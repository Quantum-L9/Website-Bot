// L9_META: layer=test, role=image_validation_regression, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ImageSlotSpec } from '../../src/pipeline/BuildContext.js';
import type { SourceSiteManifest } from '../../src/pipeline/evidence/SourceSiteManifest.js';
import { ImageAssetPlanningStage } from '../../src/stages/ImageAssetPlanningStage.js';
import { SiteAssemblerStage } from '../../src/stages/SiteAssemblerStage.js';
import { ImageValidationStage } from '../../src/stages/ImageValidationStage.js';
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

const heroSlot: ImageSlotSpec = { id: 'home-hero', placement: '/:hero', required: true, aspectRatio: '16:9' };

async function assembleWithProvidedHero(clientId: string, sourcePath: string) {
  const ctx = fixtureContext({
    client_id: clientId,
    assets: {
      imageSlots: [heroSlot],
      providedImages: [{ id: 'hero', path: sourcePath, intendedPlacement: '/:hero', altText: 'Hero' }],
    },
  });
  await new ImageAssetPlanningStage().run(ctx);
  await new SiteAssemblerStage().run(ctx);
  return ctx;
}

void test('passes when every referenced image exists on disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-qa-'));
  writeFileSync(join(dir, 'hero.png'), pngWith(1920, 1080));
  const ctx = await assembleWithProvidedHero('qa-ok-client', join(dir, 'hero.png'));
  try {
    await new ImageValidationStage().run(ctx);
    assert.equal(ctx.imageProvenanceWarnings, undefined, 'provided images carry no provenance warnings');
  } finally {
    cleanupContext(ctx);
    rmSync(dir, { recursive: true, force: true });
    rmSync(resolve('build', 'assets', ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});

void test('fails closed on a broken image reference', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-qa-'));
  writeFileSync(join(dir, 'hero.png'), pngWith(1920, 1080));
  const ctx = await assembleWithProvidedHero('qa-broken-client', join(dir, 'hero.png'));
  try {
    // Remove the copied file to simulate a broken reference in the built site.
    rmSync(join(ctx.outputDir, 'public/images/home-hero.png'), { force: true });
    await assert.rejects(() => new ImageValidationStage().run(ctx), /broken image reference/i);
  } finally {
    cleanupContext(ctx);
    rmSync(dir, { recursive: true, force: true });
    rmSync(resolve('build', 'assets', ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});

void test('surfaces source-site provenance warnings for release evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-qa-'));
  const localPath = join(dir, 'src-hero.png');
  writeFileSync(localPath, pngWith(1920, 1080));

  const ctx = fixtureContext({
    client_id: 'qa-provenance-client',
    assets: { imageSlots: [{ ...heroSlot, preferredSources: ['source-site'] }] },
  });
  const manifest: SourceSiteManifest = {
    schema: 'website-bot.source-site-manifest/v1',
    sourceUrl: 'https://acme.example/',
    crawledAt: '2026-07-20T00:00:00.000Z',
    crawlerVersion: '1.0.0',
    pages: [],
    images: [{
      id: 'src-hero', sourceUrl: 'https://acme.example/hero.png', referringPageUrl: 'https://acme.example/',
      localPath, altText: 'Hero', mimeType: 'image/png', width: 1920, height: 1080, byteLength: 250_000,
      sha256: 'd'.repeat(64), provenance: 'source-site',
    }],
    rejected: [],
    warnings: [],
  };
  ctx.sourceSiteManifest = manifest;

  try {
    await new ImageAssetPlanningStage().run(ctx);
    await new SiteAssemblerStage().run(ctx);
    await new ImageValidationStage().run(ctx);
    assert.ok((ctx.imageProvenanceWarnings?.length ?? 0) > 0);
    assert.match(ctx.imageProvenanceWarnings?.[0] ?? '', /\/:hero: /);
  } finally {
    cleanupContext(ctx);
    rmSync(dir, { recursive: true, force: true });
    rmSync(resolve('build', 'assets', ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});
