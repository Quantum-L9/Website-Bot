// L9_META: layer=test, role=rendered_site_browser_integration, status=active, version=1.0.0
//
// The real renderer against a real headless Chromium: a well-formed static
// site passes every route × viewport check, and a site with a mobile overflow,
// a broken image, a dangling internal link and no sitemap fails with those
// checks named. Requires the Playwright chromium binary; its absence is a
// failure of this gate, never a skip (CI installs it — see ci.yml Gate 5).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlaywrightSiteRenderer } from "../../../src/validation/rendered-site.js";

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${title} description"><link rel="canonical" href="https://example.test/">${extraHead}<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example"}</script></head><body><header><nav aria-label="Primary"><a href="/">Home</a><a href="/services/">Services</a></nav></header><main id="main-content">${body}</main><footer>© Example</footer></body></html>`;
}

const PROSE = `<p>${"Real body copy that the validator counts as final content. ".repeat(6)}</p>`;

function writeSite(dist: string, options: { broken: boolean }): void {
  mkdirSync(join(dist, "services"), { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    page(
      "Home",
      `<h1>Example Systems</h1>${PROSE}${
        options.broken
          ? '<div style="width:3000px;height:10px"></div><img src="/missing.png" alt="missing"><a href="/pricing/">Pricing</a>'
          : ""
      }`,
    ),
  );
  writeFileSync(join(dist, "services", "index.html"), page("Services", `<h1>Services</h1>${PROSE}`));
  writeFileSync(join(dist, "robots.txt"), "User-agent: *\nAllow: /\n");
  if (!options.broken) writeFileSync(join(dist, "sitemap-index.xml"), "<sitemapindex/>");
}

void test("a well-formed built site renders and validates on desktop and mobile", async () => {
  const dist = mkdtempSync(join(tmpdir(), "render-ok-"));
  const shots = mkdtempSync(join(tmpdir(), "render-shots-"));
  writeSite(dist, { broken: false });
  try {
    const result = await new PlaywrightSiteRenderer().render({
      buildId: "render-ok",
      clientId: "render-client",
      distDir: dist,
      routes: [
        { slug: "/", title: "Home" },
        { slug: "/services", title: "Services" },
      ],
      screenshotDir: shots,
    });
    assert.equal(result.status, "PASS", JSON.stringify(result, null, 2));
    assert.equal(result.summary.renders, 4);
    assert.ok(result.browser.version);
    for (const route of result.routes) {
      assert.ok(route.screenshot_path && existsSync(route.screenshot_path), `screenshot for ${route.route}@${route.viewport}`);
      assert.deepEqual(route.console_errors, []);
    }
  } finally {
    rmSync(dist, { recursive: true, force: true });
    rmSync(shots, { recursive: true, force: true });
  }
});

void test("a site with overflow, a broken image, a dangling link and no sitemap fails with those checks named", async () => {
  const dist = mkdtempSync(join(tmpdir(), "render-bad-"));
  const shots = mkdtempSync(join(tmpdir(), "render-shots-"));
  writeSite(dist, { broken: true });
  try {
    const result = await new PlaywrightSiteRenderer().render({
      buildId: "render-bad",
      clientId: "render-client",
      distDir: dist,
      routes: [{ slug: "/", title: "Home" }],
      screenshotDir: shots,
    });
    assert.equal(result.status, "FAIL");
    const mobile = result.routes.find((route) => route.viewport === "mobile")!;
    const failed = new Set(mobile.checks.filter((check) => check.status === "FAIL").map((check) => check.name));
    for (const expected of ["no_horizontal_overflow", "images_loaded", "internal_links_resolve", "no_failed_requests"]) {
      assert.ok(failed.has(expected), `${expected} must fail: ${JSON.stringify([...failed])}`);
    }
    assert.ok(result.site_checks.some((check) => check.name === "sitemap_index" && check.status === "FAIL"));
  } finally {
    rmSync(dist, { recursive: true, force: true });
    rmSync(shots, { recursive: true, force: true });
  }
});
