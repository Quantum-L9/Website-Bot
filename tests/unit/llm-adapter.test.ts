// L9_META: layer=test, role=llm_adapter_contract, status=active, version=2.0.0
//
// Deterministic contract for the direct-DeepSeek adapter (ADR-0020). Every test drives a
// fake HTTP transport: no network, no paid calls.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  createWebsiteFactoryLLM,
  DEEPSEEK_PEAK_PRICING,
  deepseekCostUsd,
  type LlmTransport,
  TaskComplexity,
  type TaskDescriptor,
  TaskType,
} from "../../src/services/llm.js";

process.env.L9_MEMORY_MODE ??= "disabled";

const KEY_ONLY = { DEEPSEEK_API_KEY: "ds-key" } as NodeJS.ProcessEnv;

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface Reply {
  status?: number;
  json?: unknown;
  raw?: string;
  throws?: unknown;
}

function completion(over: Record<string, unknown> = {}, content: unknown = "ok") {
  return {
    id: "req-1",
    model: "deepseek-flash",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_cache_hit_tokens: 40,
      prompt_cache_miss_tokens: 60,
    },
    ...over,
  };
}

function harness(replies: Reply[] | ((n: number) => Reply) = []) {
  const calls: Captured[] = [];
  const transport: LlmTransport = async (url, init) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const reply =
      typeof replies === "function" ? replies(calls.length) : (replies[calls.length - 1] ?? {});
    if (reply.throws) throw reply.throws;
    const text = reply.raw ?? JSON.stringify(reply.json ?? completion());
    return new Response(text, {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, transport };
}

const isLlmFailure =
  (message: RegExp) =>
  (error: unknown): boolean =>
    error instanceof BuildError && error.code === "LLM_CALL_FAILED" && message.test(error.message);

const userText = (call: Captured): unknown =>
  (call.body.messages as Array<{ role: string; content: unknown }>)[1].content;

void test("D01 a valid DeepSeek text response is returned through generateContent", async () => {
  const h = harness([{ json: completion({}, "Hero copy") }]);
  const llm = createWebsiteFactoryLLM("client-x", { env: KEY_ONLY, transport: h.transport });
  assert.equal(await llm.generateContent("write hero"), "Hero copy");
  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.equal(call.url, "https://api.deepseek.com/chat/completions");
  assert.equal(call.headers.Authorization, "Bearer ds-key");
  assert.equal(call.body.model, "deepseek-flash");
  assert.equal(call.body.stream, false);
  const messages = call.body.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /conversion copywriter/i);
  assert.equal(messages[1].content, "write hero");
});

void test("D02 structured JSON tasks request json_object and return the JSON text unchanged", async () => {
  const tokens = JSON.stringify({ primary: "#111111", secondary: "#222222" });
  const h = harness([{ json: completion({}, tokens) }]);
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
  const raw = await llm.designReasoning("tokens");
  assert.deepEqual(JSON.parse(raw), JSON.parse(tokens));
  assert.deepEqual(h.calls[0].body.response_format, { type: "json_object" });
  // JSON-LD keeps text mode: a JSON-LD document may legitimately be an array.
  const schema = harness([{ json: completion({}, '[{"@type":"Organization"}]') }]);
  const llm2 = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: schema.transport });
  assert.equal(await llm2.generateSchema("json-ld"), '[{"@type":"Organization"}]');
  assert.equal(schema.calls[0].body.response_format, undefined);
});

void test("D03 strategic reasoning enables thinking with low effort and a bounded output", async () => {
  const h = harness();
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
  await llm.designReasoning("tokens");
  const body = h.calls[0].body;
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.max_tokens, 1000 + 8192);
  const task: TaskDescriptor = {
    type: TaskType.STRATEGIC_REASONING,
    complexity: TaskComplexity.HIGH,
    requiresReasoning: true,
    requiresSearch: false,
    expectedOutputTokens: 12000,
  };
  const h2 = harness();
  const env = { ...KEY_ONLY, DEEPSEEK_REASONING_TOKEN_ALLOWANCE: "4000" } as NodeJS.ProcessEnv;
  const llm2 = createWebsiteFactoryLLM("c", { env, transport: h2.transport });
  await llm2.strategize(task, "sys", "user");
  assert.equal(h2.calls[0].body.max_tokens, 16000);
  assert.equal(h2.calls[0].body.model, "deepseek-flash"); // never escalated automatically
});

void test("D04 routine content and schema generation disable thinking", async () => {
  const h = harness();
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
  await llm.generateContent("a");
  await llm.generateSchema("b");
  for (const call of h.calls) {
    assert.deepEqual(call.body.thinking, { type: "disabled" });
    assert.equal(call.body.reasoning_effort, undefined);
  }
  assert.equal(h.calls[0].body.max_tokens, 3000);
  assert.equal(h.calls[1].body.max_tokens, 1500);
});

