// L9_META: layer=test, role=hero_static_illustration_contract, status=active, version=1.0.0
//
// Operator decision D1 (2026-11-17): the required home hero ("/:hero") may be
// filled by a built-in STATIC conceptual illustration (CRM rows → relationship
// graph) when no provided or source-site image qualifies and generation cannot
// run. It is recorded in the plan as source "static-illustration", counted as
// filled by the redesign integrity receipt, delivered through siteConfig (no
// file), and rendered by the template as a labelled, accessible inline SVG with
// no script. The 100% gate and `required` stay exactly as strict: only the home
// hero gains this fill; every other required slot still fails closed.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  CONCEPTUAL_ILLUSTRATION_LABEL,
  conceptualIllustrationMarkup,
} from "../../astro_template/src/lib/conceptualIllustrations.js";
import type { BuildContext, ImageSlotSpec } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  HOME_HERO_ILLUSTRATION_ID,
  type ImageAssetPlan,
  unresolvedRequiredSlots,
  validateImageAssetPlan,
} from "../../src/pipeline/evidence/ImageAssetPlan.js";
import {
  emitRedesignExecutionIntegrityReceipt,
  validateRedesignExecutionIntegrityReceipt,
} from "../../src/pipeline/evidence/RedesignExecutionIntegrityReceipt.js";
import type { IngestedImage } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import { planImageAssets } from "../../src/services/images/ImageAssetPlanner.js";
import { ImageAssetPlanningStage } from "../../src/stages/ImageAssetPlanningStage.js";
import { ImageValidationStage } from "../../src/stages/ImageValidationStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";
import {
  BUILD_ID,
  CLIENT_ID,
  makeDonorEvidence,
  makeLandscape,
  makeSeoBlueprint,
  makeWebsiteBlueprint,
} from "./redesign-fixtures.js";

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

// The blueprint's home hero: required, synthetic visuals admissible.
const homeHero: ImageSlotSpec = {
  id: "/:hero",
  placement: "/:hero",
  required: true,
  preferredSources: ["provided", "source-site", "generated"],
};

const sourceHero: IngestedImage = {
  id: "src-hero",
  sourceUrl: "https://example.com/hero.jpg",
  referringPageUrl: "https://example.com/",
  localPath: "/nonexistent/hero.jpg",
  mimeType: "image/jpeg",
  width: 1920,
  height: 1080,
  byteLength: 200_000,
  sha256: "a".repeat(64),
  provenance: "source-site",
} as IngestedImage;

// ---- (1) planner + stage: generation disabled, no candidates ---------------

void test("generation disabled with no candidate: the home hero resolves to the static illustration", () => {
  const plan = planImageAssets({
    slots: [homeHero],
    provided: [],
    sourceCandidates: [],
    generationEnabled: false,
  });
  const resolution = plan.assets[0].resolution;
  assert.equal(resolution.source, "static-illustration");
  assert.equal(
    resolution.source === "static-illustration" && resolution.illustrationId,
    HOME_HERO_ILLUSTRATION_ID,
  );
  assert.equal(plan.assets[0].required, true, "required is never lowered");
  assert.equal(unresolvedRequiredSlots(plan).length, 0);
  assert.doesNotThrow(() => validateImageAssetPlan(plan));
});

void test("generation enabled still generates the hero; the illustration is only a last resort", () => {
  const plan = planImageAssets({
    slots: [homeHero],
    provided: [],
    sourceCandidates: [],
    generationEnabled: true,
  });
  assert.equal(plan.assets[0].resolution.source, "generated");
});

