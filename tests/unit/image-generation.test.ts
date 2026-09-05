// L9_META: layer=test, role=image_generation_regression, status=active, version=1.0.0

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { ImageSlotSpec } from "../../src/pipeline/BuildContext.js";
import { ImageBudget, ImageBudgetExceededError } from "../../src/services/images/ImageBudget.js";
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenerator,
} from "../../src/services/images/ImageGenerator.js";
import { compileImagePrompt } from "../../src/services/images/ImagePromptCompiler.js";
import { planImageAssets } from "../../src/services/images/ImageAssetPlanner.js";
import { ImageAssetPlanningStage } from "../../src/stages/ImageAssetPlanningStage.js";
import { ImageGenerationStage } from "../../src/stages/ImageGenerationStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

class CountingGenerator implements ImageGenerator {
  calls = 0;
  constructor(private readonly costUsd = 0) {}
  async generate(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    this.calls += 1;
    return { bytes: PNG, mimeType: "image/png", model: "test-gen", estimatedCostUsd: this.costUsd };
  }
}

function ogSlot(): ImageSlotSpec {
  return {
    id: "og-image",
    placement: "global:og-image",
    required: true,
    preferredSources: ["generated"],
    generation: { intent: "Brand social card" },
    altText: "Authored social card for the client brand",
  };
}

function genContext(clientId: string) {
  return fixtureContext({
    client_id: clientId,
    assets: {
      imageSlots: [ogSlot()],
      generation: { enabled: true, budgetUsd: 5, model: "test-gen" },
    },
  });
}

// ---- prompt compiler ----

void test("compileImagePrompt is deterministic and honors compiler + exclusions", () => {
  const brief = {
    slotId: "og",
    intent: "Trustworthy hero photo",
    composition: "subject right",
    exclusions: ["text", "watermarks"],
    aspectRatio: "16:9" as const,
  };
  const a = compileImagePrompt(brief, { compiler: "default" });
  const b = compileImagePrompt(brief, { compiler: "default" });
  assert.equal(a.prompt, b.prompt);
  assert.match(a.prompt, /Do not include: text, watermarks/);
  assert.match(a.prompt, /Aspect ratio 16:9/);
  const igor = compileImagePrompt(brief, { compiler: "igor-motif" });
  assert.notEqual(igor.prompt, a.prompt);
  assert.match(igor.prompt, /cinematic/i);
});

// ---- budget ----

void test("ImageBudget charges and blocks over-limit spend", () => {
  const budget = new ImageBudget(1);
  budget.charge(0.6);
  assert.equal(budget.wouldExceed(0.5), true);
  assert.throws(() => budget.charge(0.6), ImageBudgetExceededError);
  const unlimited = new ImageBudget();
  unlimited.charge(1000);
  assert.equal(unlimited.wouldExceed(1e9), false);
});

// ---- generation stage ----

void test("generates only planned gaps, records evidence, and reuses cache on rerun", async () => {
  const ctx = genContext("gen-cache-client");
  const generator = new CountingGenerator(0);
  try {
    await new ImageAssetPlanningStage().run(ctx);
    assert.equal(ctx.imageAssetPlan?.assets[0].resolution.source, "generated");

    await new ImageGenerationStage(generator).run(ctx);
    const resolved = ctx.resolvedImages?.get("global:og-image");
    assert.equal(resolved?.source, "generated");
    assert.equal(resolved?.altText, "Authored social card for the client brand");
    assert.equal(resolved?.model, "test-gen");
    assert.ok(resolved?.promptHash);
    assert.equal(ctx.imageAssetManifest?.assets[0].source, "generated");
    assert.equal(generator.calls, 1);

    // Rerun: identical fingerprint → cache hit → no new provider call.
    await new ImageGenerationStage(generator).run(ctx);
    assert.equal(generator.calls, 1, "second run must reuse the cached image");
  } finally {
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId), { recursive: true, force: true });
  }
});

void test("reuses the client-level image cache across different buildIds", async () => {
  const first = genContext("gen-cache-client-persist");
  const generator = new CountingGenerator(0);
  try {
    await new ImageAssetPlanningStage().run(first);
    await new ImageGenerationStage(generator).run(first);
    assert.equal(generator.calls, 1);

    const second = genContext("gen-cache-client-persist");
    await new ImageAssetPlanningStage().run(second);
    await new ImageGenerationStage(generator).run(second);
    assert.equal(generator.calls, 1, "a new buildId must still hit the client cache");
    cleanupContext(second);
  } finally {
    cleanupContext(first);
    rmSync(resolve("build", "assets", first.clientId), { recursive: true, force: true });
  }
});

void test("generation fails closed when the budget is exhausted", async () => {
  const ctx = fixtureContext({
    client_id: "gen-budget-client",
    assets: {
      imageSlots: [ogSlot()],
      generation: { enabled: true, budgetUsd: 0.5, model: "test-gen" },
    },
  });
  try {
    await new ImageAssetPlanningStage().run(ctx);
    await assert.rejects(
      () => new ImageGenerationStage(new CountingGenerator(1)).run(ctx),
      /budget exceeded/i,
    );
  } finally {
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId), { recursive: true, force: true });
  }
});

// L2-S14-001: a spec with NO `assets` block still reaches generation under
// REDESIGN_IMPROVE (the blueprint's visual requirements demand it). The stage
// crashed with a TypeError reading `assets.generation` instead of generating.
void test("generation works for a spec that declares no assets block", async () => {
  const ctx = fixtureContext({ client_id: "gen-no-assets-client" });
  assert.equal(ctx.domainSpec.assets, undefined);
  ctx.imageAssetPlan = planImageAssets({
    slots: [ogSlot()],
    provided: [],
    sourceCandidates: [],
    generationEnabled: true,
  });
  assert.equal(ctx.imageAssetPlan.assets[0]?.resolution.source, "generated");
  const generator = new CountingGenerator(0);
  try {
    await new ImageGenerationStage(generator).run(ctx);
    assert.equal(generator.calls, 1);
    assert.equal(ctx.imageAssetManifest?.assets[0]?.source, "generated");
  } finally {
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId), { recursive: true, force: true });
  }
});

void test("generation errors when a gap exists but no provider is configured", async () => {
  const ctx = genContext("gen-noprovider-client");
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    await new ImageAssetPlanningStage().run(ctx);
    await assert.rejects(
      () => new ImageGenerationStage().run(ctx),
      /no image provider is configured/i,
    );
  } finally {
    if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
    if (savedGoogle !== undefined) process.env.GOOGLE_API_KEY = savedGoogle;
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId), { recursive: true, force: true });
  }
});
