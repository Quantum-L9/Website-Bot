// L9_META: layer=script, role=site_quality_extractor, status=active, version=1.0.0
//
// Renders a built site (a dist directory served locally, or a live URL) in
// headless Chromium and extracts the page model the deterministic checks in
// site-quality-checks.ts judge. Extraction reads the RENDERED DOM: collapsed
// <details> are opened and lazy images forced eager first, so the model is
// what a visitor can see, not what the source happened to contain.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import type { ImageModel, PageModel } from "./site-quality-checks.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

/** A URL or path without trailing slashes (no regex: linear on any input). */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/** Resolve a request path to a file inside root, Astro-style (dir → index.html). */
export function resolveStaticFile(root: string, urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    return undefined;
  }
  const candidate = resolve(root, `.${normalize(decoded)}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return undefined;
  for (const path of [candidate, join(candidate, "index.html"), `${candidate}.html`]) {
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return undefined;
}

/** A loopback static server for a dist directory. */
export async function serveDirectory(
  root: string,
): Promise<{ url: string; close(): Promise<void> }> {
  const base = resolve(root);
  const server: Server = createServer((request, response) => {
    const file = resolveStaticFile(base, request.url ?? "/");
    if (!file) {
      const notFound = resolveStaticFile(base, "/404.html");
      response.writeHead(404, { "content-type": CONTENT_TYPES[".html"] });
      response.end(notFound ? readFileSync(notFound) : "Not found");
      return;
    }
    const body = readFileSync(file);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(body.length),
    });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Every built route in a dist directory: each index.html, plus top-level *.html. */
export function discoverRoutes(distDir: string): string[] {
  const root = resolve(distDir);
  const routes = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith("_") || entry.name === "assets") continue;
        walk(path);
      } else if (entry.name === "index.html") {
        const rel = relative(root, dir).split(sep).join("/");
        routes.add(rel ? `/${rel}` : "/");
      } else if (dir === root && entry.name.endsWith(".html") && entry.name !== "404.html") {
        routes.add(`/${entry.name.slice(0, -".html".length)}`);
      }
    }
  };
  walk(root);
  const rest = [...routes].filter((route) => route !== "/");
  rest.sort((a, b) => a.localeCompare(b));
  return routes.has("/") ? ["/", ...rest] : rest;
}

/**
 * In-page extraction, passed to page.evaluate as SOURCE TEXT: a transpiled
 * function could carry bundler helpers that do not exist in the page.
 */
export const EXTRACT_SOURCE = String.raw`(async () => {
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (el.closest("[hidden],[aria-hidden='true']")) return false;
    const rect = el.getBoundingClientRect();
    const srOnly = rect.width <= 1 && rect.height <= 1;
    return !srOnly;
  };
  // Controls are judged even when they collapse to nothing: an empty link is
  // still focusable and announced, so only display/visibility hide it.
  const rendered = (el) => {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !el.closest("[hidden]");
  };
  const text = (el) => (el.innerText || "").replace(/\s+/g, " ").trim();
  for (const details of document.querySelectorAll("details")) details.open = true;
  const images = [...document.querySelectorAll("img")];
  for (const img of images) img.loading = "eager";
  await Promise.all(images.map((img) => (img.complete ? null : img.decode().catch(() => null))));
  await new Promise((done) => setTimeout(done, 50));

  const chrome = "header, nav, footer, .site-header, .site-footer";
  const main = document.querySelector("main") || document.body;
  const heroOf = (el) => el.closest("[data-section^='hero'], .hero, [data-section='masthead']");

  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter(visible)
    .map((el) => ({ level: Number(el.tagName.slice(1)), text: text(el), inHero: Boolean(heroOf(el)) }))
    .filter((heading) => heading.text);

  const paragraphs = [...main.querySelectorAll("p, blockquote, dd, li")]
    .filter((el) => visible(el) && !el.closest(chrome) && !el.closest("summary"))
    .filter((el) => !(el.tagName === "LI" && el.querySelector("p, li")))
    .filter((el) => !(el.tagName !== "LI" && el.closest("li")) || el.tagName === "P")
    .map(text)
    .filter(Boolean);

  const labelSelector = "[class*='eyebrow'],[class*='kicker'],[class*='overline'],[class*='badge'],[class*='label'],[class*='tag']";
  const labels = [...document.querySelectorAll(labelSelector)]
    .filter((el) => visible(el) && !el.matches("label, input, a, button") && !el.closest("form"))
    .map(text)
    .filter((value) => value && value.split(" ").length <= 6);

  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const joined = labelledby.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((node) => node.textContent.trim()).join(" ");
      if (joined) return joined;
    }
    const title = el.getAttribute("title");
    if (title && title.trim()) return title.trim();
    const img = [...el.querySelectorAll("img[alt], svg title")].map((node) => node.getAttribute ? (node.getAttribute("alt") || node.textContent) : node.textContent).find((value) => value && value.trim());
    if (img) return img.trim();
    if (el.tagName === "INPUT") return (el.value || "").trim();
    return "";
  };
  const controls = [...document.querySelectorAll("a[href], button, input[type=submit], input[type=button], [role=button]")]
    .filter(rendered)
    .map((el) => ({
      text: el.tagName === "INPUT" ? (el.value || "").trim() : text(el),
      accessibleName: nameOf(el),
      ...(el.tagName === "A" ? { href: el.getAttribute("href") || "" } : {}),
      inNav: Boolean(el.closest("nav, [role=navigation]")),
    }));

  const faqs = [];
  for (const details of document.querySelectorAll("details")) {
    const summary = details.querySelector("summary");
    if (!summary || !visible(details)) continue;
    const question = text(summary);
    const answer = (details.textContent || "").replace(summary.textContent || "", "").replace(/\s+/g, " ").trim();
    faqs.push({ question, answer });
  }
  for (const dt of document.querySelectorAll("dl dt")) {
    if (!visible(dt) || dt.closest("details")) continue;
    let dd = dt.nextElementSibling;
    while (dd && dd.tagName !== "DD" && dd.tagName !== "DT") dd = dd.nextElementSibling;
    faqs.push({ question: text(dt), answer: dd && dd.tagName === "DD" ? text(dd) : "" });
  }

  const imageModels = images
    .filter((img) => visible(img) || img.naturalWidth === 0)
    .map((img) => ({
      src: img.currentSrc || (img.getAttribute("src") ? new URL(img.getAttribute("src"), location.href).href : ""),
      alt: img.hasAttribute("alt") ? img.getAttribute("alt") : null,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    }));

  const clone = main.cloneNode(true);
  for (const node of clone.querySelectorAll(chrome)) node.remove();
  document.body.appendChild(clone);
  clone.style.position = "absolute";
  clone.style.left = "-99999px";
  const mainText = text(clone);
  clone.remove();

  return {
    title: document.title || "",
    headings,
    paragraphs,
    controls,
    faqs,
    images: imageModels,
    labels,
    mainText,
    fullText: text(document.body),
  };
})()`;

interface RawPage extends Omit<PageModel, "path" | "status" | "images"> {
  images: Array<Omit<ImageModel, "bytes" | "status">>;
}

export interface BrowserLike {
  newPage(options?: { viewport?: { width: number; height: number } }): Promise<{
    goto(
      url: string,
      options: { waitUntil: "load"; timeout: number },
    ): Promise<{ status(): number } | null>;
    evaluate<T>(source: string): Promise<T>;
    close(): Promise<void>;
  }>;
}

/** Measure an image the page referenced: HTTP status and byte size. */
async function measureImage(
  src: string,
  cache: Map<string, { status: number | null; bytes: number | null }>,
): Promise<{ status: number | null; bytes: number | null }> {
  const cached = cache.get(src);
  if (cached) return cached;
  let result: { status: number | null; bytes: number | null } = { status: null, bytes: null };
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",");
    const payload = comma === -1 ? "" : src.slice(comma + 1);
    result = {
      status: 200,
      bytes: src.slice(0, comma).includes(";base64")
        ? Math.floor((payload.length * 3) / 4)
        : payload.length,
    };
  } else if (/^https?:/.test(src)) {
    try {
      const response = await fetch(src);
      const body = await response.arrayBuffer();
      result = { status: response.status, bytes: body.byteLength };
    } catch {
      result = { status: 0, bytes: null };
    }
  }
  cache.set(src, result);
  return result;
}

/** Render every route and extract its page model. */
export async function extractSite(
  browser: BrowserLike,
  baseUrl: string,
  routes: string[],
): Promise<PageModel[]> {
  const pages: PageModel[] = [];
  const imageCache = new Map<string, { status: number | null; bytes: number | null }>();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    for (const route of routes) {
      const url = `${trimTrailingSlashes(baseUrl)}${route}`;
      const response = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
      const status = response?.status() ?? 0;
      const raw = await page.evaluate<RawPage>(EXTRACT_SOURCE);
      const images: ImageModel[] = [];
      for (const image of raw.images)
        images.push({ ...image, ...(await measureImage(image.src, imageCache)) });
      pages.push({ ...raw, images, path: route, status });
    }
  } finally {
    await page.close();
  }
  return pages;
}
