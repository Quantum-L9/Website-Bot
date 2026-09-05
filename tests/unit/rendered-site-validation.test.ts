// L9_META: layer=test, role=rendered_site_validation, status=active, version=1.0.0
//
// A production build is not terminal success: the rendered-site-validation
// stage must fail closed on any failing render, on an unavailable browser, and
// must never run without persisted build evidence. Pure checks are exercised
// directly; the real-browser path is covered in
// tests/integration/local/rendered-site-browser.test.ts.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { RenderedSiteValidationStage } from "../../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { type CommandResult, type CommandRunner, SiteBuildStage } from "../../src/stages/SiteBuildStage.js";
import { runInNewContext } from "node:vm";
import {
  evaluateRouteFacts,
  PAGE_FACTS_EXPRESSION,
  PlaywrightSiteRenderer,
  type RenderedPageFacts,
  type RenderedSiteValidationReport,
  RENDERED_SITE_VALIDATION_SCHEMA,
  resolveDistFile,
  type SiteRenderer,
  StaticDistServer,
} from "../../src/validation/rendered-site.js";
import { distPathForRoute } from "../../src/validation/validate-generated-site.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

class FakeBuildRunner implements CommandRunner {
  constructor(private readonly routes: string[]) {}
  async run(command: string, args: string[], options: { cwd: string }): Promise<CommandResult> {
    if (command === "npm" && args[0] === "run" && args[1] === "build") {
      for (const route of this.routes) {
        const path = join(options.cwd, "dist", distPathForRoute(route));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "<!doctype html><title>fixture</title>", "utf-8");
      }
      writeFileSync(join(options.cwd, "dist", "sitemap-index.xml"), "<sitemapindex/>", "utf-8");
    }
    return { stdout: command === "npm" && args[0] === "--version" ? "10.9.2\n" : "", stderr: "", durationMs: 1 };
  }
}

function report(status: "PASS" | "FAIL", ctx: { buildId: string; clientId: string }): RenderedSiteValidationReport {
  return {
    schema: RENDERED_SITE_VALIDATION_SCHEMA,
    build_id: ctx.buildId,
    client_id: ctx.clientId,
    dist_dir: "/dist",
    served_from: "http://127.0.0.1:0",
    rendered_at: "2026-09-03T00:00:00.000Z",
    browser: { engine: "chromium" },
    viewports: [{ name: "desktop", width: 1440, height: 900 }],
    site_checks: [],
    routes: [
      {
        route: "/",
        viewport: "desktop",
        url: "http://127.0.0.1:0/",
        http_status: 200,
        console_errors: status === "FAIL" ? ["Uncaught ReferenceError: hydrate is not defined"] : [],
        failed_requests: [],
        checks: [
          { name: "no_console_errors", status, detail: status === "FAIL" ? "hydration error" : "clean" },
        ],
        status,
      },
    ],
    summary: { routes: 1, renders: 1, passed: status === "PASS" ? 1 : 0, failed: status === "PASS" ? 0 : 1 },
    status,
  };
}

function healthyFacts(): RenderedPageFacts {
  return {
    title: "Home | CI Test Business",
    h1_count: 1,
    h1_text: "CI Test Business",
    has_main: true,
    nav_link_count: 3,
    meta_description: "desc",
    canonical: "https://ci-test.example.com/",
    body_text_length: 800,
    scroll_width: 1440,
    inner_width: 1440,
    images: [{ src: "/images/hero.png", complete: true, natural_width: 1200, alt: "hero" }],
    internal_links: ["/services", "/contact"],
    json_ld_blocks: ['{"@context":"https://schema.org"}'],
  };
}

// L2-S17-001: Playwright evaluates a string as an EXPRESSION. The collector
// must therefore be a self-invoking expression, never a bare function source
// (which evaluates to the function object, serializes as undefined, and made
// every real-browser render fail with "page facts unavailable").
void test("the page-facts expression invokes the collector when evaluated as an expression", () => {
  const element = (text = "") => ({
    textContent: text,
    getAttribute: () => "",
    hasAttribute: () => false,
    querySelectorAll: () => [] as unknown[],
  });
  const document = {
    title: "Home",
    body: { innerText: "hello world" },
    documentElement: { scrollWidth: 1200 },
    images: [] as unknown[],
    querySelector: (selector: string) => (selector.includes("main") ? element() : null),
    querySelectorAll: (selector: string) => (selector === "h1" ? [element("Home")] : []),
  };
  const facts = runInNewContext(PAGE_FACTS_EXPRESSION, {
    document,
    window: { innerWidth: 1200 },
    Array,
    Boolean,
  }) as RenderedPageFacts | undefined;
  assert.ok(facts && typeof facts === "object", "expression must evaluate to the facts object, not a function");
  assert.equal(facts.title, "Home");
  assert.equal(facts.h1_count, 1);
  assert.equal(facts.has_main, true);
  assert.equal(facts.inner_width, 1200);
});

