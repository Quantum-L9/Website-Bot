// L9_META: layer=test, role=two_client_factory_acceptance, status=active, version=1.0.0
//
// WB-FACTORY-07: two invented businesses go through the native factory path:
// DomainSpec validation -> DesignIntelligenceStage (resolved COPY design, no
// LLM) -> SiteAssemblerStage -> generated-source validation -> SiteBuildStage
// (real npm install, astro check, astro build) -> RenderedSiteValidationStage
// (real Chromium, desktop + mobile). Content is test-supplied (COPY): this
// proves build/render/evidence behaviour for arbitrary input, not autonomous
// SEO-Bot content generation, which stays NOT_RUN here. Requires network for
// the generated site's npm install and the Playwright chromium binary; their
// absence fails this gate, never skips it (CI Gate 5 provides both).

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import type { BuildContext, DomainSpec } from "../../../src/pipeline/BuildContext.js";
import { FileEvidenceStore } from "../../../src/pipeline/evidence/FileEvidenceStore.js";
import { validateDomainSpec } from "../../../src/pipeline/validateDomainSpec.js";
import { DesignIntelligenceStage } from "../../../src/stages/DesignIntelligenceStage.js";
import { RenderedSiteValidationStage } from "../../../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../../src/stages/SiteBuildStage.js";
import {
  DEFAULT_RENDER_VIEWPORTS,
  PlaywrightSiteRenderer,
  type RenderedSiteValidationReport,
  StaticDistServer,
} from "../../../src/validation/rendered-site.js";
import {
  distPathForRoute,
  validateGeneratedSite,
} from "../../../src/validation/validate-generated-site.js";

const CLIENTS = {
  editorial: "fixtures/wb-factory-07-editorial.yaml",
  industrial: "fixtures/wb-factory-07-industrial.yaml",
} as const;
type Client = keyof typeof CLIENTS;

interface Built {
  spec: DomainSpec;
  ctx: BuildContext;
  root: string;
  distDir: string;
  report: RenderedSiteValidationReport;
}
const built = new Map<Client, Built>();

function loadSpec(client: Client): DomainSpec {
  return validateDomainSpec(parse(readFileSync(CLIENTS[client], "utf-8")), CLIENTS[client]);
}

async function buildClient(client: Client): Promise<Built> {
  const spec = loadSpec(client);
  const root = mkdtempSync(join(tmpdir(), `wb07-${client}-`));
  const buildId = `wb07-${client}-${process.pid}`;
  const evidenceStore = new FileEvidenceStore({
    rootDir: join(root, "evidence"),
    clientId: spec.client_id,
    buildId,
    mode: "local-proof",
  });
  const generatedContent = new Map<string, string>();
  for (const route of spec.routes)
    for (const component of route.components)
      generatedContent.set(
        `${route.slug}:${component}`,
        `${spec.business_name}: ${route.title} ${component}\n\nTest-supplied fixture copy for the ${component} section of ${route.title}. It exists only to exercise the factory's build and render path.`,
      );
  const ctx: BuildContext = {
    buildId,
    clientId: spec.client_id,
    domainSpec: spec,
    dryRun: false,
    mode: "local-proof",
    autoRegisterSeoBot: false,
    buildIntent: "COPY",
    llm: { flushUsage: () => [] } as unknown as BuildContext["llm"],
    outputDir: join(root, "site"),
    evidenceStore,
    evidenceIndex: await evidenceStore.initialize(),
    resume: false,
    qualityEvidence: { seoBaseline: "pending", visualQa: "pending" },
    generatedContent,
    generatedSchemas: new Map([
      [
        "Organization",
        { "@context": "https://schema.org", "@type": "Organization", name: spec.business_name },
      ],
    ]),
    visualQaPassed: false,
    stageResults: new Map(),
    startedAt: new Date(),
  };
  await new DesignIntelligenceStage().run(ctx);
  await new SiteAssemblerStage().run(ctx);
  validateGeneratedSite(ctx.outputDir, spec.routes);
  await new SiteBuildStage().run(ctx);
  await new RenderedSiteValidationStage().run(ctx);
  assert.ok(ctx.renderedSiteValidationPath && ctx.distDir);
  const report = JSON.parse(
    readFileSync(ctx.renderedSiteValidationPath, "utf-8"),
  ) as RenderedSiteValidationReport;
  return { spec, ctx, root, distDir: ctx.distDir, report };
}

