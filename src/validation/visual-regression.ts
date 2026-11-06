// L9_META: layer=validation, role=visual_regression, status=active, version=1.0.0
//
// Approved visual regression (WB-BUILD-CONTRACT-TESTS-01 Wave 4). Protects a
// design AFTER a human has judged it acceptable; it never decides whether a
// design is good, and nothing here can approve a reference.
//
// - capture: renders built routes at fixed desktop/mobile viewports in
//   Chromium with every source of nondeterminism pinned: the template's font
//   (vendored Inter, so the machine's installed fonts do not matter),
//   animations and caret off, reduced motion, fixed locale and timezone, no
//   off-origin requests, images settled, build-time dynamic text masked.
// - compare: a per-pixel comparison run inside Chromium's canvas (no image
//   library), writing expected / actual / diff PNGs as inspectable evidence.
// - approval: references are trusted only through an approval record naming
//   a human approver and the sha256 of every reference file; a missing,
//   tampered or self-issued approval fails closed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type RenderViewport,
  SETTLE_IMAGES_EXPRESSION,
  StaticDistServer,
} from "./rendered-site.js";
import { normalizeRouteSlug } from "./validate-generated-site.js";

export const VISUAL_APPROVAL_SCHEMA = "website-bot.visual-reference-approval/v1" as const;

/** Desktop and mobile are protected independently (V4-03). */
export const VISUAL_VIEWPORTS: readonly RenderViewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

/**
 * A pixel differs when any channel moves more than `pixelThreshold` (0–255),
 * which absorbs sub-pixel anti-aliasing; a screenshot fails when more than
 * `maxDiffRatio` of its pixels differ, or when its size changed.
 */
export interface VisualTolerance {
  pixelThreshold: number;
  maxDiffRatio: number;
}

/**
 * Calibrated on a real defect (Wave 4 review): form inputs overflowing into
 * the neighbouring column move only low-contrast 1px borders, which a 32/255
 * threshold counted as 361 px (0.023%, passing) but 8/255 counts as 3,245 px
 * (0.20%). An unchanged build re-renders with 0 differing pixels.
 */
export const DEFAULT_VISUAL_TOLERANCE: VisualTolerance = {
  pixelThreshold: 8,
  maxDiffRatio: 0.0005,
};

/** Template fonts by weight; the files live in tests/visual/fonts (OFL-1.1). */
const FONT_WEIGHTS = [400, 500, 600, 700, 800] as const;

/** Build-time dynamic text the template marks for masking (e.g. the copyright year). */
export const DYNAMIC_CONTENT_SELECTOR = "[data-visual-dynamic]";