void test("image planning passes for a COPY build whose required home hero has no candidate", async () => {
  const ctx = fixtureContext({
    assets: { imageSlots: [homeHero], generation: { enabled: false } },
  });
  try {
    await new ImageAssetPlanningStage().run(ctx);
    const hero = ctx.imageAssetPlan?.assets.find((asset) => asset.placement === "/:hero");
    assert.equal(hero?.resolution.source, "static-illustration");
    // No file was staged for it: the manifest carries only delivered files.
    assert.equal(ctx.resolvedImages?.has("/:hero"), false);
    assert.equal(ctx.imageAssetManifest?.assets.length, 0);
    const stored = await ctx.evidenceStore.readImagePlan();
    assert.equal(stored?.value.assets[0].resolution.source, "static-illustration");
  } finally {
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});

void test("REDESIGN planning with only a provided logo fills the blueprint hero (QAP regression)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wb-illus-"));
  writeFileSync(join(dir, "logo.png"), pngWith(512, 512));
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape, {
    visual_requirements: [
      {
        requirement_id: "vr-/-hero",
        route_id: "/",
        section_id: "hero",
        slot_id: "/:hero",
        role: "hero",
        required: true,
        min_count: 1,
        preferred_provenance: ["source", "licensed", "generated"],
        device_suitability: ["desktop", "mobile"],
      },
      {
        requirement_id: "vr-global-logo",
        route_id: "global",
        section_id: "header",
        slot_id: "global:logo",
        role: "logo",
        required: true,
        min_count: 1,
        preferred_provenance: ["source"],
        device_suitability: ["desktop", "mobile"],
      },
    ],
  });
  const ctx = {
    buildId: "illus-build",
    clientId: "illus-client",
    dryRun: true,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    startedAt: new Date("2026-11-17T00:00:00.000Z"),
    websiteBlueprint: blueprint,
    domainSpec: {
      client_id: "illus-client",
      business_name: "Illus Biz",
      vertical: "test_service",
      geography: { states: ["TN"], primary_state: "TN" },
      design: { status: "resolved" },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
      assets: {
        generation: { enabled: false },
        providedImages: [{ id: "logo", path: join(dir, "logo.png") }],
      },
    },
    generatedContent: new Map(),
    generatedSchemas: new Map(),
    stageResults: new Map(),
    qualityEvidence: { seoBaseline: "pending", visualQa: "pending" },
    evidenceStore: { async writeImagePlan() {}, async writeImageAssets() {} },
  } as unknown as BuildContext;
  try {
    await new ImageAssetPlanningStage().run(ctx);
    const byPlacement = new Map(
      ctx.imageAssetPlan?.assets.map((asset) => [asset.placement, asset.resolution.source]),
    );
    assert.equal(byPlacement.get("/:hero"), "static-illustration");
    assert.equal(byPlacement.get("global:logo"), "provided");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- (2) real images still win ---------------------------------------------

void test("a provided /:hero image still wins over the illustration", () => {
  const plan = planImageAssets({
    slots: [homeHero],
    provided: [{ id: "hero-photo", intendedPlacement: "/:hero", width: 1920, height: 1080 }],
    sourceCandidates: [],
    generationEnabled: false,
  });
  const resolution = plan.assets[0].resolution;
  assert.equal(resolution.source, "provided");
  assert.equal(resolution.source === "provided" && resolution.candidateId, "hero-photo");
});

void test("an authorized source-site hero still wins over the illustration", () => {
  const plan = planImageAssets({
    slots: [homeHero],
    provided: [],
    sourceCandidates: [sourceHero],
    generationEnabled: false,
  });
  assert.equal(plan.assets[0].resolution.source, "source-site");
});

// ---- (3) every other required slot still fails closed ----------------------

void test("a non-home-hero required slot with no candidate still fails closed", () => {
  const slots: ImageSlotSpec[] = [
    { ...homeHero, id: "svc-hero", placement: "/services:hero" },
    { ...homeHero, id: "home-team", placement: "/:team" },
    { ...homeHero, id: "about-hero", placement: "/:hero#secondary" },
  ];
  const plan = planImageAssets({
    slots,
    provided: [],
    sourceCandidates: [],
    generationEnabled: false,
  });
  for (const asset of plan.assets)
    assert.equal(asset.resolution.source, "unresolved", asset.slotId);
  assert.equal(unresolvedRequiredSlots(plan).length, 3);
});

void test("a home hero restricted to real assets, or optional, is never illustrated", () => {
  const plan = planImageAssets({
    slots: [
      { ...homeHero, preferredSources: ["provided", "source-site"] },
      { ...homeHero, id: "optional-hero", required: false },
    ],
    provided: [],
    sourceCandidates: [],
    generationEnabled: false,
  });
  assert.equal(plan.assets[0].resolution.source, "unresolved");
  assert.equal(plan.assets[1].resolution.source, "unresolved");
});

void test("the planning stage still throws for a required non-hero slot", async () => {
  const ctx = fixtureContext({
    assets: {
      imageSlots: [homeHero, { ...homeHero, id: "svc-hero", placement: "/services:hero" }],
      generation: { enabled: false },
    },
  });
  try {
    await assert.rejects(
      () => new ImageAssetPlanningStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        /Required image slots could not be resolved: svc-hero$|: svc-hero;/.test(error.message),
    );
  } finally {
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});

void test("plan evidence rejects a static illustration outside the home hero", () => {
  const plan: ImageAssetPlan = {
    schema: "website-bot.image-asset-plan/v1",
    version: "1.0.0",
    assets: [
      {
        slotId: "team",
        placement: "/:team",
        required: true,
        resolution: { source: "static-illustration", illustrationId: "crm-to-graph", reason: "x" },
      },
    ],
  };
  assert.throws(() => validateImageAssetPlan(plan), /only valid for \/:hero/);
});

// ---- (4) integrity receipt ---------------------------------------------------

function receiptCtx(assets: ImageAssetPlan["assets"]): BuildContext {
  const landscape = makeLandscape();
  return {
    buildId: BUILD_ID,
    clientId: CLIENT_ID,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    competitiveLandscape: landscape,
    websiteBlueprint: makeWebsiteBlueprint(landscape),
    seoContentBlueprint: makeSeoBlueprint(landscape),
    pageContentContract: {
      artifact_id: `page_content_contract:${"1".repeat(64)}`,
      integrity: { algorithm: "sha256", payload_digest: "1".repeat(64) },
    },
    structuredContentPackage: {
      artifact_id: `structured_content_package:${"2".repeat(64)}`,
      integrity: { algorithm: "sha256", payload_digest: "2".repeat(64) },
    },
    acceptedDonors: Array.from({ length: 10 }, (_, index) =>
      makeDonorEvidence(`donor-${index}.example.com`),
    ),
    redesignCounters: {
      pageContentContractLlmCalls: 0,
      legacyContentGenerationCalls: 0,
      redesignSchemaLlmCalls: 0,
    },
    sourceAssetDecisions: [],
    imageAssetPlan: { schema: "website-bot.image-asset-plan/v1", version: "1.0.0", assets },
    sourceSiteManifest: { images: [] },
    stageResults: new Map(),
    qualityEvidence: { seoBaseline: "pending", visualQa: "passed" },
  } as unknown as BuildContext;
}

const illustratedHero: ImageAssetPlan["assets"][number] = {
  slotId: "/:hero",
  placement: "/:hero",
  required: true,
  resolution: { source: "static-illustration", illustrationId: "crm-to-graph", reason: "d1" },
};
const providedLogo: ImageAssetPlan["assets"][number] = {
  slotId: "global:logo",
  placement: "global:logo",
  required: true,
  resolution: { source: "provided", candidateId: "logo", score: 60 },
};

void test("the integrity receipt counts the static illustration as filled (100%)", () => {
  const receipt = emitRedesignExecutionIntegrityReceipt(
    receiptCtx([illustratedHero, providedLogo]),
  );
  assert.equal(receipt.visual.required_slots, 2);
  assert.equal(receipt.visual.required_slots_filled, 2);
  assert.equal(receipt.visual.required_visual_slots_filled_pct, 100);
  assert.doesNotThrow(() =>
    validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: false }),
  );
});

