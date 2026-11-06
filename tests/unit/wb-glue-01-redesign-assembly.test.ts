// L9_META: layer=test, role=redesign_blueprint_assembly_contract, status=active, version=1.0.0
//
// WB-GLUE-01: a REDESIGN_IMPROVE build executes the accepted WebsiteBuildBlueprint
// section order, the accepted StructuredContentPackage copy (joined by section
// identity, kept structured), and the resolved image plan (bound to the section
// each image was planned for, client bytes unchanged). Every business, route,
// copy and image here is synthetic.

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import {
  BLUEPRINT,
  page,
  redesignContext,
  sections,
  sha256,
} from "../helpers/redesignAssemblyFixture.js";
import { cleanupContext } from "../helpers/siteFactoryFixture.js";
import type { RedesignRouteFixture } from "./redesign-fixtures.js";

async function assertAssemblyRejects(
  ctx: BuildContext,
  code: string,
  pattern: RegExp,
): Promise<void> {
  try {
    await assert.rejects(
      () => new SiteAssemblerStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError && error.code === code && pattern.test(error.message),
    );
    assert.equal(existsSync(join(ctx.outputDir, "src/pages/index.astro")), false);
  } finally {
    cleanupContext(ctx);
  }
}

void test("pages render the blueprint's sections in blueprint order with their own structured copy", async () => {
  const ctx = await redesignContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    const home = sections(page(ctx, "/"));
    assert.deepEqual(
      home.map((section) => section.sectionId),
      ["hero", "how", "repairs", "installs", "story", "proof", "questions", "closing"],
    );
    assert.deepEqual(
      home.map((section) => section.name),
      [
        "hero",
        "process",
        "services_overview",
        "services_overview",
        "about_story",
        "trust_bar",
        "faq",
        "cta",
      ],
    );
    const byId = new Map(home.map((section) => [section.sectionId, section]));
    // The route's service-card grid renders once: only the first services section owns it.
    assert.equal(byId.get("repairs")?.structured.serviceCards, undefined);
    assert.equal(byId.get("installs")?.structured.serviceCards, false);
    // Copy stays with its section identity whatever the package order was.
    assert.equal(byId.get("repairs")?.structured.heading, "Repairs");
    assert.deepEqual(byId.get("repairs")?.structured.blocks, [
      { kind: "bullets", items: ["Leaks", "Clogs"] },
    ]);
    assert.equal(byId.get("installs")?.structured.heading, "Installations");
    assert.deepEqual(byId.get("how")?.structured.blocks, [
      { kind: "steps", items: ["Call us", "We inspect", "We fix it"] },
    ]);
    assert.deepEqual(byId.get("story")?.structured.blocks[1], {
      kind: "quote",
      text: "They fixed it the same day.",
      attribution: "A. Customer",
    });
    // Every section passes the structured object to the existing renderer.
    assert.match(
      page(ctx, "/"),
      /<SectionRenderer name=\{section\.name\} content=\{section\.content\} structured=\{section\.structured\} layout=\{section\.layout \?\? undefined\} imagePlacement=\{section\.imagePlacement\} \/>/,
    );
    // One H1: the hero owns it, so the layout gets no page heading.
    assert.doesNotMatch(page(ctx, "/"), /pageHeading=/);
    assert.match(page(ctx, "/contact"), /pageHeading=\{"Contact"\}/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("CTAs resolve only to verified destinations; nothing is manufactured", async () => {
  const ctx = await redesignContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    const byId = new Map(sections(page(ctx, "/")).map((section) => [section.sectionId, section]));
    // A canonical route path resolves to that route.
    assert.deepEqual(byId.get("hero")?.structured.cta, {
      label: "See our services",
      href: "/contact",
    });
    // The operator's primary action resolves to the verified lead-form destination.
    assert.deepEqual(byId.get("closing")?.structured.cta, {
      label: "Request a quote",
      href: "/contact#quote",
    });
    // An unverified action and an external URL never become links.
    assert.equal(byId.get("story")?.structured.cta, null);
    assert.equal(byId.get("repairs")?.structured.cta, null);
    // Every CTA that resolved is a site-relative canonical destination.
    for (const section of byId.values()) {
      const href = section.structured.cta?.href;
      if (href !== undefined) assert.ok(href.startsWith("/") && !href.startsWith("//"), href);
    }
  } finally {
    cleanupContext(ctx);
  }
});

void test("a planned FAQ section carries the route's FAQ data; internal links resolve only to real routes", async () => {
  const ctx = await redesignContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    const source = page(ctx, "/");
    const faq = sections(source).find((section) => section.sectionId === "questions");
    assert.deepEqual(faq?.structured.faqs, [
      { question: "Do you work weekends?", answer: "Yes, by appointment." },
    ]);
    assert.match(
      source,
      /const relatedLinks = \[\s*\{\s*"href": "\/contact",\s*"label": "Contact our team"\s*\}\s*\] as const;/,
    );
    assert.doesNotMatch(source, /\/nowhere|Unpublished page/);
    assert.match(source, /<nav class="related-links" aria-label="Related pages">/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("an unsupported required section renderer fails source-bound instead of becoming prose", async () => {
  const blueprint: RedesignRouteFixture[] = [
    {
      route_id: "/",
      sections: [
        { section_id: "hero", component_class: "hero" },
        { section_id: "tour", component_class: "video-carousel" },
      ],
    },
    ...BLUEPRINT.slice(1),
  ];
  const ctx = await redesignContext({
    blueprint,
    routes: (routes) =>
      routes.map((route) =>
        route.route_id === "/"
          ? {
              ...route,
              sections: [
                { section_id: "hero", heading: "Hi", blocks: [] },
                { section_id: "tour", heading: "Tour", blocks: [] },
              ],
            }
          : route,
      ),
  });
  await assertAssemblyRejects(
    ctx,
    "SITE_ASSEMBLY_FAILED",
    /^unsupported-section-renderer: route "\/" section "tour" requests component_class "video-carousel"/,
  );
});

void test("an ambiguous component class fails with route, section, class and candidate renderers", async () => {
  const blueprint: RedesignRouteFixture[] = [
    { route_id: "/", sections: [{ section_id: "mixed", component_class: "services-cta" }] },
    ...BLUEPRINT.slice(1),
  ];
  const ctx = await redesignContext({
    blueprint,
    routes: (routes) =>
      routes.map((route) =>
        route.route_id === "/"
          ? { ...route, sections: [{ section_id: "mixed", heading: "Mixed", blocks: [] }] }
          : route,
      ),
  });
  await assertAssemblyRejects(
    ctx,
    "SITE_ASSEMBLY_FAILED",
    /^ambiguous-section-renderer: route "\/" section "mixed" requests component_class "services-cta"; candidate renderers: cta, services_overview$/,
  );
});

void test("REDESIGN_IMPROVE without the accepted blueprint fails explicitly instead of using the COPY path", async () => {
  const ctx = await redesignContext();
  ctx.websiteBlueprint = undefined;
  await assertAssemblyRejects(ctx, "REDESIGN_PIPELINE_INCOMPLETE", /WebsiteBuildBlueprint/);
});

void test("planned images bind to their intended sections and client bytes are published unchanged", async () => {
  const provided = [
    { id: "brand-logo", intendedPlacement: "global:logo" },
    { id: "storefront", intendedPlacement: "/:hero" },
    { id: "repair-van", intendedPlacement: "/:service#repairs" },
    { id: "new-heater", intendedPlacement: "/:service#installs" },
    { id: "crew-photo", intendedPlacement: "/:team#story" },
  ];
  const ctx = await redesignContext({ provided });
  try {
    await new SiteAssemblerStage().run(ctx);
    const byId = new Map(sections(page(ctx, "/")).map((section) => [section.sectionId, section]));
    assert.equal(byId.get("hero")?.imagePlacement, "/:hero");
    assert.equal(byId.get("repairs")?.imagePlacement, "/:service#repairs");
    assert.equal(byId.get("installs")?.imagePlacement, "/:service#installs");
    assert.equal(byId.get("story")?.imagePlacement, "/:team#story");
    // Sections nothing was planned for take no image (no first-text-section fallback).
    assert.equal(byId.get("how")?.imagePlacement, null);
    assert.equal(byId.get("closing")?.imagePlacement, null);

    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    for (const image of provided) {
      const asset = ctx.resolvedImages?.get(image.intendedPlacement);
      assert.ok(asset, `${image.intendedPlacement} resolved`);
      assert.equal(asset.source, "provided");
      assert.ok(
        config.includes(JSON.stringify(image.intendedPlacement)),
        `${image.intendedPlacement} published`,
      );
      const original = readFileSync(asset.originalPath ?? "");
      const published = readFileSync(join(ctx.outputDir, "public/images", asset.outputFileName));
      // Byte-for-byte: no crop, recolor, re-encode or substitution between input and site.
      assert.equal(sha256(published), sha256(original));
      assert.equal(asset.sha256, sha256(original));
    }
    // No asset of any slot was generated.
    assert.equal(
      ctx.imageAssetPlan?.assets.some((asset) => asset.resolution.source === "generated"),
      false,
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("a rebuild after the accepted copy changes reassembles instead of reusing stale pages", async () => {
  const stage = new SiteAssemblerStage();
  assert.equal(await stage.canResume({ buildIntent: "REDESIGN_IMPROVE" } as BuildContext), false);
  assert.equal(await stage.canResume({ buildIntent: "COPY" } as BuildContext), true);

  const first = await redesignContext();
  const outputDir = first.outputDir;
  try {
    await stage.run(first);
    assert.match(page(first, "/"), /Fixture Plumbing That Shows Up/);
    const second = await redesignContext({
      routes: (routes) =>
        routes.map((route) =>
          route.route_id === "/"
            ? {
                ...route,
                sections: route.sections.map((section) =>
                  section.section_id === "hero"
                    ? { ...section, heading: "Revised Approved Heading" }
                    : section,
                ),
              }
            : route,
        ),
    });
    rmSync(second.outputDir, { recursive: true, force: true });
    second.outputDir = outputDir;
    await stage.run(second);
    assert.match(page(second, "/"), /Revised Approved Heading/);
    assert.doesNotMatch(page(second, "/"), /Fixture Plumbing That Shows Up/);
  } finally {
    cleanupContext(first);
  }
});

void test("PipelineRunner re-runs a local stage that declines its checkpoint (REDESIGN assembly)", async () => {
  const { PipelineRunner } = await import("../../src/pipeline/PipelineRunner.js");
  const { checkpointDigest } = await import("../../src/pipeline/StageCheckpoint.js");
  const stage = new SiteAssemblerStage();
  const checkpoint = {
    schema: "website-bot.stage-checkpoint/v2" as const,
    buildId: "glue-build",
    clientId: "glue-client",
    stage: stage.name,
    stageVersion: stage.version,
    attempt: 1,
    inputEvidence: [],
    outputEvidence: [],
    inputDigest: checkpointDigest([]),
    outputDigest: checkpointDigest([]),
    status: "passed" as const,
    startedAt: "2026-11-06T00:00:00.000Z",
    completedAt: "2026-11-06T00:00:01.000Z",
  };
  const runner = new PipelineRunner() as unknown as {
    resumeStage(
      ctx: BuildContext,
      stage: SiteAssemblerStage,
      checkpoint: unknown,
    ): Promise<boolean>;
  };
  const ctx = (buildIntent: BuildContext["buildIntent"]) =>
    ({
      resume: true,
      buildId: "glue-build",
      clientId: "glue-client",
      buildIntent,
      evidenceStore: { verifyReference: async () => true },
    }) as unknown as BuildContext;
  // A valid checkpoint: COPY resumes it, REDESIGN_IMPROVE reassembles.
  assert.equal(await runner.resumeStage(ctx("COPY"), stage, checkpoint), true);
  assert.equal(await runner.resumeStage(ctx("REDESIGN_IMPROVE"), stage, checkpoint), false);
});
