// L9_META: layer=test, role=image_asset_planning_regression, status=active, version=1.0.0

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { ImageSlotSpec } from "../../src/pipeline/BuildContext.js";
import { unresolvedRequiredSlots } from "../../src/pipeline/evidence/ImageAssetPlan.js";
import type { IngestedImage } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import {
  aspectMatches,
  type ProvidedCandidate,
  parseAspectRatio,
  planImageAssets,
  scoreProvided,
} from "../../src/services/images/ImageAssetPlanner.js";
import { ImageAssetPlanningStage } from "../../src/stages/ImageAssetPlanningStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
function pngWith(width: number, height: number): Buffer {
  const buffer = Buffer.from(PNG_1x1);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const heroSlot: ImageSlotSpec = {
  id: "home-hero",
  placement: "/:hero",
  required: true,
  aspectRatio: "16:9",
};
const logoSlot: ImageSlotSpec = { id: "site-logo", placement: "global:logo", required: true };

// ---- pure planner ----

void test("parseAspectRatio and aspectMatches understand ratio strings", () => {
  assert.equal(parseAspectRatio("16:9")?.toFixed(3), "1.778");
  assert.equal(parseAspectRatio("nonsense"), undefined);
  assert.equal(aspectMatches(heroSlot, 1920, 1080), true);
  assert.equal(aspectMatches(heroSlot, 1000, 1000), false);
});

void test("a provided image intended for another placement is excluded", () => {
  const candidate: ProvidedCandidate = {
    id: "x",
    intendedPlacement: "global:logo",
    width: 1920,
    height: 1080,
  };
  assert.equal(scoreProvided(heroSlot, candidate), Number.NEGATIVE_INFINITY);
});

void test("planner prefers provided over source-site over generated", () => {
  const provided: ProvidedCandidate[] = [
    { id: "hero-a", intendedPlacement: "/:hero", width: 1920, height: 1080 },
  ];
  const sourceCandidates: IngestedImage[] = [
    {
      id: "src-hero",
      sourceUrl: "https://example.com/h.jpg",
      referringPageUrl: "https://example.com/",
      localPath: "/tmp/none",
      mimeType: "image/jpeg",
      width: 1920,
      height: 1080,
      byteLength: 200_000,
      sha256: "a".repeat(64),
      provenance: "source-site",
    },
  ];
  const plan = planImageAssets({
    slots: [heroSlot],
    provided,
    sourceCandidates,
    generationEnabled: true,
  });
  assert.equal(plan.assets[0].resolution.source, "provided");
});

void test("planner falls through to generation when nothing matches, and flags required unresolved", () => {
  const generated = planImageAssets({
    slots: [heroSlot],
    provided: [],
    sourceCandidates: [],
    generationEnabled: true,
  });
  assert.equal(generated.assets[0].resolution.source, "generated");

  const onlyProvided: ImageSlotSpec = { ...heroSlot, preferredSources: ["provided"] };
  const unresolved = planImageAssets({
    slots: [onlyProvided],
    provided: [],
    sourceCandidates: [],
    generationEnabled: true,
  });
  assert.equal(unresolved.assets[0].resolution.source, "unresolved");
  assert.equal(unresolvedRequiredSlots(unresolved).length, 1);
});

void test("a tiny low-byte source candidate is not selected", () => {
  const sourceCandidates: IngestedImage[] = [
    {
      id: "thumb",
      sourceUrl: "https://example.com/t.png",
      referringPageUrl: "https://example.com/",
      localPath: "/tmp/none",
      mimeType: "image/png",
      width: 80,
      height: 45,
      byteLength: 900,
      sha256: "b".repeat(64),
      provenance: "source-site",
    },
  ];
  const slot: ImageSlotSpec = { ...heroSlot, preferredSources: ["source-site"] };
  const plan = planImageAssets({
    slots: [slot],
    provided: [],
    sourceCandidates,
    generationEnabled: false,
  });
  assert.equal(plan.assets[0].resolution.source, "unresolved");
});

// ---- stage + assembler vertical slice: provided images land in the built site ----

void test("provided images resolve, copy into public/images, and register in siteConfig", async () => {
  const source = mkdtempSync(join(tmpdir(), "wb-provided-"));
  writeFileSync(join(source, "hero.png"), pngWith(1920, 1080));
  writeFileSync(join(source, "logo.png"), pngWith(512, 512));

  const ctx = fixtureContext({
    assets: {
      imageSlots: [heroSlot, logoSlot],
      providedImages: [
        {
          id: "hero-img",
          path: join(source, "hero.png"),
          intendedPlacement: "/:hero",
          altText: "Roof crew at work",
        },
        {
          id: "logo-img",
          path: join(source, "logo.png"),
          intendedPlacement: "global:logo",
          altText: "Company logo",
        },
      ],
    },
  });

  try {
    await new ImageAssetPlanningStage().run(ctx);
    assert.equal(ctx.imageAssetPlan?.assets.length, 2);
    assert.equal(ctx.resolvedImages?.get("/:hero")?.source, "provided");
    assert.equal(ctx.resolvedImages?.get("/:hero")?.width, 1920);
    assert.equal(ctx.resolvedImages?.get("global:logo")?.source, "provided");
    assert.equal(ctx.imageAssetManifest?.assets.length, 2);

    await new SiteAssemblerStage().run(ctx);
    assert.ok(existsSync(join(ctx.outputDir, "public/images/home-hero.png")), "hero image copied");
    assert.ok(existsSync(join(ctx.outputDir, "public/images/site-logo.png")), "logo image copied");

    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    assert.match(config, /\/images\/home-hero\.png/);
    assert.match(config, /"global:logo"/);
    assert.match(config, /"source": ?"provided"/);

    assert.ok(
      ctx.assemblyManifest?.files.some((file) => file.path === "public/images/home-hero.png"),
      "hero image recorded in assembly manifest",
    );
  } finally {
    cleanupContext(ctx);
    rmSync(source, { recursive: true, force: true });
    rmSync(resolve("build", "assets", ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});
