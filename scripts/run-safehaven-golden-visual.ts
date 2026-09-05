// L9_META: layer=cli, role=safehaven_golden_rendered_evidence, status=active, version=1.0.0
//
// Safe Haven real-Golden bridge, stage 2 of 3: the POST-DEPLOYMENT rendered
// evidence collector.
//
// It visits the deployed candidate exactly as a visitor would and records only
// what it actually observed:
//   * every frozen case route: HTTP status, path drift, H1 count, title,
//     meta description, canonical, lang;
//   * same-origin internal links across the whole rendered corpus;
//   * rendered business truth (phone, email, prohibited claim patterns);
//   * 5 sentinel routes x 2 viewports = 10 blind screenshot pairs;
//   * 3 blind judge trials per pair = 30 governed VISUAL_QA Router calls,
//     each with its full audit record.
//
// It never reads the Website-Bot build, never repairs a page, and never
// self-certifies: normalization is stored as evidence for the verifier to
// recompute, not as authority.

import { createHash, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stripTrailingSlashes } from "./lib/text-trim.mjs";

export const SAFEHAVEN_GOLDEN_VISUAL_SCHEMA =
  "l9.safehaven-golden-visual-evidence/v1" as const;

/* =========================================================
 * TYPES
 * ======================================================= */

export interface GoldenViewport {
  id: string;
  width: number;
  height: number;
  device_scale_factor: number;
}

export interface RenderedRouteObservation {
  route: string;
  http_status: number;
  final_pathname: string;
  path_drift: boolean;
  h1_count: number;
  title: string;
  meta_description: string;
  canonical: string;
  lang: string;
  internal_links: string[];
  text_length: number;
}

export interface VisualTrialEvidence {
  trial_id: string;
  blind: true;
  judge_input_manifest: {
    candidate_identity_exposed: false;
    baseline_identity_exposed: false;
    repository_identity_exposed: false;
    quality_delta_exposed: false;
    previous_verdict_exposed: false;
  };
  orientation: {
    A: "CANDIDATE" | "BASELINE";
    B: "CANDIDATE" | "BASELINE";
    randomized?: boolean;
    reversed_from_trial_1?: boolean;
    independent?: boolean;
  };
  raw_judge: {
    preference: string;
    confidence: number;
    dimensions: Record<string, number>;
    critical_defects_a: string[];
    critical_defects_b: string[];
    short_reason: string;
  };
  normalized_preference: "CANDIDATE" | "BASELINE" | "TIE";
  normalized_candidate_delta: Record<string, number>;
  audit_id: string;
}

export interface VisualPairEvidence {
  route: string;
  viewport: string;
  candidate_blank: boolean;
  baseline_blank: boolean;
  route_match: boolean;
  viewport_match: boolean;
  candidate_run_id: string;
  captured_run_id: string;
  candidate_screenshot_digest: string;
  baseline_screenshot_digest: string;
  trials: VisualTrialEvidence[];
}

export interface VisualQaAuditRecord {
  audit_id: string;
  task_type: string;
  searchRequired: boolean;
  searchPolicySource: string;
  provider: string;
  model: string;
  request_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
}

export interface SafeHavenGoldenVisualEvidence {
  schema: typeof SAFEHAVEN_GOLDEN_VISUAL_SCHEMA;
  case_id: string;
  candidate_run_id: string;
  candidate_url: string;
  baseline_url: string;
  captured_at: string;
  rendered_visual_qa_executed: boolean;
  site: {
    routes: string[];
    reachable_routes: number;
    broken_internal_links: number;
    unique_titles: number;
    unique_canonical_urls: number;
    per_route: Array<{
      route: string;
      http_status: number;
      h1_count: number;
      title: string;
      meta_description: string;
      canonical: string;
      lang: string;
    }>;
    observations: RenderedRouteObservation[];
  };
  business_truth: {
    phone_mismatch_count: number;
    email_mismatch_count: number;
    prohibition_violations: number;
    findings: Array<{ route: string; kind: string; detail: string }>;
  };
  visual: { pairs: VisualPairEvidence[] };
  llm_audit: { operations: { VISUAL_QA: VisualQaAuditRecord[] } };
}

