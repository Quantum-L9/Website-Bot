// L9_META: layer=validation, role=site_quality_runner, status=active, version=1.0.0
//
// Runs the rendered-site quality checks over a built site: serves the dist,
// renders every route in headless Chromium (extract-page.ts) and applies the
// deterministic checks (checks.ts). Shared by the CLI
// (scripts/quality/check-site.ts) and the pipeline's site-quality stage, so
// both judge a site by exactly the same rules.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildReport,
  DEFAULT_OPTIONS,
  type SiteQualityOptions,
  type SiteQualityReport,
} from "./checks.js";
import { type BrowserLike, discoverRoutes, extractSite, serveDirectory } from "./extract-page.js";

export interface CheckInvocation {
  dist?: string;
  url?: string;
  pages?: string[];
  businessName: string;
  reportPath: string;
  options?: Partial<Omit<SiteQualityOptions, "businessName">>;
}

export async function launchChromium(): Promise<{ browser: BrowserLike; close(): Promise<void> }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  return {
    browser: {
      newPage: async (options) => {
        const page = await browser.newPage(options);
        return {
          goto: (target, gotoOptions) => page.goto(target, gotoOptions),
          evaluate: <T>(source: string) => page.evaluate(source) as Promise<T>,
          close: () => page.close(),
        };
      },
    },
    close: () => browser.close(),
  };
}

/** Run one check; a run outcome is reported, never thrown. */
export async function runSiteQuality(
  invocation: CheckInvocation,
  launch: () => Promise<{ browser: BrowserLike; close(): Promise<void> }> = launchChromium,
): Promise<SiteQualityReport> {
  const options: SiteQualityOptions = {
    ...DEFAULT_OPTIONS,
    ...invocation.options,
    businessName: invocation.businessName,
  };
  const target = invocation.dist ?? invocation.url ?? "";
  const errors: string[] = [];
  let pages: Awaited<ReturnType<typeof extractSite>> = [];
  let server: { url: string; close(): Promise<void> } | undefined;
  let session: { browser: BrowserLike; close(): Promise<void> } | undefined;
  try {
    let routes = invocation.pages;
    let baseUrl = invocation.url;
    if (invocation.dist) {
      if (!existsSync(resolve(invocation.dist, "index.html")))
        throw new Error(`no built site at ${invocation.dist} (index.html missing)`);
      routes ??= discoverRoutes(invocation.dist);
      server = await serveDirectory(invocation.dist);
      baseUrl = server.url;
    }
    if (!routes?.length || !baseUrl) throw new Error("no routes to check");
    session = await launch();
    pages = await extractSite(session.browser, baseUrl, routes);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await session?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
  const report = buildReport(target, pages, options, errors);
  mkdirSync(dirname(invocation.reportPath), { recursive: true });
  writeFileSync(invocation.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return report;
}
