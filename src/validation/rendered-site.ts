// L9_META: layer=validation, role=rendered_site_validation, status=active, version=1.0.0
//
// A production build is not terminal success (RAW_INPUT_TO_RENDERED_SITE).
// `astro build` proves the source compiles and emits route files; it says
// nothing about whether those routes RENDER: a hydration error, a missing
// asset, a broken nav link, an empty <h1>, or a layout that overflows on a
// phone all ship through a green build. This module serves the built dist/
// from a loopback static server and renders every route at every declared
// viewport in a real Chromium, collecting the checks into a machine-readable
// report. It never mutates the site.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { distPathForRoute, normalizeRouteSlug } from "./validate-generated-site.js";

export const RENDERED_SITE_VALIDATION_SCHEMA = "website-bot.rendered-site-validation/v1" as const;

export interface RenderViewport {
  name: string;
  width: number;
  height: number;
}

/** Desktop + mobile are the floor; a spec may add breakpoints later. */
export const DEFAULT_RENDER_VIEWPORTS: readonly RenderViewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

export type RenderCheckStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface RenderCheck {
  name: string;
  status: RenderCheckStatus;
  detail: string;
}

export interface RouteRenderResult {
  route: string;
  viewport: string;
  url: string;
  http_status: number;
  screenshot_path?: string;
  console_errors: string[];
  failed_requests: string[];
  checks: RenderCheck[];
  status: "PASS" | "FAIL";
}

export interface RenderedSiteValidationReport {
  schema: typeof RENDERED_SITE_VALIDATION_SCHEMA;
  build_id: string;
  client_id: string;
  dist_dir: string;
  served_from: string;
  rendered_at: string;
  browser: { engine: "chromium"; version?: string };
  viewports: RenderViewport[];
  site_checks: RenderCheck[];
  routes: RouteRenderResult[];
  summary: { routes: number; renders: number; passed: number; failed: number };
  status: "PASS" | "FAIL";
}

export interface RenderRouteSpec {
  slug: string;
  title: string;
  noindex?: boolean;
}

export interface RenderSiteOptions {
  buildId: string;
  clientId: string;
  distDir: string;
  routes: RenderRouteSpec[];
  viewports?: readonly RenderViewport[];
  screenshotDir: string;
  navigationTimeoutMs?: number;
}

export interface SiteRenderer {
  render(options: RenderSiteOptions): Promise<RenderedSiteValidationReport>;
}

/* ------------------------------------------------------------------ */
/* Loopback static server for dist/                                   */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Resolve a request path to a file inside dist/, or undefined (404). */
export function resolveDistFile(distDir: string, requestPath: string): string | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(requestPath.split("?")[0].split("#")[0]);
  } catch {
    return undefined;
  }
  const root = resolve(distDir);
  const candidates = pathname.endsWith("/")
    ? [join(pathname, "index.html")]
    : [pathname, join(pathname, "index.html"), `${pathname}.html`];
  for (const candidate of candidates) {
    const absolute = resolve(root, `.${candidate}`);
    if (absolute !== root && !absolute.startsWith(root + sep)) continue;
    if (existsSync(absolute) && statSync(absolute).isFile()) return absolute;
  }
  return undefined;
}

export class StaticDistServer {
  private server: Server | undefined;

