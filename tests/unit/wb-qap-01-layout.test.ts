// L9_META: layer=test, role=layout_variant_contract, status=active, version=1.0.0

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  LAYOUT_TEMPLATE_PREFIX,
  SECTION_LAYOUT_VARIANTS,
} from "../../astro_template/src/components/SectionRegistry.js";
import type { DomainSpec } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

type Route = DomainSpec["routes"][number];

const COMPONENTS = ["hero", "approach", "faq"];

function layoutRoutes(): Route[] {
  return [
    { slug: "/", title: "Home", components: COMPONENTS },
    {
      slug: "/editorial",
      title: "Editorial",
      template: "layout:editorial",
      components: COMPONENTS,
    },
    { slug: "/diagram", title: "Diagram", template: " Layout:Diagram ", components: COMPONENTS },
    { slug: "/legacy", title: "Legacy", template: "service_page", components: COMPONENTS },
    { slug: "/plain", title: "Plain", components: COMPONENTS },
  ];
}

/** Identical copy for every route, so no variant can carry a different business claim. */
function withSharedContent(routes: Route[]) {
  const ctx = fixtureContext({ routes });
  ctx.generatedContent.clear();
  for (const route of routes) {
    for (const component of route.components) {
      ctx.generatedContent.set(
        `${route.slug}:${component}`,
        `Shared ${component} heading\n\nShared first paragraph.\n\nShared second paragraph.`,
      );
    }
  }
  return ctx;
}

function page(outputDir: string, slug: string): string {
  const path = slug === "/" ? "src/pages/index.astro" : `src/pages${slug}/index.astro`;
  return readFileSync(join(outputDir, path), "utf-8");
}

const sectionsOf = (source: string) =>
  /const sections = (\[[\s\S]*?\]) as const;/.exec(source)?.[1];

async function rejectsUnsupported(routes: Route[], dryRun: boolean, pattern: RegExp) {
  const ctx = fixtureContext({ routes });
  ctx.dryRun = dryRun;
  try {
    await assert.rejects(
      () => new SiteAssemblerStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "VALIDATION_FAILED" &&
        /^unsupported-layout: domainSpec\.routes\[0\]\.template /.test(error.message) &&
        pattern.test(error.message),
    );
    assert.equal(existsSync(join(ctx.outputDir, "src/pages/index.astro")), false);
  } finally {
    cleanupContext(ctx);
  }
}

void test("two supported layout variants and the ordinary route yield distinct pages over identical content", async () => {
  const ctx = withSharedContent(layoutRoutes());
  try {
    await new SiteAssemblerStage().run(ctx);
    const home = page(ctx.outputDir, "/");
    const editorial = page(ctx.outputDir, "/editorial");
    const diagram = page(ctx.outputDir, "/diagram");

    assert.match(editorial, /const layout = "editorial";/);
    assert.match(diagram, /const layout = "diagram";/);
    for (const variant of [editorial, diagram]) {
      assert.match(
        variant,
        /<SectionRenderer name=\{section\.name\} content=\{section\.content\} layout=\{layout\} \/>/,
      );
    }
    assert.doesNotMatch(home, /const layout|layout=\{/);
    assert.notEqual(editorial.replace(/Editorial/g, "X"), diagram.replace(/Diagram/g, "X"));

    // Same sections, same copy: the layout changes arrangement, never the claims.
    assert.equal(sectionsOf(editorial), sectionsOf(home));
    assert.equal(sectionsOf(diagram), sectionsOf(home));

    // The hero still owns the single H1; a layout never adds a page heading.
    for (const source of [home, editorial, diagram]) assert.doesNotMatch(source, /pageHeading=/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("a page-type template is not a layout request and keeps the legacy page source byte for byte", async () => {
  const ctx = withSharedContent(layoutRoutes());
  try {
    await new SiteAssemblerStage().run(ctx);
    const legacy = page(ctx.outputDir, "/legacy");
    const plain = page(ctx.outputDir, "/plain");
    assert.equal(legacy.replaceAll("Legacy", "Plain"), plain);
    assert.match(
      legacy,
      /\{sections\.map\(section => <SectionRenderer name=\{section\.name\} content=\{section\.content\} \/>\)\}/,
    );
    assert.doesNotMatch(legacy, /const layout/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("a non-string template from unvalidated YAML stays a non-request instead of crashing", async () => {
  // validateDomainSpec does not type-check routes[].template, so `template: 1` reaches assembly.
  const routes = layoutRoutes();
  (routes[3] as { template?: unknown }).template = 1;
  const ctx = withSharedContent(routes);
  try {
    await new SiteAssemblerStage().run(ctx);
    assert.equal(
      page(ctx.outputDir, "/legacy").replaceAll("Legacy", "Plain"),
      page(ctx.outputDir, "/plain"),
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("the assembler stage version changes so pre-layout checkpoints cannot be resumed", () => {
  // PipelineRunner.resumeStage reuses a checkpoint only when stageVersion matches.
  assert.notEqual(new SiteAssemblerStage().version, "3.0.0");
});

void test("an unknown explicit layout fails visibly instead of rendering generic prose", async () => {
  const routes: Route[] = [
    { slug: "/", title: "Home", template: "layout:carousel", components: COMPONENTS },
  ];
  await rejectsUnsupported(routes, false, /"layout:carousel" on \/ is not a supported layout/);
  // Plan mode surfaces the same finding before any project is materialized.
  await rejectsUnsupported(routes, true, /supported: layout:editorial, layout:diagram/);
});

void test("a supported layout with no generic section to arrange is unrealizable and fails", async () => {
  await rejectsUnsupported(
    [{ slug: "/", title: "Home", template: "layout:diagram", components: ["hero", "faq"] }],
    false,
    /cannot be realized/,
  );
});

void test("the canonical renderer realizes every registered layout and refuses an unknown one", () => {
  assert.equal(LAYOUT_TEMPLATE_PREFIX, "layout:");
  assert.deepEqual([...SECTION_LAYOUT_VARIANTS], ["editorial", "diagram"]);
  const renderer = readFileSync(
    resolve("astro_template/src/components/SectionRenderer.astro"),
    "utf8",
  );
  assert.match(renderer, /editorial: EditorialSection/);
  assert.match(renderer, /diagram: DiagramSection/);
  assert.match(renderer, /throw new Error\(`unsupported-layout:/);
  // Unregistered sections without a layout keep the documented ProseSection fallback.
  assert.match(
    renderer,
    /registry\[name\] \?\? \(layout \? layoutVariants\[layout\] : undefined\) \?\? ProseSection/,
  );
});

void test("layout variants are static, mobile-first, H1-free and structurally distinct", () => {
  const read = (file: string) =>
    readFileSync(resolve(`astro_template/src/components/sections/${file}`), "utf8");
  const editorial = read("EditorialSection.astro");
  const diagram = read("DiagramSection.astro");
  for (const source of [editorial, diagram]) {
    assert.doesNotMatch(source, /<h1/i);
    assert.match(source, /<h2/);
    assert.doesNotMatch(source, /<script|client:|<img|<canvas|<svg/i);
    // Single-column by default; the wide arrangement is an enhancement only.
    assert.match(source, /@media \(min-width: 800px\)/);
  }
  assert.match(editorial, /data-layout="editorial"/);
  assert.match(editorial, /class="editorial__lead"/);
  assert.match(diagram, /data-layout="diagram"/);
  assert.match(diagram, /<ol class="diagram__nodes">/);
  assert.doesNotMatch(editorial, /<ol/);
});