void test("resolveDistFile maps routes to index.html and refuses traversal", () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  mkdirSync(join(dist, "about"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html/>");
  writeFileSync(join(dist, "about", "index.html"), "<html/>");
  writeFileSync(join(dist, "robots.txt"), "User-agent: *");
  assert.equal(resolveDistFile(dist, "/"), join(dist, "index.html"));
  assert.equal(resolveDistFile(dist, "/about"), join(dist, "about", "index.html"));
  assert.equal(resolveDistFile(dist, "/about/"), join(dist, "about", "index.html"));
  assert.equal(resolveDistFile(dist, "/robots.txt?x=1"), join(dist, "robots.txt"));
  assert.equal(resolveDistFile(dist, "/missing"), undefined);
  assert.equal(resolveDistFile(dist, "/../../etc/passwd"), undefined);
  rmSync(dist, { recursive: true, force: true });
});

void test("the loopback static server serves dist and 404s everything else", async () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><h1>served</h1>");
  const served = await new StaticDistServer().start(dist);
  try {
    const ok = await fetch(`${served.baseUrl}/`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /served/);
    assert.equal((await fetch(`${served.baseUrl}/nope`)).status, 404);
  } finally {
    await served.close();
    rmSync(dist, { recursive: true, force: true });
  }
});

void test("a failed browser launch closes the loopback server instead of leaking it", async () => {
  // [L2-S17-002] With no Chromium binary the launch rejects; the server that
  // was started first must be closed on that path or the listener keeps the
  // test process alive (the CI hang on Build and Validate).
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  const shots = mkdtempSync(join(tmpdir(), "shots-"));
  const noBrowsers = mkdtempSync(join(tmpdir(), "no-browsers-"));
  const previous = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = noBrowsers;
  const events: string[] = [];
  const server = {
    async start(directory: string) {
      events.push(`start:${directory}`);
      return {
        baseUrl: "http://127.0.0.1:1",
        close: async () => {
          events.push("close");
        },
      };
    },
  } as unknown as StaticDistServer;
  try {
    await assert.rejects(
      new PlaywrightSiteRenderer(server).render({
        buildId: "b",
        clientId: "c",
        distDir: dist,
        routes: [{ slug: "/", title: "Home" }],
        screenshotDir: shots,
      }),
      /Executable doesn't exist|browser unavailable/,
    );
    assert.deepEqual(events, [`start:${dist}`, "close"]);
  } finally {
    if (previous === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previous;
    rmSync(dist, { recursive: true, force: true });
    rmSync(shots, { recursive: true, force: true });
    rmSync(noBrowsers, { recursive: true, force: true });
  }
});

void test("route checks pass on healthy facts and name every defect otherwise", () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  for (const route of ["services", "contact"]) {
    mkdirSync(join(dist, route), { recursive: true });
    writeFileSync(join(dist, route, "index.html"), "<html/>");
  }
  const healthy = evaluateRouteFacts(healthyFacts(), 200, [], [], dist, { slug: "/", title: "Home" });
  assert.ok(healthy.every((check) => check.status === "PASS"), JSON.stringify(healthy));

  const broken = evaluateRouteFacts(
    {
      ...healthyFacts(),
      h1_count: 0,
      scroll_width: 1900,
      images: [{ src: "/images/missing.png", complete: true, natural_width: 0, alt: null }],
      internal_links: ["/services", "/pricing"],
      json_ld_blocks: ["{not json"],
    },
    200,
    ["Uncaught TypeError"],
    ["/images/missing.png (HTTP 404)"],
    dist,
    { slug: "/", title: "Home" },
  );
  const failed = new Set(broken.filter((check) => check.status === "FAIL").map((check) => check.name));
  assert.deepEqual(
    [...failed].sort(),
    [
      "images_have_alt",
      "images_loaded",
      "internal_links_resolve",
      "no_console_errors",
      "no_failed_requests",
      "no_horizontal_overflow",
      "single_h1",
      "structured_data_parses",
    ],
  );
  assert.match(broken.find((check) => check.name === "internal_links_resolve")!.detail, /\/pricing/);
  rmSync(dist, { recursive: true, force: true });
});

void test("stage: requires build evidence, persists the report, and fails closed on a failing render", async () => {
  const ctx = fixtureContext();
  try {
    const noBuild = new RenderedSiteValidationStage({ async render() { return report("PASS", ctx); } });
    await assert.rejects(
      () => noBuild.run(ctx),
      (error: unknown) => error instanceof BuildError && error.code === "EVIDENCE_ARTIFACT_MISSING",
    );

    await new SiteAssemblerStage().run(ctx);
    await new SiteBuildStage(new FakeBuildRunner(ctx.domainSpec.routes.map((route) => route.slug))).run(ctx);

    const passing: SiteRenderer = { async render() { return report("PASS", ctx); } };
    await new RenderedSiteValidationStage(passing).run(ctx);
    assert.ok(ctx.renderedSiteValidationPath && existsSync(ctx.renderedSiteValidationPath));
    const persisted = JSON.parse(readFileSync(ctx.renderedSiteValidationPath, "utf-8")) as RenderedSiteValidationReport;
    assert.equal(persisted.schema, RENDERED_SITE_VALIDATION_SCHEMA);
    assert.equal(persisted.status, "PASS");

    const failing: SiteRenderer = { async render() { return report("FAIL", ctx); } };
    await assert.rejects(
      () => new RenderedSiteValidationStage(failing).run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "RENDERED_SITE_VALIDATION_FAILED" &&
        /no_console_errors/.test(error.message),
    );

    const noBrowser: SiteRenderer = {
      async render() {
        throw new Error("browser unavailable: the playwright package could not be loaded");
      },
    };
    await assert.rejects(
      () => new RenderedSiteValidationStage(noBrowser).run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "RENDERED_SITE_VALIDATION_FAILED" &&
        /browser unavailable/.test(error.message),
    );

    ctx.dryRun = true;
    await new RenderedSiteValidationStage(noBrowser).run(ctx);
  } finally {
    cleanupContext(ctx);
  }
});
