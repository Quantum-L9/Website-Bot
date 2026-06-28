// L9_META: layer=service, role=llm_adapter, status=active, version=3.0.0
// Thin adapter over @quantum-l9/llm-router. Website-Bot no longer talks to
// OpenRouter directly — all model selection, budgeting, and provider management
// live in the shared router package. This file only maps the pipeline's three
// task methods onto TaskDescriptors and keeps the BuildDB usage buffer (V-04).

import {
  L9LLMRouter,
  TaskType,
  TaskComplexity,
  BudgetExhaustedError,
  type TaskDescriptor,
  type LLMResponse,
} from '@quantum-l9/llm-router';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';

const logger = createModuleLogger('service:llm');

interface UsageRecord {
  stage: string;
  taskType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  recordedAt: string;
}

export interface WebsiteFactoryLLM {
  generateContent(prompt: string, context?: string): Promise<string>;
  designReasoning(prompt: string): Promise<string>;
  generateSchema(prompt: string): Promise<string>;
  recordUsage(stage: string, taskType: string, inputTokens: number, outputTokens: number, costUsd: number, model: string): void;
  flushUsage(): UsageRecord[];
}

export function createWebsiteFactoryLLM(clientId: string): WebsiteFactoryLLM {
  // Lazily constructed on first call so factory creation stays side-effect-free
  // (a dry run never touches the network or requires OPENROUTER_API_KEY).
  let router: L9LLMRouter | null = null;
  function getRouter(): L9LLMRouter {
    if (router) return router;
    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) throw new BuildError('LLM_CALL_FAILED', 'OPENROUTER_API_KEY not set');
    router = new L9LLMRouter({
      openrouterApiKey,
      // Only required for search-grounded tasks, which this pipeline does not
      // run; pass it through when present so the router is fully configured.
      perplexityApiKey: process.env.PERPLEXITY_API_KEY ?? '',
      appName: 'L9-Website-Bot',
    });
    // Budget tracking is per-client; the router throws if a client isn't initialized.
    router.initClient(clientId);
    logger.info({ clientId }, 'LLM service initialized with @quantum-l9/llm-router');
    return router;
  }

  const usageBuffer: UsageRecord[] = [];

  function record(stage: string, taskType: string, inputTokens: number, outputTokens: number, costUsd: number, model: string) {
    usageBuffer.push({ stage, taskType, model, inputTokens, outputTokens, costUsd, recordedAt: new Date().toISOString() });
  }

  async function run(
    task: TaskDescriptor,
    systemPrompt: string,
    userPrompt: string,
    stage: string,
    usageTaskType: string,
  ): Promise<LLMResponse> {
    try {
      const res = await getRouter().execute(task, systemPrompt, userPrompt);
      record(stage, usageTaskType, res.inputTokens, res.outputTokens, res.cost, res.model);
      return res;
    } catch (e) {
      if (e instanceof BudgetExhaustedError) {
        throw new BuildError('LLM_CALL_FAILED', `Budget exhausted for ${stage}: ${e.message}`);
      }
      throw new BuildError('LLM_CALL_FAILED', `Router execute failed for ${stage}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    async generateContent(prompt, _ctx) {
      const res = await run(
        { clientId, type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.MEDIUM, expectedOutputTokens: 3000, description: '[content-generation] page_copy' },
        'You are an expert copywriter for insurance supplementing businesses. Write compliance-literate, SEO-optimized copy. Be direct. Never make guarantee claims.',
        prompt,
        'content-generation',
        'page_copy',
      );
      return res.content;
    },

    async designReasoning(prompt) {
      const res = await run(
        { clientId, type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.HIGH, requiresReasoning: true, expectedOutputTokens: 1000, description: '[design-intelligence] design_tokens' },
        'You are a senior brand designer. Output ONLY valid JSON. No prose, no markdown fences. Keys: primary, secondary, accent, font_heading, font_body.',
        prompt,
        'design-intelligence',
        'design_tokens',
      );
      return res.content;
    },

    async generateSchema(prompt) {
      const res = await run(
        { clientId, type: TaskType.CODE_GENERATION, complexity: TaskComplexity.LOW, expectedOutputTokens: 1500, description: '[schema-generator] json_ld' },
        'You are a structured data expert. Output ONLY valid JSON-LD as a raw JSON object. No prose, no markdown fences, no code blocks.',
        prompt,
        'schema-generator',
        'json_ld',
      );
      return res.content;
    },

    recordUsage: record,
    flushUsage() { const out = [...usageBuffer]; usageBuffer.length = 0; return out; },
  };
}
