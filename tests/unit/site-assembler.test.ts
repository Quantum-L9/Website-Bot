// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import type { ResolvedImageAsset } from "../../src/pipeline/evidence/ImageAssetManifest.js";
import type { ImageAssetPlan } from "../../src/pipeline/evidence/ImageAssetPlan.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

void test("materializes the fixture into a client-specific Astro project", async () => {
  const ctx = fixtureContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    assert.ok(existsSync(join(ctx.outputDir, "src/pages/index.astro")));
    assert.ok(existsSync(join(ctx.outputDir, "src/pages/services/index.astro")));
    assert.ok(existsSync(join(ctx.outputDir, "src/pages/contact/index.astro")));
    assert.ok(existsSync(join(ctx.outputDir, ".l9/assembly-manifest.json")));
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    assert.match(config, /https:\/\/ci-test\.example\.com/);
    // WB-QAP-03: the fixture has no verified lead form action and no operator
    // CTA label, so no CTA destination is emitted (the form renders gated).
    assert.match(config, /primaryCta: null as \{ label: string; href: string \} \| null,/);
    // F-12 regression: every published route must be in the siteConfig routes
    // registry so the layout footer can link it (no orphaned pages).
    assert.match(config, /"routes": \[\s*\{\s*"href": "\/"/);
    assert.match(config, /"href": "\/services"/);
    assert.match(config, /"href": "\/contact"/);
    const contact = readFileSync(join(ctx.outputDir, "src/pages/contact/index.astro"), "utf-8");
    assert.match(contact, /contact_form/);
    assert.match(contact, /fixture content/);
    // L2-S16-001: a route without a hero section still gets exactly one H1 —
    // the layout renders the route title; a hero route must not get a second.
    assert.match(contact, /pageHeading=\{"Contact"\}/);
    const services = readFileSync(join(ctx.outputDir, "src/pages/services/index.astro"), "utf-8");
    assert.match(services, /pageHeading=\{"Services"\}/);
    const home = readFileSync(join(ctx.outputDir, "src/pages/index.astro"), "utf-8");
    assert.doesNotMatch(home, /pageHeading=/);
    // All generated route files must begin with Astro's own frontmatter fence.
    for (const pageSource of [home, services, contact]) {
      assert.match(pageSource, /^---\r?\n/);
      assert.doesNotMatch(pageSource, /<!--\s*L9_META/);
    }
    // WB-QAP-01: a route without a `layout:` template request renders exactly as before.
    for (const source of [home, services, contact]) {
      assert.doesNotMatch(source, /const layout|layout=\{/);
      assert.match(
        source,
        /\{sections\.map\(section => <SectionRenderer name=\{section\.name\} content=\{section\.content\} \/>\)\}/,
      );
    }
    const layout = readFileSync(join(ctx.outputDir, "src/layouts/BaseLayout.astro"), "utf-8");
    assert.match(layout, /pageHeading && <h1 class="page-title">/);
    assert.match(ctx.assemblyManifest?.sourceDigest ?? "", /^[0-9a-f]{64}$/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("restores the prior site and cleans temp/backup state when the atomic swap fails", async () => {
  const ctx = fixtureContext();
  const originalOutput = ctx.outputDir;
  // Isolate the output parent so the staging (.tmp) assertions cannot race other files' assembler runs.
  const parent = mkdtempSync(join(tmpdir(), "assembler-rollback-"));
  const outputDir = join(parent, "site");
  mkdirSync(outputDir, { recursive: true });
  ctx.outputDir = outputDir;
  // Seed an existing, human-owned site that must survive a failed replacement byte-for-byte.
  const sentinelPath = join(outputDir, "HUMAN_KEEP.txt");
  const sentinel = "human authored notes — must survive rollback\n";
  writeFileSync(sentinelPath, sentinel, "utf-8");

  // Inject a single failure on the temp → output move; the backup move and restore delegate normally.
  let failedOnce = false;
  const rename = (from: string, to: string): void => {
    if (!failedOnce && from.includes(`${dirname(outputDir)}/.tmp/`) && to === outputDir) {
      failedOnce = true;
      throw new Error("injected atomic swap failure");
    }
    renameSync(from, to);
  };

  try {
    await assert.rejects(
      () => new SiteAssemblerStage(rename).run(ctx),
      (error: unknown) => error instanceof BuildError && error.code === "SITE_ASSEMBLY_FAILED",
    );
    assert.equal(failedOnce, true, "the injected swap failure must have fired");

    // Original site is restored, unchanged, and the generated project never landed.
    assert.ok(existsSync(sentinelPath));
    assert.equal(readFileSync(sentinelPath, "utf-8"), sentinel);
    assert.equal(existsSync(join(outputDir, "src/pages/index.astro")), false);

    // No backup directory is left behind alongside the output.
    const siblings = readdirSync(dirname(outputDir));
    assert.equal(
      siblings.some((name) => name.startsWith(`${basename(outputDir)}.backup-`)),
      false,
    );

    // The temporary staging directory for this build was removed.
    const tmpParent = join(dirname(outputDir), ".tmp");
    const tmpLeftovers = existsSync(tmpParent)
      ? readdirSync(tmpParent).filter((name) => name.includes(ctx.buildId))
      : [];
    assert.deepEqual(tmpLeftovers, []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(originalOutput, { recursive: true, force: true });
    cleanupContext(ctx);
  }
});

void test("serializes route data through Astro expressions instead of raw HTML attributes", async () => {
  const ctx = fixtureContext({
    business_name: 'CI "Quoted" Business',
    routes: [{ slug: "/", title: 'Home "Quoted"', components: ["hero"] }],
  });
  ctx.generatedContent.set("/", "unused");
  ctx.generatedContent.set(
    "/:hero",
    'Copy with "quotes", <angle brackets>, and\n\nmultiple paragraphs.',
  );
  try {
    await new SiteAssemblerStage().run(ctx);
    const page = readFileSync(join(ctx.outputDir, "src/pages/index.astro"), "utf-8");
    assert.match(page, /const sections = \[/);
    assert.match(page, /title=\{"Home \\"Quoted\\""\}/);
    assert.match(page, /content=\{section\.content\}/);
    assert.doesNotMatch(page, /<Section name="[^"]+" content="/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("the assembler stage version moves past the release that emitted headered route pages", () => {
  // 3.1.0 wrote an L9_META comment ahead of the Astro fence; PipelineRunner
  // resumes a checkpoint only when stageVersion matches, so those cannot be reused.
  assert.notEqual(new SiteAssemblerStage().version, "3.1.0");
});

// ── Section image wiring ────────────────────────────────────────────────────
// The planner/generator publish images by placement; assembly must bind each
// published placement to the section it was planned for so the renderer shows
// it, instead of leaving every image except the hero unrendered.

interface PlannedFixtureImage {
  placement: string;
  required?: boolean;
  published?: boolean;
}

function withPlannedImages(ctx: BuildContext, images: PlannedFixtureImage[]): void {
  // Staged under the evidence root so cleanupContext removes it with the context.
  const stagingDir = join(ctx.evidenceStore.rootDir, "staged-images");
  mkdirSync(stagingDir, { recursive: true });
  const plan: ImageAssetPlan = {
    schema: "website-bot.image-asset-plan/v1",
    version: "1.0.0",
    assets: [],
  };
  ctx.resolvedImages = new Map();
  for (const [index, image] of images.entries()) {
    const slotId = `slot-${index}`;
    plan.assets.push({
      slotId,
      placement: image.placement,
      required: image.required ?? false,
      resolution: {
        source: "generated",
        compiledBrief: { slotId, intent: `Image for ${image.placement}` },
      },
    });
    if (image.published === false) continue;
    const absolutePath = join(stagingDir, `${slotId}.webp`);
    writeFileSync(absolutePath, `fixture image ${index}`);
    const asset: ResolvedImageAsset = {
      slotId,
      placement: image.placement,
      source: "generated",
      absolutePath,
      outputFileName: `${slotId}.webp`,
      altText: `Alt for ${image.placement}`,
      mimeType: "image/webp",
      width: 1200,
      height: 800,
      byteLength: 16,
      sha256: String(index).repeat(64).slice(0, 64),
      disposition: "approved-client-owned",
      provenanceWarnings: [],
    };
    ctx.resolvedImages.set(image.placement, asset);
  }
  ctx.imageAssetPlan = plan;
}

function emittedSections(page: string): Array<{ name: string; imagePlacement?: string | null }> {
  const match = page.match(/const sections = (\[[\s\S]*?\]) as const;/);
  assert.ok(match, "page source declares its sections");
  return JSON.parse(match[1]) as Array<{ name: string; imagePlacement?: string | null }>;
}

void test("binds each published placement to the section it was planned for", async () => {
  const ctx = fixtureContext();
  withPlannedImages(ctx, [
    { placement: "/:hero", required: true },
    { placement: "/:service" },
    { placement: "/:trust" },
    // The /services route has no hero section: the image falls back to the
    // first image-eligible section rather than being dropped.
    { placement: "/services:hero" },
    // Planned but never published (e.g. rights excluded): nothing to bind.
    { placement: "/contact:trust", published: false },
    // Layout-owned global placement: never bound to a section.
    { placement: "global:logo" },
  ]);
  try {
    await new SiteAssemblerStage().run(ctx);
    const home = readFileSync(join(ctx.outputDir, "src/pages/index.astro"), "utf-8");
    assert.deepEqual(
      emittedSections(home).map((section) => [section.name, section.imagePlacement]),
      [
        ["hero", "/:hero"],
        ["services_overview", "/:service"],
        ["trust_signals", "/:trust"],
      ],
    );
    assert.match(
      home,
      /<SectionRenderer name=\{section\.name\} content=\{section\.content\} imagePlacement=\{section\.imagePlacement\} \/>/,
    );
    const services = readFileSync(join(ctx.outputDir, "src/pages/services/index.astro"), "utf-8");
    assert.deepEqual(
      emittedSections(services).map((section) => [section.name, section.imagePlacement]),
      [
        ["service_list", "/services:hero"],
        ["cta", null],
      ],
    );
    // A route without a bound image keeps its legacy page source byte for byte.
    const contact = readFileSync(join(ctx.outputDir, "src/pages/contact/index.astro"), "utf-8");
    assert.doesNotMatch(contact, /imagePlacement/);
    assert.match(
      contact,
      /\{sections\.map\(section => <SectionRenderer name=\{section\.name\} content=\{section\.content\} \/>\)\}/,
    );
    // Every bound placement is published in the image registry the renderer reads.
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    for (const placement of ["/:hero", "/:service", "/:trust", "/services:hero"]) {
      assert.ok(config.includes(JSON.stringify(placement)), `${placement} is published`);
    }
    assert.ok(existsSync(join(ctx.outputDir, "public/images/slot-1.webp")));
  } finally {
    cleanupContext(ctx);
  }
});

void test("gives each section at most one image and binds required placements first", async () => {
  const ctx = fixtureContext({
    routes: [{ slug: "/", title: "Home", components: ["hero", "about", "process-steps"] }],
  });
  withPlannedImages(ctx, [
    { placement: "/:team" },
    { placement: "/:project_proof", required: true },
  ]);
  try {
    await new SiteAssemblerStage().run(ctx);
    const home = readFileSync(join(ctx.outputDir, "src/pages/index.astro"), "utf-8");
    assert.deepEqual(
      emittedSections(home).map((section) => [section.name, section.imagePlacement]),
      [
        ["hero", null],
        ["about", "/:project_proof"],
        ["process_steps", "/:team"],
      ],
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("a required placement with no image-eligible section fails assembly", async () => {
  const ctx = fixtureContext({
    routes: [
      { slug: "/", title: "Home", components: ["hero"] },
      { slug: "/faq", title: "FAQ", components: ["faq"] },
    ],
  });
  withPlannedImages(ctx, [{ placement: "/faq:trust", required: true }]);
  try {
    await assert.rejects(
      () => new SiteAssemblerStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "SITE_ASSEMBLY_FAILED" &&
        /image-placement-unbound: \/faq:trust \(trust\) has no image-eligible section on \/faq/.test(
          error.message,
        ),
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("an optional placement with no image-eligible section is omitted, not rendered elsewhere", async () => {
  const ctx = fixtureContext({
    routes: [
      { slug: "/", title: "Home", components: ["hero"] },
      { slug: "/faq", title: "FAQ", components: ["faq"] },
    ],
  });
  withPlannedImages(ctx, [{ placement: "/faq:trust" }]);
  try {
    await new SiteAssemblerStage().run(ctx);
    const faq = readFileSync(join(ctx.outputDir, "src/pages/faq/index.astro"), "utf-8");
    assert.doesNotMatch(faq, /imagePlacement/);
    const home = readFileSync(join(ctx.outputDir, "src/pages/index.astro"), "utf-8");
    assert.doesNotMatch(home, /imagePlacement/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("a published placement that names no spec route fails assembly", async () => {
  const ctx = fixtureContext();
  withPlannedImages(ctx, [{ placement: "/missing:hero" }]);
  try {
    await assert.rejects(
      () => new SiteAssemblerStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        /image-placement-unbound: \/missing:hero targets no spec route/.test(error.message),
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("assembly depends on image evidence whenever the resolved image plan has assets", () => {
  const ctx = fixtureContext();
  const stage = new SiteAssemblerStage();
  try {
    assert.deepEqual(stage.evidence.inputs(ctx), []);
    // A blueprint-only redesign: planned images, no spec-declared image slots.
    withPlannedImages(ctx, [{ placement: "/:hero", required: true }]);
    assert.equal(ctx.domainSpec.assets?.imageSlots, undefined);
    assert.deepEqual(stage.evidence.inputs(ctx), ["image_assets"]);
    ctx.dryRun = true;
    assert.deepEqual(stage.evidence.inputs(ctx), []);
  } finally {
    cleanupContext(ctx);
  }
});