/** CSS that removes motion and blinking carets before capture. */
const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important; transition: none !important; caret-color: transparent !important;
  scroll-behavior: auto !important;
}`;

export interface VisualRendererIdentity {
  engine: "chromium";
  /** Major version: references are only comparable within one renderer line. */
  major: number;
  version: string;
  platform: NodeJS.Platform;
}

export interface CapturedScreenshot {
  route: string;
  viewport: string;
  /** Path relative to the capture directory. */
  file: string;
  sha256: string;
  width: number;
  height: number;
}

export interface CaptureResult {
  renderer: VisualRendererIdentity;
  screenshots: CapturedScreenshot[];
}

export interface ApprovedReference extends CapturedScreenshot {}

export interface VisualApprovalRecord {
  schema: typeof VISUAL_APPROVAL_SCHEMA;
  design_id: string;
  /** A named person; never an agent, a bot or a CI identity (V4-06). */
  approved_by: string;
  approved_at: string;
  reason: string;
  /** What was rendered: the fixture, the commit, and its rendered-site verdict. */
  source: { fixture: string; git_commit: string; rendered_site_validation: "PASS" };
  renderer: VisualRendererIdentity;
  tolerance: VisualTolerance;
  references: ApprovedReference[];
}

export interface ScreenshotComparison {
  route: string;
  viewport: string;
  status: "PASS" | "FAIL";
  detail: string;
  diff_pixels: number;
  diff_ratio: number;
  /** Evidence written for a failure, relative to the evidence directory. */
  evidence?: { expected: string; actual: string; diff: string };
}

export interface VisualRegressionReport {
  design_id: string;
  renderer: VisualRendererIdentity;
  comparisons: ScreenshotComparison[];
  status: "PASS" | "FAIL";
}

export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export function screenshotName(route: string, viewport: string): string {
  const slug = normalizeRouteSlug(route);
  const stem = slug === "/" ? "home" : slug.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
  return `${viewport}-${stem}.png`;
}

/* ------------------------------------------------------------------ */
/* Approval record                                                     */
/* ------------------------------------------------------------------ */

/** Identities that may never approve a reference: agents, bots, CI (V4-06). */
const NON_HUMAN_APPROVER =
  /(^|[^a-z])(claude|codex|copilot|gpt|chatgpt|openai|anthropic|agent|bot|automation|ci|github[-_ ]actions|website[-_ ]bot)([^a-z]|$)/i;

export function approverIsHuman(approver: string): boolean {
  const name = approver.trim();
  return name.length >= 2 && !NON_HUMAN_APPROVER.test(name);
}

/** Problems with the approval record itself: schema, approver, reason, time, source. */
function recordProblems(record: VisualApprovalRecord): string[] {
  const problems: string[] = [];
  if (record.schema !== VISUAL_APPROVAL_SCHEMA) {
    problems.push(`schema is not ${VISUAL_APPROVAL_SCHEMA}`);
  }
  if (!record.approved_by || !approverIsHuman(record.approved_by)) {
    problems.push(`approver ${JSON.stringify(record.approved_by)} is not a named human`);
  }
  if (!record.reason?.trim()) problems.push("approval gives no reason");
  if (Number.isNaN(Date.parse(record.approved_at))) {
    problems.push("approval has no valid timestamp");
  }
  if (record.source?.rendered_site_validation !== "PASS") {
    problems.push("approved output did not pass rendered-site validation");
  }
  return problems;
}

/** Both viewports approved, and every PNG on disk is exactly an approved one. */
function referenceFileProblems(referenceDir: string, references: ApprovedReference[]): string[] {
  const problems: string[] = [];
  if (references.length === 0) problems.push("approval lists no references");
  for (const viewport of VISUAL_VIEWPORTS) {
    if (!references.some((reference) => reference.viewport === viewport.name)) {
      problems.push(`no approved ${viewport.name} reference`);
    }
  }
  for (const reference of references) {
    const file = join(referenceDir, reference.file);
    if (!existsSync(file)) problems.push(`${reference.file}: approved file is missing`);
    else if (sha256(readFileSync(file)) !== reference.sha256) {
      problems.push(`${reference.file}: bytes differ from the approved sha256 (unapproved update)`);
    }
  }
  const listed = new Set(references.map((reference) => reference.file));
  for (const file of readdirSync(referenceDir).filter((name) => name.endsWith(".png"))) {
    if (!listed.has(file)) problems.push(`${file}: reference file not covered by the approval`);
  }
  return problems;
}

/**
 * Every reason a reference directory cannot be trusted, or [] when its
 * approval record is well formed, names a human, and every reference file on
 * disk is exactly the one approved.
 */
export function approvalProblems(referenceDir: string): string[] {
  const path = join(referenceDir, "approval.json");
  if (!existsSync(path)) return ["no approval record (approval.json): nothing here is approved"];
  let record: VisualApprovalRecord;
  try {
    record = JSON.parse(readFileSync(path, "utf-8")) as VisualApprovalRecord;
  } catch (error) {
    return [`approval record is not valid JSON: ${(error as Error).message}`];
  }
  const references = Array.isArray(record.references) ? record.references : [];
  return [...recordProblems(record), ...referenceFileProblems(referenceDir, references)];
}

export function readApproval(referenceDir: string): VisualApprovalRecord {
  const problems = approvalProblems(referenceDir);
  if (problems.length > 0) {
    throw new Error(`untrusted visual references in ${referenceDir}: ${problems.join("; ")}`);
  }
  return JSON.parse(
    readFileSync(join(referenceDir, "approval.json"), "utf-8"),
  ) as VisualApprovalRecord;
}

/* ------------------------------------------------------------------ */
/* Deterministic capture                                               */
/* ------------------------------------------------------------------ */

type Browser = {
  version(): string;
  newContext(options: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
};
type BrowserContext = { newPage(): Promise<Page>; close(): Promise<void> };
type Route = { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> };
type Page = {
  route(pattern: string, handler: (route: Route) => Promise<void>): Promise<void>;
  goto(url: string, options?: unknown): Promise<unknown>;
  addStyleTag(options: { content: string }): Promise<unknown>;
  evaluate<T>(script: string): Promise<T>;
  locator(selector: string): unknown;
  screenshot(options: Record<string, unknown>): Promise<Buffer>;
  setContent(html: string): Promise<void>;
  close(): Promise<void>;
};

async function launchChromium(): Promise<Browser> {
  const specifier = "playwright";
  let mod: { chromium?: { launch(options?: unknown): Promise<Browser> } };
  try {
    mod = (await import(specifier)) as typeof mod;
  } catch (error) {
    throw new Error(`browser unavailable: playwright could not be loaded (${String(error)})`);
  }
  if (!mod.chromium) throw new Error("browser unavailable: playwright exposes no chromium");
  return mod.chromium.launch({ headless: true });
}

function rendererIdentity(browser: Browser): VisualRendererIdentity {
  const version = browser.version();
  return {
    engine: "chromium",
    major: Number.parseInt(version.split(".")[0] ?? "0", 10),
    version,
    platform: process.platform,
  };
}

const routeUrl = (baseUrl: string, slug: string): string =>
  slug === "/" ? `${baseUrl}/` : `${baseUrl}${slug}/`;

/** Resolves once every template weight of the vendored font is loaded. */
const FONTS_READY_EXPRESSION =
  "Promise.all([" +
  FONT_WEIGHTS.map((weight) => `document.fonts.load("${weight} 16px Inter")`).join(", ") +
  "]).then(() => document.fonts.ready)";

/** @font-face rules for the vendored template font, inlined so capture needs no network. */
export function fontFaceCss(fontDir: string): string {
  return FONT_WEIGHTS.map((weight) => {
    const file = join(fontDir, `inter-latin-${weight}.woff2`);
    if (!existsSync(file)) throw new Error(`visual font missing: ${file}`);
    const data = readFileSync(file).toString("base64");
    return `@font-face { font-family: "Inter"; font-style: normal; font-weight: ${weight}; font-display: block; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
  }).join("\n");
}

