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
 *   FAIL    a defect was observed (critical verdict, non-2xx page, a redirect
 *           away from the requested route, capture error)
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
 * The evaluator (src/services/llm.ts) needs its complete credential set,
 * EVALUATOR_CREDENTIALS below; a missing one blocks the run before capture.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
/** Every credential createWebsiteFactoryLLM requires before its first call. */
export const EVALUATOR_CREDENTIALS = ["OPENROUTER_API_KEY", "PERPLEXITY_API_KEY"];
const LLM_ADAPTER = resolve(dirname(fileURLToPath(import.meta.url)), "../src/services/llm.ts");

export class VisualQaUsageError extends Error {}

function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

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

/** Route slugs and client id from an explicitly named DomainSpec. */
async function readSpec(specPath) {
  const { parse } = await import("yaml");
  let spec;
  try {
    spec = parse(readFileSync(specPath, "utf-8"));
  } catch (error) {
    throw new VisualQaUsageError(`SPEC_PATH ${specPath} is unreadable: ${error.message}`);
  }
  const root = spec?.domain_spec ?? spec;
  const clientId = root?.client_id ?? root?.metadata?.spec_id;
  return {
    slugs: (root?.routes ?? []).map((route) => route?.slug).filter(Boolean),
    clientId: clientId ? String(clientId) : undefined,
  };
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
  const url = `${target.origin}${trimTrailingSlashes(target.pathname)}`;

  const spec = env.SPEC_PATH ? await readSpec(env.SPEC_PATH) : undefined;
  const rawPages = flag(argv, "--pages")?.split(",") ?? env.QA_PAGES?.split(",") ?? spec?.slugs;
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
  // Budget and memory attribution belong to the client being verified.
  const clientId = flag(argv, "--client-id") ?? env.CLIENT_ID ?? spec?.clientId ?? "visual-qa";
  return { url, pages, viewports, runId, reportPath, clientId };
}

const DEFECT_SEVERITIES = new Set(["critical", "major", "minor"]);

/** The evaluator's answer with an optional single surrounding code fence removed. */
function unfenced(text) {
  if (!text.startsWith("```") || !text.endsWith("```") || text.length < 6) return text;
  const body = text.slice(3, -3);
  const newline = body.indexOf("\n");
  return newline === -1 ? body.trim() : body.slice(newline + 1).trim();
}

/**
 * Whether any object in valid JSON text repeats a key. JSON.parse keeps the
 * last duplicate silently, so keys are compared decoded ("verdict" is
 * "verdict"), in every object, at every depth.
 */
function hasDuplicateKeys(text) {
  const token = /"(?:[^"\\]|\\.)*"|[{}[\]]/g;
  const colon = /\s*:/y;
  const scopes = [];
  for (let match = token.exec(text); match; match = token.exec(text)) {
    const [part] = match;
    if (part === "{") scopes.push(new Set());
    else if (part === "[") scopes.push(null);
    else if (part === "}" || part === "]") scopes.pop();
    else {
      colon.lastIndex = token.lastIndex;
      const keys = scopes.at(-1);
      if (keys && colon.test(text)) {
        const key = JSON.parse(part);
        if (keys.has(key)) return true;
        keys.add(key);
      }
    }
  }
  return false;
}

/**
 * Evaluator verdict for one screenshot, from the strict JSON result the
 * validateLayout prompt (src/services/llm.ts) requires:
 *   {"verdict":"pass"|"fail"|"blocked","defects":[{"severity","description"}],"summary"}
 * Only a well-formed "pass" with no critical defect is "ok", and only a
 * well-formed "fail" naming a critical defect is "critical". Prose, refusals,
 * "blocked", malformed, duplicated or self-contradictory results are
 * "inconclusive" and can never approve a screenshot.
 */
export function verdictFor(analysis) {
  if (typeof analysis !== "string" || !analysis.trim()) return "inconclusive";
  const text = unfenced(analysis.trim());
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    return "inconclusive";
  }
  if (hasDuplicateKeys(text)) return "inconclusive";
  if (!result || typeof result !== "object" || Array.isArray(result)) return "inconclusive";
  const { verdict, defects } = result;
  if (
    !Array.isArray(defects) ||
    defects.some(
      (defect) =>
        !DEFECT_SEVERITIES.has(defect?.severity) ||
        typeof defect?.description !== "string" ||
        !defect.description.trim(),
    )
  )
    return "inconclusive";
  const critical = defects.some((defect) => defect.severity === "critical");
  if (verdict === "pass" && !critical) return "ok";
  if (verdict === "fail" && critical) return "critical";
  return "inconclusive";
}

/**
 * The browser must end on the requested route: the same URL, or the same URL
 * differing only by a trailing slash (a canonical redirect). A redirect to any
 * other page, origin or error page is not a capture of the requested route.
 */
