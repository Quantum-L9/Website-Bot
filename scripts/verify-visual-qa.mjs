// L9_META
// skill_schema: 1
// parent: l9-website-factory
// layer: script
// role: visual_qa_verification
// tags: [verification, vision, qa, layout, screenshots]
// owner: igor_beylin
// status: active
// version: 2.0.0
// updated: 2026-10-24
// /L9_META

/**
 * Visual QA Verification Script (deployed site).
 * Captures every requested page at every requested viewport and has the LLM
 * vision evaluator judge each screenshot. Writes one structured,
 * per-invocation report and exits 0 only when that report is PASS:
 *
 *   PASS    every page x viewport returned HTTP 2xx, was screenshotted, and
 *           received a conclusive non-critical evaluator verdict
 *   FAIL    a defect was observed (critical verdict, non-2xx page, capture error)
 *   BLOCKED the run could not judge (missing input, Playwright, credentials,
 *           evaluator, unreachable target, inconclusive or failed evaluation)
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED. A screenshot without an evaluator
 * verdict is evidence of capture, never quality approval.
 *
 * Usage:
 *   node scripts/verify-visual-qa.mjs --url <https://site> --pages /,/about
 *     [--viewports desktop_1440,iphone_14] [--report <dir>/report.json]
 *     [--run-id <id>] [--client-id <id>]
 * Pages may instead come from QA_PAGES (comma-separated) or an explicit
 * SPEC_PATH DomainSpec; there is no default spec and no homepage fallback.
 * Requires OPENROUTER_API_KEY for the evaluator.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VISUAL_QA_REPORT_SCHEMA = "website-bot.visual-qa-report/v1";
export const EXIT_CODES = { PASS: 0, FAIL: 1, BLOCKED: 2 };

// Viewports to test (matches @quantum-l9/llm-router VIEWPORTS)
export const VIEWPORTS = [
  { name: "desktop_1920", width: 1920, height: 1080 },
  { name: "desktop_1440", width: 1440, height: 900 },
  { name: "ipad", width: 1024, height: 768 },
  { name: "iphone_14", width: 390, height: 844 },
  { name: "pixel_7", width: 412, height: 915 },
];

const NAVIGATION_TIMEOUT_MS = 45_000;
const LLM_ADAPTER = resolve(dirname(fileURLToPath(import.meta.url)), "../src/services/llm.ts");

export class VisualQaUsageError extends Error {}

function toPagePath(raw) {
  const value = String(raw).trim();
  const path = value.startsWith("/") ? value : `/${value}`;
  if (
    path.includes("//") ||
    /[?#\\\s]/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new VisualQaUsageError(`invalid page path ${JSON.stringify(value)}`);
  }
  return path;
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new VisualQaUsageError(`${name} requires a value`);
  return value;
}

async function pagesFromSpec(specPath) {
  const { parse } = await import("yaml");
  let spec;
  try {
    spec = parse(readFileSync(specPath, "utf-8"));
  } catch (error) {
    throw new VisualQaUsageError(`SPEC_PATH ${specPath} is unreadable: ${error.message}`);
  }
  const root = spec?.domain_spec ?? spec;
  return (root?.routes ?? []).map((route) => route?.slug).filter(Boolean);
}

/** Resolve the complete, explicit invocation. Missing required context is a usage error. */
export async function parseInvocation(argv, env) {
  const rawUrl = flag(argv, "--url") ?? env.SITE_URL;
  if (!rawUrl) throw new VisualQaUsageError("--url (or SITE_URL) is required");
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new VisualQaUsageError(`--url ${JSON.stringify(rawUrl)} is not a valid URL`);
  }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password)
    throw new VisualQaUsageError("--url must be an http(s) URL without credentials");
  if (target.search || target.hash)
    throw new VisualQaUsageError("--url must not carry a query string or fragment");
  const url = `${target.origin}${target.pathname.replace(/\/+$/, "")}`;

  let rawPages = flag(argv, "--pages")?.split(",") ?? env.QA_PAGES?.split(",");
  if (!rawPages && env.SPEC_PATH) rawPages = await pagesFromSpec(env.SPEC_PATH);
  const pages = [
    ...new Set((rawPages ?? []).filter((page) => String(page).trim()).map(toPagePath)),
  ];
  if (!pages.length)
    throw new VisualQaUsageError("no pages: pass --pages, QA_PAGES or an explicit SPEC_PATH");

  const viewportNames = flag(argv, "--viewports")
    ?.split(",")
    .map((name) => name.trim());
  const viewports = viewportNames
    ? viewportNames.map((name) => {
        const viewport = VIEWPORTS.find((candidate) => candidate.name === name);
        if (!viewport) throw new VisualQaUsageError(`unknown viewport ${JSON.stringify(name)}`);
        return viewport;
      })
    : VIEWPORTS;
  if (new Set(viewports.map((viewport) => viewport.name)).size !== viewports.length)
    throw new VisualQaUsageError("duplicate viewport");

  const runId = flag(argv, "--run-id") ?? `${Date.now()}-${randomUUID()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId))
    throw new VisualQaUsageError(`--run-id ${JSON.stringify(runId)} is not a safe identifier`);
  const reportPath = resolve(
    flag(argv, "--report") ?? join("build", "visual-qa", runId, "report.json"),
  );
  const clientId = flag(argv, "--client-id") ?? env.CLIENT_ID ?? "visual-qa";
  return { url, pages, viewports, runId, reportPath, clientId };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Evaluator verdict for one screenshot; anything but a non-empty analysis is inconclusive. */
export function verdictFor(analysis) {
  if (typeof analysis !== "string" || !analysis.trim()) return "inconclusive";
  // The evaluator's own protocol (src/services/llm.ts validateLayout prompt):
  // a severe defect is reported with the word "critical".
  return /\bcritical\b/i.test(analysis) ? "critical" : "ok";
}

export function defaultDeps(env = process.env) {
  return {
    env,
    fetch: globalThis.fetch,
    async launchBrowser() {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      return {
        version: browser.version(),
        async open(viewport) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
          });
          const page = await context.newPage();
          return {
            async goto(url) {
              const response = await page.goto(url, {
                waitUntil: "networkidle",
                timeout: NAVIGATION_TIMEOUT_MS,
              });
              return { status: response ? response.status() : 0 };
            },
            screenshot: (path) => page.screenshot({ path, fullPage: true }),
            close: () => context.close(),
          };
        },
        close: () => browser.close(),
      };
    },
    async loadEvaluator(clientId) {
      // The pipeline runs TypeScript through tsx; register it so the canonical
      // adapter loads under plain `node` too. There is no compiled dist/.
      const { register } = await import("tsx/esm/api");
      register();
      const { createWebsiteFactoryLLM } = await import(pathToFileURL(LLM_ADAPTER).href);
      return createWebsiteFactoryLLM(clientId);
    },
    now: () => new Date(),
  };
}

/** Run one visual QA invocation and write its report. A run outcome is never thrown. */
export async function runVisualQa(invocation, deps = defaultDeps()) {
  const { url, pages, viewports, runId, reportPath, clientId } = invocation;
  const runDir = dirname(reportPath);
  // Run-id scoped so a rerun replaces only its own captures, never a sibling
  // directory the caller happens to keep beside --report.
  const screenshotsDir = join(runDir, `screenshots-${runId}`);
  // Only this invocation's output may certify this invocation.
  rmSync(reportPath, { force: true });
  rmSync(screenshotsDir, { recursive: true, force: true });
  mkdirSync(screenshotsDir, { recursive: true });

  const reasons = new Set();
  const captures = [];
  const evaluations = [];
  const errors = [];
  let browserVersion = null;
  const startedAt = deps.now().toISOString();

  try {
    const hasKey = Boolean(deps.env.OPENROUTER_API_KEY?.trim());
    if (!hasKey) reasons.add("MISSING_EVALUATOR_CREDENTIALS");

    let reachable = false;
    try {
      // Non-shell reachability probe of the exact target.
      const response = await deps.fetch(`${url}/`, { redirect: "follow" });
      reachable = response.ok;
    } catch (error) {
      errors.push(`reachability: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!reachable) reasons.add("TARGET_UNREACHABLE");

    let browser;
    if (reachable) {
      try {
        browser = await deps.launchBrowser();
        browserVersion = browser.version ?? null;
      } catch (error) {
        errors.push(`browser: ${error instanceof Error ? error.message : String(error)}`);
        reasons.add("MISSING_DEPENDENCY");
      }
    }

    if (browser) {
      try {
        for (const viewport of viewports) {
          const page = await browser.open(viewport);
          try {
            for (const pagePath of pages) {
              const name = pagePath === "/" ? "_index" : pagePath.replaceAll("/", "_");
              const file = join(screenshotsDir, `${name}_${viewport.name}.png`);
              const capture = {
                page: pagePath,
                viewport: viewport.name,
                url: `${url}${pagePath}`,
                http_status: 0,
                status: "error",
                screenshot: null,
              };
              captures.push(capture);
              try {
                capture.http_status = (await page.goto(capture.url)).status;
                if (capture.http_status < 200 || capture.http_status > 299) {
                  capture.status = "http_error";
                  reasons.add("HTTP_NOT_OK");
                  continue;
                }
                await page.screenshot(file);
                const bytes = existsSync(file) ? statSync(file).size : 0;
                if (bytes === 0) {
                  reasons.add("CAPTURE_FAILED");
                  continue;
                }
                capture.screenshot = { path: file, bytes, sha256: sha256(file) };
                capture.status = "captured";
              } catch (error) {
                capture.error = error instanceof Error ? error.message : String(error);
                reasons.add("CAPTURE_FAILED");
              }
            }
          } finally {
            await page.close();
          }
        }
      } finally {
        await browser.close();
      }
    }

    let evaluator;
    if (hasKey && captures.some((capture) => capture.status === "captured")) {
      try {
        evaluator = await deps.loadEvaluator(clientId);
      } catch (error) {
        errors.push(`evaluator: ${error instanceof Error ? error.message : String(error)}`);
        reasons.add("EVALUATOR_UNAVAILABLE");
      }
    }
    for (const capture of captures) {
      if (capture.status !== "captured") continue;
      const evaluation = { page: capture.page, viewport: capture.viewport, verdict: "not_run" };
      evaluations.push(evaluation);
      if (!evaluator) continue;
      const viewport = viewports.find((candidate) => candidate.name === capture.viewport);
      try {
        const analysis = await evaluator.validateLayout(
          [capture.screenshot.path],
          `Page: ${capture.page}, Viewport: ${viewport.name} (${viewport.width}x${viewport.height})`,
        );
        evaluation.verdict = verdictFor(analysis);
        evaluation.analysis = typeof analysis === "string" ? analysis : null;
        if (evaluation.verdict === "inconclusive") reasons.add("EVALUATION_INCONCLUSIVE");
        if (evaluation.verdict === "critical") reasons.add("CRITICAL_FINDING");
      } catch (error) {
        evaluation.verdict = "error";
        evaluation.error = error instanceof Error ? error.message : String(error);
        reasons.add("EVALUATION_FAILED");
      }
    }
  } catch (error) {
    errors.push(`unexpected: ${error instanceof Error ? error.message : String(error)}`);
    reasons.add("UNEXPECTED_ERROR");
  }

  const required = pages.length * viewports.length;
  const captured = captures.filter((capture) => capture.status === "captured").length;
  const approved = evaluations.filter((evaluation) => evaluation.verdict === "ok").length;
  if (captured !== required || approved !== required) reasons.add("INCOMPLETE_COVERAGE");

  const defects = ["CRITICAL_FINDING", "HTTP_NOT_OK", "CAPTURE_FAILED"];
  const status =
    reasons.size === 0 ? "PASS" : defects.some((code) => reasons.has(code)) ? "FAIL" : "BLOCKED";
  const report = {
    schema: VISUAL_QA_REPORT_SCHEMA,
    run_id: runId,
    status,
    reasons: [...reasons].sort(),
    target_url: url,
    requested: { pages, viewports: viewports.map((viewport) => viewport.name) },
    coverage: { required, captured, approved },
    browser: browserVersion,
    started_at: startedAt,
    completed_at: deps.now().toISOString(),
    captures,
    evaluations,
    errors,
  };
  mkdirSync(runDir, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return report;
}

async function cli() {
  let invocation;
  try {
    invocation = await parseInvocation(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`visual-qa: ${error.message}`);
    console.log("STATUS: BLOCKED");
    process.exitCode = EXIT_CODES.BLOCKED;
    return;
  }
  const report = await runVisualQa(invocation);
  console.log(`visual-qa report: ${invocation.reportPath}`);
  console.log(
    `coverage: ${report.coverage.captured}/${report.coverage.required} captured, ${report.coverage.approved}/${report.coverage.required} approved`,
  );
  if (report.reasons.length) console.log(`reasons: ${report.reasons.join(", ")}`);
  console.log(`STATUS: ${report.status}`);
  process.exitCode = EXIT_CODES[report.status];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await cli().catch((error) => {
    console.error(`visual-qa: unexpected failure: ${error?.stack ?? error}`);
    console.log("STATUS: BLOCKED");
    process.exitCode = EXIT_CODES.BLOCKED;
  });
}
