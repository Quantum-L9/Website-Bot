// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentGenerationStage } from '../../src/stages/ContentGenerationStage.js';
import { BuildError } from '../../src/pipeline/BuildError.js';
import type { BuildContext } from '../../src/pipeline/BuildContext.js';

const words = (n: number): string => Array.from({ length: n }, () => 'word').join(' ');

function section(headline: string, n: number, extra = ''): string {
  return `${headline}\n\n${words(n)}${extra}`;
}

function makeCtx(opts: {
  dryRun?: boolean;
  responses: string[];
  components?: string[];
  routes?: Array<{ slug: string; title: string; components: string[] }>;
}) {
  const responses = [...opts.responses];
  const prompts: string[] = [];
  const generatedContent = new Map<string, string>();
  const ctx = {
    dryRun: opts.dryRun ?? false,
    domainSpec: {
      vertical: 'insurance_supplementing',
      business_name: 'Test Biz',
      geography: { primary_state: 'TN', states: ['TN', 'KY'] },
      routes: opts.routes ?? [{ slug: '/', title: 'Home', components: opts.components ?? ['hero'] }],
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
  const body = section('Home hero headline', 80);
  const { ctx, prompts, generatedContent } = makeCtx({ responses: [body] });
  await stage.run(ctx);
  assert.equal(prompts.length, 1);
  assert.equal(generatedContent.get('/:hero'), body);
});

void test('a short first response then a valid one succeeds after two calls', async () => {
  const valid = section('Home hero headline', 80);
  const { ctx, prompts, generatedContent } = makeCtx({
    responses: [section('Home hero headline', 12), valid],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.equal(generatedContent.get('/:hero'), valid);
});

void test('the correction prompt reports the actual first-attempt word count', async () => {
  const { ctx, prompts } = makeCtx({
    responses: [section('Home hero headline', 12), section('Home hero headline', 80)],
  });
  await stage.run(ctx);
  assert.match(prompts[1], /failed validation/i);
  assert.match(prompts[1], /It contained 12 words; provide at least 80\./);
  assert.match(prompts[1], /Rewrite the complete section from scratch\./);
});

void test('short bodies fail with CONTENT_VALIDATION_FAILED and commit nothing', async () => {
  const { ctx, generatedContent } = makeCtx({
    responses: [
      section('Home hero headline', 10),
      section('Home hero headline', 20),
      section('Home hero headline', 30),
    ],
  });
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /has 30 words, minimum 80/.test(error.message),
  );
  assert.equal(generatedContent.size, 0);
});

void test('a prohibited claim triggers a corrective retry naming the claim', async () => {
  const valid = section('Trusted local coverage', 90);
  const { ctx, prompts, generatedContent } = makeCtx({
    responses: [section('Trusted local coverage', 90, ' guaranteed'), valid],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /prohibited claim "guaranteed"/);
  assert.equal(generatedContent.get('/:hero'), valid);
});

void test('a prohibited claim that persists after retry fails', async () => {
  const banned = section('Trusted local coverage', 90, ' guaranteed');
  const { ctx } = makeCtx({ responses: [banned, banned, banned] });
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /banned claim "guaranteed" persists after retry/.test(error.message),
  );
});

void test('an 80-word markdown-wrapped response is stored as plain text', async () => {
  const wrapped = `**Home hero headline**\n\n**${words(80)}**`;
  const { ctx, generatedContent } = makeCtx({ responses: [wrapped] });
  await stage.run(ctx);
  assert.equal(generatedContent.get('/:hero'), section('Home hero headline', 80));
  assert.equal(generatedContent.get('/:hero')?.includes('**'), false);
});

void test('dry-run invokes the LLM zero times', async () => {
  const { ctx, prompts, generatedContent } = makeCtx({
    dryRun: true,
    responses: [section('Home hero headline', 80)],
  });
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

void test('H1 longer than 12 words fails after retries', async () => {
  const longH1 = Array.from({ length: 13 }, () => 'word').join(' ');
  const tooLong = section(longH1, 80);
  const { ctx, generatedContent } = makeCtx({ responses: [tooLong, tooLong, tooLong] });
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /H1 has 13 words, maximum 12/.test(error.message),
  );
  assert.equal(generatedContent.size, 0);
});

void test('two slots with identical H1 fail with CONTENT_VALIDATION_FAILED', async () => {
  const { ctx, generatedContent } = makeCtx({
    components: ['hero', 'faq'],
    responses: [
      section('Same headline here', 80),
      section('Same headline here', 80, ' unique-a'),
      section('Same headline here', 80, ' unique-b'),
      section('Same headline here', 80, ' unique-c'),
    ],
  });
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /duplicate H1/.test(error.message),
  );
  assert.equal(generatedContent.size, 1);
});

void test('two slots with identical bodies and unique H1s succeed', async () => {
  const hero = section('First unique headline', 80);
  const faq = section('Second unique headline', 80);
  const { ctx, generatedContent } = makeCtx({
    components: ['hero', 'faq'],
    responses: [hero, faq],
  });
  await stage.run(ctx);
  assert.equal(generatedContent.size, 2);
  assert.equal(generatedContent.get('/:hero'), hero);
  assert.equal(generatedContent.get('/:faq'), faq);
});

void test('valid unique H1s and 80-word bodies succeed and the prompt requires a 12-word headline', async () => {
  const hero = section('Protect your roof this season', 80);
  const faq = section('Answers for insurance claims', 80, ' extra');
  const { ctx, prompts, generatedContent } = makeCtx({
    components: ['hero', 'faq'],
    responses: [hero, faq],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /headline/i);
  assert.match(prompts[0], /12 words/);
  assert.match(prompts[0], /route slug "\/"/);
  assert.match(prompts[0], /titled "Home"/);
  assert.equal(generatedContent.get('/:hero'), hero);
  assert.equal(generatedContent.get('/:faq'), faq);
});

void test('the next slot first prompt lists already-used headlines', async () => {
  const homeHero = section('Protect your roof this season', 80);
  const contactHero = section('Request a roofing quote today', 80, ' extra');
  const { ctx, prompts, generatedContent } = makeCtx({
    routes: [
      { slug: '/', title: 'Home', components: ['hero'] },
      { slug: '/contact', title: 'Contact', components: ['hero'] },
    ],
    responses: [homeHero, contactHero],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /Already used headlines/);
  assert.match(
    prompts[1],
    /Already used headlines \(do not repeat, even paraphrased as the same CTA\):/,
  );
  assert.match(prompts[1], /- "Protect your roof this season"/);
  assert.match(prompts[1], /route slug "\/contact"/);
  assert.match(prompts[1], /titled "Contact"/);
  assert.equal(generatedContent.get('/:hero'), homeHero);
  assert.equal(generatedContent.get('/contact:hero'), contactHero);
});

void test('duplicate H1 correction lists all taken headlines then still fails after retries', async () => {
  const { ctx, prompts, generatedContent } = makeCtx({
    components: ['hero', 'faq'],
    responses: [
      section('Same headline here', 80),
      section('Same headline here', 80, ' unique-a'),
      section('Same headline here', 80, ' unique-b'),
      section('Same headline here', 80, ' unique-c'),
    ],
  });
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) => error instanceof BuildError
      && error.code === 'CONTENT_VALIDATION_FAILED'
      && /duplicate H1/.test(error.message),
  );
  assert.equal(generatedContent.size, 1);
  assert.match(prompts[1], /Already used headlines \(do not repeat, even paraphrased as the same CTA\):/);
  assert.match(prompts[1], /- "Same headline here"/);
  assert.match(prompts[2], /- "Same headline here"/);
});
