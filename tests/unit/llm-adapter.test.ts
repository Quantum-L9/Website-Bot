// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CircuitOpenError,
  BudgetExhaustedError,
  ProviderRequestError,
  Provider,
  TaskComplexity,
  TaskType,
  type LLMResponse,
  type RouterConfig,
  type TaskDescriptor,
  type BudgetConfig,
} from '@quantum-l9/llm-router';
import { createWebsiteFactoryLLM } from '../../src/services/llm.js';
import { BuildError } from '../../src/pipeline/BuildError.js';

const BOTH_KEYS = { OPENROUTER_API_KEY: 'or-key', PERPLEXITY_API_KEY: 'px-key' } as NodeJS.ProcessEnv;

function fakeResponse(over: Partial<LLMResponse> = {}): LLMResponse {
  return {
    content: 'ok',
    model: 'openrouter/some-model',
    provider: Provider.OPENROUTER,
    inputTokens: 11,
    outputTokens: 22,
    totalTokens: 33,
    cost: 0.02,
    latencyMs: 5,
    cached: false,
    ...over,
  };
}

interface Recorded { task: TaskDescriptor; systemPrompt: string; userPrompt: string; options?: { images?: string[] }; }

function makeHarness(opts: { response?: LLMResponse; throwOnExecute?: unknown } = {}) {
  const initCalls: string[] = [];
  const execCalls: Recorded[] = [];
  let factoryCalls = 0;
  const routerFactory = (_config: RouterConfig) => {
    factoryCalls += 1;
    return {
      // 1.1.1 RouterPort requires Promise<void> (initClient is async on L9LLMRouter).
      async initClient(clientId: string, _overrides?: Partial<BudgetConfig>): Promise<void> {
        initCalls.push(clientId);
      },
      async execute(
        task: TaskDescriptor,
        systemPrompt: string,
        userPrompt: string,
        options?: { images?: string[]; assistantContext?: string; consensus?: boolean; signal?: AbortSignal },
      ): Promise<LLMResponse> {
        execCalls.push({ task, systemPrompt, userPrompt, options });
        if (opts.throwOnExecute) throw opts.throwOnExecute;
        return opts.response ?? fakeResponse();
      },
    };
  };
  return { routerFactory, initCalls, execCalls, getFactoryCalls: () => factoryCalls };
}

const isLlmFailure = (message: RegExp) => (error: unknown): boolean =>
  error instanceof BuildError && error.code === 'LLM_CALL_FAILED' && message.test(error.message);

void test('generateContent maps to CONTENT_GENERATION/MEDIUM with clientId and prompts', async () => {
  const h = makeHarness();
  const llm = createWebsiteFactoryLLM('client-x', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  const out = await llm.generateContent('write hero');
  assert.equal(out, 'ok');
  assert.equal(h.execCalls.length, 1);
  const { task, systemPrompt, userPrompt } = h.execCalls[0];
  assert.equal(task.type, TaskType.CONTENT_GENERATION);
  assert.equal(task.complexity, TaskComplexity.MEDIUM);
  assert.equal(task.clientId, 'client-x');
  assert.match(systemPrompt, /conversion copywriter/i);
  assert.equal(userPrompt, 'write hero');
});

void test('designReasoning maps to STRATEGIC_REASONING/HIGH with requiresReasoning', async () => {
  const h = makeHarness();
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  await llm.designReasoning('tokens');
  const { task } = h.execCalls[0];
  assert.equal(task.type, TaskType.STRATEGIC_REASONING);
  assert.equal(task.complexity, TaskComplexity.HIGH);
  assert.equal(task.requiresReasoning, true);
});

void test('generateSchema maps to CODE_GENERATION/LOW', async () => {
  const h = makeHarness();
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  await llm.generateSchema('json-ld');
  const { task } = h.execCalls[0];
  assert.equal(task.type, TaskType.CODE_GENERATION);
  assert.equal(task.complexity, TaskComplexity.LOW);
});

void test('validateLayout maps to LAYOUT_VALIDATION and passes screenshots as base64 data URIs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vqa-'));
  const shot = join(dir, 'home_desktop.png');
  writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  const h = makeHarness();
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  const out = await llm.validateLayout([shot], 'Page: /, Viewport: desktop (1440x900)');
  assert.equal(out, 'ok');
  const { task, options, userPrompt } = h.execCalls[0];
  assert.equal(task.type, TaskType.LAYOUT_VALIDATION);
  assert.equal(task.complexity, TaskComplexity.MEDIUM);
  assert.equal(options?.images?.length, 1);
  assert.ok(options?.images?.[0].startsWith('data:image/png;base64,'));
  assert.match(userPrompt, /Page: \/, Viewport: desktop/);
});

