// L9_META: layer=service, role=llm_adapter, status=active, version=4.0.0
import {
  BudgetExhaustedError,
  CircuitOpenError,
  L9LLMRouter,
  ProviderRequestError,
  RouterConfigValidationError,
  TaskComplexity,
  TaskType,
  type LLMResponse,
  type RouterConfig,
  type TaskDescriptor,
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

/** Minimal router surface the adapter depends on — the injectable test seam. */
type RouterPort = Pick<L9LLMRouter, 'initClient' | 'execute'>;

export interface WebsiteFactoryLLMOptions {
  /** Environment source (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Router constructor seam for deterministic unit tests. Defaults to the real router. */
  routerFactory?: (config: RouterConfig) => RouterPort;
}

export function createWebsiteFactoryLLM(
  clientId: string,
  options: WebsiteFactoryLLMOptions = {},
): WebsiteFactoryLLM {
  const env = options.env ?? process.env;
  const routerFactory = options.routerFactory ?? ((config: RouterConfig) => new L9LLMRouter(config));

  function required(name: string): string {
    const value = env[name]?.trim();
    if (!value) throw new BuildError('LLM_CALL_FAILED', `Missing required LLM configuration: ${name}`);
    return value;
  }
  function positiveNumber(name: string, fallback: number): number {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new BuildError('LLM_CALL_FAILED', `${name} must be a positive number`);
    return value;
  }

  // Lazy construction: plan/dry-run never calls the LLM, so credential-free plan mode must
  // not fail here. The router is built (and credentials required) only on the first real call.
  let router: RouterPort | undefined;
  function getRouter(): RouterPort {
    if (router) return router;
    const config: RouterConfig = {
      openrouterApiKey: required('OPENROUTER_API_KEY'),
      perplexityApiKey: required('PERPLEXITY_API_KEY'),
      appName: 'L9-Website-Bot',
      providerTimeoutMs: positiveNumber('LLM_PROVIDER_TIMEOUT_MS', 60_000),
      providerMaxRetries: 0,
      budget: {
        monthlyBudgetPerClient: positiveNumber('MONTHLY_BUDGET_PER_CLIENT', 200),
        weeklyTarget: positiveNumber('WEEKLY_BUDGET_TARGET', 50),
        weeklyHardCeiling: positiveNumber('WEEKLY_BUDGET_HARD_CEILING', 100),
      },
    };
    try {
      router = routerFactory(config);
      router.initClient(clientId);
      logger.info({ clientId }, 'LLM service initialized with @quantum-l9/llm-router');
      return router;
    } catch (error) {
      if (error instanceof BuildError) throw error;
      if (error instanceof RouterConfigValidationError) {
        throw new BuildError('LLM_CALL_FAILED', `Invalid LLM router configuration: ${error.message}`);
      }
      throw new BuildError('LLM_CALL_FAILED', `Unable to initialize LLM router: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const usageBuffer: UsageRecord[] = [];
  const record = (stage: string, taskType: string, inputTokens: number, outputTokens: number, costUsd: number, model: string) => {
    usageBuffer.push({ stage, taskType, model, inputTokens, outputTokens, costUsd, recordedAt: new Date().toISOString() });
  };

  async function run(
    task: TaskDescriptor,
    systemPrompt: string,
    userPrompt: string,
    stage: string,
    usageTaskType: string,
  ): Promise<LLMResponse> {
    let response: LLMResponse;
    try {
      response = await getRouter().execute(task, systemPrompt, userPrompt);
    } catch (error) {
      if (error instanceof BuildError) throw error;
      if (error instanceof BudgetExhaustedError) {
        throw new BuildError('LLM_CALL_FAILED', `Budget exhausted for ${stage}: ${error.message}`);
      }
      if (error instanceof ProviderRequestError || error instanceof CircuitOpenError) {
        throw new BuildError('LLM_CALL_FAILED', `LLM provider unavailable for ${stage}: ${error.message}`);
      }
      throw new BuildError('LLM_CALL_FAILED', `Router execution failed for ${stage}: ${error instanceof Error ? error.message : String(error)}`);
    }
    record(stage, usageTaskType, response.inputTokens, response.outputTokens, response.cost, response.model);
    // Operational metadata only — never prompts, generated content, keys, or full bodies.
    logger.info(
      {
        clientId,
        stage,
        provider: response.provider,
        model: response.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costUsd: response.cost,
        latencyMs: response.latencyMs,
        requestId: response.requestId,
      },
      'LLM task completed',
    );
    return response;
  }

  return {
    async generateContent(prompt) {
      const response = await run(
        { clientId, type: TaskType.CONTENT_GENERATION, complexity: TaskComplexity.MEDIUM, expectedOutputTokens: 3000, description: '[content-generation] page_copy' },
        'You are an expert conversion copywriter for local service businesses. Write compliance-literate, SEO-optimized copy. Be direct. Never make guarantee claims.',
        prompt,
        'content-generation',
        'page_copy',
      );
      return response.content;
    },
    async designReasoning(prompt) {
      const response = await run(
        { clientId, type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.HIGH, requiresReasoning: true, expectedOutputTokens: 1000, description: '[design-intelligence] design_tokens' },
        'You are a senior brand designer. Output ONLY valid JSON. No prose, no markdown fences. Keys: primary, secondary, accent, font_heading, font_body.',
        prompt,
        'design-intelligence',
        'design_tokens',
      );
      return response.content;
    },
    async generateSchema(prompt) {
      const response = await run(
        { clientId, type: TaskType.CODE_GENERATION, complexity: TaskComplexity.LOW, expectedOutputTokens: 1500, description: '[schema-generator] json_ld' },
        'You are a structured data expert. Output ONLY valid JSON-LD as raw JSON. No prose or code fences.',
        prompt,
        'schema-generator',
        'json_ld',
      );
      return response.content;
    },
    recordUsage: record,
    flushUsage() {
      const output = [...usageBuffer];
      usageBuffer.length = 0;
      return output;
    },
  };
}
