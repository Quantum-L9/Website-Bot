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
      assert.ok(config.includes(`"/images/gallery/provided-${id}.png"`), `${id} in gallery`);
      const original = ctx.domainSpec.assets?.providedImages?.find((image) => image.id === id);
      assert.ok(original);
      assert.equal(
        sha256(readFileSync(join(ctx.outputDir, "public/images/gallery", `provided-${id}.png`))),
        sha256(readFileSync(original.path)),
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

void test("COPY: a supplied logo and an explicitly placed photo enter the plan without imageSlots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reuse-first-copy-"));
  const write = (id: string): string => {
    const path = join(dir, `${id}.png`);
    writeFileSync(path, pngBytes(id));
    return path;
  };
  const ctx = fixtureContext();
  ctx.domainSpec.assets = {
    generation: { enabled: true },
    providedImages: [
      { id: "acme-logo", path: write("acme-logo"), altText: "Acme company logo" },
      { id: "real-team", path: write("real-team"), intendedPlacement: "/:team" },
      { id: "holiday-party", path: write("holiday-party"), altText: "Office party" },
    ],
  };
  try {
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
    assert.ok(config.includes('"/images/gallery/provided-holiday-party.png"'));
  } finally {
    cleanupContext(ctx);
  }
});

void test("two supplied images that both look like logos identify none; the wordmark stays", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reuse-first-logo-"));
  const ctx = fixtureContext();
  ctx.domainSpec.assets = {
    providedImages: ["logo-dark", "logo-light"].map((id) => {
      const path = join(dir, `${id}.png`);
      writeFileSync(path, pngBytes(id));
      return { id, path };
    }),
  };
  try {
    await new ImageAssetPlanningStage().run(ctx);
    assert.equal(
      ctx.imageAssetPlan?.assets.some((asset) => asset.placement === "global:logo") ?? false,
      false,
    );
  } finally {
    cleanupContext(ctx);
  }
});