export function landedOnRoute(requestedUrl, finalUrl) {
  if (typeof finalUrl !== "string") return false;
  const alternate = requestedUrl.endsWith("/") ? requestedUrl.slice(0, -1) : `${requestedUrl}/`;
  return finalUrl === requestedUrl || finalUrl === alternate;
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
              return { status: response ? response.status() : 0, url: page.url() };
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

/** Non-shell reachability probe of the exact target. */
async function probeTarget(url, deps, state) {
  try {
    const response = await deps.fetch(`${url}/`, { redirect: "follow" });
    if (response.ok) return true;
  } catch (error) {
    state.errors.push(`reachability: ${messageOf(error)}`);
  }
  state.reasons.add("TARGET_UNREACHABLE");
  return false;
}

async function launch(deps, state) {
  try {
    const browser = await deps.launchBrowser();
    state.browser = browser.version ?? null;
    return browser;
  } catch (error) {
    state.errors.push(`browser: ${messageOf(error)}`);
    state.reasons.add("MISSING_DEPENDENCY");
    return undefined;
  }
}

/** Capture one page at one viewport; failures are recorded, never thrown. */
async function captureOne(page, capture, file, state) {
  try {
    const navigation = await page.goto(capture.url);
    capture.http_status = navigation.status;
    capture.final_url = navigation.url ?? null;
    if (!landedOnRoute(capture.url, capture.final_url)) {
      capture.status = "redirected";
      state.reasons.add("ROUTE_REDIRECTED");
      return;
    }
    if (capture.http_status < 200 || capture.http_status > 299) {
      capture.status = "http_error";
      state.reasons.add("HTTP_NOT_OK");
      return;
    }
    await page.screenshot(file);
    // Read once: the recorded size and digest describe the same bytes.
    const data = readFileSync(file);
    if (data.length === 0) {
      state.reasons.add("CAPTURE_FAILED");
      return;
    }
    capture.screenshot = {
      path: file,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
    capture.status = "captured";
  } catch (error) {
    capture.error = messageOf(error);
    state.reasons.add("CAPTURE_FAILED");
  }
}

/** Sequential by design: one browser context per viewport, one page at a time. */
async function captureAll(browser, { url, pages, viewports }, screenshotsDir, state) {
  try {
    for (const viewport of viewports) {
      const page = await browser.open(viewport);
      try {
        for (const pagePath of pages) {
          const name = pagePath === "/" ? "_index" : pagePath.replaceAll("/", "_");
          const capture = {
            page: pagePath,
            viewport: viewport.name,
            url: `${url}${pagePath}`,
            http_status: 0,
            status: "error",
            screenshot: null,
          };
          state.captures.push(capture);
          await captureOne(
            page,
            capture,
            join(screenshotsDir, `${name}_${viewport.name}.png`),
            state,
          );
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function loadEvaluatorFor(hasKey, clientId, deps, state) {
  if (!hasKey || !state.captures.some((capture) => capture.status === "captured")) return undefined;
  try {
    return await deps.loadEvaluator(clientId);
  } catch (error) {
    state.errors.push(`evaluator: ${messageOf(error)}`);
    state.reasons.add("EVALUATOR_UNAVAILABLE");
    return undefined;
  }
}

/** One evaluator verdict per captured screenshot; without an evaluator it stays not_run. */
async function evaluateAll(evaluator, viewports, state) {
  for (const capture of state.captures) {
    if (capture.status !== "captured") continue;
    const evaluation = { page: capture.page, viewport: capture.viewport, verdict: "not_run" };
    state.evaluations.push(evaluation);
    if (!evaluator) continue;
    const viewport = viewports.find((candidate) => candidate.name === capture.viewport);
    try {
      const analysis = await evaluator.validateLayout(
        [capture.screenshot.path],
        `Page: ${capture.page}, Viewport: ${viewport.name} (${viewport.width}x${viewport.height})`,
      );
      evaluation.verdict = verdictFor(analysis);
      evaluation.analysis = typeof analysis === "string" ? analysis : null;
      if (evaluation.verdict === "inconclusive") state.reasons.add("EVALUATION_INCONCLUSIVE");
      if (evaluation.verdict === "critical") state.reasons.add("CRITICAL_FINDING");
    } catch (error) {
      evaluation.verdict = "error";
      evaluation.error = messageOf(error);
      state.reasons.add("EVALUATION_FAILED");
    }
  }
}

const DEFECT_REASONS = ["CRITICAL_FINDING", "HTTP_NOT_OK", "ROUTE_REDIRECTED", "CAPTURE_FAILED"];

function outcome(reasons) {
  if (reasons.size === 0) return "PASS";
  return DEFECT_REASONS.some((code) => reasons.has(code)) ? "FAIL" : "BLOCKED";
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

  const state = { reasons: new Set(), captures: [], evaluations: [], errors: [], browser: null };
  const startedAt = deps.now().toISOString();
  try {
    const missing = EVALUATOR_CREDENTIALS.filter((name) => !deps.env[name]?.trim());
    const hasKey = missing.length === 0;
    if (!hasKey) {
      state.reasons.add("MISSING_EVALUATOR_CREDENTIALS");
      state.errors.push(`evaluator credentials missing: ${missing.join(", ")}`);
    }
    const browser = (await probeTarget(url, deps, state)) ? await launch(deps, state) : undefined;
    if (browser) await captureAll(browser, invocation, screenshotsDir, state);
    const evaluator = await loadEvaluatorFor(hasKey, clientId, deps, state);
    await evaluateAll(evaluator, viewports, state);
  } catch (error) {
    state.errors.push(`unexpected: ${messageOf(error)}`);
    state.reasons.add("UNEXPECTED_ERROR");
  }

  const required = pages.length * viewports.length;
  const captured = state.captures.filter((capture) => capture.status === "captured").length;
  const approved = state.evaluations.filter((evaluation) => evaluation.verdict === "ok").length;
  if (captured !== required || approved !== required) state.reasons.add("INCOMPLETE_COVERAGE");

  const report = {
    schema: VISUAL_QA_REPORT_SCHEMA,
    run_id: runId,
    status: outcome(state.reasons),
    reasons: [...state.reasons].sort((a, b) => a.localeCompare(b)),
    target_url: url,
    requested: { pages, viewports: viewports.map((viewport) => viewport.name) },
    coverage: { required, captured, approved },
    browser: state.browser,
    started_at: startedAt,
    completed_at: deps.now().toISOString(),
    captures: state.captures,
    evaluations: state.evaluations,
    errors: state.errors,
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