interface NoJsFacts {
  h1: number;
  main: boolean;
  nav: string[];
  overflow: boolean;
  ctas: Array<{ text: string; href: string }>;
}
interface FormFacts {
  anchor: boolean;
  action: string | null;
  method: string | null;
}
// Evaluated in the page as expressions (the project compiles without DOM lib types).
const NO_JS_FACTS = `(() => ({
  h1: document.querySelectorAll("h1").length,
  main: Boolean(document.querySelector("main")),
  nav: Array.from(document.querySelectorAll("header nav a[href]")).map((a) => a.getAttribute("href")),
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  ctas: Array.from(document.querySelectorAll("a[href$='#quote']")).map((a) => ({
    text: (a.textContent || "").replace(/\\s+/g, " ").trim(),
    href: a.getAttribute("href"),
  })),
}))()`;
const FORM_FACTS = `(() => {
  const element = document.querySelector("#quote");
  const form = element && (element.matches("form") ? element : element.querySelector("form"));
  return {
    anchor: Boolean(element),
    action: form ? form.getAttribute("action") : null,
    method: form ? form.getAttribute("method") : null,
  };
})()`;

function html(entry: Built, slug: string): string {
  return readFileSync(join(entry.distDir, distPathForRoute(slug)), "utf-8");
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".html"))
    .map((item) => relative(dir, join(item.parentPath, item.name)))
    .sort((a, b) => a.localeCompare(b));
}

function client(name: Client): Built {
  const entry = built.get(name);
  assert.ok(entry, `${name} was built by the first test`);
  return entry;
}

test.after(() => {
  for (const entry of built.values()) rmSync(entry.root, { recursive: true, force: true });
});

void test("both invented businesses build and render on every declared route at both native viewports", async (t) => {
  for (const name of Object.keys(CLIENTS) as Client[]) built.set(name, await buildClient(name));
  for (const [name, entry] of built) {
    const proof = entry.ctx.buildProof;
    assert.equal(proof?.status, "passed", `${name} build proof`);
    for (const check of ["install", "astro-check", "astro-build", "route-assertion"])
      assert.equal(proof?.checks.find((item) => item.name === check)?.status, "passed", check);
    assert.deepEqual(
      proof?.builtRoutes,
      entry.spec.routes.map((route) => route.slug),
    );
    assert.match(entry.ctx.assemblyManifest?.sourceDigest ?? "", /^[0-9a-f]{64}$/);
    assert.match(proof?.distDigest ?? "", /^[0-9a-f]{64}$/);

    assert.equal(entry.report.status, "PASS", `${name} rendered-site report`);
    assert.deepEqual(
      entry.report.viewports.map((viewport) => viewport.name),
      DEFAULT_RENDER_VIEWPORTS.map((viewport) => viewport.name),
    );
    assert.equal(entry.report.summary.renders, entry.spec.routes.length * 2);
    for (const route of entry.spec.routes)
      for (const viewport of DEFAULT_RENDER_VIEWPORTS)
        assert.ok(
          entry.report.routes.some(
            (render) =>
              render.route === route.slug &&
              render.viewport === viewport.name &&
              render.status === "PASS",
          ),
          `${name} ${route.slug}@${viewport.name}`,
        );
    t.diagnostic(
      JSON.stringify({
        client: entry.spec.client_id,
        routes: entry.spec.routes.map((route) => route.slug),
        source_digest: entry.ctx.assemblyManifest?.sourceDigest,
        dist_digest: proof?.distDigest,
        renders: entry.report.summary.renders,
        browser: entry.report.browser.version,
      }),
    );
  }
  assert.notEqual(
    client("editorial").ctx.buildProof?.distDigest,
    client("industrial").ctx.buildProof?.distDigest,
  );
});