export interface CaptureOptions {
  distDir: string;
  routes: readonly string[];
  outDir: string;
  fontDir: string;
  viewports?: readonly RenderViewport[];
  /** Applied after the page settles; a test hook for deliberately broken variants only. */
  injectCss?: (viewport: RenderViewport) => string | undefined;
}

/** Capture one route at one viewport under the pinned conditions. */
async function captureRoute(
  context: BrowserContext,
  baseUrl: string,
  route: string,
  viewport: RenderViewport,
  options: CaptureOptions,
  fonts: string,
): Promise<CapturedScreenshot> {
  const page = await context.newPage();
  try {
    // Only the built site loads: no font CDNs, analytics or remote media.
    await page.route("**/*", (request) =>
      request.request().url().startsWith(baseUrl) ? request.continue() : request.abort(),
    );
    const slug = normalizeRouteSlug(route);
    await page.goto(routeUrl(baseUrl, slug), { waitUntil: "load", timeout: 30_000 });
    await page.addStyleTag({ content: `${fonts}\n${FREEZE_CSS}` });
    const extra = options.injectCss?.(viewport);
    if (extra) await page.addStyleTag({ content: extra });
    await page.evaluate(FONTS_READY_EXPRESSION);
    await page.evaluate(SETTLE_IMAGES_EXPRESSION);
    const bytes = await page.screenshot({
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      scale: "css",
      mask: [page.locator(DYNAMIC_CONTENT_SELECTOR)],
      maskColor: "#ff00ff",
    });
    const file = screenshotName(route, viewport.name);
    writeFileSync(join(options.outDir, file), bytes);
    return { route: slug, viewport: viewport.name, file, sha256: sha256(bytes), ...pngSize(bytes) };
  } finally {
    await page.close();
  }
}

/** Render each route at each viewport under pinned conditions and write full-page PNGs. */
export async function captureScreenshots(options: CaptureOptions): Promise<CaptureResult> {
  const fonts = fontFaceCss(options.fontDir);
  const served = await new StaticDistServer().start(options.distDir);
  let browser: Browser;
  try {
    browser = await launchChromium();
  } catch (error) {
    await served.close();
    throw error;
  }
  mkdirSync(options.outDir, { recursive: true });
  const screenshots: CapturedScreenshot[] = [];
  try {
    for (const viewport of options.viewports ?? VISUAL_VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: "light",
        locale: "en-US",
        timezoneId: "UTC",
      });
      try {
        // One page at a time on one browser: captures stay sequential by design.
        for (const route of options.routes) {
          screenshots.push(
            await captureRoute(context, served.baseUrl, route, viewport, options, fonts),
          );
        }
      } finally {
        await context.close();
      }
    }
    return { renderer: rendererIdentity(browser), screenshots };
  } finally {
    await browser.close();
    await served.close();
  }
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG image");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/* ------------------------------------------------------------------ */
/* Comparison (in Chromium's canvas)                                   */
/* ------------------------------------------------------------------ */

