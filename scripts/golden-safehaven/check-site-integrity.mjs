#!/usr/bin/env node
/**
 * §16 SITE-INTEGRITY producer for the Safe Haven golden oracle.
 *
 * Scans the built site (dist/ directory) or a served URL and emits the
 * evidence file the receipt adapter consumes:
 *
 *   dist mode (default): node scripts/golden-safehaven/check-site-integrity.mjs \
 *     --case tests/golden/safehaven/case.json \
 *     --site-dir build/sites/<client>/dist \
 *     --out build/evidence/<client>/<build>/site-integrity.json
 *
 *   url mode:   ... --url https://candidate.example.com --out <path>
 *
 * Checks, per frozen case route:
 *   - reachable (http_status 200 in dist mode: file exists)
 *   - exactly one <h1>
 *   - <title>, meta description, canonical link, <html lang> present
 *   - unique titles and unique canonical URLs across the whole site
 *   - all internal links resolve (to a route file or an existing asset)
 *   - placeholder scan (the four frozen markers)
 *   - redirect relationships (url mode records the chain; dist mode records
 *     none — static files carry no server redirects)
 *
 * Deterministic: dist mode output is byte-identical for identical input
 * trees (no timestamps, stable ordering, sorted findings).
 */
import fs from "node:fs";
import path from "node:path";
import { compareCodeUnits, normalizeRoute, distPathForRoute } from "./lib/normalize.mjs";
import { stripTrailingSlashes } from "../../src/lib/text-trim.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : process.argv[i + 1];
}

const casePath = arg("case");
const siteDir = arg("site-dir");
const urlBase = arg("url");
const outPath = arg("out");
const allowExternal = arg("allow-external") === "true";

if (!casePath || !outPath || (!siteDir && !urlBase)) {
  console.error(
    "usage: node scripts/golden-safehaven/check-site-integrity.mjs --case <case.json> (--site-dir <dist> | --url <base>) --out <site-integrity.json>",
  );
  process.exit(2);
}

const testCase = JSON.parse(fs.readFileSync(path.resolve(casePath), "utf8"));
// Raw case routes (frozen order) are the identity emitted in per_route; the
// normalized form is used for dist-path resolution and matching.
const routes = Array.isArray(testCase.routes) ? testCase.routes.map(String) : [];
const routeEntries = routes.map((raw) => ({ raw, normalized: normalizeRoute(raw) }));

// ---- HTML parsing (deterministic, dependency-free) ----
function parseHtml(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1];
  const metaDesc =
    (html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    ) ?? [])[1] ??
    (html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    ) ?? [])[1];
  const canonical =
    (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i) ?? [])[1] ??
    (html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i) ?? [])[1];
  const lang = (html.match(/<html[^>]*\blang=["']([^"']*)["']/i) ?? [])[1];
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  const titleText = title?.trim() ?? "";
  const metaText = metaDesc?.trim() ?? "";
  const canonicalText = canonical ?? "";
  const langText = lang ?? "";
  return {
    title: titleText,
    meta_description: metaText,
    canonical: canonicalText,
    lang: langText,
    h1_count: h1Count,
    // presence booleans the golden oracle's site_integrity.per_route reads
    title_present: titleText !== "",
    meta_description_present: metaText !== "",
    canonical_present: canonicalText !== "",
    lang_present: langText !== "",
  };
}

const PLACEHOLDER_PATTERNS = [
  { patternId: "template-variable", regex: /\{\{\s*[A-Za-z_][\w.-]*\s*\}\}/ },
  { patternId: "double-underscore-placeholder", regex: /__PLACEHOLDER__/ },
  { patternId: "ejs-delimiter", regex: /<%[=-]?/ },
  { patternId: "replace-me", regex: /REPLACE_ME/ },
];

function scanPlaceholders(html) {
  const findings = [];
  for (const { patternId, regex } of PLACEHOLDER_PATTERNS) {
    const re = new RegExp(regex.source, "gi");
    let m;
    while ((m = re.exec(html)) !== null) findings.push({ pattern_id: patternId, match: m[0] });
  }
  return findings;
}

// ---- dist mode ----
function checkDist() {
  const root = path.resolve(siteDir);
  const perRoute = [];
  const broken = [];
  const redirects = [];
  for (const { raw, normalized } of routeEntries) {
    const rel = distPathForRoute(normalized);
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      perRoute.push({ route: raw, http_status: 404, file: rel });
      continue;
    }
    const html = fs.readFileSync(file, "utf8");
    const parsed = parseHtml(html);
    const placeholders = scanPlaceholders(html);
    // internal links: hrefs that are root-relative or relative (not scheme/mailto/tel/#)
    const hrefs = [...html.matchAll(/\bhref=["']([^"']*)["']/gi)].map((m) => m[1]);
    const internal = hrefs.filter(
      (h) => !/^(https?:|mailto:|tel:|sms:|javascript:|data:)/i.test(h) && h !== "#" && h !== "",
    );
    for (const href of internal) {
      const resolved = resolveInternalPath(href);
      if (!resolved) continue;
      if (!fs.existsSync(path.join(root, resolved))) {
        broken.push({ route: raw, href, expected_file: resolved });
      }
    }
    perRoute.push({ route: raw, http_status: 200, file: rel, ...parsed });
    for (const f of placeholders) broken.push({ route: raw, placeholder: f });
  }
  return { perRoute, broken, redirects, root };
}