void test("D05 a missing DEEPSEEK_API_KEY fails before any request", async () => {
  const h = harness();
  const llm = createWebsiteFactoryLLM("c", {
    env: {} as NodeJS.ProcessEnv,
    transport: h.transport,
  });
  await assert.rejects(() => llm.generateContent("a"), isLlmFailure(/DEEPSEEK_API_KEY/));
  assert.equal(h.calls.length, 0);
});

void test("D06 the DeepSeek credential alone is sufficient for every text and reasoning operation", async () => {
  const h = harness();
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
  await llm.generateContent("a");
  await llm.designReasoning("b");
  await llm.generateSchema("c");
  await llm.strategize(
    { type: TaskType.EXTRACTION, complexity: TaskComplexity.HIGH, requiresSearch: false },
    "s",
    "u",
  );
  assert.equal(h.calls.length, 4);
});

void test("D07 OpenRouter/Perplexity credentials are never used and never sufficient", async () => {
  const h = harness();
  const retired = { OPENROUTER_API_KEY: "or", PERPLEXITY_API_KEY: "px" } as NodeJS.ProcessEnv;
  const blocked = createWebsiteFactoryLLM("c", { env: retired, transport: h.transport });
  await assert.rejects(() => blocked.generateContent("a"), isLlmFailure(/DEEPSEEK_API_KEY/));
  assert.equal(h.calls.length, 0);
  const both = createWebsiteFactoryLLM("c", {
    env: { ...retired, ...KEY_ONLY },
    transport: h.transport,
  });
  await both.generateContent("a");
  assert.equal(h.calls.length, 1);
  assert.equal(new URL(h.calls[0].url).host, "api.deepseek.com");
  assert.equal(h.calls[0].headers.Authorization, "Bearer ds-key");
});

void test("D08 HTTP 429/500 fail explicitly with no retry and no fallback", async () => {
  for (const status of [429, 500]) {
    const h = harness([{ status, json: { error: { message: "busy" } } }]);
    const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
    await assert.rejects(
      () => llm.generateContent("a"),
      isLlmFailure(
        new RegExp(
          `LLM provider unavailable for content-generation: DeepSeek HTTP ${status}: busy`,
        ),
      ),
    );
    assert.equal(h.calls.length, 1);
    const [usage] = llm.flushUsage();
    assert.equal(usage.status, "failure");
    assert.equal(usage.provider, "deepseek");
  }
  const timeout = harness([{ throws: new DOMException("timed out", "TimeoutError") }]);
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: timeout.transport });
  await assert.rejects(
    () => llm.generateContent("a"),
    isLlmFailure(/request failed \(TimeoutError\)/),
  );
  assert.equal(timeout.calls.length, 1);
});

void test("D09 empty, truncated, refused or malformed responses are rejected", async () => {
  const cases: Array<[Reply, RegExp]> = [
    [{ json: completion({}, "") }, /empty content/],
    [{ json: completion({}, "   ") }, /empty content/],
    [{ json: completion({}, null) }, /empty content/],
    [
      {
        json: {
          ...completion(),
          choices: [{ finish_reason: "length", message: { content: '{"a":' } }],
        },
      },
      /finish_reason=length/,
    ],
    [
      {
        json: {
          ...completion(),
          choices: [{ finish_reason: "content_filter", message: { content: "x" } }],
        },
      },
      /finish_reason=content_filter/,
    ],
    [{ json: { ...completion(), choices: [] } }, /finish_reason=missing/],
    [{ raw: "<html>gateway</html>" }, /non-JSON response/],
    [
      { json: { id: "x", choices: [{ finish_reason: "stop", message: { content: "x" } }] } },
      /no usage/,
    ],
  ];
  for (const [reply, message] of cases) {
    const h = harness([reply]);
    const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
    await assert.rejects(() => llm.generateContent("a"), isLlmFailure(message));
  }
});

void test("D10 a request that exceeds the allowance is rejected before dispatch", async () => {
  const h = harness();
  const tiny = createWebsiteFactoryLLM("c", {
    env: { ...KEY_ONLY, LLM_BUILD_BUDGET_USD: "0.000001" } as NodeJS.ProcessEnv,
    transport: h.transport,
  });
  await assert.rejects(
    () => tiny.generateContent("a"),
    isLlmFailure(/Budget exhausted.*not dispatched/),
  );
  const capped = createWebsiteFactoryLLM("c", {
    env: { ...KEY_ONLY, LLM_MAX_REQUESTS_PER_BUILD: "1" } as NodeJS.ProcessEnv,
    transport: h.transport,
  });
  await capped.generateContent("a");
  await assert.rejects(
    () => capped.generateContent("b"),
    isLlmFailure(/LLM_MAX_REQUESTS_PER_BUILD \(1\)/),
  );
  const bounded = createWebsiteFactoryLLM("c", {
    env: { ...KEY_ONLY, LLM_MAX_INPUT_TOKENS: "50" } as NodeJS.ProcessEnv,
    transport: h.transport,
  });
  await assert.rejects(
    () => bounded.generateContent("a"),
    isLlmFailure(/exceeds LLM_MAX_INPUT_TOKENS/),
  );
  assert.equal(h.calls.length, 1); // only the single admitted call reached the provider
});