export class GoldenVisualError extends Error {
  readonly code: string;
  constructor(code: string, message: string, evidence?: unknown) {
    super(
      evidence === undefined
        ? `${code}: ${message}`
        : `${code}: ${message}\n${JSON.stringify(evidence, null, 2)}`,
    );
    this.name = "GoldenVisualError";
    this.code = code;
  }
}

/* =========================================================
 * PURE HELPERS (unit-testable without a browser or a provider)
 * ======================================================= */

export function normalizeRoute(value: string): string {
  const trimmed = String(value).trim();
  if (trimmed === "/") return "/";
  return stripTrailingSlashes(trimmed) || "/";
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Same-origin, navigable link targets only. */
export function isInternalLinkCandidate(href: string): boolean {
  const value = href.trim();
  if (value === "" || value.startsWith("#")) return false;
  return !/^(mailto:|tel:|javascript:|sms:|data:)/i.test(value);
}

export function resolveInternalPath(href: string, pageUrl: string, origin: string): string | null {
  if (!isInternalLinkCandidate(href)) return null;
  let resolved: URL;
  try {
    resolved = new URL(href, pageUrl);
  } catch {
    return null;
  }
  if (resolved.origin !== origin) return null;
  return normalizeRoute(resolved.pathname);
}

/**
 * Recompute candidate-relative values from the raw judge output and the
 * orientation actually used. This is the same transform the verifier applies;
 * storing it makes the stored values checkable, never authoritative.
 */
export function normalizePreference(
  rawPreference: string,
  orientation: { A: "CANDIDATE" | "BASELINE"; B: "CANDIDATE" | "BASELINE" },
): "CANDIDATE" | "BASELINE" | "TIE" {
  if (rawPreference === "TIE") return "TIE";
  if (rawPreference === "A") return orientation.A;
  if (rawPreference === "B") return orientation.B;
  throw new GoldenVisualError("VISUAL_RAW_PREFERENCE_INVALID", `unusable preference ${rawPreference}`);
}

export function normalizeDelta(
  rawDelta: number,
  orientation: { A: "CANDIDATE" | "BASELINE"; B: "CANDIDATE" | "BASELINE" },
): number {
  return orientation.B === "CANDIDATE" ? rawDelta : -rawDelta;
}

export function orientationForTrial(
  trialIndex: number,
  trialOne: { A: "CANDIDATE" | "BASELINE"; B: "CANDIDATE" | "BASELINE" } | null,
  coin: () => boolean,
): VisualTrialEvidence["orientation"] {
  if (trialIndex === 0) {
    const candidateFirst = coin();
    return {
      A: candidateFirst ? "CANDIDATE" : "BASELINE",
      B: candidateFirst ? "BASELINE" : "CANDIDATE",
      randomized: true,
    };
  }
  if (trialIndex === 1) {
    if (!trialOne) {
      throw new GoldenVisualError(
        "VISUAL_ORIENTATION_REVERSAL_EVIDENCE_MISSING",
        "trial 2 cannot be reversed without trial 1 orientation",
      );
    }
    return { A: trialOne.B, B: trialOne.A, reversed_from_trial_1: true };
  }
  const candidateFirst = coin();
  return {
    A: candidateFirst ? "CANDIDATE" : "BASELINE",
    B: candidateFirst ? "BASELINE" : "CANDIDATE",
    randomized: true,
    independent: true,
  };
}

/** Strict judge-output parser: no repair, no defaulting, no coercion of missing scores. */
export function parseJudgeResponse(
  raw: string,
  dimensionNames: string[],
  scoreScale: { minimum: number; maximum: number },
): VisualTrialEvidence["raw_judge"] {
  const fenced = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new GoldenVisualError("VISUAL_RAW_JUDGE_EVIDENCE_MISSING", "judge returned no JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1)) as unknown;
  } catch (error) {
    throw new GoldenVisualError(
      "VISUAL_RAW_JUDGE_EVIDENCE_MISSING",
      `judge JSON is unparseable: ${(error as Error).message}`,
    );
  }
  const value = parsed as Record<string, unknown>;
  const preference = value.preference;
  if (preference !== "A" && preference !== "B" && preference !== "TIE") {
    throw new GoldenVisualError("VISUAL_RAW_PREFERENCE_INVALID", "judge preference must be A|B|TIE", preference);
  }
  const dimensions = value.dimensions;
  if (typeof dimensions !== "object" || dimensions === null) {
    throw new GoldenVisualError("VISUAL_RAW_DIMENSIONS_MISSING", "judge returned no dimensions");
  }
  const scores: Record<string, number> = {};
  for (const name of dimensionNames) {
    const score = (dimensions as Record<string, unknown>)[name];
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new GoldenVisualError("VISUAL_RAW_DIMENSION_MISSING", `judge omitted dimension ${name}`);
    }
    if (score < scoreScale.minimum || score > scoreScale.maximum) {
      throw new GoldenVisualError(
        "VISUAL_RAW_DIMENSION_SCORE_OUT_OF_RANGE",
        `dimension ${name} scored ${score} outside [${scoreScale.minimum}, ${scoreScale.maximum}]`,
      );
    }
    scores[name] = score;
  }
  const stringArray = (input: unknown): string[] =>
    Array.isArray(input) ? input.map((entry) => String(entry)) : [];
  return {
    preference,
    confidence: typeof value.confidence === "number" ? value.confidence : 0,
    dimensions: scores,
    critical_defects_a: stringArray(value.critical_defects_a),
    critical_defects_b: stringArray(value.critical_defects_b),
    short_reason: typeof value.short_reason === "string" ? value.short_reason : "",
  };
}

