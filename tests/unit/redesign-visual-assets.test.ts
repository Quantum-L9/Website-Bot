// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// Campaign 7 test matrices H/I: blueprint-derived visual slots, the 100%
// required-slot gate, authorized source asset preference over generation,
// the SELECTED/REJECTED ledger, and donor-image exclusion from generation
// inputs (donor evidence is never a planner candidate source).

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32 as zlibCrc32 } from "node:zlib";
import type { VisualRequirement, WebsiteBuildBlueprintV2 } from "@quantum-l9/bot-interop";
import { deriveVisualRequirements } from "../../src/intelligence/WebsiteBuildBlueprintCompiler.js";
import type { BuildContext, ImageSlotSpec } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import type { IngestedImage } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import {
  ImageAssetPlanningStage,
  mergeBlueprintAndSpecSlots,
  slotsFromVisualRequirements,
} from "../../src/stages/ImageAssetPlanningStage.js";
import { BLUEPRINT_ROUTES, makeLandscape, makeWebsiteBlueprint } from "./redesign-fixtures.js";

// A real 1x1 PNG so inspectImage decodes staged source assets.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function makeSourceImage(
  id: string,
  dir: string,
  overrides?: Partial<IngestedImage>,
): IngestedImage {
  const localPath = join(dir, `${id}.png`);
  writeFileSync(localPath, PNG_1X1);
  return {
    id,
    sourceUrl: `https://source.example.com/images/${id}.jpg`,
    referringPageUrl: "https://source.example.com/",
    localPath,
    altText: `photo ${id}`,
    surroundingText: "completed project",
    mimeType: "image/png",
    width: 1920,
    height: 1080,
    byteLength: 120_000,
    sha256: id.repeat(8).slice(0, 64).padEnd(64, "0"),
    ...overrides,
  } as IngestedImage;
}

function makeCtx(_dir: string, overrides?: Partial<BuildContext>): BuildContext {
  return {
    buildId: "visual-test-build",
    clientId: "visual-test-client",
    dryRun: true,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    startedAt: new Date("2026-08-17T00:00:00.000Z"),
    domainSpec: {
      client_id: "visual-test-client",
      business_name: "Test Biz",
      vertical: "test_service",
      geography: { states: ["TN"], primary_state: "TN" },
      design: { status: "resolved" },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
      assets: { generation: { enabled: true } },
    },
    generatedContent: new Map(),
    generatedSchemas: new Map(),
    stageResults: new Map(),
    qualityEvidence: { seoBaseline: "pending", visualQa: "pending" },
    evidenceStore: {
      async writeImagePlan() {},
      async writeImageAssets() {},
    },
    ...overrides,
  } as unknown as BuildContext;
}

// ---- Matrix H: blueprint-derived slots -------------------------------------

void test("deriveVisualRequirements produces a global logo and a required home hero", () => {
  const requirements = deriveVisualRequirements(BLUEPRINT_ROUTES);
  const logo = requirements.find((entry) => entry.role === "logo");
  const hero = requirements.find((entry) => entry.role === "hero");
  // WB-GLUE-01: the logo is a protected brand asset — present as a source-only
  // requirement, never mandatory synthetic generation.
  assert.ok(logo && !logo.required && logo.route_id === "global");
  assert.deepEqual(logo.preferred_provenance, ["source"]);
  assert.ok(hero?.required && hero.route_id === "/");
  const trust = requirements.find((entry) => entry.role === "trust");
  assert.ok(trust && !trust.required, "trust slot derived from trust content slot, optional");
});

void test("deriveVisualRequirements is deterministic and slot-unique", () => {
  const first = deriveVisualRequirements(BLUEPRINT_ROUTES);
  const second = deriveVisualRequirements(BLUEPRINT_ROUTES);
  assert.deepEqual(first, second);
  const ids = first.map((entry) => entry.slot_id);
  assert.equal(new Set(ids).size, ids.length);
});