function resolveInternalPath(href) {
  // strip query/hash, collapse the route path to the dist file layout
  const clean = href.split(/[?#]/)[0];
  if (!clean) return null;
  if (clean.endsWith("/")) return distPathForRoute(clean);
  // bare path without trailing slash: could be a route or a direct asset file
  if (clean.startsWith("/")) return clean.slice(1);
  return null;
}

// ---- url mode ----
async function checkUrl() {
  const base = stripTrailingSlashes(urlBase);
  const perRoute = [];
  const redirects = [];
  const broken = [];
  const statusCache = new Map();
  for (const { raw, normalized } of routeEntries) {
    const url = `${base}${normalized === "/" ? "/" : normalized}`;
    const res = await fetch(url, { redirect: "manual" });
    const chain = [];
    let current = res;
    let finalUrl = url;
    let finalRes = current;
    while (current.status >= 300 && current.status < 400 && current.headers.get("location")) {
      const loc = new URL(current.headers.get("location"), current.url).toString();
      chain.push(loc);
      current = await fetch(loc, { redirect: "manual" });
      finalUrl = loc;
      finalRes = current;
    }
    const status = finalRes.status;
    const text = status < 400 ? await finalRes.text() : "";
    const parsed = status < 400 ? parseHtml(text) : {};
    redirects.push({ route: raw, status: res.status, final_url: finalUrl, chain });
    perRoute.push({ route: raw, http_status: status, ...parsed });
    if (status < 400) {
      for (const href of collectInternalHrefs(text, finalUrl)) {
        const key = href.split(/[?#]/)[0];
        if (!key || statusCache.has(key)) continue;
        const target = new URL(href, finalUrl);
        const isSameOrigin = target.origin === new URL(finalUrl).origin;
        if (!isSameOrigin && !allowExternal) continue;
        const probe = await fetch(target, { redirect: "follow" });
        statusCache.set(key, probe.status);
      }
      for (const href of collectInternalHrefs(text, finalUrl)) {
        const key = href.split(/[?#]/)[0];
        if (!key) continue;
        const target = new URL(href, finalUrl);
        if (!allowExternal && target.origin !== new URL(finalUrl).origin) continue;
        if ((statusCache.get(key) ?? 0) >= 400) broken.push({ route: raw, href, status: statusCache.get(key) });
      }
    }
  }
  return { perRoute, broken, redirects, base };
}

function collectInternalHrefs(html, baseUrl) {
  const hrefs = [...html.matchAll(/\bhref=["']([^"']*)["']/gi)].map((m) => m[1]);
  return hrefs.filter(
    (h) => !/^(mailto:|tel:|sms:|javascript:|data:)/i.test(h) && h !== "#" && h !== "",
  );
}

// ---- shared aggregation ----
function aggregate(mode, { perRoute, broken, redirects }) {
  const brokenLinks = broken.filter((b) => b.href);
  const placeholderFindings = broken.filter((b) => b.placeholder);
  const reachable = perRoute.filter((r) => r.http_status === 200);
  const titles = reachable.map((r) => r.title).filter((t) => t !== "");
  const canonicals = reachable.map((r) => r.canonical).filter((c) => c !== "");
  const titleCounts = new Map();
  for (const t of titles) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
  const canonicalCounts = new Map();
  for (const c of canonicals) canonicalCounts.set(c, (canonicalCounts.get(c) ?? 0) + 1);
  const duplicateTitles = [...titleCounts].filter(([, n]) => n > 1).map(([t, n]) => ({ title: t, count: n }));
  const duplicateCanonicals = [...canonicalCounts]
    .filter(([, n]) => n > 1)
    .map(([c, n]) => ({ canonical: c, count: n }));
  return {
    schema: "website-bot.golden-site-integrity/v1",
    case_id: testCase.case_id,
    mode,
    routes: perRoute.map((r) => r.route),
    reachable_routes: reachable.length,
    broken_internal_links: brokenLinks.length,
    broken_link_targets: [
      ...new Set(brokenLinks.map((b) => `${b.route} -> ${b.href}`)),
    ].sort(compareCodeUnits),
    placeholder_count: placeholderFindings.length,
    placeholder_findings: placeholderFindings
      .map((f) => ({ route: f.route, ...f.placeholder }))
      .toSorted((a, b) => compareCodeUnits(a.route, b.route)),
    unique_titles: new Set(titles).size,
    unique_canonical_urls: new Set(canonicals).size,
    duplicate_titles: duplicateTitles.toSorted((a, b) => compareCodeUnits(a.title, b.title)),
    duplicate_canonicals: duplicateCanonicals.toSorted((a, b) =>
      compareCodeUnits(a.canonical, b.canonical),
    ),
    per_route: perRoute,
    redirects,
  };
}

const out = siteDir ? aggregate("dist", checkDist()) : await checkUrl().then((r) => aggregate("url", r));
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `site-integrity: ${out.routes.length} routes, ${out.reachable_routes} reachable, ` +
    `${out.broken_internal_links} broken links, ${out.placeholder_count} placeholders, ` +
    `${out.unique_titles}/${out.routes.length} unique titles, ${out.unique_canonical_urls}/${out.routes.length} unique canonicals`,
);
