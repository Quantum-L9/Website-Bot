// L9_META: layer=test, role=reuse_first_asset_contract, status=active, version=1.0.0
//
// Reuse-first assets, generate only what is missing: client-provided assets
// first (originals preserved), then authorized source-site assets, and
// generation only for unfilled illustrative slots — never for a logo, team
// portrait or real project photo. One image plan, one registry, one rendering
// path. Every business, route and image here is synthetic.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { VisualRequirement } from "@quantum-l9/bot-interop";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { ImageAssetPlanningStage } from "../../src/stages/ImageAssetPlanningStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import {
  page,
  pngBytes,
  redesignContext,
  sections,
  sha256,
} from "../helpers/redesignAssemblyFixture.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

function requirement(
  slot: string,
  route: string,
  section: string,
  role: VisualRequirement["role"],
  provenance: VisualRequirement["preferred_provenance"],
  required = false,
): VisualRequirement {
  return {
    requirement_id: `vr-${slot}`,
    route_id: route,
    section_id: section,
    slot_id: slot,
    role,
    required,
    min_count: 1,
    preferred_provenance: provenance,
    device_suitability: ["desktop", "mobile"],
  };
}

const planned = (ctx: BuildContext, placement: string) => {
  const resolution = ctx.imageAssetPlan?.assets.find(
    (asset) => asset.placement === placement,
  )?.resolution;
  assert.ok(resolution, `plan carries ${placement}`);
  return {
    source: resolution.source,
    candidateId: "candidateId" in resolution ? resolution.candidateId : undefined,
  };
};

void test("Quantum AI Partners regression: real logo and photos used unchanged; only the two illustrations are generated", async () => {
  const ctx = await redesignContext({
    generation: true,
    provided: [
      { id: "qap-logo", intendedPlacement: "global:logo", altText: "Quantum AI Partners logo" },
      { id: "project-1", intendedPlacement: "/:project_proof", altText: "Client workshop" },
      { id: "project-2", altText: "Strategy session with a client team" },
      { id: "project-3", altText: "Delivered analytics dashboard" },
      { id: "team-photo", intendedPlacement: "/:team", altText: "The Quantum AI Partners team" },
    ],
    visualRequirements: [
      // The blueprint asks for the real assets — and even prefers generation
      // for some of them; reuse-first must still win.
      requirement("global:logo", "global", "global", "logo", ["generated"], true),
      requirement("/:story:project_proof", "/", "story", "project_proof", ["generated"]),
      requirement("/:proof:team", "/", "proof", "team", ["source", "generated"]),
      // Two genuinely illustrative visuals with no client asset.
      requirement("/:repairs:service", "/", "repairs", "service", ["source", "generated"]),
      requirement("/:installs:service", "/", "installs", "service", ["source", "generated"]),
    ],
  });
  try {
    assert.deepEqual(planned(ctx, "global:logo"), { source: "provided", candidateId: "qap-logo" });
    assert.deepEqual(planned(ctx, "/:project_proof"), {
      source: "provided",
      candidateId: "project-1",
    });
    assert.deepEqual(planned(ctx, "/:team"), { source: "provided", candidateId: "team-photo" });
    const generated = (ctx.imageAssetPlan?.assets ?? [])
      .filter((asset) => asset.resolution.source === "generated")
      .map((asset) => asset.placement)
      .sort();
    assert.deepEqual(generated, ["/:service#installs", "/:service#repairs"]);

    await new SiteAssemblerStage().run(ctx);
    const byId = new Map(sections(page(ctx, "/")).map((section) => [section.sectionId, section]));
    assert.equal(byId.get("story")?.imagePlacement, "/:project_proof");
    assert.equal(byId.get("proof")?.imagePlacement, "/:team");

    // Every placed client asset is published byte-for-byte.
    for (const placement of ["global:logo", "/:project_proof", "/:team"]) {
      const asset = ctx.resolvedImages?.get(placement);
      assert.ok(asset, placement);
      assert.equal(
        sha256(readFileSync(join(ctx.outputDir, "public/images", asset.outputFileName))),
        sha256(readFileSync(asset.originalPath ?? "")),
        placement,
      );
    }
    // The two unplaced project photos are not forced into an unrelated
    // section: they stay in the gallery inventory, unchanged.
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    for (const id of ["project-2", "project-3"]) {
      const original = ctx.domainSpec.assets?.providedImages?.find((image) => image.id === id);
      assert.ok(original);
      const digest = sha256(readFileSync(original.path));
      const file = `provided-${id}-${digest.slice(0, 12)}.png`;
      assert.ok(config.includes(`"/images/gallery/${file}"`), `${id} in gallery`);
      assert.equal(
        sha256(readFileSync(join(ctx.outputDir, "public/images/gallery", file))),
        digest,
      );
    }
    // The logo and the placed photos are never repeated in the gallery.
    for (const id of ["qap-logo", "project-1", "team-photo"]) {
      assert.ok(!config.includes(`provided-${id}.`), `${id} not duplicated into the gallery`);
    }
  } finally {
    cleanupContext(ctx);
  }
});

