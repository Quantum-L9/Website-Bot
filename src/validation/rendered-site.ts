// L9_META: layer=validation, role=rendered_site_validation, status=active, version=1.1.0
//
// A production build is not terminal success (RAW_INPUT_TO_RENDERED_SITE).
// `astro build` proves the source compiles and emits route files; it says
// nothing about whether those routes RENDER: a hydration error, a missing
// asset, a broken nav link, an empty <h1>, or a layout that overflows on a
// phone all ship through a green build. This module serves the built dist/
// from a loopback static server and renders every route at every declared
// viewport in a real Chromium, collecting the checks into a machine-readable
// report. It never mutates the site.
//
// When the caller hands it what the accepted artifacts require of a route
// (blueprint section order, the images each slot must show), every render is
// also compared against that requirement in the DOM: sections in order, each
// required image present in its own section, visible, decoded and unswapped.
// Responsive geometry (critical elements inside the viewport, headings not
// clipped, CTAs not covered) is checked on every render. Expectations come
// from accepted artifacts only, never from the rendered output itself.

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

/** One image an accepted artifact requires a route to show. */
export interface ExpectedRouteImage {
  /** Placement key (`<route>:<role>[#section]` or `global:logo`), rendered as data-image-slot. */
  slot: string;
  /** Published file the slot must show. */
  src: string;
  /** Blueprint section the image belongs to; absent for layout-owned images (the logo). */
  section_id?: string;
}

/** What the accepted artifacts require a route to render. */
export interface RouteVisualExpectation {
  /** Blueprint section ids in order; absent when no blueprint governs the route. */
  section_order?: string[];
  images: ExpectedRouteImage[];
}