void test("visual requirements project into planner slots with source-over-generation precedence", () => {
  const requirement: VisualRequirement = {
    requirement_id: "vr-test",
    route_id: "/",
    section_id: "hero",
    slot_id: "/:hero",
    role: "hero",
    required: true,
    min_count: 1,
    preferred_provenance: ["source", "generated"],
    device_suitability: ["desktop"],
  };
  const [slot] = slotsFromVisualRequirements([requirement]);
  assert.equal(slot.id, "/:hero");
  assert.equal(slot.placement, "/:hero");
  assert.equal(slot.required, true);
  assert.deepEqual(slot.preferredSources, ["provided", "source-site", "generated"]);
});

void test("spec slots with a placement already covered by the blueprint are dropped (golden run #54)", () => {
  const blueprintSlots: ImageSlotSpec[] = [
    {
      id: "hero-global-logo",
      placement: "global:logo",
      required: false,
      preferredSources: ["provided", "source-site"],
    },
  ];
  const specSlots: ImageSlotSpec[] = [
    {
      id: "logo",
      placement: "global:logo",
      required: false,
      preferredSources: ["provided", "source-site", "generated"],
    },
    {
      id: "og-image",
      placement: "global:og-image",
      required: false,
      preferredSources: ["generated"],
    },
  ];
  const merged = mergeBlueprintAndSpecSlots(blueprintSlots, specSlots);
  // The spec "logo" shares the blueprint's placement (different id) — the
  // manifest's uniqueness key is the placement, so it must drop; the
  // og-image slot is a genuine operator addition and stays.
  assert.equal(merged.length, 2);
  assert.deepEqual(
    merged.map((slot) => slot.id),
    ["hero-global-logo", "og-image"],
  );
});

void test("blueprint requirements sharing a role keep distinct section-qualified placements (golden run #58, WB-GLUE-01)", () => {
  const requirements: VisualRequirement[] = [
    {
      requirement_id: "vr-a",
      route_id: "/",
      section_id: "hero",
      slot_id: "/:hero",
      role: "service",
      required: false,
      min_count: 1,
      preferred_provenance: ["generated"],
      device_suitability: ["desktop"],
    },
    {
      requirement_id: "vr-b",
      route_id: "/",
      section_id: "services-overview",
      slot_id: "/:services-overview",
      role: "service",
      required: true,
      min_count: 1,
      preferred_provenance: ["generated"],
      device_suitability: ["desktop"],
    },
    {
      requirement_id: "vr-c",
      route_id: "/",
      section_id: "hero",
      slot_id: "/:hero",
      role: "project_proof",
      required: false,
      min_count: 1,
      preferred_provenance: ["generated"],
      device_suitability: ["desktop"],
    },
  ];
  const slots = slotsFromVisualRequirements(requirements);
  // WB-GLUE-01: the two "service"-role requirements live in different
  // sections, so each keeps its own section-qualified placement instead of
  // one being dropped. The repeated slot id "/:hero" keeps one slot only, so
  // the plan never carries two slots with one id.
  assert.equal(slots.length, 2);
  const overview = slots.find((slot) => slot.placement === "/:service#services-overview");
  assert.ok(overview);
  assert.equal(overview.id, "/:services-overview");
  assert.equal(overview.required, true);
  const heroService = slots.find((slot) => slot.placement === "/:service#hero");
  assert.ok(heroService);
  assert.equal(heroService.id, "/:hero");
  assert.equal(new Set(slots.map((slot) => slot.placement)).size, slots.length);
  assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length);
});

void test("an authorized source photo outranks generation for a hero slot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c7-visual-"));
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape, {
    visual_requirements: deriveVisualRequirements(BLUEPRINT_ROUTES),
  });
  const hero = makeSourceImage("heroimg", dir, {
    domContext: { isAboveFold: true },
  } as Partial<IngestedImage>);
  const ctx = makeCtx(dir, {
    websiteBlueprint: blueprint,
    sourceSiteManifest: { images: [hero] } as never,
  });
  await new ImageAssetPlanningStage().run(ctx);
  const heroPlan = ctx.imageAssetPlan?.assets.find((asset) => asset.slotId === "/:hero");
  assert.ok(heroPlan);
  assert.equal(heroPlan.resolution.source, "source-site");
  assert.equal(heroPlan.resolution.candidateId, "heroimg");
});