void test("D10b failures without reported usage stay charged; the allowance closes after them", async () => {
  const h = harness(() => ({ status: 503 }));
  // Allowance fits exactly one worst-case content reservation.
  const llm = createWebsiteFactoryLLM("c", {
    env: { ...KEY_ONLY, LLM_BUILD_BUDGET_USD: "0.0045" } as NodeJS.ProcessEnv,
    transport: h.transport,
  });
  await assert.rejects(() => llm.generateContent("a"), isLlmFailure(/HTTP 503/));
  await assert.rejects(() => llm.generateContent("a"), isLlmFailure(/Budget exhausted/));
  assert.equal(h.calls.length, 1);
});

void test("D11 multiple stages share one cumulative allowance", async () => {
  const h = harness();
  // Each content call reserves ~$0.0036 (bytes + 3000 output tokens at peak); actual is tiny.
  const llm = createWebsiteFactoryLLM("c", {
    env: { ...KEY_ONLY, LLM_BUILD_BUDGET_USD: "0.004" } as NodeJS.ProcessEnv,
    transport: h.transport,
  });
  await llm.generateContent("a");
  await llm.generateSchema("b");
  await llm.generateContent("c");
  const usage = llm.flushUsage();
  assert.deepEqual(
    usage.map((u) => u.stage),
    ["content-generation", "schema-generator", "content-generation"],
  );
  const total = usage.reduce((sum, u) => sum + u.costUsd, 0);
  assert.ok(
    Math.abs(
      total - 3 * deepseekCostUsd(DEEPSEEK_PEAK_PRICING["deepseek-flash"], completion().usage),
    ) < 1e-12,
  );
  // After committed spend, a reservation larger than the remainder is refused pre-dispatch.
  const hungry = createWebsiteFactoryLLM("c", {
    env: { ...KEY_ONLY, LLM_BUILD_BUDGET_USD: "0.006" } as NodeJS.ProcessEnv,
    transport: harness(() => ({
      json: completion({ usage: { prompt_tokens: 1000, completion_tokens: 3000 } }),
    })).transport,
  });
  await hungry.generateContent("a");
  await assert.rejects(() => hungry.generateContent("b"), isLlmFailure(/Budget exhausted/));
});

void test("D12 provider-reported tokens and computed cost are recorded exactly", async () => {
  const h = harness([{ json: completion({ id: "req-42", model: "deepseek-flash" }) }]);
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
  await llm.generateContent("a");
  const [usage] = llm.flushUsage();
  assert.equal(usage.provider, "deepseek");
  assert.equal(usage.model, "deepseek-flash");
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 50);
  assert.equal(usage.requestId, "req-42");
  assert.equal(usage.status, "success");
  assert.equal(usage.stage, "content-generation");
  assert.equal(usage.taskType, "page_copy");
  // 40 hit × $0.006 + 60 miss × $0.30 + 50 out × $1.20, per 1M tokens (peak).
  assert.ok(Math.abs(usage.costUsd - (40 * 0.006 + 60 * 0.3 + 50 * 1.2) / 1e6) < 1e-15);
  assert.deepEqual(llm.flushUsage(), []);
  // Without a hit/miss split every prompt token is priced as a cache miss.
  const pricing = DEEPSEEK_PEAK_PRICING["deepseek-flash"];
  assert.ok(Math.abs(deepseekCostUsd(pricing, { prompt_tokens: 10 }) - (10 * 0.3) / 1e6) < 1e-15);
});

void test("D13 stage errors keep the BuildError LLM_CALL_FAILED contract", async () => {
  const h = harness([{ status: 401, json: { error: { message: "Authentication Fails" } } }]);
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
  await assert.rejects(
    () => llm.designReasoning("a"),
    (error: unknown) =>
      error instanceof BuildError &&
      error.code === "LLM_CALL_FAILED" &&
      /design-intelligence/.test(error.message) &&
      !/ds-key/.test(error.message),
  );
  for (const [name, value] of [
    ["LLM_PROVIDER_TIMEOUT_MS", "0"],
    ["LLM_BUILD_BUDGET_USD", "abc"],
    ["LLM_MAX_REQUESTS_PER_BUILD", "1.5"],
    ["DEEPSEEK_MODEL", "deepseek-unknown"],
    ["DEEPSEEK_BASE_URL", "http://api.deepseek.com"],
  ]) {
    const probe = harness();
    const bad = createWebsiteFactoryLLM("c", {
      env: { ...KEY_ONLY, [name]: value } as NodeJS.ProcessEnv,
      transport: probe.transport,
    });
    await assert.rejects(() => bad.generateContent("a"), isLlmFailure(/./));
    assert.equal(probe.calls.length, 0, `${name}=${value} must fail before dispatch`);
  }
});

