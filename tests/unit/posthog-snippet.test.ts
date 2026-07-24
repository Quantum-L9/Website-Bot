// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SiteAssemblerStage } from '../../src/stages/SiteAssemblerStage.js';
import { PostHogSnippetStage } from '../../src/stages/PostHogSnippetStage.js';
import { validateGeneratedSite } from '../../src/validation/validate-generated-site.js';
import { cleanupContext, fixtureContext, withEnv } from '../helpers/siteFactoryFixture.js';

void test('injects one syntactically closed PostHog script and remains idempotent', async () => {
  const ctx = fixtureContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    await withEnv({ PUBLIC_POSTHOG_KEY: 'phc_fixture_key_123456', POSTHOG_HOST: 'https://us.i.posthog.com' }, async () => {
      const stage = new PostHogSnippetStage();
      await stage.run(ctx);
      await stage.run(ctx);
    });
    const layout = readFileSync(join(ctx.outputDir, 'src/layouts/BaseLayout.astro'), 'utf-8');
    assert.equal(layout.match(/L9:POSTHOG:INJECTED/g)?.length, 1);
    assert.match(layout, /<\/script>/);
    assert.doesNotMatch(layout, /<\\\/script>/);
    assert.match(layout, /posthogHost/);
    validateGeneratedSite(ctx.outputDir, ctx.domainSpec.routes);
  } finally {
    cleanupContext(ctx);
  }
});

void test('does not expose an ambiguous legacy PostHog credential', async () => {
  const ctx = fixtureContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    await withEnv({ PUBLIC_POSTHOG_KEY: undefined, POSTHOG_KEY: 'personal-looking-token', POSTHOG_REQUIRED: 'true' }, async () => {
      await assert.rejects(() => new PostHogSnippetStage().run(ctx), /no public project key/);
    });
  } finally {
    cleanupContext(ctx);
  }
});