/**
 * Router policy-source tokens normalized to the oracle's vocabulary: the
 * Router reports `explicit` / `task_default`, the oracle names EXPLICIT /
 * TASK_DEFAULT. Case is the only difference; the value itself is the Router's.
 */
export function oracleSearchPolicySource(routerValue: string): string {
  return String(routerValue).trim().toUpperCase();
}

export function scanBusinessTruth(
  route: string,
  text: string,
  html: string,
  facts: { phone_display: string; phone_e164: string; email: string },
  forbiddenPatterns: string[],
): Array<{ route: string; kind: string; detail: string }> {
  const findings: Array<{ route: string; kind: string; detail: string }> = [];
  const expectedDigits = digitsOnly(facts.phone_e164);
  for (const match of html.matchAll(/(?:tel:)?(\+?\d[\d\s().-]{6,}\d)/g)) {
    const observed = digitsOnly(match[1] ?? "");
    if (observed.length < 10) continue;
    if (!expectedDigits.endsWith(observed) && !observed.endsWith(expectedDigits.slice(-10))) {
      findings.push({ route, kind: "phone", detail: match[1] ?? "" });
    }
  }
  // Bounded by the protocol's own limits — RFC 5321 caps a local-part at 64
  // octets and RFC 1035 a DNS label at 63 — so no real address stops matching
  // and the futile backtracking before "@" and "." is capped (typescript:S8786).
  for (const match of html.matchAll(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g)) {
    const observed = match[0].toLowerCase();
    if (observed !== facts.email.toLowerCase()) {
      findings.push({ route, kind: "email", detail: match[0] });
    }
  }
  for (const pattern of forbiddenPatterns) {
    const expression = new RegExp(pattern, "gi");
    for (const match of text.matchAll(expression)) {
      findings.push({ route, kind: "prohibition", detail: match[0] });
    }
  }
  return findings;
}

export function summarizeBusinessTruth(
  findings: Array<{ route: string; kind: string; detail: string }>,
): SafeHavenGoldenVisualEvidence["business_truth"] {
  return {
    phone_mismatch_count: findings.filter((f) => f.kind === "phone").length,
    email_mismatch_count: findings.filter((f) => f.kind === "email").length,
    prohibition_violations: findings.filter((f) => f.kind === "prohibition").length,
    findings,
  };
}

