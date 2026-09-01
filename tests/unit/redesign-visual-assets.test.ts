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
import type { VisualRequirement } from "@quantum-l9/bot-interop";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import type { IngestedImage } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import { deriveVisualRequirements } from "../../src/intelligence/WebsiteBuildBlueprintCompiler.js";
import {
  ImageAssetPlanningStage,
  mergeBlueprintAndSpecSlots,
  slotsFromVisualRequirements,
} from "../../src/stages/ImageAssetPlanningStage.js";
import type { ImageSlotSpec } from "../../src/pipeline/BuildContext.js";
import { BLUEPRINT_ROUTES, makeLandscape, makeWebsiteBlueprint } from "./redesign-fixtures.js";

// A real 1x1 PNG so inspectImage decodes staged source assets.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function makeSourceImage(id: string, dir: string, overrides?: Partial<IngestedImage>): IngestedImage {
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

function makeCtx(dir: string, overrides?: Partial<BuildContext>): BuildContext {
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
  assert.ok(logo && logo.required && logo.route_id === "global");
  assert.ok(hero && hero.required && hero.route_id === "/");
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
  assert.deepEqual(merged.map((slot) => slot.id), ["hero-global-logo", "og-image"]);
});

void test("blueprint requirements sharing a role dedupe to one placement (golden run #58)", () => {
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
  // Both "service"-role requirements collapse to one "/:service"
  // placement; the required one wins the tie.
  assert.equal(slots.length, 2);
  const service = slots.find((slot) => slot.placement === "/:service");
  assert.ok(service);
  assert.equal(service.id, "/:services-overview");
  assert.equal(service.required, true);
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