void test("required slots below 100% fail closed with VISUAL_ASSET_REQUIREMENT_UNSATISFIED", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c7-visual-"));
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape, {
    visual_requirements: deriveVisualRequirements(BLUEPRINT_ROUTES),
  });
  // Generation disabled and no source/provided candidates: required logo+hero unresolvable.
  const ctx = makeCtx(dir, {
    websiteBlueprint: blueprint,
    domainSpec: {
      client_id: "visual-test-client",
      business_name: "Test Biz",
      vertical: "test_service",
      geography: { states: ["TN"], primary_state: "TN" },
      design: { status: "resolved" },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
      assets: { generation: { enabled: false } },
    } as never,
  });
  await assert.rejects(
    () => new ImageAssetPlanningStage().run(ctx),
    (error: unknown) =>
      error instanceof BuildError && error.code === "VISUAL_ASSET_REQUIREMENT_UNSATISFIED",
  );
});

void test("image planning without a sealed blueprint fails closed under REDESIGN_IMPROVE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c7-visual-"));
  const ctx = makeCtx(dir);
  await assert.rejects(
    () => new ImageAssetPlanningStage().run(ctx),
    (error: unknown) =>
      error instanceof BuildError && error.code === "REDESIGN_PIPELINE_INCOMPLETE",
  );
});

// ---- Matrix I: reuse ledger -------------------------------------------------

void test("every discovered source asset receives a SELECTED or REJECTED-with-reason decision", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c7-ledger-"));
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape, {
    visual_requirements: deriveVisualRequirements(BLUEPRINT_ROUTES),
  });
  const heroImage = makeSourceImage("heroimg", dir, {
    domContext: { isAboveFold: true },
  } as Partial<IngestedImage>);
  const galleryImage = makeSourceImage("galleryimg", dir, {
    referringPageUrl: "https://source.example.com/gallery",
  });
  const brandMark = makeSourceImage("brand", dir, {
    sourceUrl: "https://source.example.com/logo.png",
    width: 200,
    height: 80,
    byteLength: 6_000,
  });
  const ctx = makeCtx(dir, {
    websiteBlueprint: blueprint,
    sourceSiteManifest: { images: [heroImage, galleryImage, brandMark] } as never,
  });
  await new ImageAssetPlanningStage().run(ctx);
  const decisions = ctx.sourceAssetDecisions;
  assert.ok(decisions);
  assert.equal(decisions.length, 3, "no silent loss: every asset has a decision");
  for (const decision of decisions) {
    assert.ok(decision.reason.length > 0, "every decision carries a machine-readable reason");
  }
  const selected = decisions.filter((entry) => entry.decision === "SELECTED");
  assert.ok(selected.length >= 1);
});

void test("donor evidence is never a planner candidate source (DONOR_REFERENCE_ONLY)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c7-donor-excl-"));
  const landscape = makeLandscape();
  const blueprint = makeWebsiteBlueprint(landscape, {
    visual_requirements: deriveVisualRequirements(BLUEPRINT_ROUTES),
  });
  // Donor evidence present on ctx; planner input comes only from sourceSiteManifest.
  const ctx = makeCtx(dir, {
    websiteBlueprint: blueprint,
    acceptedDonors: [
      {
        domain: "donor-0.example.com",
        serp_observation_ids: [],
        pages: [],
        screenshot_paths: [join(dir, "donor-shot.png")],
        crawl_manifest_path: join(dir, "donor-manifest.json"),
        evidence_digest: "a".repeat(64),
        crawled_at: "2026-08-17T00:00:00.000Z",
        disposition: "DONOR_REFERENCE_ONLY",
      },
    ],
    sourceSiteManifest: { images: [] } as never,
  });
  await new ImageAssetPlanningStage().run(ctx);
  for (const planned of ctx.imageAssetPlan?.assets ?? []) {
    assert.notEqual(planned.resolution.source, "source-site");
    if (planned.resolution.source === "generated") {
      const brief = JSON.stringify(planned.resolution.compiledBrief ?? {});
      assert.ok(!brief.includes("donor-0.example.com"), "donor evidence must not leak into briefs");
    }
  }
  assert.equal(ctx.sourceAssetDecisions?.length, 0);
});