void test("route trees, page metadata and layouts in the built output follow each spec", () => {
  for (const [name, entry] of built) {
    assert.deepEqual(
      htmlFiles(entry.distDir),
      entry.spec.routes
        .map((route) => distPathForRoute(route.slug))
        .sort((a, b) => a.localeCompare(b)),
      `${name} dist route tree is exactly the declared routes`,
    );
    const siteUrl = `https://${entry.spec.seo_contract?.site_url}`;
    for (const route of entry.spec.routes) {
      const page = html(entry, route.slug);
      // No contact detail is invented, so none is published (AGENTS.md).
      assert.doesNotMatch(page, /href="tel:/, `${name} ${route.slug} publishes no phone`);
      assert.match(page, new RegExp(`<title>${route.title}</title>`));
      assert.match(page, /<meta name="description" content="[^"]+"/);
      const canonicalPath = route.slug === "/" ? "/" : `${route.slug}/`;
      assert.ok(page.includes(`<link rel="canonical" href="${siteUrl}${canonicalPath}">`));
      assert.equal(
        /<meta name="robots" content="noindex,nofollow"/.test(page),
        route.noindex === true,
      );
      const layout = route.template?.slice("layout:".length);
      if (layout) {
        assert.match(page, new RegExp(`data-layout="${layout}"`), `${name} ${route.slug}`);
        assert.doesNotMatch(page, new RegExp(`data-layout="(?!${layout})`));
      } else {
        assert.doesNotMatch(page, /data-layout=/);
      }
    }
    // A noindex route is left out of the primary navigation.
    const home = html(entry, "/");
    for (const route of entry.spec.routes.filter((candidate) => candidate.noindex))
      assert.doesNotMatch(
        home.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "",
        new RegExp(`href="${route.slug}`),
      );
  }
});

void test("styling differs only through tokens the native design stage derived from each client's intent", () => {
  const editorial = client("editorial");
  const industrial = client("industrial");
  const tokens = (entry: Built) => entry.ctx.designTokens ?? {};
  assert.notDeepEqual(tokens(editorial), tokens(industrial));
  for (const entry of [editorial, industrial]) {
    const page = html(entry, "/");
    const style = page.match(/<html[^>]*style="([^"]*)"/)?.[1] ?? "";
    for (const [token, cssVar] of [
      ["layout_radius", "--radius"],
      ["layout_content_width", "--content-width"],
    ] as const)
      assert.ok(
        style.includes(`${cssVar}:${tokens(entry)[token]}`),
        `${entry.spec.client_id} ${cssVar}`,
      );
    const css = readdirSync(join(entry.distDir, "_astro"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(entry.distDir, "_astro", file), "utf-8"))
      .join("\n");
    assert.ok(css.includes(tokens(entry).primary), `${entry.spec.client_id} primary color ships`);
    const other = entry === editorial ? industrial : editorial;
    assert.ok(!css.includes(tokens(other).primary), "no other client's primary color ships");
  }
});

void test("with visual enhancements disabled the built site ships no client JavaScript", () => {
  for (const [name, entry] of built) {
    for (const file of htmlFiles(entry.distDir)) {
      const page = readFileSync(join(entry.distDir, file), "utf-8");
      assert.doesNotMatch(page, /data-visual-slot|data-enhancement/, `${name} ${file}`);
      for (const script of page.match(/<script\b[^>]*>/gi) ?? [])
        assert.match(script, /type="application\/ld\+json"/i, `${name} ${file}: ${script}`);
    }
    const files = readdirSync(entry.distDir, { recursive: true }).map(String);
    assert.deepEqual(
      files.filter((file) => /\.(m?js)$/.test(file)),
      [],
      `${name} emits no JavaScript bundles`,
    );
  }
});

