// L9_META: layer=script, role=site_quality_checker_cli, status=active, version=1.0.0
//
// Rendered-site quality checker. Renders every route of a built site in
// headless Chromium and applies the deterministic checks in
// site-quality-checks.ts. Writes a machine-readable report and exits:
//
//   0 PASS     every page rendered and no check failed
//   1 FAIL     at least one check failed (findings name page, check, evidence)
//   2 BLOCKED  the site could not be judged (no dist, no browser, no pages)
//
// Usage:
//   npx tsx scripts/quality/check-site.ts --dist <dir> [--spec <domain-spec.yaml>]
//     [--business-name <name>] [--pages /,/about] [--report <path>]
//   npx tsx scripts/quality/check-site.ts --url <https://site> --pages /,/about ...
//
// The business name comes from --business-name or the spec's business_name;
// it is required (the business-name heading and cross-client checks need it).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { type BrowserLike, discoverRoutes, extractSite, serveDirectory } from "./extract-page.js";
import {
  buildReport,
  DEFAULT_OPTIONS,
  type SiteQualityOptions,
  type SiteQualityReport,
} from "./site-quality-checks.js";

export const EXIT_CODES = { PASS: 0, FAIL: 1, BLOCKED: 2 } as const;

export interface CheckInvocation {
  dist?: string;
  url?: string;
  pages?: string[];
  businessName: string;
  reportPath: string;
  options?: Partial<Omit<SiteQualityOptions, "businessName">>;
}

function flag(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

export function businessNameFromSpec(specPath: string): string | undefined {
  const parsed = parse(readFileSync(specPath, "utf-8")) as Record<string, unknown> | null;
  const root = (parsed?.domain_spec as Record<string, unknown> | undefined) ?? parsed ?? {};
  const name = root.business_name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

export function parseArgs(argv: string[]): CheckInvocation {
  const dist = flag(argv, "dist");
  const url = flag(argv, "url");
  if (!dist === !url) throw new Error("exactly one of --dist or --url is required");
  const spec = flag(argv, "spec");
  const businessName =
    flag(argv, "business-name") ?? (spec ? businessNameFromSpec(spec) : undefined);
  if (!businessName) throw new Error("--business-name or a --spec with business_name is required");
  const pages = flag(argv, "pages")
    ?.split(",")
    .map((page) => page.trim())
    .filter(Boolean)
    .map((page) => (page.startsWith("/") ? page : `/${page}`));
  if (url && !pages?.length) throw new Error("--url needs --pages");
  return {
    ...(dist ? { dist: resolve(dist) } : {}),
    ...(url ? { url } : {}),
    ...(pages?.length ? { pages } : {}),
    businessName,
    reportPath: resolve(flag(argv, "report") ?? "build/site-quality/report.json"),
  };
}

async function launchChromium(): Promise<{ browser: BrowserLike; close(): Promise<void> }> {
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

async function cli(): Promise<void> {
  let invocation: CheckInvocation;
  try {
    invocation = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`site-quality: ${error instanceof Error ? error.message : String(error)}`);
    console.log("STATUS: BLOCKED");
    process.exitCode = EXIT_CODES.BLOCKED;
    return;
  }
  const report = await runSiteQuality(invocation);
  for (const page of report.pages)
    console.log(
      `${page.path}: HTTP ${page.status}, ${page.words}/${page.floor} words, ${page.findings} finding(s)`,
    );
  for (const finding of report.findings)
    console.log(
      `[${finding.severity.toUpperCase()}] ${finding.check} ${finding.page}: ${finding.detail}${finding.evidence ? ` — "${finding.evidence}"` : ""}`,
    );
  for (const error of report.errors) console.error(`error: ${error}`);
  console.log(`site-quality report: ${invocation.reportPath}`);
  console.log(`STATUS: ${report.status}`);
  process.exitCode = EXIT_CODES[report.status];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await cli();