// ---- WB-GLUE-01: client-asset-first selection and protected brand ----------

/** A distinct, decodable 1x1 PNG per seed (only the tEXt chunk differs). */
function pngBytes(seed: string): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlibCrc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const iend = PNG_1X1.subarray(PNG_1X1.length - 12);
  const head = PNG_1X1.subarray(0, PNG_1X1.length - 12);
  return Buffer.concat([head, chunk("tEXt", Buffer.from(`seed\0${seed}`, "latin1")), iend]);
}

function writeProvided(dir: string, id: string): string {
  const path = join(dir, `${id}.png`);
  writeFileSync(path, pngBytes(id));
  return path;
}

const GLUE_ROUTES: WebsiteBuildBlueprintV2["routes"] = [
  {
    route_id: "/",
    path: "/",
    purpose: "Home",
    sections: [
      {
        section_id: "hero",
        component_class: "hero",
        objective: "offer",
        content_slots: ["primary_offer"],
        pattern_refs: [],
        proof_requirements: [],
      },
      {
        section_id: "repairs",
        component_class: "services-overview",
        objective: "repairs",
        content_slots: ["service_overview"],
        pattern_refs: [],
        proof_requirements: [],
      },
      {
        section_id: "installs",
        component_class: "services-overview",
        objective: "installs",
        content_slots: ["service_overview"],
        pattern_refs: [],
        proof_requirements: [],
      },
    ],
  },
  {
    route_id: "/about",
    path: "/about",
    purpose: "About",
    sections: [
      {
        section_id: "crew",
        component_class: "prose",
        objective: "team",
        content_slots: ["trust"],
        pattern_refs: [],
        proof_requirements: [],
      },
    ],
  },
];

function glueCtx(
  dir: string,
  provided: Array<{ id: string; intendedPlacement?: string; altText?: string }>,
  extra?: { imageSlots?: ImageSlotSpec[]; requirements?: VisualRequirement[] },
): BuildContext {
  const landscape = makeLandscape();
  return makeCtx(dir, {
    websiteBlueprint: makeWebsiteBlueprint(landscape, {
      routes: GLUE_ROUTES,
      visual_requirements: extra?.requirements ?? deriveVisualRequirements(GLUE_ROUTES),
    }),
    domainSpec: {
      client_id: "visual-test-client",
      business_name: "Test Biz",
      vertical: "test_service",
      geography: { states: ["TN"], primary_state: "TN" },
      design: { status: "resolved" },
      routes: [
        { slug: "/", title: "Home", components: ["hero"] },
        { slug: "/about", title: "About", components: ["prose"] },
      ],
      assets: {
        generation: { enabled: true },
        providedImages: provided.map((image) => ({ ...image, path: writeProvided(dir, image.id) })),
        ...(extra?.imageSlots ? { imageSlots: extra.imageSlots } : {}),
      },
    } as never,
  });
}

function resolutionFor(ctx: BuildContext, placement: string) {
  const planned = ctx.imageAssetPlan?.assets.find((asset) => asset.placement === placement);
  assert.ok(planned, `plan carries ${placement}`);
  return planned.resolution;
}

function candidateFor(ctx: BuildContext, placement: string): string | undefined {
  const resolution = resolutionFor(ctx, placement);
  return "candidateId" in resolution ? resolution.candidateId : undefined;
}

void test("two same-role sections on one route keep distinct placements and their own client images", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
  const ctx = glueCtx(dir, [
    { id: "installs-photo", intendedPlacement: "/:service#installs" },
    { id: "repairs-photo", intendedPlacement: "/:service#repairs" },
  ]);
  await new ImageAssetPlanningStage().run(ctx);
  assert.equal(candidateFor(ctx, "/:service#repairs"), "repairs-photo");
  assert.equal(candidateFor(ctx, "/:service#installs"), "installs-photo");
  assert.equal(
    ctx.imageAssetPlan?.assets.some((asset) => asset.placement === "/:service"),
    false,
    "the colliding role never keeps an unqualified placement",
  );
});

