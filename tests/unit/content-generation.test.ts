// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentGenerationStage } from '../../src/stages/ContentGenerationStage.js';
import { BuildError } from '../../src/pipeline/BuildError.js';
import type { BuildContext } from '../../src/pipeline/BuildContext.js';

const words = (n: number): string => Array.from({ length: n }, () => 'word').join(' ');

function makeCtx(opts: { dryRun?: boolean; responses: string[]; components?: string[] }) {
  const responses = [...opts.responses];
  const prompts: string[] = [];
  const generatedContent = new Map<string, string>();
  const ctx = {
    dryRun: opts.dryRun ?? false,
    domainSpec: {
      vertical: 'insurance_supplementing',
      business_name: 'Test Biz',
      geography: { primary_state: 'TN', states: ['TN', 'KY'] },
      routes: [{ slug: '/', title: 'Home', components: opts.components ?? ['hero'] }],
    },
    generatedContent,
    llm: {
      async generateContent(prompt: string): Promise<string> {
        prompts.push(prompt);
        return responses.shift() ?? '';
      },
    },
  } as unknown as BuildContext;
  return { ctx, prompts, generatedContent };
}

const stage = new ContentGenerationStage();

void test('an 80-word response is accepted in a single call', async () => {
  const { ctx, prompts, generatedContent } = makeCtx({ responses: [words(80)] });
  await stage.run(ctx);
  assert.equal(prompts.length, 1);
  assert.equal(generatedContent.get('/:hero'), words(80));
});

void test('a short first response then a valid one succeeds after two calls', async () => {
  const { ctx, prompts, generatedContent } = makeCtx({ responses: [words(12), words(80)] });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.equal(generatedContent.get('/:hero'), words(80));
});

void test('the correction prompt reports the actual first-attempt word count', async () => {
  const { ctx, prompts } = makeCtx({ responses: [words(12), words(80)] });
  await stage.run(ctx);
  assert.match(prompts[1], /failed validation/i);
  assert.match(prompts[1], /It contained 12 words; provide at least 80\./);
  assert.match(prompts[1], /Rewrite the complete section from scratch\./);
});

void test('two short responses fail with CONTENT_VALIDATION_FAILED and commit nothing', async () => {
  const { ctx, generatedContent } = makeCtx({ responses: [words(10), words(20)] });
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /has 20 words, minimum 80/.test(error.message),
  );
  assert.equal(generatedContent.size, 0);
});

void test('a prohibited claim triggers a corrective retry naming the claim', async () => {
  const { ctx, prompts, generatedContent } = makeCtx({ responses: [`${words(90)} guaranteed`, words(90)] });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /prohibited claim "guaranteed"/);
  assert.equal(generatedContent.get('/:hero'), words(90));
});

void test('a prohibited claim that persists after retry fails', async () => {
  const { ctx } = makeCtx({ responses: [`${words(90)} guaranteed`, `${words(90)} guaranteed`] });
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /banned claim "guaranteed" persists after retry/.test(error.message),
  );
});

void test('an 80-word markdown-wrapped response is stored as plain text', async () => {
  const wrapped = `**${words(80)}**`;
  const { ctx, generatedContent } = makeCtx({ responses: [wrapped] });
  await stage.run(ctx);
  assert.equal(generatedContent.get('/:hero'), words(80));
  assert.equal(generatedContent.get('/:hero')?.includes('**'), false);
});

void test('dry-run invokes the LLM zero times', async () => {
  const { ctx, prompts, generatedContent } = makeCtx({ dryRun: true, responses: [words(80)] });
  await stage.run(ctx);
  assert.equal(prompts.length, 0);
  assert.equal(generatedContent.size, 0);
});

void test('crawled source copy is ported and the LLM is not called', async () => {
  const { ctx, prompts, generatedContent } = makeCtx({ responses: [words(80)] });
  ctx.sourceSiteManifest = {
    schema: 'website-bot.source-site-manifest/v1',
    sourceUrl: 'https://www.safehavenrr.com/',
    crawledAt: '2026-08-13T00:00:00.000Z',
    crawlerVersion: '1.1.0',
    pages: [{
      url: 'https://www.safehavenrr.com/',
      headings: ['Safe Haven Roofing & Renovations'],
      description: 'Charlotte roofing specialists.',
      bodyText: 'We handle storm damage, insurance claims, and full replacements across the metro.',
      depth: 0,
    }],
    images: [],
    rejected: [],
    warnings: [],
  };
  await stage.run(ctx);
  assert.equal(prompts.length, 0);
  assert.match(generatedContent.get('/:hero') ?? '', /Safe Haven Roofing & Renovations/);
});

void test('sourceSite.enabled with an empty crawl fails closed and does not call the LLM', async () => {
  const { ctx, prompts } = makeCtx({ responses: [words(80)] });
  ctx.domainSpec.assets = { sourceSite: { url: 'https://www.safehavenrr.com/', enabled: true } };
  ctx.sourceSiteManifest = {
    schema: 'website-bot.source-site-manifest/v1',
    sourceUrl: 'https://www.safehavenrr.com/',
    crawledAt: '2026-08-13T00:00:00.000Z',
    crawlerVersion: '1.1.0',
    pages: [],
    images: [],
    rejected: [],
    warnings: [],
  };
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /Refusing to invent copy/.test(error.message),
  );
  assert.equal(prompts.length, 0);
});

void test('unmatched reconstructing slug does not receive home bodyText', async () => {
  const { ctx, prompts } = makeCtx({ responses: [words(80)] });
  ctx.domainSpec.routes = [
    { slug: '/', title: 'Home', components: ['hero'] },
    { slug: '/services/invented', title: 'Invented', components: ['hero'] },
  ];
  ctx.sourceSiteManifest = {
    schema: 'website-bot.source-site-manifest/v1',
    sourceUrl: 'https://www.safehavenrr.com/',
    crawledAt: '2026-08-13T00:00:00.000Z',
    crawlerVersion: '1.1.0',
    pages: [{
      url: 'https://www.safehavenrr.com/',
      headings: ['Safe Haven Roofing & Renovations'],
      description: 'Charlotte roofing specialists.',
      bodyText: 'Home-only body that must not paint invented service routes.',
      depth: 0,
    }],
    images: [],
    rejected: [],
    warnings: [],
  };
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /no crawled page matched \/services\/invented/.test(error.message),
  );
  assert.equal(prompts.length, 0);
});