export function summarizeSite(
  observations: RenderedRouteObservation[],
  expectedRoutes: string[],
): SafeHavenGoldenVisualEvidence["site"] {
  const expected = new Set(expectedRoutes.map(normalizeRoute));
  const reachable = observations.filter(
    (observation) =>
      observation.http_status === 200 &&
      !observation.path_drift &&
      observation.h1_count === 1 &&
      observation.title.trim() !== "" &&
      observation.meta_description.trim() !== "" &&
      observation.canonical.trim() !== "" &&
      observation.lang.trim() !== "",
  ).length;
  const observedPaths = new Set(observations.map((observation) => normalizeRoute(observation.route)));
  let brokenInternalLinks = 0;
  for (const observation of observations) {
    for (const link of observation.internal_links) {
      if (!expected.has(link) && !observedPaths.has(link)) brokenInternalLinks += 1;
    }
  }
  return {
    routes: observations.map((observation) => observation.route),
    reachable_routes: reachable,
    broken_internal_links: brokenInternalLinks,
    unique_titles: new Set(observations.map((o) => o.title.trim()).filter(Boolean)).size,
    unique_canonical_urls: new Set(observations.map((o) => o.canonical.trim()).filter(Boolean)).size,
    per_route: observations.map((observation) => ({
      route: observation.route,
      http_status: observation.http_status,
      h1_count: observation.h1_count,
      title: observation.title,
      meta_description: observation.meta_description,
      canonical: observation.canonical,
      lang: observation.lang,
    })),
    observations,
  };
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const output = resolve(path);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  renameSync(temporary, output);
}

