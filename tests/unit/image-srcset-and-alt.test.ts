// L9_META: layer=test, role=image_srcset_and_alt_contract, status=active, version=1.0.0
//
// Follow-ups deferred from the real-first image pipeline (PR #304):
//  S1 every re-encoded (source-site / generated) raster ships narrower srcset
//     renditions beside its full-size file; a client-provided file stays
//     byte-for-byte with none (build contract T08);
//  S2 the template renders srcset/sizes only when renditions exist;
//  A1 a blueprint's composition guidance is an instruction for making the
//     image, never its alt text: alt describes what the image shows.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { VisualRequirement } from "@quantum-l9/bot-interop";
import sharp from "sharp";
import { srcsetFor } from "../../astro_template/src/lib/responsiveImage.js";
import type { ImageSlotSpec } from "../../src/pipeline/BuildContext.js";
import {
  buildImageAssetManifest,
  variantFileName,
  variantStagedPath,
} from "../../src/pipeline/evidence/ImageAssetManifest.js";
import { resolveAltText } from "../../src/services/images/ImageAltText.js";
import { planImageAssets } from "../../src/services/images/ImageAssetPlanner.js";
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenerator,
} from "../../src/services/images/ImageGenerator.js";
import { optimizeImageWithVariants } from "../../src/services/images/ImageOptimizer.js";
import {
  ImageAssetPlanningStage,
  mergeBlueprintAndSpecSlots,
  slotsFromVisualRequirements,
} from "../../src/stages/ImageAssetPlanningStage.js";
import { ImageGenerationStage } from "../../src/stages/ImageGenerationStage.js";
import { realPng } from "../helpers/realImage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

async function photo(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  let seed = 11;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (seed >> 16) & 0xff;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .blur(2)
    .png()
    .toBuffer();
}

/** A provider stand-in that returns a full-size photo, so renditions are possible. */
class LargePhotoGenerator implements ImageGenerator {
  constructor(private readonly bytes: Buffer) {}
  async generate(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    return { bytes: this.bytes, mimeType: "image/png", model: "large-photo", estimatedCostUsd: 0 };
  }
}

// ---- S1: renditions ---------------------------------------------------------

void test("S1: a large hero yields 640/960/1280 renditions with the slot's crop and byte cap", async () => {
  const { image, variants } = await optimizeImageWithVariants(await photo(3000, 2000), {
    id: "/:hero",
    placement: "/:hero",
    aspectRatio: "16:9",
  });
  assert.equal(image.width, 1920);
  assert.deepEqual(
    variants.map((variant) => variant.width),
    [640, 960, 1280],
  );
  for (const variant of variants) {
    assert.equal(variant.mimeType, image.mimeType);
    assert.equal(variant.height, Math.round(variant.width / (16 / 9)));
    const meta = await sharp(variant.bytes).metadata();
    assert.equal(meta.width, variant.width);
    assert.ok(variant.byteLength < image.byteLength);
  }
});

void test("S1: no rendition at or above the shipped width; logos and OG cards get none", async () => {
  const small = await optimizeImageWithVariants(await photo(700, 500), {
    id: "/:service",
    placement: "/:service",
  });
  assert.deepEqual(
    small.variants.map((variant) => variant.width),
    [480],
  );
  const tiny = await optimizeImageWithVariants(await photo(400, 300), {
    id: "/:service",
    placement: "/:service",
  });
  assert.equal(tiny.variants.length, 0);
  const og = await optimizeImageWithVariants(await photo(1600, 1600), {
    id: "og-image",
    placement: "global:og-image",
  });
  assert.equal(og.variants.length, 0);
  const logo = await optimizeImageWithVariants(await photo(1600, 400), {
    id: "logo",
    placement: "global:logo",
  });
  assert.equal(logo.variants.length, 0);
});

void test("S1: variant names derive from the shipped name and are staged beside the full file", () => {
  assert.equal(variantFileName("hero.webp", 640), "hero-640w.webp");
  assert.equal(variantStagedPath("/a/b/abc.webp", 960), join("/a/b", "abc-960w.webp"));
});