/**
 * Browser-side comparison: decodes both PNGs, counts pixels whose channels
 * differ beyond the threshold over the overlapping area (plus every pixel
 * outside it when sizes differ), and paints a diff image: differing pixels
 * red over a faded copy of the expected screenshot.
 */
const COMPARE_FUNCTION = `async ({ expected, actual, threshold }) => {
  const load = (data) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("could not decode screenshot"));
    image.src = "data:image/png;base64," + data;
  });
  const [a, b] = await Promise.all([load(expected), load(actual)]);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pixels = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  const pa = pixels(a);
  const pb = pixels(b);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const context = out.getContext("2d");
  const diff = context.createImageData(width, height);
  let differing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = x < a.width && y < a.height && x < b.width && y < b.height;
      const delta = inside
        ? Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]))
        : 255;
      if (delta > threshold) {
        differing++;
        diff.data[i] = 255; diff.data[i + 1] = 0; diff.data[i + 2] = 0; diff.data[i + 3] = 255;
      } else {
        const grey = Math.round((pa[i] + pa[i + 1] + pa[i + 2]) / 3);
        diff.data[i] = diff.data[i + 1] = diff.data[i + 2] = 200 + Math.round(grey / 5);
        diff.data[i + 3] = 255;
      }
    }
  }
  context.putImageData(diff, 0, 0);
  return {
    width, height, differing,
    sameSize: a.width === b.width && a.height === b.height,
    expectedSize: [a.width, a.height], actualSize: [b.width, b.height],
    diffPng: out.toDataURL("image/png").split(",")[1],
  };
}`;

interface CanvasComparison {
  width: number;
  height: number;
  differing: number;
  sameSize: boolean;
  expectedSize: [number, number];
  actualSize: [number, number];
  diffPng: string;
}

export interface CompareOptions {
  design_id: string;
  referenceDir: string;
  references: readonly ApprovedReference[];
  actualDir: string;
  actual: CaptureResult;
  evidenceDir: string;
  tolerance?: VisualTolerance;
}

/**
 * Compare every reference with the matching fresh capture. A reference with
 * no capture, a capture with no approved reference, a size change or too
 * many differing pixels fails; each pixel failure leaves expected / actual /
 * diff PNGs in the evidence directory.
 */