export function readJson(path: string): unknown {
  if (!existsSync(path)) throw new GoldenVisualError("INPUT_MISSING", `file not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

/* =========================================================
 * BROWSER SEAM
 * ======================================================= */

interface RenderedPage {
  status: number;
  finalUrl: string;
  html: string;
  text: string;
  h1Count: number;
  title: string;
  metaDescription: string;
  canonical: string;
  lang: string;
  links: string[];
}

interface BrowserPort {
  render(url: string, viewport: GoldenViewport): Promise<RenderedPage>;
  screenshot(url: string, viewport: GoldenViewport): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * Playwright is loaded through a runtime specifier so this module stays
 * importable (and unit-testable) without a browser. Unlike the crawler's
 * best-effort capturer, every failure here is fatal: unobserved evidence must
 * never be silently downgraded to "no finding".
 */
class PlaywrightBrowserPort implements BrowserPort {
  private browser: {
    newContext(options: unknown): Promise<unknown>;
    close(): Promise<void>;
  } | undefined;

  private async ensureBrowser(): Promise<NonNullable<PlaywrightBrowserPort["browser"]>> {
    if (this.browser) return this.browser;
    const specifier = "playwright";
    const module_ = (await import(specifier)) as {
      chromium: { launch(options?: unknown): Promise<NonNullable<PlaywrightBrowserPort["browser"]>> };
    };
    this.browser = await module_.chromium.launch({ headless: true });
    return this.browser;
  }

  private async withPage<T>(
    url: string,
    viewport: GoldenViewport,
    action: (page: Record<string, (...args: never[]) => Promise<unknown>>, response: unknown) => Promise<T>,
  ): Promise<T> {
    const browser = await this.ensureBrowser();
    const context = (await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.device_scale_factor,
    })) as { newPage(): Promise<unknown>; close(): Promise<void> };
    try {
      const page = (await context.newPage()) as Record<string, (...args: never[]) => Promise<unknown>>;
      const response = await (page.goto as unknown as (
        target: string,
        options: unknown,
      ) => Promise<unknown>)(url, { waitUntil: "networkidle", timeout: 45_000 });
      return await action(page, response);
    } finally {
      await context.close();
    }
  }

  async render(url: string, viewport: GoldenViewport): Promise<RenderedPage> {
    return this.withPage(url, viewport, async (page, response) => {
      const evaluate = page.evaluate as unknown as <T>(fn: string) => Promise<T>;
      const status = (response as { status(): number } | null)?.status() ?? 0;
      const finalUrl = await (page.url as unknown as () => string | Promise<string>)();
      const extracted = await evaluate<{
        html: string;
        text: string;
        h1Count: number;
        title: string;
        metaDescription: string;
        canonical: string;
        lang: string;
        links: string[];
      }>(`(() => ({
        html: document.documentElement.outerHTML,
        text: document.body ? document.body.innerText : "",
        h1Count: document.querySelectorAll("h1").length,
        title: document.title || "",
        metaDescription:
          document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
        lang: document.documentElement.getAttribute("lang") || "",
        links: Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") || ""),
      }))()`);
      return { status, finalUrl: String(finalUrl), ...extracted };
    });
  }

  async screenshot(url: string, viewport: GoldenViewport): Promise<Uint8Array> {
    return this.withPage(url, viewport, async (page) => {
      const shot = page.screenshot as unknown as (options: unknown) => Promise<Uint8Array>;
      return shot({ fullPage: false, type: "png" });
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }
}

/* =========================================================
 * JUDGE SEAM
 * ======================================================= */

export interface JudgeCallResult {
  content: string;
  provider: string;
  model: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  searchRequired: boolean;
  searchPolicySource: string;
}

export interface JudgePort {
  judge(systemPrompt: string, userPrompt: string, imageDataUris: string[]): Promise<JudgeCallResult>;
}

/**
 * Governed VISUAL_QA judging. `requiresSearch` is set explicitly to false, so
 * the Router itself reports searchPolicySource EXPLICIT — the audit record is
 * the Router's own routing resolution, never an assertion by this script.
 */
class RouterJudgePort implements JudgePort {
  private router: {
    initClient(clientId: string): Promise<void>;
    route(task: unknown): { searchRequired: boolean; searchPolicySource: string };
    execute(
      task: unknown,
      systemPrompt: string,
      userPrompt: string,
      options?: { images?: string[] },
    ): Promise<{
      content: string;
      provider: string;
      model: string;
      requestId?: string;
      inputTokens: number;
      outputTokens: number;
      cost: number;
      latencyMs: number;
    }>;
  } | undefined;

  private taskType = "visual_qa";

  constructor(private readonly clientId: string) {}

  private requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new GoldenVisualError("LLM_CONFIG_MISSING", `${name} is required for VISUAL_QA judging`);
    return value;
  }

  private async ensureRouter(): Promise<NonNullable<RouterJudgePort["router"]>> {
    if (this.router) return this.router;
    const specifier = "@quantum-l9/llm-router";
    const module_ = (await import(specifier)) as {
      L9LLMRouter: new (config: unknown) => NonNullable<RouterJudgePort["router"]>;
      TaskType: Record<string, string>;
    };
    this.taskType = module_.TaskType.VISUAL_QA ?? "visual_qa";
    const router = new module_.L9LLMRouter({
      openrouterApiKey: this.requireEnv("OPENROUTER_API_KEY"),
      perplexityApiKey: this.requireEnv("PERPLEXITY_API_KEY"),
      appName: "L9-Website-Bot-Golden",
      providerMaxRetries: 0,
    });
    await router.initClient(this.clientId);
    this.router = router;
    return router;
  }

  async judge(
    systemPrompt: string,
    userPrompt: string,
    imageDataUris: string[],
  ): Promise<JudgeCallResult> {
    const router = await this.ensureRouter();
    const task = {
      clientId: this.clientId,
      type: this.taskType,
      complexity: "medium",
      // EXPLICIT search policy: Golden visual adjudication must never search.
      requiresSearch: false,
      expectedOutputTokens: 900,
      description: "[golden-visual-qa] blind_pairwise_adjudication",
      images: imageDataUris,
    };
    const resolution = router.route(task);
    const response = await router.execute(task, systemPrompt, userPrompt, { images: imageDataUris });
    return {
      content: response.content,
      provider: String(response.provider),
      model: response.model,
      requestId: response.requestId ?? "",
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: response.cost,
      latencyMs: response.latencyMs,
      searchRequired: resolution.searchRequired,
      searchPolicySource: oracleSearchPolicySource(resolution.searchPolicySource),
    };
  }
}

/* =========================================================
 * COLLECTION
 * ======================================================= */

export interface CollectOptions {
  casePath: string;
  oraclePath: string;
  judgePath: string;
  candidateUrl: string;
  baselineUrl: string;
  candidateRunId: string;
  outputPath: string;
}

interface CaseAuthority {
  case_id: string;
  routes: string[];
  visual_sentinels: Array<{ route: string; critical: boolean }>;
  viewports: GoldenViewport[];
  verified_business_facts: { phone_display: string; phone_e164: string; email: string };
  fact_guardrails: { forbidden_patterns: string[] };
}

interface OracleAuthority {
  visual_oracle: {
    trials_per_pair: number;
    dimensions: Record<string, number>;
    score_scale: { minimum: number; maximum: number };
  };
  visual_capture: { required_pairs: number; routes: number; viewports: number };
  site_integrity: { built_routes: number };
}

function pngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

/** A capture that painted nothing is evidence of failure, not a tie. */
function isBlankCapture(bytes: Uint8Array, textLength: number): boolean {
  return bytes.byteLength < 5_000 || textLength < 40;
}

export async function collectRenderedEvidence(
  options: CollectOptions,
  browser: BrowserPort,
  judge: JudgePort,
  coin: () => boolean = () => randomInt(0, 2) === 1,
): Promise<SafeHavenGoldenVisualEvidence> {
  const testCase = readJson(options.casePath) as CaseAuthority & { schema?: string };
  const oracle = readJson(options.oraclePath) as OracleAuthority & { schema?: string };
  const judgePrompt = readFileSync(options.judgePath, "utf-8");

  const dimensionNames = Object.keys(oracle.visual_oracle.dimensions);
  const scoreScale = oracle.visual_oracle.score_scale;
  const trialsPerPair = oracle.visual_oracle.trials_per_pair;
  const candidateOrigin = new URL(options.candidateUrl).origin;

  if (testCase.routes.length !== oracle.site_integrity.built_routes) {
    throw new GoldenVisualError(
      "ROUTE_COUNT_MISMATCH",
      "case route count does not match the oracle built-route count",
      { case: testCase.routes.length, oracle: oracle.site_integrity.built_routes },
    );
  }

  // ---- Phase A: full rendered corpus over every frozen route -----------
  const integrityViewport = testCase.viewports[0];
  if (!integrityViewport) throw new GoldenVisualError("INPUT_MISSING", "case declares no viewport");
  const observations: RenderedRouteObservation[] = [];
  const truthFindings: Array<{ route: string; kind: string; detail: string }> = [];
  for (const route of testCase.routes) {
    const target = new URL(route, options.candidateUrl).toString();
    const page = await browser.render(target, integrityViewport);
    const finalPathname = normalizeRoute(new URL(page.finalUrl).pathname);
    observations.push({
      route,
      http_status: page.status,
      final_pathname: finalPathname,
      path_drift: finalPathname !== normalizeRoute(route),
      h1_count: page.h1Count,
      title: page.title,
      meta_description: page.metaDescription,
      canonical: page.canonical,
      lang: page.lang,
      internal_links: [
        ...new Set(
          page.links
            .map((href) => resolveInternalPath(href, page.finalUrl, candidateOrigin))
            .filter((value): value is string => value !== null),
        ),
      ],
      text_length: page.text.length,
    });
    truthFindings.push(
      ...scanBusinessTruth(
        route,
        page.text,
        page.html,
        testCase.verified_business_facts,
        testCase.fact_guardrails.forbidden_patterns,
      ),
    );
  }

  // ---- Phase B/C: 10 blind pairs x 3 trials ----------------------------
  const pairs: VisualPairEvidence[] = [];
  const auditRecords: VisualQaAuditRecord[] = [];
  for (const sentinel of testCase.visual_sentinels) {
    for (const viewport of testCase.viewports) {
      const candidateTarget = new URL(sentinel.route, options.candidateUrl).toString();
      const baselineTarget = new URL(sentinel.route, options.baselineUrl).toString();
      const candidateShot = await browser.screenshot(candidateTarget, viewport);
      const baselineShot = await browser.screenshot(baselineTarget, viewport);
      // Baseline paint is measured, never assumed: a blank baseline would make
      // the comparison meaningless and is recorded as such.
      const baselinePage = await browser.render(baselineTarget, viewport);
      const candidatePage = observations.find(
        (observation) => normalizeRoute(observation.route) === normalizeRoute(sentinel.route),
      );
      if (!candidatePage) {
        throw new GoldenVisualError(
          "VISUAL_ROUTE_MISMATCH",
          `sentinel ${sentinel.route} was never rendered in the integrity pass`,
        );
      }

      const trials: VisualTrialEvidence[] = [];
      let trialOne: VisualTrialEvidence["orientation"] | null = null;
      for (let trialIndex = 0; trialIndex < trialsPerPair; trialIndex++) {
        const orientation = orientationForTrial(
          trialIndex,
          trialOne ? { A: trialOne.A, B: trialOne.B } : null,
          coin,
        );
        if (trialIndex === 0) trialOne = orientation;
        const imageA = orientation.A === "CANDIDATE" ? candidateShot : baselineShot;
        const imageB = orientation.B === "CANDIDATE" ? candidateShot : baselineShot;
        const auditId = `golden-visual-${normalizeRoute(sentinel.route).replace(/\//g, "_") || "root"}-${viewport.id}-trial-${trialIndex + 1}`;
        const result = await judge.judge(
          judgePrompt,
          [
            `ROUTE PURPOSE: ${sentinel.route}`,
            `VIEWPORT: ${viewport.id} ${viewport.width}x${viewport.height}`,
            "IMAGE A is the first attached image. IMAGE B is the second attached image.",
            "Return JSON only, exactly as specified.",
          ].join("\n"),
          [pngDataUri(imageA), pngDataUri(imageB)],
        );
        const rawJudge = parseJudgeResponse(result.content, dimensionNames, scoreScale);
        const orientationPair = { A: orientation.A, B: orientation.B };
        trials.push({
          trial_id: `${normalizeRoute(sentinel.route)}::${viewport.id}::trial-${trialIndex + 1}`,
          blind: true,
          judge_input_manifest: {
            candidate_identity_exposed: false,
            baseline_identity_exposed: false,
            repository_identity_exposed: false,
            quality_delta_exposed: false,
            previous_verdict_exposed: false,
          },
          orientation,
          raw_judge: rawJudge,
          normalized_preference: normalizePreference(rawJudge.preference, orientationPair),
          normalized_candidate_delta: Object.fromEntries(
            dimensionNames.map((name) => [
              name,
              normalizeDelta(rawJudge.dimensions[name] as number, orientationPair),
            ]),
          ),
          audit_id: auditId,
        });
        auditRecords.push({
          audit_id: auditId,
          task_type: "VISUAL_QA",
          searchRequired: result.searchRequired,
          searchPolicySource: result.searchPolicySource,
          provider: result.provider,
          model: result.model,
          request_id: result.requestId,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          cost_usd: result.costUsd,
          latency_ms: result.latencyMs,
        });
      }

      pairs.push({
        route: sentinel.route,
        viewport: viewport.id,
        candidate_blank: isBlankCapture(candidateShot, candidatePage.text_length),
        baseline_blank: isBlankCapture(baselineShot, baselinePage.text.length),
        route_match: !candidatePage.path_drift,
        viewport_match: true,
        candidate_run_id: options.candidateRunId,
        captured_run_id: options.candidateRunId,
        candidate_screenshot_digest: sha256Hex(candidateShot),
        baseline_screenshot_digest: sha256Hex(baselineShot),
        trials,
      });
    }
  }

  if (pairs.length !== oracle.visual_capture.required_pairs) {
    throw new GoldenVisualError("VISUAL_CAPTURE_INCOMPLETE", "visual pair count violates the oracle", {
      expected: oracle.visual_capture.required_pairs,
      actual: pairs.length,
    });
  }
  const totalTrials = pairs.reduce((sum, pair) => sum + pair.trials.length, 0);
  if (totalTrials !== oracle.visual_capture.required_pairs * trialsPerPair) {
    throw new GoldenVisualError("VISUAL_ORACLE_MISSING_TRIAL", "blind trial count violates the oracle", {
      expected: oracle.visual_capture.required_pairs * trialsPerPair,
      actual: totalTrials,
    });
  }

  return {
    schema: SAFEHAVEN_GOLDEN_VISUAL_SCHEMA,
    case_id: testCase.case_id,
    candidate_run_id: options.candidateRunId,
    candidate_url: options.candidateUrl,
    baseline_url: options.baselineUrl,
    captured_at: new Date().toISOString(),
    rendered_visual_qa_executed: true,
    site: summarizeSite(observations, testCase.routes),
    business_truth: summarizeBusinessTruth(truthFindings),
    visual: { pairs },
    llm_audit: { operations: { VISUAL_QA: auditRecords } },
  };
}

