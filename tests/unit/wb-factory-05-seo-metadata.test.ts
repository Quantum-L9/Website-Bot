// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// WB-FACTORY-05: under REDESIGN_IMPROVE the route <head> title and description
// come verbatim from the accepted SEO-Bot StructuredContentPackage, bound by
// route identity and path. COPY keeps the legacy route-title head. Every
// business, route and metadata string here is synthetic.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  type StructuredContentPackageArtifact,
  type StructuredContentRoute,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
} from "@quantum-l9/bot-interop";
import type { BuildContext, DomainSpec } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const BUSINESS = "Example Fixture Plumbing Co.";
const ROUTES: DomainSpec["routes"] = [
  { slug: "/", title: "Home", components: ["hero", "services-overview"] },
  { slug: "/services", title: "Services", components: ["service-list"] },
  { slug: "/thanks", title: "Thanks", components: ["service-list"], noindex: true },
];
const METADATA: Record<string, StructuredContentRoute["metadata"]> = {
  "/": {
    title: "Fixture Plumbing in Example County | Same-Week Repairs",
    description: "Synthetic home description authored by the SEO-Bot fixture.",
  },
  "/services": {
    title: "Drain and Pipe Services | Example Fixture Plumbing",
    description: "Synthetic services description, independent of the home route.",
  },
  "/thanks": {
    title: "Request Received | Example Fixture Plumbing",
    description: "Synthetic confirmation description for a noindex route.",
  },
};

function scpRoute(slug: string): StructuredContentRoute {
  const route = ROUTES.find((candidate) => candidate.slug === slug);
  assert.ok(route, `fixture route ${slug}`);
  return {
    route_id: slug,
    path: slug,
    metadata: { ...METADATA[slug] },
    sections: route.components.map((component, index) => ({
      section_id: `${slug}#${index}`,
      heading: `${route.title} ${component}`,
      blocks: [{ kind: "paragraph", text: `Synthetic ${component} prose.` }],
    })),
    faqs: [],
    internal_links: [],
    schema_content_inputs: {},
  };
}

function sealPackage(
  ctx: BuildContext,
  routes: StructuredContentRoute[],
): StructuredContentPackageArtifact {
  return sealIntelligenceArtifact({
    artifact_type: "structured_content_package",
    client_id: ctx.clientId,
    build_id: ctx.buildId,
    producer: { repo: "SEO-Bot", version: "1.0.0" },
    produced_at: "2026-10-24T00:00:00.000Z",
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.structuredContentPackage,
      page_content_contract_ref: {
        artifact_type: "page_content_contract",
        artifact_id: "page_content_contract:fixture",
        payload_digest: "sha256:fixture",
      },
      routes,
      validation: {
        seo_blueprint_passed: true,
        contract_passed: true,
        unsupported_claims: [],
        failed_requirements: [],
      },
      route_evidence: routes.map((route) => ({
        route_id: route.route_id,
        repair_attempts: 0,
        generation_calls: 1,
        validation_calls: 1,
        schema_errors: 0,
      })),
    },
  });
}

function redesignContext(
  mutate: (routes: StructuredContentRoute[]) => StructuredContentRoute[] = (routes) => routes,
): BuildContext {
  const ctx = fixtureContext({ business_name: BUSINESS, routes: ROUTES });
  ctx.buildIntent = "REDESIGN_IMPROVE";
  ctx.structuredContentPackage = sealPackage(
    ctx,
    mutate(ROUTES.map((route) => scpRoute(route.slug))),
  );
  return ctx;
}

function copyContext(): BuildContext {
  return fixtureContext({ business_name: BUSINESS, routes: ROUTES });
}

function page(ctx: BuildContext, slug: string): string {
  const path = slug === "/" ? "src/pages/index.astro" : `src/pages${slug}/index.astro`;
  return readFileSync(join(ctx.outputDir, path), "utf-8");
}

function layoutTag(source: string): string {
  const tag = source.match(/<BaseLayout [^\n]*>/)?.[0];
  assert.ok(tag, "generated page renders BaseLayout");
  return tag;
}

async function assertRejects(ctx: BuildContext, code: string, pattern: RegExp): Promise<void> {
  try {
    await assert.rejects(
      () => new SiteAssemblerStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError && error.code === code && pattern.test(error.message),
    );
    // Assembly fails before materializing: no generated route reaches the output.
    assert.equal(existsSync(join(ctx.outputDir, "src/pages/index.astro")), false);
    assert.equal(ctx.assemblyManifest, undefined);
  } finally {
    cleanupContext(ctx);
  }
}