void test("S1: generated renditions are staged and recorded; the provided hero stays byte-identical without any", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wb-srcset-"));
  const heroPath = join(dir, "porch.png");
  const heroBytes = realPng(1600, 900);
  writeFileSync(heroPath, heroBytes);
  const ctx = fixtureContext({
    client_id: "srcset-client",
    assets: {
      generation: { enabled: true },
      providedImages: [
        { id: "porch", path: heroPath, intendedPlacement: "/:hero", altText: "Front porch" },
      ],
      imageSlots: [
        { id: "/:hero", placement: "/:hero", required: true, aspectRatio: "16:9" },
        {
          id: "/services:service",
          placement: "/services:service",
          required: false,
          aspectRatio: "3:2",
          preferredSources: ["generated"],
          generation: { intent: "Image for /services:service", subject: "Copper pipe fittings" },
        },
      ],
    },
  });
  try {
    await new ImageAssetPlanningStage().run(ctx);
    await new ImageGenerationStage(new LargePhotoGenerator(await photo(2400, 1600))).run(ctx);
    const hero = ctx.resolvedImages?.get("/:hero");
    const service = ctx.resolvedImages?.get("/services:service");
    assert.ok(hero && service);

    // T08: the client file is shipped as given, so it has no renditions.
    assert.equal(hero.source, "provided");
    assert.equal(hero.variants, undefined);
    assert.deepEqual(readFileSync(hero.absolutePath), heroBytes);

    assert.equal(service.source, "generated");
    assert.deepEqual(
      service.variants?.map((variant) => variant.width),
      [480, 800],
    );
    for (const variant of service.variants ?? []) {
      const staged = variantStagedPath(service.absolutePath, variant.width);
      assert.ok(existsSync(staged), staged);
      assert.equal(variant.fileName, variantFileName(service.outputFileName, variant.width));
    }
    // The alt is the subject the image was generated to show.
    assert.equal(service.altText, "Copper pipe fittings");

    const manifest = buildImageAssetManifest("b", "c", "t", [hero, service]);
    const recorded = manifest.assets.find((asset) => asset.placement === "/services:service");
    assert.equal(recorded?.altText, "Copper pipe fittings");
    assert.equal(recorded?.variants?.length, 2);
  } finally {
    cleanupContext(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- S2: template attributes ------------------------------------------------

void test("S2: srcset lists renditions plus the full file ascending; none without renditions", () => {
  assert.equal(srcsetFor({ src: "/images/hero.webp", width: 1920 }), undefined);
  assert.equal(
    srcsetFor({
      src: "/images/hero.webp",
      width: 1920,
      variants: [
        { src: "/images/hero-960w.webp", width: 960 },
        { src: "/images/hero-640w.webp", width: 640 },
      ],
    }),
    "/images/hero-640w.webp 640w, /images/hero-960w.webp 960w, /images/hero.webp 1920w",
  );
});

// ---- A1: alt text -----------------------------------------------------------

const HERO_REQUIREMENT: VisualRequirement = {
  requirement_id: "vr-/-hero",
  route_id: "/",
  section_id: "hero",
  slot_id: "/:hero",
  role: "hero",
  required: true,
  min_count: 1,
  preferred_provenance: ["source", "generated"],
  device_suitability: ["desktop", "mobile"],
  composition_guidance: "above-fold hero establishing the trade and locality",
};

void test("A1: composition guidance goes to the generation brief, never to alt text", () => {
  const [slot] = slotsFromVisualRequirements([HERO_REQUIREMENT], {
    vertical: "plumbing",
    locality: "NC",
  });
  assert.equal(slot.altText, undefined);
  assert.equal(slot.generation?.composition, HERO_REQUIREMENT.composition_guidance);
  assert.equal(slot.generation?.subject, "Plumbing services in NC");
  assert.equal(slot.generation?.intent, "Image for /:hero");

  const plan = planImageAssets({
    slots: [slot],
    provided: [],
    sourceCandidates: [],
    generationEnabled: true,
    vertical: "plumbing",
  });
  const resolution = plan.assets[0]?.resolution;
  assert.equal(resolution?.source, "generated");
  if (resolution?.source !== "generated") return;
  const brief = resolution.compiledBrief;
  assert.equal(brief.altText, undefined);
  const alt = resolveAltText(slot, [slot.altText, brief.altText, brief.subject, brief.intent]);
  assert.equal(alt, "Plumbing services in NC");
  assert.doesNotMatch(alt, /above-fold|establishing|composition/i);
});

void test("A1: without a vertical no subject is claimed; alt falls back to the section, never guidance", () => {
  const [slot] = slotsFromVisualRequirements([HERO_REQUIREMENT]);
  assert.equal(slot.generation?.subject, undefined);
  const alt = resolveAltText(slot, [slot.altText, slot.generation?.subject], {
    businessName: "Acme Plumbing",
    routes: [{ slug: "/", title: "Home" }],
  });
  assert.equal(alt, "Acme Plumbing hero image, Home page");
});

void test("A1: an operator's alt and brief on an overlapping spec slot outrank the blueprint's", () => {
  const blueprint = slotsFromVisualRequirements([HERO_REQUIREMENT], { vertical: "plumbing" });
  const spec: ImageSlotSpec[] = [
    {
      id: "/:hero",
      placement: "/:hero",
      required: true,
      altText: "Technician repairing a water heater",
      generation: { intent: "Water heater repair", subject: "A water heater" },
    },
  ];
  const [merged] = mergeBlueprintAndSpecSlots(blueprint, spec);
  assert.equal(merged.altText, "Technician repairing a water heater");
  assert.equal(merged.generation?.subject, "A water heater");
});
