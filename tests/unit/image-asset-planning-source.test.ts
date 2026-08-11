// L9_META: layer=test, role=source_site_planning_regression, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ImageSlotSpec } from '../../src/pipeline/BuildContext.js';
import type { IngestedImage, SourceSiteManifest } from '../../src/pipeline/evidence/SourceSiteManifest.js';
import { planImageAssets, routeSlugFromPlacement } from '../../src/services/images/ImageAssetPlanner.js';
import { ImageAssetPlanningStage } from '../../src/stages/ImageAssetPlanningStage.js';
import { cleanupContext, fixtureContext } from '../helpers/siteFactoryFixture.js';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
function pngWith(width: number, height: number): Buffer {
  const buffer = Buffer.from(PNG_1x1);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function sourceImage(id: string, page: string, width: number, height: number, localPath = '/tmp/none'): IngestedImage {
  return {
    id, sourceUrl: `https://acme.example${page}${id}.jpg`, referringPageUrl: `https://acme.example${page}`,
    localPath, altText: id, mimeType: 'image/png', width, height, byteLength: 250_000, sha256: id.padEnd(64, '0'),
    provenance: 'source-site',
  };
}

void test('routeSlugFromPlacement maps placements to routes', () => {
  assert.equal(routeSlugFromPlacement('/:hero'), '/');
  assert.equal(routeSlugFromPlacement('/services:hero'), '/services');
  assert.equal(routeSlugFromPlacement('global:logo'), undefined);
});

void test('planner prefers a source candidate found on the slot’s own route', () => {
  const slot: ImageSlotSpec = { id: 'svc-hero', placement: '/services:hero', required: true, aspectRatio: '16:9', preferredSources: ['source-site'] };
  const homeHero = sourceImage('home-hero', '/', 1920, 1080);
  const servicesHero = sourceImage('svc-hero', '/services/', 1920, 1080);
  const plan = planImageAssets({ slots: [slot], provided: [], sourceCandidates: [homeHero, servicesHero], generationEnabled: false });
  const resolution = plan.assets[0].resolution;
  assert.equal(resolution.source, 'source-site');
  assert.equal(resolution.source === 'source-site' && resolution.candidateId, 'svc-hero');
});

void test('stage resolves a crawled source-site image into the build with provenance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-src-'));
  const localPath = join(dir, 'hero.png');
  writeFileSync(localPath, pngWith(1920, 1080));

  const ctx = fixtureContext({
    assets: { imageSlots: [{ id: 'home-hero', placement: '/:hero', required: true, aspectRatio: '16:9', preferredSources: ['source-site'] }] },
  });
  const manifest: SourceSiteManifest = {
    schema: 'website-bot.source-site-manifest/v1',
    sourceUrl: 'https://acme.example/',
    crawledAt: '2026-07-20T00:00:00.000Z',
    crawlerVersion: '1.0.0',
    pages: [],
    images: [{ ...sourceImage('home-hero', '/', 1920, 1080, localPath), sha256: 'c'.repeat(64) }],
    rejected: [],
    warnings: [],
  };
  ctx.sourceSiteManifest = manifest;

  try {
    await new ImageAssetPlanningStage().run(ctx);
    const resolved = ctx.resolvedImages?.get('/:hero');
    assert.equal(resolved?.source, 'source-site');
    assert.equal(resolved?.width, 1920);
    assert.equal(resolved?.disposition, 'approved-client-owned');
    assert.ok((resolved?.provenanceWarnings.length ?? 0) > 0, 'source-site reuse carries a provenance warning');
    assert.equal(ctx.imageAssetManifest?.assets[0].source, 'source-site');
  } finally {
    cleanupContext(ctx);
    rmSync(dir, { recursive: true, force: true });
    rmSync(resolve('build', 'assets', ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});
