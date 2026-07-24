// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { SchemaGeneratorStage } from '../../src/stages/SchemaGeneratorStage.js';
import type { BuildContext } from '../../src/pipeline/BuildContext.js';
import { BuildError } from '../../src/pipeline/BuildError.js';

const FAQ_JSON = '[{"question":"How long does a roof last?","answer":"20-30 years."},{"question":"Do you offer inspections?","answer":"Yes, free."}]';

function stubContext(responses: string[]): { ctx: BuildContext; prompts: string[] } {
  const prompts: string[] = [];
  const queue = [...responses];
  const ctx = {
    dryRun: false,
    domainSpec: {
      business_name: 'Safe Haven Roofing',
      vertical: 'roofing',
      geography: { states: ['TN', 'KY'], primary_state: 'TN' },
      routes: [
        { slug: '/', title: 'Home', components: ['hero'] },
        { slug: '/contact', title: 'Contact', components: ['contact_form'] },
      ],
      seo_contract: { site_url: 'safehavenrr.com', phone: '+1-615-555-0100' },
    },
    generatedSchemas: new Map<string, unknown>(),
    llm: {
      async generateSchema(prompt: string) {
        prompts.push(prompt);
        const next = queue.shift();
        if (next === undefined) throw new Error('stub exhausted');
        return next;
      },
    },
  } as unknown as BuildContext;
  return { ctx, prompts };
}

void test('fenced FAQ JSON is recovered on the first attempt', async () => {
  const { ctx, prompts } = stubContext(['```json\n' + FAQ_JSON + '\n```']);
  await new SchemaGeneratorStage().run(ctx);
  assert.equal(prompts.length, 1);
  const faq = ctx.generatedSchemas.get('FAQPage') as { mainEntity: unknown[] };
  assert.equal(faq.mainEntity.length, 2);
});

void test('corrective retry recovers after an unparseable first reply', async () => {
  const { ctx, prompts } = stubContext(['Sorry, here you go later.', FAQ_JSON]);
  await new SchemaGeneratorStage().run(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous reply was rejected/);
  const faq = ctx.generatedSchemas.get('FAQPage') as { mainEntity: unknown[] };
  assert.equal(faq.mainEntity.length, 2);
});

void test('fails closed with SCHEMA_GENERATION_FAILED after two bad replies', async () => {
  const { ctx } = stubContext(['nope', 'still nope']);
  await assert.rejects(
    () => new SchemaGeneratorStage().run(ctx),
    (error: unknown) => error instanceof BuildError && error.code === 'SCHEMA_GENERATION_FAILED',
  );
});

void test('site URL is normalized to https and phone flows into schemas', async () => {
  const { ctx } = stubContext([FAQ_JSON]);
  await new SchemaGeneratorStage().run(ctx);
  const local = ctx.generatedSchemas.get('LocalBusiness') as { url: string; telephone: string };
  assert.equal(local.url, 'https://safehavenrr.com');
  assert.equal(local.telephone, '+1-615-555-0100');
  const crumbs = ctx.generatedSchemas.get('BreadcrumbList') as { itemListElement: Array<{ item: string }> };
  assert.equal(crumbs.itemListElement[0].item, 'https://safehavenrr.com/');
});
