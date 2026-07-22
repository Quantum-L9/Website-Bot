// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SiteAssemblerStage } from '../../src/stages/SiteAssemblerStage.js';
import { cleanupContext, fixtureContext } from '../helpers/siteFactoryFixture.js';

void test('materializes the fixture into a client-specific Astro project', async () => {
  const ctx = fixtureContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    assert.ok(existsSync(join(ctx.outputDir, 'src/pages/index.astro')));
    assert.ok(existsSync(join(ctx.outputDir, 'src/pages/services/index.astro')));
    assert.ok(existsSync(join(ctx.outputDir, 'src/pages/contact/index.astro')));
    assert.ok(existsSync(join(ctx.outputDir, '.l9/assembly-manifest.json')));
    const config = readFileSync(join(ctx.outputDir, 'src/lib/siteConfig.ts'), 'utf-8');
    assert.match(config, /https:\/\/ci-test\.example\.com/);
    const contact = readFileSync(join(ctx.outputDir, 'src/pages/contact/index.astro'), 'utf-8');
    assert.match(contact, /contact_form/);
    assert.match(contact, /fixture content/);
    assert.match(ctx.assemblyManifest?.sourceDigest ?? '', /^[0-9a-f]{64}$/);
  } finally {
    cleanupContext(ctx);
  }
});

void test('serializes route data through Astro expressions instead of raw HTML attributes', async () => {
  const ctx = fixtureContext({
    business_name: 'CI "Quoted" Business',
    routes: [{ slug: '/', title: 'Home "Quoted"', components: ['hero'] }],
  });
  ctx.generatedContent.set('/', 'unused');
  ctx.generatedContent.set('/:hero', 'Copy with "quotes", <angle brackets>, and\n\nmultiple paragraphs.');
  try {
    await new SiteAssemblerStage().run(ctx);
    const page = readFileSync(join(ctx.outputDir, 'src/pages/index.astro'), 'utf-8');
    assert.match(page, /const sections = \[/);
    assert.match(page, /title=\{"Home \\"Quoted\\""\}/);
    assert.match(page, /content=\{section\.content\}/);
    assert.doesNotMatch(page, /<Section name="[^"]+" content="/);
  } finally {
    cleanupContext(ctx);
  }
});