void test("the integrity receipt still fails below 100% beside an illustrated hero", () => {
  const receipt = emitRedesignExecutionIntegrityReceipt(
    receiptCtx([
      illustratedHero,
      {
        slotId: "/:team",
        placement: "/:team",
        required: true,
        resolution: { source: "unresolved", reason: "no team photo" },
      },
    ]),
  );
  assert.equal(receipt.visual.required_visual_slots_filled_pct, 50);
  assert.throws(
    () => validateRedesignExecutionIntegrityReceipt(receipt, { requireVisualQa: false }),
    /required_visual_slots_filled must be 100%, got 50%/,
  );
});

// ---- downstream: assembly delivers it without a file; validation accepts ----

void test("assembly delivers the illustration via siteConfig and image validation accepts it", async () => {
  const ctx = fixtureContext({
    assets: { imageSlots: [homeHero], generation: { enabled: false } },
  });
  try {
    await new ImageAssetPlanningStage().run(ctx);
    await new SiteAssemblerStage().run(ctx);
    assert.deepEqual(ctx.siteConfig?.illustrations, {
      "/:hero": { illustrationId: "crm-to-graph", source: "static-illustration" },
    });
    assert.equal(ctx.siteConfig?.images?.["/:hero"], undefined, "no image entry");
    const imagesDir = join(ctx.outputDir, "public/images");
    assert.ok(
      !existsSync(imagesDir) || readdirSync(imagesDir).length === 0,
      "no image file is copied for the illustration",
    );
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    const emitted =
      /\n {2}illustrations: ([\s\S]*?) as Record<string, \{ illustrationId: string; source: string \}>,/.exec(
        config,
      )?.[1];
    assert.ok(emitted, "siteConfig.ts emits a widened illustrations registry");
    assert.deepEqual(JSON.parse(emitted), {
      "/:hero": { illustrationId: "crm-to-graph", source: "static-illustration" },
    });
    await new ImageValidationStage().run(ctx);
  } finally {
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});

void test("image validation fails closed when a planned illustration was not delivered", async () => {
  const ctx = fixtureContext({
    assets: { imageSlots: [homeHero], generation: { enabled: false } },
  });
  try {
    await new ImageAssetPlanningStage().run(ctx);
    await new SiteAssemblerStage().run(ctx);
    if (ctx.siteConfig) ctx.siteConfig.illustrations = {};
    await assert.rejects(
      () => new ImageValidationStage().run(ctx),
      /static illustration not delivered: \/:hero[\s\S]*required slot not delivered|required slot not delivered[\s\S]*static illustration not delivered/,
    );
  } finally {
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});

void test("image validation rejects an illustration-only delivery that was never planned", async () => {
  // No image slots, no image files, no plan entries: only a delivered
  // illustration. The early "nothing to validate" return must not skip it.
  const ctx = fixtureContext({ assets: { generation: { enabled: false } } });
  try {
    ctx.siteConfig = {
      ...(ctx.siteConfig ?? {}),
      images: {},
      illustrations: {
        "/:hero": { illustrationId: "crm-to-graph", source: "static-illustration" },
      },
    } as unknown as BuildContext["siteConfig"];
    await assert.rejects(
      () => new ImageValidationStage().run(ctx),
      /delivered static illustration \/:hero was never planned/,
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("assembly refuses an illustration whose route renders no hero section", async () => {
  const ctx = fixtureContext({
    routes: [{ slug: "/", title: "Home", components: ["services-overview"] }],
    assets: { imageSlots: [homeHero], generation: { enabled: false } },
  });
  try {
    await new ImageAssetPlanningStage().run(ctx);
    await assert.rejects(
      () => new SiteAssemblerStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "SITE_ASSEMBLY_FAILED" &&
        /illustration-unbound: \/:hero/.test(error.message),
    );
  } finally {
    cleanupContext(ctx);
    rmSync(resolve("build", "assets", ctx.clientId, ctx.buildId), { recursive: true, force: true });
  }
});

// ---- (5) template: static, labelled, accessible inline SVG ------------------

void test("the template renders the conceptual illustration as labelled inline SVG with no script", () => {
  const markup = conceptualIllustrationMarkup("crm-to-graph", "/:hero");
  assert.ok(markup);
  assert.match(markup, /^<figure class="hero__illustration"/);
  assert.match(markup, /data-asset-source="static-illustration"/);
  assert.match(markup, /data-image-slot="\/:hero"/);
  assert.match(markup, /<svg[^>]*role="img"[^>]*aria-labelledby="ci-hero-title ci-hero-desc"/);
  assert.match(markup, /<title id="ci-hero-title">Conceptual illustration: CRM records/);
  assert.match(markup, /<desc id="ci-hero-desc">Rows of a customer relationship management table/);
  assert.match(
    markup,
    new RegExp(
      `<figcaption class="hero__illustration-label">${CONCEPTUAL_ILLUSTRATION_LABEL}</figcaption>`,
    ),
  );
  assert.equal(CONCEPTUAL_ILLUSTRATION_LABEL, "Conceptual illustration");
  // CRM rows and graph nodes/edges are both drawn.
  assert.equal(markup.match(/class="ci-row"/g)?.length, 5);
  assert.ok((markup.match(/class="ci-node/g)?.length ?? 0) >= 5);
  assert.ok((markup.match(/class="ci-edge"/g)?.length ?? 0) >= 5);
  // Static: no script, no raster, no canvas/WebGL, no animation, no inline colors.
  for (const banned of [
    /<script/i,
    /<img/i,
    /<image/i,
    /<canvas/i,
    /webgl/i,
    /<animate/i,
    /<set\b/i,
    /on[a-z]+=/i,
    /#[0-9a-f]{3,6}\b/i,
  ]) {
    assert.doesNotMatch(markup, banned);
  }
  assert.equal(conceptualIllustrationMarkup("unknown", "/:hero"), undefined);
});

void test("Hero.astro wires the illustration only when there is no hero image", () => {
  const hero = readFileSync(resolve("astro_template/src/components/sections/Hero.astro"), "utf8");
  assert.match(hero, /import ConceptualIllustration from "\.\.\/ConceptualIllustration\.astro";/);
  assert.match(
    hero,
    /const heroIllustration = heroImage \? undefined : illustrations\[`\$\{path\}:hero`\];/,
  );
  assert.match(hero, /\{heroIllustration && \(\s*<ConceptualIllustration/);
  const component = readFileSync(
    resolve("astro_template/src/components/ConceptualIllustration.astro"),
    "utf8",
  );
  assert.doesNotMatch(component, /<script/i);
  assert.match(component, /set:html=\{markup\}/);
  const css = readFileSync(resolve("astro_template/src/styles/global.css"), "utf8");
  for (const rule of [".ci-head", ".ci-node", ".ci-edge", ".ci-flow"]) {
    const line = css.split("\n").find((entry) => entry.startsWith(`${rule} {`));
    assert.ok(line, rule);
    assert.match(line, /var\(--color-(primary|accent|secondary|background|text)\)/, rule);
  }
  assert.doesNotMatch(
    css.slice(css.indexOf(".hero__illustration"), css.indexOf(".hero__actions")),
    /animation|transition/,
  );
  const placeholder = readFileSync(resolve("astro_template/src/lib/siteConfig.ts"), "utf8");
  assert.match(
    placeholder,
    /illustrations: \{\} as Record<string, \{ illustrationId: string; source: string \}>/,
  );
});