export async function compareScreenshots(options: CompareOptions): Promise<VisualRegressionReport> {
  const tolerance = options.tolerance ?? DEFAULT_VISUAL_TOLERANCE;
  const browser = await launchChromium();
  const comparisons: ScreenshotComparison[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    await page.setContent("<!doctype html><title>compare</title>");
    for (const reference of options.references) {
      const capture = options.actual.screenshots.find(
        (shot) => shot.route === reference.route && shot.viewport === reference.viewport,
      );
      const base = { route: reference.route, viewport: reference.viewport };
      if (!capture) {
        comparisons.push({
          ...base,
          status: "FAIL",
          detail: "approved view was not rendered",
          diff_pixels: 0,
          diff_ratio: 1,
        });
        continue;
      }
      const expected = readFileSync(join(options.referenceDir, reference.file));
      const actual = readFileSync(join(options.actualDir, capture.file));
      const result = await page.evaluate<CanvasComparison>(
        `(${COMPARE_FUNCTION})(${JSON.stringify({
          expected: expected.toString("base64"),
          actual: actual.toString("base64"),
          threshold: tolerance.pixelThreshold,
        })})`,
      );
      const ratio = result.differing / (result.width * result.height);
      const pass = result.sameSize && ratio <= tolerance.maxDiffRatio;
      const detail = result.sameSize
        ? `${result.differing} of ${result.width * result.height} pixels differ (${(ratio * 100).toFixed(3)}%, allowed ${(tolerance.maxDiffRatio * 100).toFixed(3)}%)`
        : `size changed from ${result.expectedSize.join("x")} to ${result.actualSize.join("x")}`;
      const comparison: ScreenshotComparison = {
        ...base,
        status: pass ? "PASS" : "FAIL",
        detail,
        diff_pixels: result.differing,
        diff_ratio: ratio,
      };
      if (!pass) {
        const stem = reference.file.replace(/\.png$/, "");
        mkdirSync(options.evidenceDir, { recursive: true });
        const files = {
          expected: `${stem}.expected.png`,
          actual: `${stem}.actual.png`,
          diff: `${stem}.diff.png`,
        };
        writeFileSync(join(options.evidenceDir, files.expected), expected);
        writeFileSync(join(options.evidenceDir, files.actual), actual);
        writeFileSync(join(options.evidenceDir, files.diff), Buffer.from(result.diffPng, "base64"));
        comparison.evidence = files;
      }
      comparisons.push(comparison);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  // A view rendered with no approved reference is unprotected, not passing:
  // adding a route or viewport to protection needs a human approval too.
  for (const shot of options.actual.screenshots) {
    const approved = options.references.some(
      (reference) => reference.route === shot.route && reference.viewport === shot.viewport,
    );
    if (!approved) {
      comparisons.push({
        route: shot.route,
        viewport: shot.viewport,
        status: "FAIL",
        detail: "no approved reference for this view; it must be approved before it is protected",
        diff_pixels: 0,
        diff_ratio: 1,
      });
    }
  }
  const report: VisualRegressionReport = {
    design_id: options.design_id,
    renderer: options.actual.renderer,
    comparisons,
    status: comparisons.every((comparison) => comparison.status === "PASS") ? "PASS" : "FAIL",
  };
  mkdirSync(options.evidenceDir, { recursive: true });
  writeFileSync(
    resolve(options.evidenceDir, "visual-regression-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

/* ------------------------------------------------------------------ */
/* Approval (human only, explicit, never from failing output)          */
/* ------------------------------------------------------------------ */

export const CANDIDATE_MANIFEST = "candidate.json";

/** What a candidate capture records, so approval binds to exactly what was reviewed. */
export interface CandidateManifest {
  design_id: string;
  fixture: string;
  git_commit: string;
  rendered_site_validation: "PASS" | "FAIL";
  renderer: VisualRendererIdentity;
  screenshots: CapturedScreenshot[];
}

/** One digest over a candidate set, which the reviewer must quote back to approve it. */
export function candidateSetDigest(manifest: CandidateManifest): string {
  const lines = [...manifest.screenshots]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((shot) => `${shot.file} ${shot.sha256}`);
  return sha256(Buffer.from(`${manifest.design_id}\n${lines.join("\n")}\n`)).slice(0, 16);
}

export interface ApprovalRequest {
  approver?: string;
  reason?: string;
  /** The digest the human quotes after reviewing the candidate PNGs. */
  confirm?: string;
  replace: boolean;
  env: Record<string, string | undefined>;
  candidate?: CandidateManifest;
  referencesExist: boolean;
}

/**
 * Every reason an approval must be refused (V4-01, V4-04, V4-06), or [] when
 * a named human, outside CI, explicitly confirms a reviewed candidate set
 * rendered from output that passed the browser gate.
 */
export function approvalRefusals(request: ApprovalRequest): string[] {
  const refusals: string[] = [];
  if (request.env.CI || request.env.GITHUB_ACTIONS) {
    refusals.push("references are never approved in CI");
  }
  if (!request.approver || !approverIsHuman(request.approver)) {
    refusals.push("--approver must name the person approving (not an agent, bot or CI identity)");
  }
  if (!request.reason?.trim()) refusals.push("--reason is required");
  if (request.referencesExist && !request.replace) {
    refusals.push("approved references already exist; replacing them needs --replace");
  }
  if (!request.candidate) {
    refusals.push("no candidate capture to approve: run without --confirm first and review it");
    return refusals;
  }
  if (request.candidate.rendered_site_validation !== "PASS") {
    refusals.push(
      "the candidate failed rendered-site validation; a baseline is never taken from it",
    );
  }
  for (const viewport of VISUAL_VIEWPORTS) {
    if (!request.candidate.screenshots.some((shot) => shot.viewport === viewport.name)) {
      refusals.push(`the candidate has no ${viewport.name} screenshots`);
    }
  }
  const digest = candidateSetDigest(request.candidate);
  if (request.confirm !== digest) {
    refusals.push(
      `--confirm must quote the reviewed candidate digest (${digest}); the set on disk is what gets approved`,
    );
  }
  return refusals;
}

/** The approval record for a confirmed candidate set. */
export function approvalRecord(
  candidate: CandidateManifest,
  approver: string,
  reason: string,
  approvedAt: Date,
  tolerance: VisualTolerance = DEFAULT_VISUAL_TOLERANCE,
): VisualApprovalRecord {
  return {
    schema: VISUAL_APPROVAL_SCHEMA,
    design_id: candidate.design_id,
    approved_by: approver.trim(),
    approved_at: approvedAt.toISOString(),
    reason: reason.trim(),
    source: {
      fixture: candidate.fixture,
      git_commit: candidate.git_commit,
      rendered_site_validation: "PASS",
    },
    renderer: candidate.renderer,
    tolerance,
    references: candidate.screenshots,
  };
}