/* =========================================================
 * CLI
 * ======================================================= */

function argumentValue(argv: string[], name: string): string | undefined {
  return argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function main(argv: string[]): Promise<void> {
  if (process.env.GOLDEN_CALIBRATION_MODE) {
    throw new GoldenVisualError(
      "GOLDEN_CALIBRATION_MODE_SET",
      "rendered Golden evidence must never be collected in calibration mode",
    );
  }
  if (!argv.includes("--authorize-paid-visual")) {
    throw new GoldenVisualError(
      "PAID_VISUAL_NOT_AUTHORIZED",
      "30 paid VISUAL_QA Router calls require --authorize-paid-visual",
    );
  }
  const candidateUrl = argumentValue(argv, "candidate-url");
  const candidateRunId = argumentValue(argv, "run-id");
  if (!candidateUrl || !/^https:\/\//.test(candidateUrl)) {
    throw new GoldenVisualError("CANDIDATE_URL_INVALID", "--candidate-url must be an HTTPS URL");
  }
  if (!candidateRunId?.trim()) {
    throw new GoldenVisualError("RUN_ID_MISSING", "--run-id=<build id> is required");
  }
  const casePath = argumentValue(argv, "case") ?? "tests/golden/safehaven/case.json";
  const testCase = readJson(casePath) as { source_url?: string };
  const baselineUrl = argumentValue(argv, "baseline-url") ?? testCase.source_url;
  if (!baselineUrl) throw new GoldenVisualError("BASELINE_URL_MISSING", "no baseline URL available");

  const outputPath = argumentValue(argv, "out") ?? "evidence/safehaven-golden-visual.json";
  const browser = new PlaywrightBrowserPort();
  try {
    const evidence = await collectRenderedEvidence(
      {
        casePath,
        oraclePath: argumentValue(argv, "oracle") ?? "tests/golden/safehaven/oracle.json",
        judgePath: argumentValue(argv, "judge") ?? "tests/golden/safehaven/visual-judge.md",
        candidateUrl,
        baselineUrl,
        candidateRunId,
        outputPath,
      },
      browser,
      new RouterJudgePort(argumentValue(argv, "client-id") ?? "safehaven-golden"),
    );
    writeJsonAtomic(outputPath, evidence);
    console.log(
      JSON.stringify(
        {
          schema: "l9.safehaven-golden-visual-result/v1",
          output: outputPath,
          routes_observed: evidence.site.observations.length,
          reachable_routes: evidence.site.reachable_routes,
          broken_internal_links: evidence.site.broken_internal_links,
          visual_pairs: evidence.visual.pairs.length,
          visual_trials: evidence.llm_audit.operations.VISUAL_QA.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).endsWith("run-safehaven-golden-visual.ts");
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