void test('construction is lazy: no router built, keys unread, flushUsage works pre-init', () => {
  const h = makeHarness();
  const llm = createWebsiteFactoryLLM('c', { env: {} as NodeJS.ProcessEnv, routerFactory: h.routerFactory });
  assert.equal(h.getFactoryCalls(), 0);           // creating the service reads no keys and builds no router
  assert.deepEqual(llm.flushUsage(), []);          // usable before any router init
  assert.equal(h.getFactoryCalls(), 0);
});

void test('router factory and initClient run exactly once across multiple calls', async () => {
  const h = makeHarness();
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  await llm.generateContent('a');
  await llm.designReasoning('b');
  await llm.generateSchema('d');
  assert.equal(h.getFactoryCalls(), 1);
  assert.deepEqual(h.initCalls, ['c']);
});

void test('usage is recorded from response fields and flushUsage clears the buffer', async () => {
  const h = makeHarness({ response: fakeResponse({ model: 'm1', inputTokens: 7, outputTokens: 9, cost: 0.5 }) });
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  await llm.generateContent('a');
  const usage = llm.flushUsage();
  assert.equal(usage.length, 1);
  assert.equal(usage[0].model, 'm1');
  assert.equal(usage[0].inputTokens, 7);
  assert.equal(usage[0].outputTokens, 9);
  assert.equal(usage[0].costUsd, 0.5);
  assert.equal(usage[0].stage, 'content-generation');
  assert.deepEqual(llm.flushUsage(), []);
});

void test('missing OPENROUTER_API_KEY throws a stable BuildError before any provider call', async () => {
  const h = makeHarness();
  const llm = createWebsiteFactoryLLM('c', { env: { PERPLEXITY_API_KEY: 'px' } as NodeJS.ProcessEnv, routerFactory: h.routerFactory });
  await assert.rejects(() => llm.generateContent('a'), isLlmFailure(/OPENROUTER_API_KEY/));
  assert.equal(h.getFactoryCalls(), 0);
});

void test('missing PERPLEXITY_API_KEY throws a stable BuildError', async () => {
  const h = makeHarness();
  const llm = createWebsiteFactoryLLM('c', { env: { OPENROUTER_API_KEY: 'or' } as NodeJS.ProcessEnv, routerFactory: h.routerFactory });
  await assert.rejects(() => llm.generateContent('a'), isLlmFailure(/PERPLEXITY_API_KEY/));
});

void test('BudgetExhaustedError maps to LLM_CALL_FAILED with a budget message', async () => {
  const budgetErr = Object.create(BudgetExhaustedError.prototype) as Error;
  Object.defineProperty(budgetErr, 'message', { value: 'over budget', enumerable: true });
  const h = makeHarness({ throwOnExecute: budgetErr });
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  await assert.rejects(() => llm.generateContent('a'), isLlmFailure(/Budget exhausted for content-generation/));
});

void test('ProviderRequestError maps to a provider-unavailable LLM_CALL_FAILED', async () => {
  const provErr = Object.create(ProviderRequestError.prototype) as Error;
  Object.defineProperty(provErr, 'message', { value: 'upstream 503', enumerable: true });
  const h = makeHarness({ throwOnExecute: provErr });
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  await assert.rejects(() => llm.generateContent('a'), isLlmFailure(/LLM provider unavailable/));
});

void test('CircuitOpenError maps to a provider-unavailable LLM_CALL_FAILED', async () => {
  const h = makeHarness({ throwOnExecute: new CircuitOpenError(Provider.OPENROUTER) });
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  await assert.rejects(() => llm.generateContent('a'), isLlmFailure(/LLM provider unavailable/));
});

void test('an existing BuildError from execute is re-thrown, not double-wrapped', async () => {
  const original = new BuildError('LLM_CALL_FAILED', 'inner failure');
  const h = makeHarness({ throwOnExecute: original });
  const llm = createWebsiteFactoryLLM('c', { env: BOTH_KEYS, routerFactory: h.routerFactory });
  await assert.rejects(() => llm.generateContent('a'), (error: unknown) => error === original);
});
