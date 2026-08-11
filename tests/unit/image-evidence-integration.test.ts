// L9_META: layer=test, role=image_evidence_integration, status=active, version=1.0.0
//
// PR-06 coverage: the three image evidence kinds round-trip through the canonical
// store as snake_case JSON while staying camelCase in memory; source-site ingestion
// reuses verified evidence without re-crawling; and deterministic image QA blocks
// unauthorized republication and evidence/site drift. No network or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { clientAssetRoot, type SiteConfig } from '../../src/pipeline/BuildContext.js';
import type { SourceSiteManifest } from '../../src/pipeline/evidence/SourceSiteManifest.js';
import type { ImageAssetPlan } from '../../src/pipeline/evidence/ImageAssetPlan.js';
import { buildImageAssetManifest, type ResolvedImageAsset } from '../../src/pipeline/evidence/ImageAssetManifest.js';
import { sha256File } from '../../src/pipeline/evidence/EvidenceCanonicalizer.js';
import { SourceSiteIngestionStage } from '../../src/stages/SourceSiteIngestionStage.js';
import { ImageValidationStage } from '../../src/stages/ImageValidationStage.js';
import { cleanupContext, fixtureContext } from '../helpers/siteFactoryFixture.js';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function resolvedAsset(over: Partial<ResolvedImageAsset> & { slotId: string; placement: string; source: ResolvedImageAsset['source'] }): ResolvedImageAsset {
  return {
    absolutePath: '/staged/x.png',
    outputFileName: `${over.slotId}.png`,
    altText: `${over.slotId} alt`,
    mimeType: 'image/png',
    width: 1920,
    height: 1080,
    byteLength: PNG_1x1.length,
    sha256: 'a'.repeat(64),
    disposition: 'approved-client-owned',
    provenanceWarnings: [],
    ...over,
  };
}

// ── Evidence round-trip ──────────────────────────────────────────────────────────

void test('image evidence round-trips as snake_case on disk and camelCase in memory', async () => {
  const ctx = fixtureContext({ client_id: 'evi-roundtrip' });
  try {
    const sourceManifest: SourceSiteManifest = {
      schema: 'website-bot.source-site-manifest/v1',
      sourceUrl: 'https://acme.example/',
      crawledAt: '2026-07-20T00:00:00.000Z',
      crawlerVersion: '1.0.0',
      pages: [{ url: 'https://acme.example/', headings: ['Welcome'], depth: 0 }],
      images: [{
        id: 'src-1', sourceUrl: 'https://acme.example/a.png', referringPageUrl: 'https://acme.example/',
        localPath: '/tmp/a.png', mimeType: 'image/png', width: 800, height: 600, byteLength: 1234,
        sha256: 'b'.repeat(64), provenance: 'source-site', domContext: { tagName: 'img', cssClasses: ['hero'], isAboveFold: true, renderedWidth: 800, renderedHeight: 600 },
      }],
      rejected: [],
      warnings: [],
    };
    const plan: ImageAssetPlan = {
      schema: 'website-bot.image-asset-plan/v1',
      version: '1.0.0',
      assets: [
        { slotId: 'hero', placement: '/:hero', required: true, resolution: { source: 'source-site', candidateId: 'src-1', score: 42 } },
        { slotId: 'og', placement: '/:og-image', required: false, resolution: { source: 'generated', compiledBrief: { slotId: 'og', intent: 'social', subject: 'roof' } } },
      ],
    };
    const manifest = buildImageAssetManifest(ctx.buildId, ctx.clientId, '2026-07-20T00:00:00.000Z', [
      resolvedAsset({ slotId: 'hero', placement: '/:hero', source: 'source-site', sourceUrl: 'https://acme.example/a.png' }),
    ]);

    await ctx.evidenceStore.writeSourceSite(sourceManifest);
    await ctx.evidenceStore.writeImagePlan(plan);
    await ctx.evidenceStore.writeImageAssets(manifest);

    // In memory: camelCase, deep-equal to what we wrote (JSON drops undefined-valued
    // optional keys, so compare against the JSON-normalized form).
    const normalize = (value: unknown) => JSON.parse(JSON.stringify(value));
    assert.deepEqual((await ctx.evidenceStore.readSourceSite())?.value, normalize(sourceManifest));
    assert.deepEqual((await ctx.evidenceStore.readImagePlan())?.value, normalize(plan));
    assert.deepEqual((await ctx.evidenceStore.readImageAssets())?.value, normalize(manifest));

    // On disk: snake_case keys, never camelCase.
    const raw = readFileSync(join(ctx.evidenceStore.rootDir, 'source-site-manifest.json'), 'utf-8');
    assert.match(raw, /"source_url"/);
    assert.match(raw, /"crawled_at"/);
    assert.match(raw, /"byte_length"/);
    assert.match(raw, /"is_above_fold"/);
    assert.doesNotMatch(raw, /"sourceUrl"|"byteLength"|"isAboveFold"/);
    const planRaw = readFileSync(join(ctx.evidenceStore.rootDir, 'image-asset-plan.json'), 'utf-8');
    assert.match(planRaw, /"slot_id"/);
    assert.match(planRaw, /"compiled_brief"/);
    assert.doesNotMatch(planRaw, /"slotId"|"compiledBrief"/);
  } finally {
    cleanupContext(ctx);
  }
});