void test("with JavaScript disabled, navigation, the CTA and the form work at both viewports", async () => {
  const { chromium } = (await import("playwright")) as typeof import("playwright");
  const browser = await chromium.launch();
  try {
    for (const [name, entry] of built) {
      const server = await new StaticDistServer().start(entry.distDir);
      const label = entry.spec.conversion_authority?.primary_action ?? "";
      const formRoute = entry.spec.routes.find((route) =>
        route.components.includes("contact-form"),
      );
      assert.ok(formRoute);
      try {
        for (const viewport of DEFAULT_RENDER_VIEWPORTS) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            javaScriptEnabled: false,
          });
          const page = await context.newPage();
          try {
            for (const route of entry.spec.routes) {
              const response = await page.goto(`${server.baseUrl}${route.slug}`);
              assert.equal(response?.status(), 200, `${name} ${route.slug}`);
              const facts = await page.evaluate<NoJsFacts>(NO_JS_FACTS);
              assert.equal(facts.h1, 1, `${name} ${route.slug}@${viewport.name} h1`);
              assert.ok(facts.main);
              assert.ok(facts.nav.length > 0, `${name} ${route.slug}@${viewport.name} nav`);
              assert.equal(
                facts.overflow,
                false,
                `${name} ${route.slug}@${viewport.name} overflow`,
              );
              // Every CTA carries the operator's label and the verified form destination.
              for (const cta of facts.ctas) {
                assert.equal(cta.href, `${formRoute.slug}#quote`);
                assert.ok(cta.text.includes(label), `${name} ${route.slug} CTA label: ${cta.text}`);
              }
              if (route.components.includes("hero"))
                assert.ok(facts.ctas.length > 0, `${name} ${route.slug} hero carries the CTA`);
            }
            await page.goto(`${server.baseUrl}${formRoute.slug}`);
            const form = await page.evaluate<FormFacts>(FORM_FACTS);
            assert.deepEqual(form, {
              anchor: true,
              action: entry.spec.seo_contract?.lead_form_action ?? null,
              method: "post",
            });
          } finally {
            await context.close();
          }
        }
      } finally {
        await server.close();
      }
    }
  } finally {
    await browser.close();
  }
});

void test("NEGATIVE render seam: a broken link, missing description and mobile overflow fail as those checks", async () => {
  const entry = client("editorial");
  const mutated = mkdtempSync(join(tmpdir(), "wb07-mutated-"));
  const shots = mkdtempSync(join(tmpdir(), "wb07-mutated-shots-"));
  try {
    cpSync(entry.distDir, mutated, { recursive: true });
    const edit = (slug: string, change: (page: string) => string) => {
      const path = join(mutated, distPathForRoute(slug));
      writeFileSync(path, change(readFileSync(path, "utf-8")));
    };
    edit("/journal", (page) =>
      page.replace("</main>", '<a href="/journal/missing-essay/">Missing essay</a></main>'),
    );
    edit("/workshops", (page) => page.replace(/<meta name="description" content="[^"]*">/, ""));
    edit("/contact", (page) =>
      page.replace("</main>", '<div style="width:3000px;height:4px"></div></main>'),
    );
    const report = await new PlaywrightSiteRenderer().render({
      buildId: "wb07-mutated",
      clientId: entry.spec.client_id,
      distDir: mutated,
      routes: entry.spec.routes.map((route) => ({ slug: route.slug, title: route.title })),
      screenshotDir: shots,
    });
    assert.equal(report.status, "FAIL");
    const failed = (slug: string, viewport: string) =>
      new Set(
        report.routes
          .find((render) => render.route === slug && render.viewport === viewport)
          ?.checks.filter((check) => check.status === "FAIL")
          .map((check) => check.name),
      );
    assert.deepEqual([...failed("/journal", "desktop")], ["internal_links_resolve"]);
    assert.deepEqual([...failed("/workshops", "mobile")], ["meta_description"]);
    assert.deepEqual([...failed("/contact", "mobile")], ["no_horizontal_overflow"]);
    // Unmutated routes still pass: each failure is the mutation, not the fixture.
    for (const slug of ["/", "/journal/paper-grain"])
      for (const viewport of ["desktop", "mobile"])
        assert.deepEqual([...failed(slug, viewport)], [], `${slug}@${viewport}`);
  } finally {
    rmSync(mutated, { recursive: true, force: true });
    rmSync(shots, { recursive: true, force: true });
  }
});

void test("evidence labels: offline fixture coverage measured; provider redesign NOT_RUN; autonomy UNKNOWN", (t) => {
  assert.equal(built.size, 2);
  const offline = [...built.values()].every(
    (entry) => entry.report.status === "PASS" && entry.ctx.buildProof?.status === "passed",
  );
  const summary = {
    contract: "WB-FACTORY-07",
    offline_fixture_coverage: offline ? "PASSED" : "FAILED",
    build_intent_exercised: "COPY (test-supplied content)",
    provider_redesign_integration: "NOT_RUN",
    full_autonomous_readiness: "UNKNOWN",
    reason:
      "REDESIGN_IMPROVE needs live SEO-Bot and LLM provider evidence, which this offline test does not run",
  };
  t.diagnostic(JSON.stringify(summary));
  assert.equal(summary.offline_fixture_coverage, "PASSED");
});