export interface RenderRouteSpec {
  slug: string;
  title: string;
  noindex?: boolean;
  expect?: RouteVisualExpectation;
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
/**
 * Human-readable detail for the broken-image check: three states — nothing to
 * check, everything loaded, or the list that did not (typescript:S3358).
 */
function imageCheckDetail(imageCount: number, broken: ReadonlyArray<{ src: string }>): string {
  if (imageCount === 0) return "no images on route";
  if (broken.length === 0) return `${imageCount} image(s) loaded`;
  return `broken: ${broken.map((image) => image.src).join(", ")}`;
}

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
    imageCheckDetail(facts.images.length, brokenImages),
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

/** DOM facts about sections, slot images and responsive geometry (PAGE_VISUAL_FACTS_EXPRESSION). */
export interface RenderedVisualFacts {
  /** `data-section-id` of every section inside <main>, in document order. */
  sections: string[];
  slot_images: Array<{
    slot: string;
    src: string;
    /** Section the image renders in (`data-section-for` / `data-section-id` ancestor). */
    section_id: string | null;
    /** Laid out with a non-empty box, not hidden by display, visibility or opacity. */
    visible: boolean;
    decoded: boolean;
    /** Intersects the viewport once scrolled into view. */
    in_viewport: boolean;
  }>;
  /** Visible headings, buttons and nav links extending past the viewport's horizontal edges. */
  outside_viewport: string[];
  /** Headings whose text overflows their own box horizontally. */
  clipped_headings: string[];
  /** CTAs whose centre point is covered by another element. */
  obstructed_ctas: string[];
}

function describeImageFault(
  expected: ExpectedRouteImage,
  shown: RenderedVisualFacts["slot_images"],
): string | undefined {
  if (shown.length === 0) return `${expected.slot}: not rendered`;
  if (shown.length > 1) return `${expected.slot}: rendered ${shown.length} times`;
  const [image] = shown;
  if (expected.section_id !== undefined && image.section_id !== expected.section_id) {
    return `${expected.slot}: in section ${image.section_id ?? "(none)"}, expected ${expected.section_id}`;
  }
  if (image.src !== expected.src)
    return `${expected.slot}: shows ${image.src}, expected ${expected.src}`;
  if (!image.visible) return `${expected.slot}: not visible`;
  if (!image.in_viewport) return `${expected.slot}: never enters the viewport`;
  if (!image.decoded) return `${expected.slot}: did not load and decode`;
  return undefined;
}

/**
 * Compare a render's DOM against what the accepted artifacts require of the
 * route, plus responsive geometry. Pure over the collected facts; no image
 * count or text-length threshold is applied, so a text-only route the
 * blueprint gives no imagery passes.
 */
export function evaluateVisualFacts(
  facts: RenderedVisualFacts,
  expect: RouteVisualExpectation | undefined,
): RenderCheck[] {
  const checks: RenderCheck[] = [];
  const push = (name: string, faults: string[], ok: string): void => {
    checks.push({
      name,
      status: faults.length === 0 ? "PASS" : "FAIL",
      detail: faults.length === 0 ? ok : faults.slice(0, 8).join("; "),
    });
  };
  if (expect?.section_order) {
    const want = expect.section_order.join(" > ");
    const got = facts.sections.join(" > ");
    push(
      "blueprint_section_order",
      want === got ? [] : [`rendered ${got || "(no sections)"}, blueprint ${want}`],
      `${expect.section_order.length} section(s) in blueprint order`,
    );
  }
  if (expect) {
    const faults = expect.images.flatMap((expected) => {
      const fault = describeImageFault(
        expected,
        facts.slot_images.filter((image) => image.slot === expected.slot),
      );
      return fault ? [fault] : [];
    });
    push(
      "required_images_visible",
      faults,
      expect.images.length === 0
        ? "no imagery required on route"
        : `${expect.images.length} required image(s) visible in their sections`,
    );
  }
  push(
    "critical_elements_in_viewport",
    facts.outside_viewport,
    "headings, CTAs and navigation inside the viewport",
  );
  push("headings_not_clipped", facts.clipped_headings, "no heading overflows its box");
  push("cta_not_obstructed", facts.obstructed_ctas, "every CTA is clickable at its centre");
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

/**
 * Browser-side fact collector. Kept as source text so no transpiler helper can
 * leak into the page; the exported EXPRESSION below is what is evaluated.
 */
const PAGE_FACTS_FUNCTION = `() => {
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

/**
 * `page.evaluate(string)` evaluates the string as an EXPRESSION. A function
 * expression evaluates to the function object (serialized as undefined) and is
 * never called, so every route reported "page facts unavailable" in a real
 * browser (L2-S17-001). The collector is therefore invoked inside the
 * expression itself.
 */
export const PAGE_FACTS_EXPRESSION = `(${PAGE_FACTS_FUNCTION})()`;

/**
 * Browser-side collector for section identity, slot images and responsive
 * geometry. Each slot image is scrolled into view and given a bounded chance
 * to decode, so a lazy image below the fold is judged as a visitor would see
 * it. Read-only apart from scroll position, which it restores.
 */
const PAGE_VISUAL_FACTS_FUNCTION = `async () => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const main = document.querySelector("main, #main-content");
  const label = (element) => {
    const text = (element.textContent || "").replace(/s+/g, " ").trim().slice(0, 60);
    return element.tagName.toLowerCase() + (text ? ' "' + text + '"' : "");
  };
  const shown = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    if (
      typeof element.checkVisibility === "function" &&
      !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    ) {
      return false;
    }
    if (getComputedStyle(element).visibility !== "visible") return false;
    for (let node = element; node; node = node.parentElement) {
      if (Number(getComputedStyle(node).opacity) === 0) return false;
    }
    return true;
  };
  const settle = (image) =>
    image.complete && image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.race([
          image.decode().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
  const sections = main
    ? Array.from(main.querySelectorAll("[data-section-id]")).map(
        (element) => element.getAttribute("data-section-id") || "",
      )
    : [];
  const slotImages = [];
  for (const image of Array.from(document.querySelectorAll("img[data-image-slot]"))) {
    image.scrollIntoView({ block: "center", inline: "nearest" });
    await settle(image);
    const rect = image.getBoundingClientRect();
    const owner = image.closest("[data-section-for], [data-section-id]");
    slotImages.push({
      slot: image.getAttribute("data-image-slot") || "",
      src: image.getAttribute("src") || "",
      section_id: owner
        ? owner.getAttribute("data-section-for") || owner.getAttribute("data-section-id")
        : null,
      visible: shown(image),
      decoded: image.complete && image.naturalWidth > 0,
      in_viewport:
        rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth,
    });
  }
  const critical = Array.from(
    document.querySelectorAll("main h1, main h2, main a.btn, main button, nav[aria-label='Primary'] a"),
  ).filter(shown);
  const outside = critical.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < -1 || rect.right > viewportWidth + 1;
  });
  const clippedHeadings = critical
    .filter((element) => /^H[12]$/.test(element.tagName) && element.scrollWidth > element.clientWidth + 1)
    .map(label);
  const obstructedCtas = [];
  // A CTA already reported outside the viewport is not also reported as covered.
  const ctas = critical.filter(
    (element) => element.matches("main a.btn, main button") && !outside.includes(element),
  );
  for (const cta of ctas) {
    cta.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = cta.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || (hit !== cta && !cta.contains(hit))) obstructedCtas.push(label(cta));
  }
  window.scrollTo(0, 0);
  return {
    sections,
    slot_images: slotImages,
    outside_viewport: outside.map(label),
    clipped_headings: clippedHeadings,
    obstructed_ctas: obstructedCtas,
  };
}`;

/**
 * Give every image a bounded chance to load before facts are read. A lazy
 * image below the fold has not started loading when `load` fires, so reading
 * `complete` at once reported a healthy image as broken depending on scroll
 * distance and timing. Each pending image is scrolled into view (starting a
 * lazy load) and awaited until it loads or errors, capped overall; a broken
 * file still errors and is still reported by images_loaded.
 */
const SETTLE_IMAGES_FUNCTION = `async () => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const pending = Array.from(document.images).filter((image) => !image.complete);
  for (const image of pending) {
    image.scrollIntoView({ block: "center", inline: "nearest" });
    await frame();
  }
  await Promise.race([
    Promise.all(
      pending.map((image) =>
        image.complete
          ? undefined
          : new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            }),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  window.scrollTo(0, 0);
  return pending.length;
}`;

export const SETTLE_IMAGES_EXPRESSION = `(${SETTLE_IMAGES_FUNCTION})()`;

/** Evaluated expression (see PAGE_FACTS_EXPRESSION): resolves to RenderedVisualFacts. */
export const PAGE_VISUAL_FACTS_EXPRESSION = `(${PAGE_VISUAL_FACTS_FUNCTION})()`;

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
    let browser: Browser;
    try {
      browser = await mod.chromium.launch({ headless: true });
    } catch (error) {
      // A failed launch must not leak the loopback server: an open listener
      // keeps the process alive after the typed failure below is reported.
      await served.close();
      throw error;
    }
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
    let visual: RenderedVisualFacts | undefined;
    let visualError: string | undefined;
    let screenshotPath: string | undefined;
    try {
      const response = await page.goto(url, {
        waitUntil: "load",
        timeout: options.navigationTimeoutMs ?? 30_000,
      });
      httpStatus = response?.status() ?? 0;
      await page.evaluate<number>(SETTLE_IMAGES_EXPRESSION);
      facts = await page.evaluate<RenderedPageFacts>(PAGE_FACTS_EXPRESSION);
      screenshotPath = resolve(
        options.screenshotDir,
        `${safeName(slug === "/" ? "home" : slug)}-${viewport.name}.png`,
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });
      try {
        visual = await page.evaluate<RenderedVisualFacts>(PAGE_VISUAL_FACTS_EXPRESSION);
      } catch (error) {
        visualError = error instanceof Error ? error.message : String(error);
      }
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
    if (facts) {
      // A route whose layout could not be inspected is not a passing route.
      if (visual) checks.push(...evaluateVisualFacts(visual, route.expect));
      else
        checks.push({
          name: "visual_facts_collected",
          status: "FAIL",
          detail: visualError ?? "visual facts unavailable",
        });
    }
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