void test("a suitable provided asset wins even when the blueprint prefers generation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
  const requirements: VisualRequirement[] = [
    {
      requirement_id: "vr-hero",
      route_id: "/",
      section_id: "hero",
      slot_id: "/:hero",
      role: "hero",
      required: true,
      min_count: 1,
      preferred_provenance: ["generated"],
      device_suitability: ["desktop"],
    },
  ];
  const ctx = glueCtx(dir, [{ id: "storefront", intendedPlacement: "/:hero" }], { requirements });
  await new ImageAssetPlanningStage().run(ctx);
  assert.equal(resolutionFor(ctx, "/:hero").source, "provided");
  assert.equal(candidateFor(ctx, "/:hero"), "storefront");
});

void test("an unrelated large client photo never fills an unrelated slot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
  const ctx = glueCtx(dir, [{ id: "holiday-party", altText: "Staff holiday party 2025" }]);
  await new ImageAssetPlanningStage().run(ctx);
  for (const asset of ctx.imageAssetPlan?.assets ?? []) {
    assert.notEqual(
      "candidateId" in asset.resolution ? asset.resolution.candidateId : undefined,
      "holiday-party",
      asset.placement,
    );
  }
  // Only the genuinely unresolved illustrative slots go to the generator.
  assert.equal(resolutionFor(ctx, "/:hero").source, "generated");
});

void test("an unplaced provided image whose alt text names the role is eligible for that role", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
  const ctx = glueCtx(dir, [{ id: "crew-1", altText: "Our trust-building crew" }]);
  await new ImageAssetPlanningStage().run(ctx);
  assert.equal(candidateFor(ctx, "/about:trust"), "crew-1");
});

void test("no real logo: the logo is never generated and the build is not blocked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
  const ctx = glueCtx(dir, []);
  await new ImageAssetPlanningStage().run(ctx);
  const logo = resolutionFor(ctx, "global:logo");
  assert.equal(logo.source, "unresolved");
  assert.equal(
    (ctx.imageAssetPlan?.assets ?? []).some(
      (asset) => asset.placement === "global:logo" && asset.resolution.source === "generated",
    ),
    false,
  );
  // One genuinely missing illustrative image is the generator's job; the rest stay untouched.
  assert.equal(resolutionFor(ctx, "/:hero").source, "generated");
});

void test("an explicitly required real logo with none available fails with a missing-logo error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
  const ctx = glueCtx(dir, [], {
    imageSlots: [
      {
        id: "brand-logo",
        placement: "global:logo",
        required: true,
        preferredSources: ["provided", "source-site", "generated"],
      },
    ],
  });
  await assert.rejects(
    () => new ImageAssetPlanningStage().run(ctx),
    (error: unknown) =>
      error instanceof BuildError &&
      error.code === "VISUAL_ASSET_REQUIREMENT_UNSATISFIED" &&
      /missing-logo/.test(error.message) &&
      /never synthesizes a logo/.test(error.message),
  );
});

void test("a provided logo is used unchanged for global:logo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
  const ctx = glueCtx(dir, [{ id: "brand", intendedPlacement: "global:logo" }]);
  await new ImageAssetPlanningStage().run(ctx);
  assert.equal(resolutionFor(ctx, "global:logo").source, "provided");
  assert.equal(candidateFor(ctx, "global:logo"), "brand");
});

void test("an explicit provided placement absent from the slot inventory is projected, not dropped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
  const ctx = glueCtx(dir, [{ id: "team-shot", intendedPlacement: "/about:team#crew" }]);
  await new ImageAssetPlanningStage().run(ctx);
  assert.equal(resolutionFor(ctx, "/about:team#crew").source, "provided");
  assert.equal(candidateFor(ctx, "/about:team#crew"), "team-shot");
});

void test("an explicit provided placement naming no route or section fails instead of redirecting", async () => {
  for (const intendedPlacement of ["/missing:team", "/about:team#nope", "global:banner"]) {
    const dir = mkdtempSync(join(tmpdir(), "glue-visual-"));
    const ctx = glueCtx(dir, [{ id: "stray", intendedPlacement }]);
    await assert.rejects(
      () => new ImageAssetPlanningStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "VALIDATION_FAILED" &&
        error.message.includes(intendedPlacement),
      intendedPlacement,
    );
  }
});
