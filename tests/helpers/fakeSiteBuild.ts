// L9_META: layer=test, role=fake_site_build, status=active, version=1.0.0
//
// A SiteBuildStage command runner that stands in for npm install / astro
// check / astro build: it emits one HTML file per route plus the sitemap the
// build proof requires, so stages after site-build run on real persisted
// build evidence without installing anything. Also records the rendered-site
// reports a test renderer returns.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CommandRunner } from "../../src/stages/SiteBuildStage.js";
import {
  RENDERED_SITE_VALIDATION_SCHEMA,
  type RenderedSiteValidationReport,
  type RenderSiteOptions,
} from "../../src/validation/rendered-site.js";
import { distPathForRoute } from "../../src/validation/validate-generated-site.js";

export function fakeAstroBuild(routes: readonly string[]): CommandRunner {
  return {
    run(command, args, options) {
      if (command === "npm" && args[0] === "run" && args[1] === "build") {
        for (const route of routes) {
          const path = join(options.cwd, "dist", distPathForRoute(route));
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, "<!doctype html><title>fixture</title>", "utf-8");
        }
        writeFileSync(join(options.cwd, "dist", "sitemap-index.xml"), "<sitemapindex/>", "utf-8");
      }
      const stdout = command === "npm" && args[0] === "--version" ? "10.9.2\n" : "";
      return Promise.resolve({ stdout, stderr: "", durationMs: 1 });
    },
  };
}

/** A rendered-site report for the given render options, passing or failing one named check. */
export function renderedReport(
  options: RenderSiteOptions,
  failing?: { check: string; detail: string },
): RenderedSiteValidationReport {
  const status = failing ? ("FAIL" as const) : ("PASS" as const);
  const routes = options.routes.map((route) => ({
    route: route.slug,
    viewport: "desktop",
    url: `http://127.0.0.1:0${route.slug}`,
    http_status: 200,
    console_errors: [],
    failed_requests: [],
    checks: [
      failing
        ? { name: failing.check, status: "FAIL" as const, detail: failing.detail }
        : { name: "route_returns_success", status: "PASS" as const, detail: "HTTP 200" },
    ],
    status,
  }));
  return {
    schema: RENDERED_SITE_VALIDATION_SCHEMA,
    build_id: options.buildId,
    client_id: options.clientId,
    dist_dir: options.distDir,
    served_from: "http://127.0.0.1:0",
    rendered_at: "2026-11-06T00:00:00.000Z",
    browser: { engine: "chromium" },
    viewports: [{ name: "desktop", width: 1440, height: 900 }],
    site_checks: [],
    routes,
    summary: {
      routes: routes.length,
      renders: routes.length,
      passed: failing ? 0 : routes.length,
      failed: failing ? routes.length : 0,
    },
    status,
  };
}
