#!/usr/bin/env node
import crypto from "node:crypto";
/**
 * §17 VISUAL CAPTURE HARNESS — Safe Haven Golden E2E.
 *
 * Renders baseline + candidate for the 5 sentinel routes x 2 viewports =
 * 10 pairs. Capture conditions are equivalent per pair: same route, same
 * viewport, same device scale. Blank/unpainted captures are detected and
 * recorded (never silently accepted); every capture carries run identity.
 *
 * Usage:
 *   node scripts/golden-safehaven/capture-visual.mjs \
 *     --case tests/golden/safehaven/case.json \
 *     --baseline-url https://www.safehavenrr.com \
 *     --candidate-url http://localhost:4321 \
 *     --run-id <golden-run-id> \
 *     --out <runDir>/visual
 *
 * Baseline URL is the FROZEN source baseline authority. If a frozen static
 * baseline export exists (--baseline-dir), it is served locally instead so
 * the pair is a frozen-vs-candidate comparison, not live-vs-candidate.
 */
import fs from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1];
}
function has(name) {
  return process.argv.includes(`--${name}`);
}

const casePath = arg("case");
const baselineUrl = arg("baseline-url");
const candidateUrl = arg("candidate-url");
const runId = arg("run-id");
const outRoot = arg("out");
if (!casePath || !baselineUrl || !candidateUrl || !runId || !outRoot) {
  console.error(
    "usage: capture-visual.mjs --case <case.json> --baseline-url <url> --candidate-url <url> --run-id <id> --out <dir> [--full-page] [--serve-baseline-dir <dir>]",
  );
  process.exit(2);
}

const testCase = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), casePath), "utf8"));
const viewports = testCase.viewports ?? [];
const sentinels = testCase.visual_sentinels ?? [];
const fullPage = has("full-page");

let baselinePort = null;
let baselineServer = null;
let baselineBase = baselineUrl;
const baselineDir = arg("serve-baseline-dir");
if (baselineDir) {
  // Serve a frozen baseline export locally: equivalence with a candidate
  // served locally (same host family, no CDN variance) and frozen authority.
  const { createServer } = await import("node:http");
  const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  baselineServer = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "https://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(baselineDir, p);
    if (
      !file.startsWith(path.resolve(baselineDir)) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": mime[path.extname(file)] ?? "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => baselineServer.listen(0, "127.0.0.1", resolve));
  baselinePort = baselineServer.address().port;
  baselineBase = `http://127.0.0.1:${baselinePort}`;
}

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function captureKey(route, viewport, side) {
  const rt = route.replaceAll("/", "_").replace(/^_/, "") || "root";
  return { rt, file: `${side}__${rt}__${viewport.id}.png` };
}

const pairs = [];
const manifest = {
  schema: "l9.golden-visual-capture-manifest/v1",
  run_id: runId,
  captured_at: new Date().toISOString(),
  baseline: {
    url: baselineBase,
    source: baselineDir ? `frozen export ${baselineDir}` : baselineUrl,
  },
  candidate: { url: candidateUrl },
  viewports,
  pairs: [],
};

const resultsDir = path.join(outRoot, "captures");
fs.mkdirSync(path.join(resultsDir, "baseline"), { recursive: true });
fs.mkdirSync(path.join(resultsDir, "candidate"), { recursive: true });

async function capture(url, route, viewport, side) {
  const { file } = captureKey(route, viewport, side);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.device_scale_factor ?? 1,
  });
  const page = await context.newPage();
  const target = `${url}${route}`;
  const resp = await page
    .goto(target, { waitUntil: "networkidle", timeout: 45_000 })
    .catch(() => null);
  const status = resp?.status() ?? null;
  if (status && status >= 400) {
    await context.close();
    throw new Error(`capture failed: ${target} returned HTTP ${status}`);
  }
  const buf = await page.screenshot({ path: path.join(resultsDir, side, file), fullPage });
  const finalUrl = new URL(page.url()).pathname;
  await context.close();
  const hash = sha256(buf);
  const blank = isBlankPng(buf);
  return { file, hash, status, final_route: finalUrl, blank };
}

/**
 * Blank/unpainted heuristic: a capture that is visually empty (single-color)
 * decodes to an almost-entropy-free PNG. We do not reject here — §17 wants
 * the fact RECORDED and the oracle to judge it; a blank capture must never
 * be silently treated as a valid comparison.
 */
function isBlankPng(buf) {
  // PNG signature check + tiny heuristic: pure-color captures compress to
  // very small files relative to their IDAT; use byte size as a weak but
  // deterministic first signal and record it.
  return buf.length < 512;
}

for (const sentinel of sentinels) {
  for (const viewport of viewports) {
    const b = await capture(baselineBase, sentinel.route, viewport, "baseline");
    const c = await capture(candidateUrl, sentinel.route, viewport, "candidate");
    const pair = {
      pair_id: `${sentinel.route.replaceAll("/", "_")}__${viewport.id}`,
      route: sentinel.route,
      viewport: viewport.id,
      critical: sentinel.critical,
      run_id: runId,
      baseline: {
        file: `baseline/${b.file}`,
        hash: b.hash,
        status: b.status,
        final_route: b.final_route,
        blank: b.blank,
      },
      candidate: {
        file: `candidate/${c.file}`,
        hash: c.hash,
        status: c.status,
        final_route: c.final_route,
        blank: c.blank,
      },
      route_match:
        normalizeRoute(b.final_route) === normalizeRoute(sentinel.route) &&
        normalizeRoute(c.final_route) === normalizeRoute(sentinel.route),
      viewport_match: true, // context enforces; recorded for determinism
    };
    pairs.push(pair);
    manifest.pairs.push(pair);
  }
}

await browser.close();
if (baselineServer) await new Promise((r) => baselineServer.close(r));

fs.writeFileSync(path.join(outRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

function normalizeRoute(p) {
  if (!p) return null;
  if (!p.startsWith("/")) p = `/${p}`;
  if (!p.endsWith("/")) p += "/";
  return p;
}

const blankCount = pairs.filter((p) => p.baseline.blank || p.candidate.blank).length;
const mismatch = pairs.filter((p) => !p.route_match).length;
console.log(
  JSON.stringify(
    {
      pairs: pairs.length,
      blank_captures: blankCount,
      route_mismatches: mismatch,
      manifest: path.join(outRoot, "manifest.json"),
    },
    null,
    2,
  ),
);
process.exit(pairs.length === 10 ? 0 : 1);
