// L9_META: layer=cli, role=safehaven_golden_receipt_merger, status=active, version=1.0.0
//
// Safe Haven real-Golden bridge, stage 3 of 3: the STRICT MERGER.
//
// This script produces no evidence of its own. It takes three independently
// produced, independently owned records —
//   * Website-Bot runtime evidence (l9.safehaven-real-runtime-evidence/v1)
//   * rendered post-deployment evidence (l9.safehaven-golden-visual-evidence/v1)
//   * SEO-Bot per-run LLM audit (l9.seo-bot-run-llm-audit/v1)
// — proves they describe the same run, and assembles `l9.golden-run-receipt/v1`.
//
// Every composition rule is fail-closed. A caller cannot override a business
// truth count, cannot supply a section the producers did not produce, and
// cannot merge a synthetic calibration artefact into a real Golden receipt.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stripTrailingSlashes } from "../src/lib/text-trim.mjs";

export const GOLDEN_RUN_RECEIPT_SCHEMA = "l9.golden-run-receipt/v1" as const;
export const SEO_LLM_AUDIT_SCHEMA = "l9.seo-bot-run-llm-audit/v1" as const;

const SEO_OWNED_OPERATIONS = [
  "SEO_CONTENT_BLUEPRINT",
  "STRUCTURED_CONTENT_GENERATION",
  "CONTENT_VALIDATION",
] as const;

const FULL_SHA = /^[0-9a-f]{40}$/;

export class GoldenReceiptMergeError extends Error {
  readonly code: string;
  constructor(code: string, message: string, evidence?: unknown) {
    super(
      evidence === undefined
        ? `${code}: ${message}`
        : `${code}: ${message}\n${JSON.stringify(evidence, null, 2)}`,
    );
    this.name = "GoldenReceiptMergeError";
    this.code = code;
  }
}