void test("REDESIGN_IMPROVE heads use the exact StructuredContentPackage metadata per route", async () => {
  const ctx = redesignContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    for (const route of ROUTES) {
      const tag = layoutTag(page(ctx, route.slug));
      const { title, description } = METADATA[route.slug];
      assert.ok(tag.includes(`title={${JSON.stringify(title)}}`), `${route.slug} title`);
      assert.ok(
        tag.includes(`description={${JSON.stringify(description)}}`),
        `${route.slug} description`,
      );
      // No synthesized "<route title> | <business>" description survives on this path.
      assert.ok(!tag.includes(`${route.title} | ${BUSINESS}`), `${route.slug} generic description`);
      assert.ok(tag.includes(`noindex={${Boolean(route.noindex)}}`), `${route.slug} noindex`);
      // Descriptions stay independent: no route carries another route's metadata.
      for (const other of ROUTES.filter((candidate) => candidate.slug !== route.slug)) {
        assert.ok(!tag.includes(JSON.stringify(METADATA[other.slug].description)));
        assert.ok(!tag.includes(JSON.stringify(METADATA[other.slug].title)));
      }
    }
    // The visible page heading and the navigation keep the spec route titles.
    assert.match(page(ctx, "/services"), /pageHeading=\{"Services"\}/);
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    assert.match(config, /"title": "Services"/);
    assert.doesNotMatch(config, /Drain and Pipe Services/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("hostile metadata is serialized as Astro expression string literals", async () => {
  const title = `Pipes "R" Us </title><script>alert('x')</script> {braces} & more`;
  const description = `Line \\ with <b>markup</b>, "quotes", \`ticks\` and }{ expression breakers`;
  const ctx = redesignContext((routes) =>
    routes.map((route) =>
      route.route_id === "/" ? { ...route, metadata: { title, description } } : route,
    ),
  );
  try {
    await new SiteAssemblerStage().run(ctx);
    const tag = layoutTag(page(ctx, "/"));
    assert.ok(tag.includes(`title={${JSON.stringify(title)}}`));
    assert.ok(tag.includes(`description={${JSON.stringify(description)}}`));
    // The raw markup never appears outside its string literal.
    assert.doesNotMatch(
      tag.replace(JSON.stringify(title), "").replace(JSON.stringify(description), ""),
      /<script>|<b>/,
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("REDESIGN_IMPROVE without the accepted StructuredContentPackage fails typed", async () => {
  const ctx = redesignContext();
  ctx.structuredContentPackage = undefined;
  await assertRejects(ctx, "REDESIGN_PIPELINE_INCOMPLETE", /StructuredContentPackage/);
});

void test("a spec route the producer did not author fails instead of falling back", async () => {
  await assertRejects(
    redesignContext((routes) => routes.filter((route) => route.route_id !== "/services")),
    "ROUTE_SET_MISMATCH",
    /\/services/,
  );
});

void test("duplicate producer routes fail instead of picking one", async () => {
  await assertRejects(
    redesignContext((routes) => [...routes, scpRoute("/services")]),
    "ROUTE_SET_MISMATCH",
    /duplicate/,
  );
});

void test("producer routes whose identity and path are swapped fail", async () => {
  await assertRejects(
    redesignContext((routes) =>
      routes.map((route) =>
        route.route_id === "/"
          ? { ...route, path: "/services" }
          : route.route_id === "/services"
            ? { ...route, path: "/" }
            : route,
      ),
    ),
    "ROUTE_SET_MISMATCH",
    /path/,
  );
});

void test("a producer route outside the spec route set fails", async () => {
  await assertRejects(
    redesignContext((routes) => [
      ...routes,
      { ...scpRoute("/services"), route_id: "/extra", path: "/extra" },
    ]),
    "ROUTE_SET_MISMATCH",
    /\/extra/,
  );
});

for (const [label, metadata] of [
  ["missing metadata", undefined],
  ["blank title", { title: "  ", description: "Synthetic description." }],
  ["missing description", { title: "Synthetic title" }],
  ["non-string description", { title: "Synthetic title", description: 42 }],
] as const) {
  void test(`invalid producer metadata (${label}) fails typed`, async () => {
    await assertRejects(
      redesignContext((routes) =>
        routes.map((route) =>
          route.route_id === "/services"
            ? ({ ...route, metadata } as unknown as StructuredContentRoute)
            : route,
        ),
      ),
      "VALIDATION_FAILED",
      /\/services/,
    );
  });
}

void test("COPY keeps the legacy route-title head and never requires a SEO-Bot artifact", async () => {
  const ctx = copyContext();
  try {
    assert.equal(ctx.buildIntent, "COPY");
    assert.equal(ctx.structuredContentPackage, undefined);
    await new SiteAssemblerStage().run(ctx);
    for (const route of ROUTES) {
      const tag = layoutTag(page(ctx, route.slug));
      assert.ok(tag.includes(`title={${JSON.stringify(route.title)}}`));
      assert.ok(tag.includes(`description={${JSON.stringify(`${route.title} | ${BUSINESS}`)}}`));
      assert.ok(tag.includes(`noindex={${Boolean(route.noindex)}}`));
    }
  } finally {
    cleanupContext(ctx);
  }
});

void test("NEGATIVE: deleted REDESIGN metadata fails while the equivalent COPY route stays valid", async () => {
  const strip = (routes: StructuredContentRoute[]) =>
    routes.map((route) =>
      route.route_id === "/"
        ? ({ ...route, metadata: undefined } as unknown as StructuredContentRoute)
        : route,
    );
  await assertRejects(redesignContext(strip), "VALIDATION_FAILED", /metadata/);

  const copy = copyContext();
  // The same broken package is present but has no authority over COPY.
  copy.structuredContentPackage = sealPackage(
    copy,
    strip(ROUTES.map((route) => scpRoute(route.slug))),
  );
  try {
    await new SiteAssemblerStage().run(copy);
    assert.ok(
      layoutTag(page(copy, "/")).includes(`description={${JSON.stringify(`Home | ${BUSINESS}`)}}`),
    );
  } finally {
    cleanupContext(copy);
  }
});

void test("the assembler stage version moves past the release that synthesized redesign heads", () => {
  // PipelineRunner resumes a checkpoint only when stageVersion matches; 3.3.0
  // wrote generic redesign descriptions, so those checkpoints cannot be reused.
  assert.notEqual(new SiteAssemblerStage().version, "3.3.0");
});
