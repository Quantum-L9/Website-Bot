// L9_META: layer=test, role=image_real_first_contract, status=active, version=1.0.0
//
// Lane wb-images. One test group per verified defect:
//  D1 the Gemini request carried no image config, so aspect ratio and size
//     survived only as words in the prompt;
//  D2 no shipped raster was resized, re-encoded or size-capped (multi-MB
//     images reached production);
//  D3 generation outweighed real photos and every brief asked for
//     "Photorealistic" output, i.e. fake photos of invented crews and jobs;
//  D4 any client's home hero fell back to the CRM→graph illustration and the
//     integrity receipt counted it as filled.

import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { ImageSlotSpec } from "../../src/pipeline/BuildContext.js";
import {
  HOME_HERO_ILLUSTRATION_ID,
  type ImageAssetPlan,
  illustrationFitsVertical,
  unresolvedRequiredSlots,
} from "../../src/pipeline/evidence/ImageAssetPlan.js";
import type { IngestedImage } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import { GeminiImageGenerator } from "../../src/services/images/GeminiImageGenerator.js";
import {
  GENERATED_IMAGES_PER_PAGE_CAP,
  planImageAssets,
} from "../../src/services/images/ImageAssetPlanner.js";
import {
  ImageOptimizationError,
  optimizeImageForSlot,
  slotRenderProfile,
} from "../../src/services/images/ImageOptimizer.js";
import { compileImagePrompt } from "../../src/services/images/ImagePromptCompiler.js";

// ---- D1: provider request config -------------------------------------------

function captureRequests(): { bodies: Array<Record<string, unknown>>; restore: () => void } {
  const bodies: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { bodies, restore: () => (globalThis.fetch = original) };
}

void test("D1: the requested aspect ratio is sent as generationConfig.imageConfig", async () => {
  const { bodies, restore } = captureRequests();
  try {
    const result = await new GeminiImageGenerator({ apiKey: "k" }).generate({
      prompt: "hero",
      aspectRatio: "16:9",
      imageSize: "2K",
    });
    const config = bodies[0].generationConfig as { imageConfig?: Record<string, unknown> };
    assert.deepEqual(config?.imageConfig, { aspectRatio: "16:9" });
    // gemini-2.5-flash-image has no size tiers: the size is not sent, and why is recorded.
    assert.equal(result.requestConfig?.imageSize, undefined);
    assert.ok(result.adjustments?.some((note) => /imageSize 2K not sent/.test(note)));
  } finally {
    restore();
  }
});

void test("D1: a model with size tiers receives imageSize", async () => {
  const { bodies, restore } = captureRequests();
  try {
    await new GeminiImageGenerator({ apiKey: "k", model: "gemini-3-pro-image" }).generate({
      prompt: "hero",
      aspectRatio: "4:3",
      imageSize: "2K",
    });
    const config = bodies[0].generationConfig as { imageConfig?: Record<string, unknown> };
    assert.deepEqual(config?.imageConfig, { aspectRatio: "4:3", imageSize: "2K" });
  } finally {
    restore();
  }
});

void test("D1: an unsupported ratio is mapped to the nearest supported one and recorded", async () => {
  const { bodies, restore } = captureRequests();
  try {
    const result = await new GeminiImageGenerator({ apiKey: "k" }).generate({
      prompt: "banner",
      aspectRatio: "5:2",
    });
    const config = bodies[0].generationConfig as { imageConfig?: Record<string, unknown> };
    assert.deepEqual(config?.imageConfig, { aspectRatio: "21:9" });
    assert.ok(result.adjustments?.some((note) => /5:2/.test(note) && /21:9/.test(note)));
  } finally {
    restore();
  }
});

// ---- D2: optimisation of every shipped raster ------------------------------

async function photo(width: number, height: number): Promise<Buffer> {
  // Noisy content so the encoded size is representative of a real photo.
  const raw = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = (seed >> 16) & 0xff;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .blur(2)
    .png()
    .toBuffer();
}

void test("D2: a large hero is cropped to the slot aspect, resized and re-encoded", async () => {
  const original = await photo(3000, 2000);
  const slot = { id: "/:hero", placement: "/:hero", aspectRatio: "16:9" };
  const result = await optimizeImageForSlot(original, slot);
  const profile = slotRenderProfile(slot);
  assert.equal(result.mimeType, "image/webp");
  assert.equal(result.width, profile.maxWidth);
  assert.equal(result.height, Math.round(profile.maxWidth / (16 / 9)));
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, result.width);
  assert.equal(meta.height, result.height);
  assert.ok(result.byteLength <= profile.maxBytes, `${result.byteLength} > ${profile.maxBytes}`);
  assert.ok(result.byteLength < original.length);
  assert.ok(result.adjustments.some((note) => /cropped/.test(note)));
});

void test("D2: an OG card is exactly 1200x630 JPEG", async () => {
  const result = await optimizeImageForSlot(await photo(1600, 1600), {
    id: "og-image",
    placement: "global:og-image",
  });
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.width, 1200);
  assert.equal(result.height, 630);
});

void test("D2: a small image is never enlarged", async () => {
  const result = await optimizeImageForSlot(await photo(400, 300), {
    id: "svc",
    placement: "/services:service",
  });
  assert.equal(result.width, 400);
  assert.equal(result.height, 300);
});

void test("D2: an output that cannot fit the byte cap fails closed", async () => {
  await assert.rejects(
    optimizeImageForSlot(
      await photo(1200, 800),
      { id: "svc", placement: "/services:service" },
      {
        maxBytes: 200,
      },
    ),
    ImageOptimizationError,
  );
});

