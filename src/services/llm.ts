// L9_META: layer=service, role=llm_adapter, status=active, version=2.0.0
// Wraps OpenRouter API with Website-Bot specific task methods.
// Mirrors SEO-Bot LLM adapter pattern. Exposes recordUsage for BuildDB wiring (V-04).

import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';

const logger = createModuleLogger('service:llm');

const MODEL = {
  content: process.env.LLM_CONTENT_MODEL ?? 'perplexity/llama-3.1-sonar-large-128k-online',
  design:  process.env.LLM_DESIGN_MODEL  ?? 'openai/gpt-4o',
  schema:  process.env.LLM_SCHEMA_MODEL  ?? 'openai/gpt-4o-mini',
} as const;

const COST_PER_TOKEN: Record<string, number> = {
  'openai/gpt-4o':                                   0.000005,
  'openai/gpt-4o-mini':                              0.0000002,
  'perplexity/llama-3.1-sonar-large-128k-online':    0.000001,
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OKResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

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

async function call(
  model: string,
  userPrompt: string,
  systemPrompt: string,
): Promise<{ content: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new BuildError('LLM_CALL_FAILED', 'OPENROUTER_API_KEY not set');

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/cryptoxdog/Website-Bot',
      'X-Title': 'L9-Website-Bot',
    },
    body: JSON.stringify({ model, messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ], temperature: 0.3 }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new BuildError('LLM_CALL_FAILED', `OpenRouter ${res.status}: ${body}`);
  }

  const data = (await res.json()) as OKResponse;
  const content = data.choices?.[0]?.message?.content ?? '';
  const inputTokens  = data.usage?.prompt_tokens     ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const costUsd = (inputTokens + outputTokens) * (COST_PER_TOKEN[model] ?? 0.000001);

  logger.debug({ model, inputTokens, outputTokens, costUsd }, 'LLM call complete');
  return { content, inputTokens, outputTokens, costUsd };
}

export function createWebsiteFactoryLLM(_clientId: string): WebsiteFactoryLLM {
  const usageBuffer: UsageRecord[] = [];

  function record(stage: string, taskType: string, inputTokens: number, outputTokens: number, costUsd: number, model: string) {
    usageBuffer.push({ stage, taskType, model, inputTokens, outputTokens, costUsd, recordedAt: new Date().toISOString() });
  }

  return {
    async generateContent(prompt, _ctx) {
      const { content, inputTokens, outputTokens, costUsd } = await call(
        MODEL.content, prompt,
        'You are an expert copywriter for insurance supplementing businesses. Write compliance-literate, SEO-optimized copy. Be direct. Never make guarantee claims.',
      );
      record('content-generation', 'page_copy', inputTokens, outputTokens, costUsd, MODEL.content);
      return content;
    },

    async designReasoning(prompt) {
      const { content, inputTokens, outputTokens, costUsd } = await call(
        MODEL.design, prompt,
        'You are a senior brand designer. Output ONLY valid JSON. No prose, no markdown fences. Keys: primary, secondary, accent, font_heading, font_body.',
      );
      record('design-intelligence', 'design_tokens', inputTokens, outputTokens, costUsd, MODEL.design);
      return content;
    },

    async generateSchema(prompt) {
      const { content, inputTokens, outputTokens, costUsd } = await call(
        MODEL.schema, prompt,
        'You are a structured data expert. Output ONLY valid JSON-LD as a raw JSON object. No prose, no markdown fences, no code blocks.',
      );
      record('schema-generator', 'json_ld', inputTokens, outputTokens, costUsd, MODEL.schema);
      return content;
    },

    recordUsage: record,
    flushUsage() { const out = [...usageBuffer]; usageBuffer.length = 0; return out; },
  };
}