function halt(code: string, message: string, evidence?: unknown): never {
  throw new GoldenReceiptMergeError(code, message, evidence);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRoute(value: string): string {
  const trimmed = String(value).trim();
  if (trimmed === "/") return "/";
  return stripTrailingSlashes(trimmed) || "/";
}

export function readJson(path: string, code: string): unknown {
  if (!existsSync(path)) halt(code, `required input not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch (error) {
    halt(code, `unreadable JSON at ${path}: ${(error as Error).message}`);
  }
}

/** No input may carry a synthetic-calibration marker into a real receipt. */
export function assertNotSynthetic(value: unknown, label: string): void {
  if (isObject(value) && isObject(value.calibration) && value.calibration.synthetic === true) {
    halt("SYNTHETIC_CALIBRATION_INPUT", `${label} is a synthetic calibration artefact`);
  }
}

export interface MergeInputs {
  testCase: Record<string, unknown>;
  oracle: Record<string, unknown>;
  runtime: Record<string, unknown>;
  rendered: Record<string, unknown>;
  seoAudit: Record<string, unknown>;
}

/* =========================================================
 * INPUT VALIDATION
 * ======================================================= */

function assertRuntimeShape(runtime: Record<string, unknown>): void {
  if (runtime.schema !== "l9.safehaven-real-runtime-evidence/v1") {
    halt(
      "RUNTIME_EVIDENCE_INVALID",
      "runtime evidence schema is not l9.safehaven-real-runtime-evidence/v1",
      runtime.schema,
    );
  }
  for (const section of [
    "identity",
    "run",
    "preflight",
    "events",
    "competitive_landscape",
    "donor_evidence",
    "website_build_blueprint",
    "seo_content_blueprint",
    "page_content_contract",
    "structured_content",
    "legacy",
    "assets",
    "site_build",
  ]) {
    if (runtime[section] === undefined || runtime[section] === null) {
      halt("RUNTIME_SECTION_MISSING", `runtime evidence section missing: ${section}`);
    }
  }
  const unresolved = runtime.unresolved_external_dependencies;
  if (!Array.isArray(unresolved)) {
    halt(
      "RUNTIME_EVIDENCE_INVALID",
      "runtime evidence must declare unresolved_external_dependencies",
    );
  }
  const identity = runtime.identity as Record<string, unknown>;
  for (const repo of ["website_bot", "seo_bot", "llm_router"]) {
    const entry = identity[repo];
    if (!isObject(entry) || typeof entry.sha !== "string" || !FULL_SHA.test(entry.sha)) {
      halt("IDENTITY_SHA_INVALID", `${repo} identity SHA is missing or malformed`);
    }
  }
}

function assertRenderedShape(rendered: Record<string, unknown>): void {
  if (rendered.schema !== "l9.safehaven-golden-visual-evidence/v1") {
    halt(
      "RENDERED_EVIDENCE_INVALID",
      "rendered evidence schema is not l9.safehaven-golden-visual-evidence/v1",
      rendered.schema,
    );
  }
  if (rendered.rendered_visual_qa_executed !== true) {
    halt(
      "RENDERED_VISUAL_QA_NOT_EXECUTED",
      "rendered evidence does not record an executed visual QA pass",
    );
  }
  if (
    !isObject(rendered.site) ||
    !Array.isArray((rendered.site as Record<string, unknown>).per_route)
  ) {
    halt("RENDERED_EVIDENCE_INVALID", "rendered evidence carries no per-route site observations");
  }
  if (
    !isObject(rendered.visual) ||
    !Array.isArray((rendered.visual as Record<string, unknown>).pairs)
  ) {
    halt("VISUAL_EVIDENCE_MISSING", "rendered evidence carries no visual pairs");
  }
}

export function assertSeoAudit(
  seoAudit: Record<string, unknown>,
  expectedRunId: string,
  expectedCaseId: string,
): void {
  if (seoAudit.schema !== SEO_LLM_AUDIT_SCHEMA) {
    halt("SEO_AUDIT_INVALID", `SEO audit schema must be ${SEO_LLM_AUDIT_SCHEMA}`, seoAudit.schema);
  }
  if (seoAudit.run_id !== expectedRunId) {
    halt("SEO_AUDIT_RUN_ID_MISMATCH", "SEO audit was produced for a different run", {
      expected: expectedRunId,
      actual: seoAudit.run_id,
    });
  }
  if (seoAudit.case_id !== undefined && seoAudit.case_id !== expectedCaseId) {
    halt("CASE_ID_MISMATCH", "SEO audit case_id does not match the Golden case", seoAudit.case_id);
  }
  const operations = seoAudit.operations;
  if (!isObject(operations)) halt("SEO_AUDIT_INVALID", "SEO audit carries no operations");
  for (const operation of SEO_OWNED_OPERATIONS) {
    const calls = operations[operation];
    if (!Array.isArray(calls) || calls.length === 0) {
      halt("LLM_AUDIT_OPERATION_MISSING", `SEO audit has no ${operation} calls`);
    }
    for (const call of calls) {
      if (
        !isObject(call) ||
        call.searchRequired !== false ||
        call.searchPolicySource !== "EXPLICIT"
      ) {
        halt(
          `${operation}_SEARCH_POLICY_VIOLATION`,
          `${operation} call must record searchRequired=false and searchPolicySource=EXPLICIT`,
          call,
        );
      }
    }
  }
  for (const counter of [
    "direct_provider_bypass_count",
    "unsupported_capability_combination_count",
  ]) {
    if (typeof seoAudit[counter] !== "number") {
      halt("SEO_AUDIT_INVALID", `SEO audit is missing ${counter}`);
    }
  }
}

/* =========================================================
 * CROSS-RECORD IDENTITY
 * ======================================================= */

export function assertSameRun(inputs: MergeInputs): { runId: string; caseId: string } {
  const caseId = inputs.testCase.case_id;
  if (typeof caseId !== "string" || caseId.trim() === "") {
    halt("CASE_ID_MISSING", "case.json carries no case_id");
  }
  if (inputs.runtime.case_id !== caseId) {
    halt(
      "CASE_ID_MISMATCH",
      "runtime evidence belongs to a different case",
      inputs.runtime.case_id,
    );
  }
  if (inputs.rendered.case_id !== caseId) {
    halt(
      "CASE_ID_MISMATCH",
      "rendered evidence belongs to a different case",
      inputs.rendered.case_id,
    );
  }
  const run = inputs.runtime.run as Record<string, unknown>;
  const runId = run.run_id;
  if (typeof runId !== "string" || runId.trim() === "") {
    halt("RUN_ID_MISSING", "runtime evidence carries no run_id");
  }
  if (inputs.rendered.candidate_run_id !== runId) {
    halt("CANDIDATE_RUN_ID_MISMATCH", "rendered evidence was captured for a different run", {
      expected: runId,
      actual: inputs.rendered.candidate_run_id,
    });
  }
  return { runId, caseId };
}

export function assertUnresolvedDependenciesResolved(runtime: Record<string, unknown>): void {
  const unresolved = runtime.unresolved_external_dependencies as Array<{
    field: string;
    owner: string;
  }>;
  if (unresolved.length > 0) {
    halt(
      "EXTERNAL_DEPENDENCY_UNRESOLVED",
      "runtime evidence still names facts its owning repository has not supplied",
      unresolved,
    );
  }
}

/* =========================================================
 * VISUAL + SITE VALIDATION
 * ======================================================= */

export function assertVisualEvidence(
  rendered: Record<string, unknown>,
  testCase: Record<string, unknown>,
  oracle: Record<string, unknown>,
  runId: string,
): void {
  const pairs = (rendered.visual as { pairs: Array<Record<string, unknown>> }).pairs;
  const sentinels = testCase.visual_sentinels as Array<{ route: string }>;
  const viewports = testCase.viewports as Array<{ id: string }>;
  const expectedKeys = new Set(
    sentinels.flatMap((sentinel) =>
      viewports.map((viewport) => `${normalizeRoute(sentinel.route)}::${viewport.id}`),
    ),
  );
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = `${normalizeRoute(String(pair.route))}::${String(pair.viewport)}`;
    if (seen.has(key)) halt("VISUAL_PAIR_DUPLICATE", `duplicate visual pair ${key}`);
    seen.add(key);
    if (!expectedKeys.has(key)) halt("VISUAL_PAIR_SET_MISMATCH", `unexpected visual pair ${key}`);
    if (pair.candidate_run_id !== runId) {
      halt(
        "STALE_VISUAL_CAPTURE",
        `${key} was captured for a different run`,
        pair.candidate_run_id,
      );
    }
    if (!viewports.some((entry) => entry.id === pair.viewport)) {
      halt("VISUAL_VIEWPORT_MISMATCH", `${key} uses an unknown viewport`);
    }
    const trialsPerPair = (oracle.visual_oracle as { trials_per_pair: number }).trials_per_pair;
    const trials = pair.trials;
    if (!Array.isArray(trials) || trials.length !== trialsPerPair) {
      halt("VISUAL_ORACLE_MISSING_TRIAL", `${key} must carry exactly ${trialsPerPair} trials`, {
        actual: Array.isArray(trials) ? trials.length : null,
      });
    }
    for (const [index, trial] of trials.entries()) {
      if (!isObject(trial))
        halt("VISUAL_ORACLE_MISSING_TRIAL", `${key} trial ${index + 1} is not an object`);
      if (!isObject(trial.orientation)) {
        halt("VISUAL_ORIENTATION_MISSING", `${key} trial ${index + 1} carries no orientation`);
      }
      if (!isObject(trial.raw_judge)) {
        halt(
          "VISUAL_RAW_JUDGE_EVIDENCE_MISSING",
          `${key} trial ${index + 1} carries no raw judge output`,
        );
      }
    }
  }
  for (const key of expectedKeys) {
    if (!seen.has(key)) halt("VISUAL_PAIR_SET_MISMATCH", `missing visual pair ${key}`);
  }
}

export function assertSiteRouteSet(
  rendered: Record<string, unknown>,
  runtime: Record<string, unknown>,
  expectedRoutes: string[],
): void {
  const perRoute = (rendered.site as { per_route: Array<{ route: string }> }).per_route;
  const expected = new Set(expectedRoutes.map(normalizeRoute));
  const observed = new Set<string>();
  for (const row of perRoute) {
    const route = normalizeRoute(row.route);
    if (observed.has(route)) halt("DUPLICATE_ROUTE", `rendered evidence repeats route ${route}`);
    observed.add(route);
    if (!expected.has(route))
      halt("ROUTE_SET_MISMATCH", `rendered evidence contains unexpected route ${route}`);
  }
  for (const route of expected) {
    if (!observed.has(route))
      halt("SITE_ROUTE_MISSING", `rendered evidence is missing route ${route}`);
  }
  const built = (runtime.site_build as { routes: string[] }).routes.map(normalizeRoute);
  const builtSet = new Set(built);
  for (const route of expected) {
    if (!builtSet.has(route)) {
      halt("ROUTE_SET_MISMATCH", `the build produced no route ${route}`, built);
    }
  }
}

export function assertPccDigests(runtime: Record<string, unknown>): void {
  const pcc = runtime.page_content_contract as Record<string, unknown>;
  const determinism = pcc.determinism as Record<string, unknown> | undefined;
  if (
    !determinism ||
    typeof determinism.digest_run_1 !== "string" ||
    typeof determinism.digest_run_2 !== "string" ||
    determinism.digest_run_1.trim() === "" ||
    determinism.digest_run_1 !== determinism.digest_run_2 ||
    determinism.same_semantic_input_same_digest !== true
  ) {
    halt(
      "PCC_DIGEST_MISMATCH",
      "PageContentContract determinism proof is absent or unequal",
      determinism,
    );
  }
}

/* =========================================================
 * MERGE
 * ======================================================= */

export function mergeGoldenReceipt(inputs: MergeInputs): Record<string, unknown> {
  for (const [label, value] of [
    ["runtime evidence", inputs.runtime],
    ["rendered evidence", inputs.rendered],
    ["SEO audit", inputs.seoAudit],
  ] as const) {
    assertNotSynthetic(value, label);
  }
  assertRuntimeShape(inputs.runtime);
  assertRenderedShape(inputs.rendered);
  const { runId, caseId } = assertSameRun(inputs);
  assertSeoAudit(inputs.seoAudit, runId, caseId);
  assertUnresolvedDependenciesResolved(inputs.runtime);
  assertPccDigests(inputs.runtime);

  const expectedRoutes = inputs.testCase.routes as string[];
  assertSiteRouteSet(inputs.rendered, inputs.runtime, expectedRoutes);
  assertVisualEvidence(inputs.rendered, inputs.testCase, inputs.oracle, runId);

  const renderedSite = inputs.rendered.site as Record<string, unknown>;
  const siteBuild = inputs.runtime.site_build as Record<string, unknown>;
  const structured = inputs.runtime.structured_content as Record<string, unknown>;
  const routeResults = structured.route_results as Array<Record<string, unknown>>;

  // Business truth is composed from its owning producers only. There is no
  // caller-supplied override path for any of these four counts.
  const unsupportedClaimCount = routeResults.reduce(
    (sum, row) => sum + Number(row.unsupported_claims ?? 0),
    0,
  );
  const renderedTruth = inputs.rendered.business_truth as Record<string, unknown>;
  for (const field of ["phone_mismatch_count", "email_mismatch_count", "prohibition_violations"]) {
    if (typeof renderedTruth[field] !== "number") {
      halt("BUSINESS_TRUTH_EVIDENCE_MISSING", `rendered evidence carries no ${field}`);
    }
  }

  const visualQaCalls = (inputs.rendered.llm_audit as { operations?: Record<string, unknown> })
    ?.operations?.VISUAL_QA;
  if (!Array.isArray(visualQaCalls) || visualQaCalls.length === 0) {
    halt("LLM_AUDIT_OPERATION_MISSING", "rendered evidence carries no VISUAL_QA audit records");
  }
  const seoOperations = inputs.seoAudit.operations as Record<string, unknown>;

  return {
    schema: GOLDEN_RUN_RECEIPT_SCHEMA,
    case_id: caseId,
    assembled_at: new Date().toISOString(),
    sources: {
      runtime_evidence_schema: inputs.runtime.schema,
      rendered_evidence_schema: inputs.rendered.schema,
      seo_audit_schema: inputs.seoAudit.schema,
    },
    identity: inputs.runtime.identity,
    run: inputs.runtime.run,
    preflight: inputs.runtime.preflight,
    events: inputs.runtime.events,
    competitive_landscape: inputs.runtime.competitive_landscape,
    donor_evidence: inputs.runtime.donor_evidence,
    website_build_blueprint: inputs.runtime.website_build_blueprint,
    seo_content_blueprint: inputs.runtime.seo_content_blueprint,
    page_content_contract: inputs.runtime.page_content_contract,
    structured_content: inputs.runtime.structured_content,
    legacy: inputs.runtime.legacy,
    assets: inputs.runtime.assets,
    site: {
      routes: (renderedSite.per_route as Array<{ route: string }>).map((row) => row.route),
      built_routes: siteBuild.built_routes,
      reachable_routes: renderedSite.reachable_routes,
      broken_internal_links: renderedSite.broken_internal_links,
      placeholder_count: siteBuild.placeholder_count,
      per_route: renderedSite.per_route,
    },
    business_truth: {
      unsupported_claim_count: unsupportedClaimCount,
      phone_mismatch_count: renderedTruth.phone_mismatch_count,
      email_mismatch_count: renderedTruth.email_mismatch_count,
      prohibition_violations: renderedTruth.prohibition_violations,
    },
    llm_audit: {
      direct_provider_bypass_count: inputs.seoAudit.direct_provider_bypass_count,
      unsupported_capability_combination_count:
        inputs.seoAudit.unsupported_capability_combination_count,
      operations: {
        SEO_CONTENT_BLUEPRINT: seoOperations.SEO_CONTENT_BLUEPRINT,
        STRUCTURED_CONTENT_GENERATION: seoOperations.STRUCTURED_CONTENT_GENERATION,
        CONTENT_VALIDATION: seoOperations.CONTENT_VALIDATION,
        VISUAL_QA: visualQaCalls,
      },
    },
    visual: {
      rendered_visual_qa_executed: true,
      pairs: (inputs.rendered.visual as { pairs: unknown[] }).pairs,
    },
  };
}

/* =========================================================
 * CLI
 * ======================================================= */

function argumentValue(argv: string[], name: string): string | undefined {
  return argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export function main(argv: string[]): void {
  if (process.env.GOLDEN_CALIBRATION_MODE) {
    halt(
      "GOLDEN_CALIBRATION_MODE_SET",
      "a real Golden receipt must never be assembled in calibration mode",
    );
  }
  const casePath = argumentValue(argv, "case") ?? "tests/golden/safehaven/case.json";
  const oraclePath = argumentValue(argv, "oracle") ?? "tests/golden/safehaven/oracle.json";
  const runtimePath =
    argumentValue(argv, "runtime") ?? "evidence/safehaven-real-runtime-evidence.json";
  const renderedPath = argumentValue(argv, "visual") ?? "evidence/safehaven-golden-visual.json";
  const seoAuditPath =
    argumentValue(argv, "seo-llm-audit") ?? "evidence/safehaven-seo-llm-audit.json";
  const outputPath = argumentValue(argv, "out") ?? "evidence/safehaven-real-golden-receipt.json";

  const receipt = mergeGoldenReceipt({
    testCase: readJson(casePath, "CASE_MISSING") as Record<string, unknown>,
    oracle: readJson(oraclePath, "ORACLE_MISSING") as Record<string, unknown>,
    runtime: readJson(runtimePath, "RUNTIME_EVIDENCE_MISSING") as Record<string, unknown>,
    rendered: readJson(renderedPath, "VISUAL_EVIDENCE_MISSING") as Record<string, unknown>,
    seoAudit: readJson(seoAuditPath, "SEO_AUDIT_MISSING") as Record<string, unknown>,
  });

  // Written only after every gate above has passed, and atomically, so a
  // partially assembled receipt can never be handed to the verifier.
  const output = resolve(outputPath);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
  renameSync(temporary, output);
  console.log(
    JSON.stringify(
      {
        schema: "l9.golden-receipt-merge-result/v1",
        output: outputPath,
        case_id: receipt.case_id,
        run_id: (receipt.run as { run_id: string }).run_id,
        routes: (receipt.site as { routes: string[] }).routes.length,
        visual_pairs: (receipt.visual as { pairs: unknown[] }).pairs.length,
      },
      null,
      2,
    ),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).endsWith("build-safehaven-real-golden-receipt.ts");
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
