// L9_META: layer=test, role=image_gallery_dedupe, status=active, version=1.0.0
//
// Lane wb-images (CTO Q1): a source-site photo that fills a slot is
// re-encoded for that slot, so its shipped digest differs from the crawled
// file's. The gallery dedupes by the original digest too, so that photo never
// reappears there, and the gallery photos it does show are optimised copies.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import type { IngestedImage } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import { sha256Bytes as sha256 } from "../../src/services/hashing.js";
import { RENDER_PROFILES } from "../../src/services/images/ImageOptimizer.js";
import { ImageAssetPlanningStage } from "../../src/stages/ImageAssetPlanningStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { realPng } from "../helpers/realImage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

function crawled(dir: string, id: string, bytes: Buffer, width: number, height: number) {
  const localPath = join(dir, `${id}.png`);
  writeFileSync(localPath, bytes);
  return {
    id,
    sourceUrl: `https://client.example/${id}.png`,
    referringPageUrl: "https://client.example/",
    localPath,
    mimeType: "image/png",
    width,
    height,
    byteLength: bytes.length,
    sha256: sha256(bytes),
    provenance: "source-site",
    altText: `${id} photo`,
  } as IngestedImage;
}

void test("a slot-filling source photo is not repeated in the gallery; gallery photos are optimised", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wb-gallery-"));
  const heroBytes = realPng(2400, 1350, [10, 60, 110], [200, 140, 60]);
  const otherBytes = realPng(2000, 1500, [120, 30, 30], [30, 160, 90]);
  const hero = crawled(dir, "storefront", heroBytes, 2400, 1350);
  const other = crawled(dir, "workshop", otherBytes, 2000, 1500);
  const ctx = fixtureContext({
    client_id: "gallery-dedupe-client",
    assets: {
      generation: { enabled: false },
      imageSlots: [
        {
          id: "home-hero",
          placement: "/:hero",
          required: true,
          aspectRatio: "16:9",
          preferredSources: ["source-site"],
        },
      ],
    },
  });
  ctx.sourceSiteManifest = {
    schema: "website-bot.source-site-manifest/v1",
    sourceUrl: "https://client.example/",
    crawledAt: "2026-11-20T00:00:00.000Z",
    crawlerVersion: "1.0.0",
    pages: [],
    images: [hero, other],
  } as never;
  try {
    await new ImageAssetPlanningStage().run(ctx);
    const slotAsset = ctx.resolvedImages?.get("/:hero");
    assert.equal(slotAsset?.source, "source-site");
    // The slot's shipped file is a re-encode, with the crawled digest kept.
    assert.notEqual(slotAsset?.sha256, hero.sha256);
    assert.equal(slotAsset?.originalSha256, hero.sha256);

    await new SiteAssemblerStage().run(ctx);
    const gallery = ctx.siteConfig?.galleryImages ?? [];
    assert.equal(gallery.length, 1, JSON.stringify(gallery));
    assert.match(gallery[0].src, /^\/images\/gallery\/workshop\.webp$/);
    assert.ok(!gallery.some((entry) => entry.src.includes("storefront")));
    assert.equal(gallery[0].width, RENDER_PROFILES.content.maxWidth);

    const published = readFileSync(join(ctx.outputDir, "public", gallery[0].src));
    const meta = await sharp(published).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, gallery[0].width);
    assert.equal(meta.height, gallery[0].height);
    assert.ok(published.length < otherBytes.length);
    assert.ok(!existsSync(join(ctx.outputDir, "public/images/gallery/storefront.webp")));
  } finally {
    cleanupContext(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});