interface SuppliedImage {
  id: string;
  /** File name on disk; defaults to `<id>.png`. */
  file?: string;
  altText?: string;
  intendedPlacement?: string;
}

/** A COPY build whose spec supplies these client images (distinct, decodable PNGs). */
function copyContextWith(images: SuppliedImage[], generation?: boolean): BuildContext {
  const dir = mkdtempSync(join(tmpdir(), "reuse-first-"));
  const ctx = fixtureContext();
  ctx.domainSpec.assets = {
    ...(generation === undefined ? {} : { generation: { enabled: generation } }),
    providedImages: images.map(({ file, ...image }) => {
      const path = join(dir, file ?? `${image.id}.png`);
      writeFileSync(path, pngBytes(image.id));
      return { ...image, path };
    }),
  };
  return ctx;
}

async function withContext(ctx: BuildContext, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    cleanupContext(ctx);
  }
}

const plansLogo = (ctx: BuildContext): boolean =>
  ctx.imageAssetPlan?.assets.some((asset) => asset.placement === "global:logo") ?? false;

void test("COPY: a supplied logo and an explicitly placed photo enter the plan without imageSlots", async () => {
  const ctx = copyContextWith(
    [
      { id: "acme-logo", altText: "Acme Roofing logo" },
      // Larger and sharing the logo's alt words: it must not win the logo slot.
      { id: "crew", altText: "Acme Roofing crew on a roof" },
      { id: "real-team", intendedPlacement: "/:team" },
      { id: "holiday-party", altText: "Office party" },
    ],
    true,
  );
  await withContext(ctx, async () => {
    await new ImageAssetPlanningStage().run(ctx);
    // The one unambiguous logo becomes global:logo; nothing is generated for it.
    assert.deepEqual(planned(ctx, "global:logo"), {
      source: "provided",
      candidateId: "acme-logo",
    });
    assert.deepEqual(planned(ctx, "/:team"), { source: "provided", candidateId: "real-team" });
    assert.equal(
      ctx.imageAssetPlan?.assets.some((asset) => asset.resolution.source === "generated"),
      false,
    );
    await new SiteAssemblerStage().run(ctx);
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    assert.ok(config.includes('"global:logo"'), "the layout header gets the real logo");
    // The unrelated photo is kept available in the gallery inventory, not placed.
    assert.match(config, /"\/images\/gallery\/provided-holiday-party-[0-9a-f]{12}\.png"/);
  });
});

void test("two supplied images that both look like logos identify none; the wordmark stays", async () => {
  const ctx = copyContextWith([{ id: "logo-dark" }, { id: "logo-light" }]);
  await withContext(ctx, async () => {
    await new ImageAssetPlanningStage().run(ctx);
    assert.equal(plansLogo(ctx), false);
  });
});

void test("only an asset's own name identifies the logo, never alt text describing a photo", async () => {
  const ctx = copyContextWith([
    { id: "truck", altText: "Our van with the company logo on the side" },
  ]);
  await withContext(ctx, async () => {
    await new ImageAssetPlanningStage().run(ctx);
    assert.equal(plansLogo(ctx), false);
  });
});

void test("evidence outputs are declared only when the stage produced a plan", async () => {
  // Unplaced, not a logo: no slot results, so nothing is written and nothing may be claimed.
  const ctx = copyContextWith([{ id: "photo" }]);
  const stage = new ImageAssetPlanningStage();
  await withContext(ctx, async () => {
    await stage.run(ctx);
    assert.equal(ctx.imageAssetPlan, undefined);
    assert.deepEqual(stage.evidence.outputs(ctx), []);
    const [photo] = ctx.domainSpec.assets?.providedImages ?? [];
    ctx.domainSpec.assets?.providedImages?.push({
      id: "team",
      path: photo.path,
      intendedPlacement: "/:team",
    });
    await stage.run(ctx);
    assert.ok(ctx.imageAssetPlan);
    assert.deepEqual(stage.evidence.outputs(ctx), ["image_plan", "image_assets"]);
  });
});

void test("two client photos whose ids slug alike keep distinct gallery files", async () => {
  const ctx = copyContextWith([
    { id: "project-1", file: "p0.png" },
    { id: "Project 1", file: "p1.png" },
  ]);
  await withContext(ctx, async () => {
    await new SiteAssemblerStage().run(ctx);
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    const files = [
      ...config.matchAll(/"\/images\/gallery\/(provided-project-1-[0-9a-f]{12}\.png)"/g),
    ].map((match) => match[1]);
    assert.equal(new Set(files).size, 2, "each client photo keeps its own file");
    for (const file of files) {
      assert.ok(readFileSync(join(ctx.outputDir, "public/images/gallery", file)).length > 0);
    }
  });
});