void test("D14 construction is lazy: no credential read and no request before the first call", () => {
  const h = harness();
  const llm = createWebsiteFactoryLLM("c", {
    env: {} as NodeJS.ProcessEnv,
    transport: h.transport,
  });
  assert.deepEqual(llm.flushUsage(), []);
  llm.recordUsage("stage", "task", 1, 2, 0.5, "deepseek-flash");
  const [manual] = llm.flushUsage();
  assert.equal(manual.costUsd, 0.5);
  assert.equal(h.calls.length, 0);
});

void test("D15 search-grounded requests fail closed instead of inventing evidence", async () => {
  const h = harness();
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
  const grounded: TaskDescriptor[] = [
    { type: TaskType.STRATEGIC_REASONING, complexity: TaskComplexity.HIGH, requiresSearch: true },
    { type: TaskType.COMPETITOR_RESEARCH, complexity: TaskComplexity.MEDIUM },
    { type: TaskType.FACT_VERIFICATION, complexity: TaskComplexity.LOW },
    { type: TaskType.MARKET_RESEARCH, complexity: TaskComplexity.MEDIUM },
  ];
  for (const task of grounded) {
    await assert.rejects(
      () => llm.strategize(task, "s", "u"),
      isLlmFailure(/Search-grounded task/),
    );
  }
  assert.equal(h.calls.length, 0);
});

void test("D16 the text adapter has no image-generation path; images stay on Gemini", () => {
  const adapter = readFileSync(new URL("../../src/services/llm.ts", import.meta.url), "utf8");
  const generator = readFileSync(
    new URL("../../src/services/images/GeminiImageGenerator.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(adapter, /GEMINI_API_KEY|generativelanguage|from ["'][^"']*images\//);
  assert.doesNotMatch(generator, /services\/llm|deepseek/i);
  assert.match(generator, /GEMINI_API_KEY/);
});

void test("D17 stage-facing prompts and task semantics are unchanged", async () => {
  const h = harness();
  const llm = createWebsiteFactoryLLM("client-x", { env: KEY_ONLY, transport: h.transport });
  await llm.generateSchema("json-ld");
  await llm.strategize(
    {
      type: TaskType.STRATEGIC_REASONING,
      complexity: TaskComplexity.HIGH,
      requiresReasoning: true,
      requiresSearch: false,
      expectedOutputTokens: 5000,
    },
    "custom system",
    "custom user",
  );
  const schemaSystem = (h.calls[0].body.messages as Array<{ content: string }>)[0].content;
  assert.match(schemaSystem, /structured data expert/i);
  const strat = h.calls[1].body.messages as Array<{ content: string }>;
  assert.equal(strat[0].content, "custom system");
  assert.equal(strat[1].content, "custom user");
  const usage = llm.flushUsage();
  assert.equal(usage[1].stage, "competitive-intelligence");
  assert.equal(usage[1].taskType, TaskType.STRATEGIC_REASONING);
});

void test("D18 validateLayout sends screenshots as DeepSeek image parts and keeps its report contract", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vqa-"));
  const shot = join(dir, "home_desktop.png");
  writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  const verdict = JSON.stringify({ verdict: "pass", defects: [], summary: "clean" });
  const h = harness([{ json: completion({}, verdict) }]);
  const llm = createWebsiteFactoryLLM("c", { env: KEY_ONLY, transport: h.transport });
  assert.equal(await llm.validateLayout([shot], "Page: /, Viewport: desktop (1440x900)"), verdict);
  const body = h.calls[0].body;
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.deepEqual(body.response_format, { type: "json_object" });
  const parts = userText(h.calls[0]) as Array<Record<string, unknown>>;
  assert.equal(parts[0].type, "text");
  assert.match(String(parts[0].text), /Page: \/, Viewport: desktop/);
  assert.equal(parts[1].type, "image_url");
  assert.ok(
    String((parts[1].image_url as { url: string }).url).startsWith("data:image/png;base64,"),
  );
  // A model without verified vision support refuses before dispatch.
  const pro = harness();
  const noVision = createWebsiteFactoryLLM("c", {
    env: { ...KEY_ONLY, DEEPSEEK_MODEL: "deepseek-v4-pro" } as NodeJS.ProcessEnv,
    transport: pro.transport,
  });
  await assert.rejects(
    () => noVision.validateLayout([shot], "x"),
    isLlmFailure(/does not support image input/),
  );
  assert.equal(pro.calls.length, 0);
});
