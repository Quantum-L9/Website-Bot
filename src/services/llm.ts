// L9_META: layer=service, role=llm_adapter, status=active, version=5.0.0
//
// The single Website-Bot LLM boundary (ADR-0020). Every text, reasoning and vision
// operation crosses this adapter to the DeepSeek Chat Completions API. There is no
// router, no provider fallback, no automatic retry and no automatic model escalation.
// Image generation is NOT here: it stays isolated in services/images/GeminiImageGenerator.ts.

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import { BuildError } from "../pipeline/BuildError.js";
import { hydrateWebsiteContext } from "./memory.js";

const logger = createModuleLogger("service:llm");

// ─────────────────────────────────────────────────────────────────────────────
// Capability vocabulary (ADR-0003). Stages declare WHAT they need, never a provider
// or a model. String values are unchanged from the retired router so memory
// hydration keys and recorded task types stay stable.
// ─────────────────────────────────────────────────────────────────────────────

export const TaskType = {
  CLASSIFICATION: "classification",
  EXTRACTION: "extraction",
  SCORING: "scoring",
  CONTENT_GENERATION: "content_generation",
  STRATEGIC_REASONING: "strategic_reasoning",
  CODE_GENERATION: "code_generation",
  COMPETITOR_RESEARCH: "competitor_research",
  CITATION_CHECK: "citation_check",
  FACT_VERIFICATION: "fact_verification",
  MARKET_RESEARCH: "market_research",
  LINK_PROSPECTING: "link_prospecting",
  VISUAL_QA: "visual_qa",
  SCREENSHOT_ANALYSIS: "screenshot_analysis",
  LAYOUT_VALIDATION: "layout_validation",
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const TaskComplexity = {
  TRIVIAL: "trivial",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
} as const;
export type TaskComplexity = (typeof TaskComplexity)[keyof typeof TaskComplexity];

export interface TaskDescriptor {
  type: TaskType;
  complexity: TaskComplexity;
  expectedOutputTokens?: number;
  requiresReasoning?: boolean;
  requiresSearch?: boolean;
  clientId?: string;
  description?: string;
}

/**
 * Task types that were search-grounded (Perplexity) under the retired router. DeepSeek
 * text generation is not evidence retrieval, so these fail closed instead of producing
 * unsupported claims (no web-search subsystem is authorized in this adapter).
 */
const SEARCH_GROUNDED_TASKS: ReadonlySet<TaskType> = new Set([
  TaskType.COMPETITOR_RESEARCH,
  TaskType.CITATION_CHECK,
  TaskType.FACT_VERIFICATION,
  TaskType.MARKET_RESEARCH,
  TaskType.LINK_PROSPECTING,
]);

// ─────────────────────────────────────────────────────────────────────────────
// DeepSeek provider contract. Verified 2026-11-06 against
// https://api-docs.deepseek.com/api/create-chat-completion and
// https://api-docs.deepseek.com/quick_start/pricing (USD per 1M tokens).
// Off-peak bills half of peak; peak rates are used so recorded cost and budget
// reservations are an upper bound, never an under-count.
// ─────────────────────────────────────────────────────────────────────────────

export const DEEPSEEK_PROVIDER = "deepseek";
export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";

interface ModelPricing {
  cacheHitPerMTok: number;
  cacheMissPerMTok: number;
  outputPerMTok: number;
  vision: boolean;
}

export const DEEPSEEK_PEAK_PRICING: Readonly<Record<string, ModelPricing>> = {
  "deepseek-flash": {
    cacheHitPerMTok: 0.006,
    cacheMissPerMTok: 0.3,
    outputPerMTok: 1.2,
    vision: true,
  },
  "deepseek-v4-pro": {
    cacheHitPerMTok: 0.044,
    cacheMissPerMTok: 1.32,
    outputPerMTok: 3.96,
    vision: false,
  },
};

/** DeepSeek's documented upper bound on tokens per input image (guides/vision). */
const IMAGE_TOKEN_UPPER_BOUND = 1024;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// DeepSeek vision accepts base64 data URLs (JPEG, PNG, GIF, WebP). Local screenshots
// are read and encoded.
function imageToDataUri(path: string): string {
  const mime = IMAGE_MIME[extname(path).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

export interface UsageRecord {
  stage: string;
  taskType: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requestId?: string;
  status: "success" | "failure";
  recordedAt: string;
}

export interface WebsiteFactoryLLM {
  generateContent(prompt: string, context?: string): Promise<string>;
  designReasoning(prompt: string): Promise<string>;
  generateSchema(prompt: string): Promise<string>;
  validateLayout(imagePaths: string[], context: string): Promise<string>;
  /** Dispatch with an explicit capability descriptor (REDESIGN_IMPROVE ops). */
  strategize(task: TaskDescriptor, systemPrompt: string, userPrompt: string): Promise<string>;
  recordUsage(
    stage: string,
    taskType: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    model: string,
  ): void;
  flushUsage(): UsageRecord[];
}

/** The HTTP transport the adapter depends on — the injectable test seam. */
export type LlmTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface WebsiteFactoryLLMOptions {
  /** Environment source (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** HTTP transport seam for deterministic unit tests. Defaults to global fetch. */
  transport?: LlmTransport;
}

interface ResolvedConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  pricing: ModelPricing;
  timeoutMs: number;
  maxRequests: number;
  budgetUsd: number;
  maxInputTokens: number;
  reasoningTokenAllowance: number;
}

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface DeepSeekCompletion {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  usage?: DeepSeekUsage;
}

type UserContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

interface DispatchSpec {
  task: TaskDescriptor;
  stage: string;
  usageTaskType: string;
  systemPrompt: string;
  userPrompt: string;
  images?: string[];
  json?: boolean;
}

function fail(message: string): never {
  throw new BuildError("LLM_CALL_FAILED", message);
}

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** Cost at verified peak rates — an upper bound on what DeepSeek bills for the call. */
export function deepseekCostUsd(pricing: ModelPricing, usage: DeepSeekUsage): number {
  const prompt = nonNegativeInt(usage.prompt_tokens);
  const hit = nonNegativeInt(usage.prompt_cache_hit_tokens);
  const reportedMiss = nonNegativeInt(usage.prompt_cache_miss_tokens);
  // Without a hit/miss split every prompt token is priced as a (dearer) cache miss.
  const miss = hit + reportedMiss === prompt ? reportedMiss : prompt - Math.min(hit, prompt);
  const cachedHit = prompt - miss;
  const output = nonNegativeInt(usage.completion_tokens);
  return (
    (cachedHit * pricing.cacheHitPerMTok +
      miss * pricing.cacheMissPerMTok +
      output * pricing.outputPerMTok) /
    1_000_000
  );
}

export function createWebsiteFactoryLLM(
  clientId: string,
  options: WebsiteFactoryLLMOptions = {},
): WebsiteFactoryLLM {
  const env = options.env ?? process.env;
  const transport: LlmTransport = options.transport ?? ((url, init) => fetch(url, init));

  function required(name: string): string {
    const value = env[name]?.trim();
    if (!value) fail(`Missing required LLM configuration: ${name}`);
    return value;
  }
  function positiveNumber(name: string, fallback: number): number {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) fail(`${name} must be a positive number`);
    return value;
  }
  function positiveInt(name: string, fallback: number): number {
    const value = positiveNumber(name, fallback);
    if (!Number.isInteger(value)) fail(`${name} must be a positive integer`);
    return value;
  }

  // Lazy resolution: plan/dry-run never calls the LLM, so credential-free plan mode must
  // not fail here. Configuration (and the credential) is read only on the first real call.
  let config: ResolvedConfig | undefined;
  function getConfig(): ResolvedConfig {
    if (config) return config;
    const model = env.DEEPSEEK_MODEL?.trim() || DEEPSEEK_DEFAULT_MODEL;
    const pricing = DEEPSEEK_PEAK_PRICING[model];
    if (!pricing)
      fail(
        `DEEPSEEK_MODEL ${model} has no verified pricing; allowed: ${Object.keys(DEEPSEEK_PEAK_PRICING).join(", ")}`,
      );
    const baseUrl = (env.DEEPSEEK_BASE_URL?.trim() || DEEPSEEK_DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    if (!baseUrl.startsWith("https://")) fail("DEEPSEEK_BASE_URL must be an https:// URL");
    const resolved: ResolvedConfig = {
      model,
      pricing,
      endpoint: `${baseUrl}/chat/completions`,
      timeoutMs: positiveInt("LLM_PROVIDER_TIMEOUT_MS", 60_000),
      maxRequests: positiveInt("LLM_MAX_REQUESTS_PER_BUILD", 200),
      budgetUsd: positiveNumber("LLM_BUILD_BUDGET_USD", 10),
      maxInputTokens: positiveInt("LLM_MAX_INPUT_TOKENS", 400_000),
      reasoningTokenAllowance: positiveInt("DEEPSEEK_REASONING_TOKEN_ALLOWANCE", 8_192),
      apiKey: required("DEEPSEEK_API_KEY"),
    };
    config = resolved;
    logger.info(
      { clientId, provider: DEEPSEEK_PROVIDER, model, budgetUsd: resolved.budgetUsd },
      "LLM service initialized (direct DeepSeek)",
    );
    return resolved;
  }

  // Build allowance for this adapter instance (one instance per build). Every dispatch
  // reserves its worst-case cost first; a dispatch whose reservation does not fit is
  // never sent. Process-local: not durable across workers or restarts.
  let requestsDispatched = 0;
  let committedUsd = 0;
  let reservedUsd = 0;

  const usageBuffer: UsageRecord[] = [];
  const pushUsage = (record: Omit<UsageRecord, "recordedAt">) => {
    usageBuffer.push({ ...record, recordedAt: new Date().toISOString() });
  };

  async function dispatch(spec: DispatchSpec): Promise<string> {
    const { task, stage } = spec;
    if (task.requiresSearch === true || SEARCH_GROUNDED_TASKS.has(task.type)) {
      fail(
        `Search-grounded task ${task.type} for ${stage} is unsupported: no authorized retrieval capability backs this adapter`,
      );
    }
    const cfg = getConfig();
    const images = spec.images ?? [];
    if (images.length > 0 && !cfg.pricing.vision)
      fail(`Model ${cfg.model} does not support image input (${stage})`);

    const memoryContext = await hydrateWebsiteContext(
      clientId,
      task.type,
      task.description ?? spec.usageTaskType,
      [stage, spec.usageTaskType],
    );
    const systemContent = `${spec.systemPrompt}${memoryContext}`;
    const thinking = task.requiresReasoning === true && images.length === 0;
    const expectedOutput = Math.max(1, Math.floor(task.expectedOutputTokens ?? 2_000));
    const maxTokens = thinking ? expectedOutput + cfg.reasoningTokenAllowance : expectedOutput;

    // Upper bound on input tokens: one token never spans less than one UTF-8 byte of text.
    const inputBound =
      Buffer.byteLength(systemContent, "utf8") +
      Buffer.byteLength(spec.userPrompt, "utf8") +
      images.length * IMAGE_TOKEN_UPPER_BOUND;
    if (inputBound > cfg.maxInputTokens)
      fail(
        `Input for ${stage} exceeds LLM_MAX_INPUT_TOKENS (${inputBound} > ${cfg.maxInputTokens}); not dispatched`,
      );
    if (requestsDispatched >= cfg.maxRequests)
      fail(
        `Budget exhausted for ${stage}: LLM_MAX_REQUESTS_PER_BUILD (${cfg.maxRequests}) reached; not dispatched`,
      );
    const reservation =
      (inputBound * cfg.pricing.cacheMissPerMTok + maxTokens * cfg.pricing.outputPerMTok) /
      1_000_000;
    const remaining = cfg.budgetUsd - committedUsd - reservedUsd;
    if (reservation > remaining + 1e-12)
      fail(
        `Budget exhausted for ${stage}: reservation $${reservation.toFixed(6)} exceeds remaining $${Math.max(0, remaining).toFixed(6)} of LLM_BUILD_BUDGET_USD; not dispatched`,
      );

    const userContent: UserContent =
      images.length === 0
        ? spec.userPrompt
        : [
            { type: "text", text: spec.userPrompt },
            ...images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          ];
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      thinking: { type: thinking ? "enabled" : "disabled" },
      max_tokens: maxTokens,
      stream: false,
    };
    if (thinking) body.reasoning_effort = "low";
    if (spec.json) body.response_format = { type: "json_object" };

    requestsDispatched += 1;
    reservedUsd += reservation;
    const started = Date.now();
    // Any failure after dispatch without provider-reported usage has unverified billing:
    // its full reservation is committed against the allowance (never under-counted).
    const failUnreported = (message: string): never => {
      reservedUsd -= reservation;
      committedUsd += reservation;
      pushUsage({
        stage,
        taskType: spec.usageTaskType,
        provider: DEEPSEEK_PROVIDER,
        model: cfg.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        status: "failure",
      });
      return fail(message);
    };
    let response: Response;
    try {
      response = await transport(cfg.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (error) {
      return failUnreported(
        `LLM provider unavailable for ${stage}: DeepSeek request failed (${error instanceof Error ? error.name : "error"})`,
      );
    }
    if (!response.ok) {
      let detail = "";
      try {
        const payload = (await response.json()) as { error?: { message?: unknown } };
        if (typeof payload?.error?.message === "string")
          detail = `: ${payload.error.message.slice(0, 200)}`;
      } catch {
        /* non-JSON error body: the status alone is reported */
      }
      return failUnreported(
        `LLM provider unavailable for ${stage}: DeepSeek HTTP ${response.status}${detail}`,
      );
    }
    let completion: DeepSeekCompletion;
    try {
      completion = (await response.json()) as DeepSeekCompletion;
    } catch {
      return failUnreported(`DeepSeek returned a non-JSON response for ${stage}`);
    }
    if (!completion?.usage)
      return failUnreported(`DeepSeek response for ${stage} carried no usage`);

    const usage = completion.usage;
    const costUsd = deepseekCostUsd(cfg.pricing, usage);
    reservedUsd -= reservation;
    committedUsd += costUsd;
    const choice = completion.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason ?? "missing";
    const model = completion.model ?? cfg.model;
    const accepted =
      finishReason === "stop" && typeof content === "string" && content.trim() !== "";
    pushUsage({
      stage,
      taskType: spec.usageTaskType,
      provider: DEEPSEEK_PROVIDER,
      model,
      inputTokens: nonNegativeInt(usage.prompt_tokens),
      outputTokens: nonNegativeInt(usage.completion_tokens),
      costUsd,
      requestId: completion.id,
      status: accepted ? "success" : "failure",
    });
    // Operational metadata only — never prompts, generated content, reasoning, or keys.
    logger.info(
      {
        clientId,
        stage,
        provider: DEEPSEEK_PROVIDER,
        model,
        inputTokens: nonNegativeInt(usage.prompt_tokens),
        outputTokens: nonNegativeInt(usage.completion_tokens),
        costUsd,
        latencyMs: Date.now() - started,
        requestId: completion.id,
        finishReason,
      },
      "LLM task completed",
    );
    if (finishReason !== "stop")
      fail(`DeepSeek response for ${stage} rejected: finish_reason=${finishReason}`);
    if (typeof content !== "string" || content.trim() === "")
      fail(`DeepSeek response for ${stage} rejected: empty content`);
    return content;
  }

  return {
    async generateContent(prompt) {
      return dispatch({
        task: {
          clientId,
          type: TaskType.CONTENT_GENERATION,
          complexity: TaskComplexity.MEDIUM,
          expectedOutputTokens: 3000,
          description: "[content-generation] page_copy",
        },
        systemPrompt:
          "You are an expert conversion copywriter for local service businesses. Write compliance-literate, SEO-optimized copy. Be direct. Never make guarantee claims.",
        userPrompt: prompt,
        stage: "content-generation",
        usageTaskType: "page_copy",
      });
    },
    async designReasoning(prompt) {
      return dispatch({
        task: {
          clientId,
          type: TaskType.STRATEGIC_REASONING,
          complexity: TaskComplexity.HIGH,
          requiresReasoning: true,
          expectedOutputTokens: 1000,
          description: "[design-intelligence] design_tokens",
        },
        systemPrompt:
          "You are a senior brand designer. Output ONLY valid JSON. No prose, no markdown fences. Keys: primary, secondary, accent, font_heading, font_body.",
        userPrompt: prompt,
        stage: "design-intelligence",
        usageTaskType: "design_tokens",
        json: true,
      });
    },
    async generateSchema(prompt) {
      return dispatch({
        task: {
          clientId,
          type: TaskType.CODE_GENERATION,
          complexity: TaskComplexity.LOW,
          expectedOutputTokens: 1500,
          description: "[schema-generator] json_ld",
        },
        systemPrompt:
          "You are a structured data expert. Output ONLY valid JSON-LD as raw JSON. No prose or code fences.",
        userPrompt: prompt,
        stage: "schema-generator",
        usageTaskType: "json_ld",
      });
    },
    async validateLayout(imagePaths, context) {
      return dispatch({
        task: {
          clientId,
          type: TaskType.LAYOUT_VALIDATION,
          complexity: TaskComplexity.MEDIUM,
          expectedOutputTokens: 800,
          description: "[visual-qa] layout_validation",
        },
        // A machine-checkable result (scripts/verify-visual-qa.mjs verdictFor): prose is never a verdict.
        systemPrompt:
          'You are a meticulous web layout QA reviewer. From the attached screenshot(s), identify layout, spacing, overflow, alignment, contrast, and responsiveness defects. Respond with ONLY one JSON object and nothing else: {"verdict":"pass"|"fail"|"blocked","defects":[{"severity":"critical"|"major"|"minor","description":"..."}],"summary":"..."}. Use "fail" only when at least one defect is critical; "pass" only when you could fully inspect every screenshot and found no critical defect; "blocked" whenever you cannot judge a screenshot.',
        userPrompt: `Evaluate the attached screenshot(s) for layout defects. ${context}`,
        stage: "visual-qa",
        usageTaskType: "layout_validation",
        images: imagePaths.map(imageToDataUri),
        json: true,
      });
    },
    async strategize(task, systemPrompt, userPrompt) {
      return dispatch({
        task: { ...task, clientId, description: task.description ?? "[intelligence] improve_op" },
        systemPrompt,
        userPrompt,
        stage: "competitive-intelligence",
        usageTaskType: task.type,
      });
    },
    recordUsage(stage, taskType, inputTokens, outputTokens, costUsd, model) {
      pushUsage({
        stage,
        taskType,
        provider: DEEPSEEK_PROVIDER,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        status: "success",
      });
    },
    flushUsage() {
      const output = [...usageBuffer];
      usageBuffer.length = 0;
      return output;
    },
  };
}