  async start(distDir: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const server = createServer((request, response) => {
      const file = resolveDistFile(distDir, request.url ?? "/");
      if (!file) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      response.end(readFileSync(file));
    });
    this.server = server;
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("static server has no port");
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      close: () =>
        new Promise<void>((resolvePromise) => {
          server.close(() => resolvePromise());
        }),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Route checks (pure over collected page facts)                       */
/* ------------------------------------------------------------------ */

/** Facts collected from a rendered page; the checks below are pure over these. */
export interface RenderedPageFacts {
  title: string;
  h1_count: number;
  h1_text: string;
  has_main: boolean;
  nav_link_count: number;
  meta_description: string;
  canonical: string;
  body_text_length: number;
  scroll_width: number;
  inner_width: number;
  images: Array<{ src: string; complete: boolean; natural_width: number; alt: string | null }>;
  internal_links: string[];
  json_ld_blocks: string[];
}

export function evaluateRouteFacts(
  facts: RenderedPageFacts,
  httpStatus: number,
  consoleErrors: string[],
  failedRequests: string[],
  distDir: string,
  route: RenderRouteSpec,
): RenderCheck[] {
  const checks: RenderCheck[] = [];
  const push = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, status: ok ? "PASS" : "FAIL", detail });
  };
  push("route_returns_success", httpStatus === 200, `HTTP ${httpStatus}`);
  push(
    "title_present",
    facts.title.trim().length > 0,
    facts.title ? `title: ${facts.title}` : "no <title>",
  );
  push(
    "single_h1",
    facts.h1_count === 1,
    facts.h1_count === 1 ? `h1: ${facts.h1_text}` : `${facts.h1_count} <h1> elements`,
  );
  push("main_landmark", facts.has_main, facts.has_main ? "<main> present" : "no <main> landmark");
  push(
    "navigation_present",
    facts.nav_link_count > 0,
    `${facts.nav_link_count} primary nav link(s)`,
  );
  push(
    "final_content_present",
    facts.body_text_length >= 120,
    `${facts.body_text_length} characters of body text`,
  );
  push(
    "meta_description",
    facts.meta_description.trim().length > 0,
    facts.meta_description ? "present" : "missing",
  );
  push("canonical_tag", facts.canonical.trim().length > 0, facts.canonical || "missing");
  push(
    "no_horizontal_overflow",
    facts.scroll_width <= facts.inner_width + 1,
    `scrollWidth ${facts.scroll_width} vs innerWidth ${facts.inner_width}`,
  );
  const brokenImages = facts.images.filter((image) => !image.complete || image.natural_width === 0);
  push(
    "images_loaded",
    brokenImages.length === 0,
    facts.images.length === 0
      ? "no images on route"
      : brokenImages.length === 0
        ? `${facts.images.length} image(s) loaded`
        : `broken: ${brokenImages.map((image) => image.src).join(", ")}`,
  );
  const missingAlt = facts.images.filter((image) => image.alt === null);
  push(
    "images_have_alt",
    missingAlt.length === 0,
    missingAlt.length === 0
      ? "every image carries alt"
      : `${missingAlt.length} image(s) without alt`,
  );
  const unresolved = facts.internal_links.filter((href) => {
    const path = href.split("?")[0].split("#")[0];
    if (!path || path === "/") return false;
    return resolveDistFile(distDir, path) === undefined;
  });
  push(
    "internal_links_resolve",
    unresolved.length === 0,
    unresolved.length === 0
      ? `${facts.internal_links.length} internal link(s) resolve`
      : `unresolved: ${[...new Set(unresolved)].join(", ")}`,
  );
  const badJsonLd = facts.json_ld_blocks.filter((block) => {
    try {
      JSON.parse(block);
      return false;
    } catch {
      return true;
    }
  });
  push(
    "structured_data_parses",
    badJsonLd.length === 0,
    `${facts.json_ld_blocks.length} JSON-LD block(s), ${badJsonLd.length} malformed`,
  );
  push(
    "no_console_errors",
    consoleErrors.length === 0,
    consoleErrors.length === 0 ? "clean console" : consoleErrors.slice(0, 5).join(" | "),
  );
  push(
    "no_failed_requests",
    failedRequests.length === 0,
    failedRequests.length === 0
      ? "every same-origin request succeeded"
      : failedRequests.slice(0, 5).join(", "),
  );
  if (route.noindex) {
    checks.push({ name: "noindex_route", status: "PASS", detail: "route declared noindex" });
  }
  return checks;
}

export function evaluateSiteChecks(distDir: string): RenderCheck[] {
  const checks: RenderCheck[] = [];
  const robots = resolveDistFile(distDir, "/robots.txt");
  checks.push({
    name: "robots_txt",
    status: robots ? "PASS" : "FAIL",
    detail: robots ? "present" : "dist/robots.txt missing",
  });
  const sitemap = resolveDistFile(distDir, "/sitemap-index.xml");
  checks.push({
    name: "sitemap_index",
    status: sitemap ? "PASS" : "FAIL",
    detail: sitemap ? "present" : "dist/sitemap-index.xml missing",
  });
  return checks;
}

/* ------------------------------------------------------------------ */
/* Playwright renderer                                                 */
/* ------------------------------------------------------------------ */

const PAGE_FACTS_SCRIPT = `() => {
  const h1s = Array.from(document.querySelectorAll("h1"));
  const nav = document.querySelector("nav[aria-label='Primary'], header nav, nav");
  const meta = document.querySelector("meta[name='description']");
  const canonical = document.querySelector("link[rel='canonical']");
  return {
    title: document.title || "",
    h1_count: h1s.length,
    h1_text: (h1s[0]?.textContent || "").trim().slice(0, 200),
    has_main: Boolean(document.querySelector("main, #main-content")),
    nav_link_count: nav ? nav.querySelectorAll("a[href]").length : 0,
    meta_description: meta ? meta.getAttribute("content") || "" : "",
    canonical: canonical ? canonical.getAttribute("href") || "" : "",
    body_text_length: (document.body?.innerText || "").replace(/\\s+/g, " ").trim().length,
    scroll_width: document.documentElement.scrollWidth,
    inner_width: window.innerWidth,
    images: Array.from(document.images).map((image) => ({
      src: image.getAttribute("src") || "",
      complete: image.complete,
      natural_width: image.naturalWidth,
      alt: image.hasAttribute("alt") ? image.getAttribute("alt") : null,
    })),
    internal_links: Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => anchor.getAttribute("href") || "")
      .filter((href) => href.startsWith("/") && !href.startsWith("//")),
    json_ld_blocks: Array.from(document.querySelectorAll("script[type='application/ld+json']")).map(
      (script) => script.textContent || "",
    ),
  };
}`;

function safeName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
}

