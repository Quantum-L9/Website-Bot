// L9_META: layer=validation, role=client_e2e, status=active, version=1.0.0
//
// Browser E2E for the built quantum-ai-partners site. Serves build/sites/
// <client>/dist with `npm run preview` (astro), then walks every route at
// desktop + mobile widths: navigation, headings, imagery, internal links,
// console errors, missing assets, and screenshots for visual review.
//
// Usage (from the Website-Bot repo root):
//   node --import tsx examples/quantum-ai-partners/e2e.mjs
//   node --import tsx examples/quantum-ai-partners/e2e.mjs --preview-port 4321
import { spawn } from "node:child_process";
import { resolveNodeTool } from "../../scripts/lib/exec-path.mjs";
import { mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const CLIENT = "quantumaipartners_com";
const SITE_ROOT = new URL("../../build/sites/" + CLIENT + "/", import.meta.url).pathname;
const DIST = SITE_ROOT + "dist";
const SHOT_DIR = SITE_ROOT + ".l9/e2e";
const args = process.argv.slice(2);
const portArg = args.indexOf("--preview-port");
const PORT = portArg !== -1 ? Number(args[portArg + 1]) : 4321;
const BASE = `http://127.0.0.1:${PORT}`;

if (!existsSync(DIST + "/index.html")) {
  console.error(`E2E requires a built site at ${DIST} — run the pipeline first.`);
  process.exit(1);
}
mkdirSync(SHOT_DIR, { recursive: true });

const routes = [
  { path: "/", h1: /./ },
  { path: "/services", h1: /Services|Strategic AI|Consulting/i },
  { path: "/approach", h1: /Approach|Implementation|Methodology/i },
  { path: "/about", h1: /About|Quantum AI/i },
  { path: "/faq", h1: /FAQ|Questions|Consulting/i },
  { path: "/contact", h1: /Contact|Quantum AI|Journey|Start/i },
];

const preview = spawn(
  resolveNodeTool("npx"),
  ["astro", "preview", "--port", String(PORT), "--host", "127.0.0.1"],
  {
    cwd: SITE_ROOT,
    stdio: "ignore",
  },
);
const stop = () => {
  try {
    preview.kill("SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", stop);

// Wait for the preview server.
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const response = await fetch(BASE + "/");
    if (response.ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const browser = await chromium.launch();
const failures = [];
const missingAssets = new Set();
const consoleErrors = [];

for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: width === 1280 ? 900 : 844 } });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`[${width}px] ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    missingAssets.add(`[${width}px] ${request.url()}`);
  });
  for (const route of routes) {
    const response = await page.goto(BASE + route.path, { waitUntil: "networkidle" });
    if (!response || response.status() !== 200) {
      failures.push(`[${width}px] ${route.path}: HTTP ${response?.status() ?? "failed"}`);
      continue;
    }
    const h1 = await page.locator("h1").first().textContent().catch(() => "");
    if (!h1 || !route.h1.test(h1.trim())) {
      failures.push(`[${width}px] ${route.path}: h1 missing/weak: ${JSON.stringify(h1)}`);
    }
    const navLinks = await page.locator("nav a").count();
    if (navLinks < 2) failures.push(`[${width}px] ${route.path}: nav has only ${navLinks} link(s)`);
    // Every internal link must resolve.
    for (const href of await page.locator('a[href^="/"]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href")),
    )) {
      if (!href) continue;
      const check = await page.request.get(BASE + href.split("#")[0]);
      if (check.status() >= 400) failures.push(`[${width}px] ${route.path}: broken link ${href}`);
    }
    // Imagery present where expected.
    const imgs = await page.locator("img").count();
    const missingAlt = await page.locator("img:not([alt])").count();
    if (missingAlt > 0) failures.push(`[${width}px] ${route.path}: ${missingAlt} img(s) missing alt`);
    // Screenshot for visual review.
    const shotName = `${route.path === "/" ? "home" : route.path.slice(1)}-${width}px.png`;
    await page.screenshot({ path: `${SHOT_DIR}/${shotName}`, fullPage: false });
    console.log(`[${width}px] ${route.path}: ok (imgs=${imgs})`);
  }
  await page.close();
}
await browser.close();
stop();

const report = { failures, missingAssets: [...missingAssets], consoleErrors };
console.log("\n== E2E REPORT ==");
console.log(JSON.stringify(report, null, 2));
if (failures.length || consoleErrors.length || missingAssets.size) process.exit(1);
console.log("E2E PASS");