// ── Source-site ingestion resume ─────────────────────────────────────────────────

void test('ingestion reuses verified source_site evidence without crawling', async () => {
  const clientId = 'ingest-reuse';
  const ctx = fixtureContext({
    client_id: clientId,
    assets: { sourceSite: { url: 'https://acme.example/', enabled: true } },
  });
  const downloadDir = resolve(clientAssetRoot(ctx), 'source-site', 'downloads');
  try {
    mkdirSync(downloadDir, { recursive: true });
    const localPath = join(downloadDir, 'a.png');
    writeFileSync(localPath, PNG_1x1);
    const manifest: SourceSiteManifest = {
      schema: 'website-bot.source-site-manifest/v1',
      sourceUrl: 'https://acme.example/',
      crawledAt: '2026-07-20T00:00:00.000Z',
      crawlerVersion: '1.0.0',
      pages: [],
      images: [{
        id: 'src-1', sourceUrl: 'https://acme.example/a.png', referringPageUrl: 'https://acme.example/',
        localPath, mimeType: 'image/png', width: 1, height: 1, byteLength: PNG_1x1.length,
        sha256: sha256File(localPath), provenance: 'source-site',
      }],
      rejected: [],
      warnings: [],
    };
    await ctx.evidenceStore.writeSourceSite(manifest);

    // If the stage ignored the verified cache it would construct a real crawler and
    // hit the network; a clean return with the manifest hydrated proves reuse.
    await new SourceSiteIngestionStage().run(ctx);
    assert.equal(ctx.sourceSiteManifest?.images[0].id, 'src-1');
    assert.equal(ctx.sourceSiteManifest?.images[0].sha256, manifest.images[0].sha256);
  } finally {
    cleanupContext(ctx);
    rmSync(resolve('build', 'assets', clientId, ctx.buildId), { recursive: true, force: true });
  }
});

// ── Deterministic image QA ───────────────────────────────────────────────────────

async function runQa(clientId: string, assets: ResolvedImageAsset[], siteImages: NonNullable<SiteConfig['images']>): Promise<void> {
  const ctx = fixtureContext({ client_id: clientId, assets: { imageSlots: [{ id: 'hero', placement: '/:hero', required: true }] } });
  try {
    ctx.siteConfig = { images: siteImages } as SiteConfig;
    await ctx.evidenceStore.writeImageAssets(buildImageAssetManifest(ctx.buildId, ctx.clientId, '2026-07-20T00:00:00.000Z', assets));
    mkdirSync(join(ctx.outputDir, 'public', 'images'), { recursive: true });
    for (const image of Object.values(siteImages)) {
      writeFileSync(join(ctx.outputDir, 'public', image.src.replace(/^\//, '')), PNG_1x1);
    }
    await new ImageValidationStage().run(ctx);
  } finally {
    cleanupContext(ctx);
    rmSync(resolve('build', 'assets', clientId, ctx.buildId), { recursive: true, force: true });
  }
}

void test('QA passes for a delivered source-site asset with republishable disposition', async () => {
  await runQa(
    'qa-ok',
    [resolvedAsset({ slotId: 'hero', placement: '/:hero', source: 'source-site', disposition: 'approved-client-owned' })],
    { '/:hero': { src: '/images/hero.png', alt: 'Hero', width: 1920, height: 1080, source: 'source-site' } },
  );
});

void test('QA blocks unauthorized republication of a crawled asset', async () => {
  await assert.rejects(
    runQa(
      'qa-rights',
      [resolvedAsset({ slotId: 'hero', placement: '/:hero', source: 'source-site', disposition: 'unknown-rights' })],
      { '/:hero': { src: '/images/hero.png', alt: 'Hero', width: 1920, height: 1080, source: 'source-site' } },
    ),
    /unauthorized republication/,
  );
});

void test('QA fails on evidence/site source drift', async () => {
  await assert.rejects(
    runQa(
      'qa-drift',
      [resolvedAsset({ slotId: 'hero', placement: '/:hero', source: 'generated' })],
      { '/:hero': { src: '/images/hero.png', alt: 'Hero', width: 1920, height: 1080, source: 'provided' } },
    ),
    /source mismatch/,
  );
});