type Browser = {
  version(): string;
  newContext(options: { viewport: { width: number; height: number } }): Promise<BrowserContext>;
  close(): Promise<void>;
};
type BrowserContext = {
  newPage(): Promise<Page>;
  close(): Promise<void>;
};
type Page = {
  on(event: string, handler: (payload: never) => void): void;
  goto(url: string, options?: unknown): Promise<{ status(): number } | null>;
  evaluate<T>(script: string): Promise<T>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  close(): Promise<void>;
};

/**
 * Renders every route × viewport in headless Chromium via a runtime
 * `playwright` specifier (same technique as ScreenshotCapturer), so the
 * module typechecks and imports without the browser package; an absent
 * browser is a typed failure at render time, never a silent skip.
 */
export class PlaywrightSiteRenderer implements SiteRenderer {
  constructor(private readonly server: StaticDistServer = new StaticDistServer()) {}

  async render(options: RenderSiteOptions): Promise<RenderedSiteValidationReport> {
    const specifier = "playwright";
    let mod: { chromium?: { launch(options?: unknown): Promise<Browser> } };
    try {
      mod = (await import(specifier)) as typeof mod;
    } catch (error) {
      throw new Error(
        `browser unavailable: the playwright package could not be loaded (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    if (!mod.chromium) throw new Error("browser unavailable: playwright exposes no chromium");

    const viewports = [...(options.viewports ?? DEFAULT_RENDER_VIEWPORTS)];
    const served = await this.server.start(options.distDir);
    const browser = await mod.chromium.launch({ headless: true });
    mkdirSync(options.screenshotDir, { recursive: true });
    const routes: RouteRenderResult[] = [];
    try {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
        });
        try {
          for (const route of options.routes) {
            routes.push(await this.renderRoute(context, served.baseUrl, options, route, viewport));
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
      await served.close();
    }
    const siteChecks = evaluateSiteChecks(options.distDir);
    const failed = routes.filter((entry) => entry.status === "FAIL").length;
    const siteFailed = siteChecks.some((check) => check.status === "FAIL");
    return {
      schema: RENDERED_SITE_VALIDATION_SCHEMA,
      build_id: options.buildId,
      client_id: options.clientId,
      dist_dir: options.distDir,
      served_from: served.baseUrl,
      rendered_at: new Date().toISOString(),
      browser: { engine: "chromium", version: browser.version() },
      viewports,
      site_checks: siteChecks,
      routes,
      summary: {
        routes: options.routes.length,
        renders: routes.length,
        passed: routes.length - failed,
        failed,
      },
      status: failed === 0 && !siteFailed ? "PASS" : "FAIL",
    };
  }

  private async renderRoute(
    context: BrowserContext,
    baseUrl: string,
    options: RenderSiteOptions,
    route: RenderRouteSpec,
    viewport: RenderViewport,
  ): Promise<RouteRenderResult> {
    const slug = normalizeRouteSlug(route.slug);
    const url = `${baseUrl}${slug === "/" ? "/" : `${slug}/`}`;
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message: { type(): string; text(): string }) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error: Error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });
    page.on(
      "requestfailed",
      (request: { url(): string; failure(): { errorText: string } | null }) => {
        if (request.url().startsWith(baseUrl))
          failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? "failed"})`);
      },
    );
    page.on("response", (response: { url(): string; status(): number }) => {
      if (response.url().startsWith(baseUrl) && response.status() >= 400)
        failedRequests.push(`${response.url()} (HTTP ${response.status()})`);
    });
    let httpStatus = 0;
    let facts: RenderedPageFacts | undefined;
    let screenshotPath: string | undefined;
    try {
      const response = await page.goto(url, {
        waitUntil: "load",
        timeout: options.navigationTimeoutMs ?? 30_000,
      });
      httpStatus = response?.status() ?? 0;
      facts = await page.evaluate<RenderedPageFacts>(PAGE_FACTS_SCRIPT);
      screenshotPath = resolve(
        options.screenshotDir,
        `${safeName(slug === "/" ? "home" : slug)}-${viewport.name}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch (error) {
      consoleErrors.push(
        `render failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await page.close();
    }
    const checks = facts
      ? evaluateRouteFacts(facts, httpStatus, consoleErrors, failedRequests, options.distDir, route)
      : [
          {
            name: "route_renders",
            status: "FAIL" as const,
            detail: consoleErrors.at(-1) ?? "page facts unavailable",
          },
        ];
    // The dist route file must exist regardless of how the server answered.
    const distFile = resolve(options.distDir, distPathForRoute(route.slug));
    checks.push({
      name: "route_exists_in_dist",
      status: existsSync(distFile) ? "PASS" : "FAIL",
      detail: distFile,
    });
    return {
      route: slug,
      viewport: viewport.name,
      url,
      http_status: httpStatus,
      screenshot_path: screenshotPath,
      console_errors: consoleErrors,
      failed_requests: failedRequests,
      checks,
      status: checks.some((check) => check.status === "FAIL") ? "FAIL" : "PASS",
    };
  }
}