void test("D2: an undecodable input fails closed", async () => {
  const fake = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  fake.writeUInt32BE(1920, 16);
  fake.writeUInt32BE(1080, 20);
  await assert.rejects(
    optimizeImageForSlot(fake, { id: "/:hero", placement: "/:hero" }),
    ImageOptimizationError,
  );
});

// ---- D3: real first, capped generation, no photoreal fakes -----------------

function slot(id: string, placement: string, required = false): ImageSlotSpec {
  return {
    id,
    placement,
    required,
    aspectRatio: "3:2",
    preferredSources: ["provided", "source-site", "generated"],
  };
}

function sourcePhoto(id: string, page: string): IngestedImage {
  return {
    id,
    sourceUrl: `https://client.example/${id}.jpg`,
    referringPageUrl: `https://client.example${page}`,
    localPath: `/nonexistent/${id}.jpg`,
    mimeType: "image/jpeg",
    width: 1500,
    height: 1000,
    byteLength: 180_000,
    sha256: id.padEnd(64, "0"),
    provenance: "source-site",
  } as IngestedImage;
}

void test("D3: a real source photo fills a slot before generation is considered", () => {
  const plan = planImageAssets({
    slots: [slot("svc-1", "/services:service#a")],
    provided: [],
    sourceCandidates: [sourcePhoto("roof-photo", "/services")],
    generationEnabled: true,
  });
  assert.equal(plan.assets[0].resolution.source, "source-site");
});

void test("D3: generated images are capped per page; excess optional slots stay empty", () => {
  const slots = [1, 2, 3, 4, 5].map((n) => slot(`svc-${n}`, `/services:service#s${n}`));
  const plan = planImageAssets({
    slots,
    provided: [],
    sourceCandidates: [],
    generationEnabled: true,
  });
  const generated = plan.assets.filter((asset) => asset.resolution.source === "generated");
  assert.equal(generated.length, GENERATED_IMAGES_PER_PAGE_CAP);
  const capped = plan.assets.filter((asset) => asset.resolution.source === "unresolved");
  assert.equal(capped.length, 5 - GENERATED_IMAGES_PER_PAGE_CAP);
  for (const asset of capped) {
    assert.match(asset.resolution.source === "unresolved" ? asset.resolution.reason : "", /cap/);
  }
});

void test("D3: a required slot is never dropped by the cap", () => {
  const slots = [
    slot("opt-1", "/services:service#a"),
    slot("opt-2", "/services:service#b"),
    slot("req-1", "/services:service#c", true),
  ];
  const plan = planImageAssets({
    slots,
    provided: [],
    sourceCandidates: [],
    generationEnabled: true,
  });
  const byId = new Map(plan.assets.map((asset) => [asset.slotId, asset.resolution.source]));
  assert.equal(byId.get("req-1"), "generated");
  assert.equal(unresolvedRequiredSlots(plan).length, 0);
});

void test("D3: a brief about crews or completed jobs is an illustration, never a photoreal fake", () => {
  const compiled = compileImagePrompt({
    slotId: "svc",
    intent: "Roofing crew installing shingles on a finished home",
  });
  assert.doesNotMatch(compiled.prompt, /photorealistic/i);
  assert.match(compiled.prompt, /illustration/i);
  assert.match(compiled.prompt, /no (realistic|identifiable) (people|person)/i);
  assert.equal(compiled.style, "illustration");
});

void test("D3: a neutral scene may be photographic but must show no people or client work", () => {
  const compiled = compileImagePrompt({ slotId: "bg", intent: "Close-up texture of slate tiles" });
  assert.equal(compiled.style, "photographic-neutral");
  assert.match(compiled.prompt, /no people/i);
  assert.doesNotMatch(compiled.prompt, /igor|crew/i);
});

void test("D3: the igor-motif compiler cannot turn a people brief into a photograph", () => {
  const compiled = compileImagePrompt(
    { slotId: "hero", intent: "Our technicians meeting a homeowner" },
    { compiler: "igor-motif" },
  );
  assert.doesNotMatch(compiled.prompt, /photograph|photorealistic/i);
});

// ---- D4: the static illustration must fit the client -----------------------

const homeHero: ImageSlotSpec = {
  id: "/:hero",
  placement: "/:hero",
  required: true,
  preferredSources: ["provided", "source-site", "generated"],
};

void test("D4: a roofer's home hero with no image stays UNRESOLVED (no CRM diagram)", () => {
  const plan: ImageAssetPlan = planImageAssets({
    slots: [homeHero],
    provided: [],
    sourceCandidates: [],
    generationEnabled: false,
    vertical: "residential_roofing",
  });
  assert.equal(plan.assets[0].resolution.source, "unresolved");
  assert.equal(unresolvedRequiredSlots(plan).length, 1);
});

void test("D4: with no declared vertical the illustration is never assumed to fit", () => {
  const plan = planImageAssets({
    slots: [homeHero],
    provided: [],
    sourceCandidates: [],
    generationEnabled: false,
  });
  assert.equal(plan.assets[0].resolution.source, "unresolved");
});

void test("D4: a CRM / data software client may still use the CRM→graph illustration", () => {
  assert.equal(illustrationFitsVertical(HOME_HERO_ILLUSTRATION_ID, "crm_software"), true);
  assert.equal(illustrationFitsVertical(HOME_HERO_ILLUSTRATION_ID, "residential_roofing"), false);
  const plan = planImageAssets({
    slots: [homeHero],
    provided: [],
    sourceCandidates: [],
    generationEnabled: false,
    vertical: "crm_software",
  });
  assert.equal(plan.assets[0].resolution.source, "static-illustration");
});
