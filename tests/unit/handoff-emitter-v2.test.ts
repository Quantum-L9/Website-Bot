import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HandoffEmitterStage } from '../../src/stages/HandoffEmitterStage.js';
import { fixtureContext, cleanupContext } from '../helpers/siteFactoryFixture.js';
import type { BuildContext } from '../../src/pipeline/BuildContext.js';

/** Run the emitter with fetch stubbed + cwd redirected so the YAML write is disposable. */
async function runEmitterCapturingPost(ctx: BuildContext): Promise<Record<string, unknown> | undefined> {
  ctx.autoRegisterSeoBot = true;
  let body: Record<string, unknown> | undefined;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    body = init?.body ? JSON.parse(init.body) : undefined;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const cwd = process.cwd();
  const tmp = mkdtempSync(join(tmpdir(), 'wb5-emit-'));
  const prevUrl = process.env.SEO_BOT_URL;
  const prevKey = process.env.SEO_BOT_API_KEY;
  process.env.SEO_BOT_URL = 'https://seo-bot.example.com';
  process.env.SEO_BOT_API_KEY = 'test-key';
  process.chdir(tmp);
  mkdirSync('contracts', { recursive: true });
  try {
    await new HandoffEmitterStage().run(ctx);
  } finally {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    process.env.SEO_BOT_URL = prevUrl;
    process.env.SEO_BOT_API_KEY = prevKey;
  }
  return body;
}

test('flat v2: no evidence bundle → registration has no site block (unchanged behavior)', async () => {
  const ctx = fixtureContext(); // mode = local-proof, no deployTarget
  ctx.deploymentUrl = 'https://client.example.com';
  await runEmitterCapturingPost(ctx).then(body => {
    assert.ok(body);
    assert.equal(body.schema_version, '2.0');
    assert.equal('site' in body, false, 'flat v2 must not carry an enriched site block');
    assert.equal('proof' in body, false);
  });
  cleanupContext(ctx);
});

test('end-to-end mode but no persisted bundle → gracefully degrades to flat v2', async () => {
  const ctx = fixtureContext();
  ctx.mode = 'end-to-end';
  ctx.deployTarget = { githubRepo: 'quantum-l9/client-site', sourceBranch: 'main' };
  ctx.deploymentUrl = 'https://client.example.com';
  const body = await runEmitterCapturingPost(ctx);
  assert.ok(body);
  assert.equal(body.schema_version, '2.0');
  assert.equal('site' in body, false, 'no bundle → must not fabricate a site block');
  cleanupContext(ctx);
});

// The enriched happy-path (a full end-to-end bundle → { site, proof } projection)
// is covered structurally by the evidence-chain + release-receipt tests, which
// exercise buildWebsiteFactoryHandoffV3's inputs; the emitter's projection is a
// direct `{ site: record.site, proof: record.proof }` pass-through.
