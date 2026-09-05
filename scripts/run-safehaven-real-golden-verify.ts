// L9_META: layer=cli, role=safehaven_real_golden_verifier, status=active, version=1.0.0
//
// Safe Haven real-Golden certification wrapper.
//
// BOUNDARY: this script is POST-BUILD ONLY. It never launches the Website-Bot
// production pipeline. Pipeline execution and Golden certification stay
// separate processes so a certification run can never quietly re-run, repair,
// or re-deploy the thing it is certifying.
//
// Phases execute in a fixed order and a failure in any phase stops the run:
//   1  GOLDEN_CALIBRATION_MODE unset
//   2  runtime evidence present and structurally valid
//   3  candidate URL is HTTPS
//   4  rendered integrity over every frozen route
//   5  sentinel x viewport screenshot pairs captured
//   6  blind multi-trial visual adjudication executed
//   7  final Golden receipt assembled by the strict merger
//   8  sealed verifier invoked
//   9  verifier stdout persisted
//  10  verdict must be GOLDEN_E2E_PASS_IMPROVED

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class GoldenVerifyError extends Error {
  readonly phase: number;
  readonly code: string;
  constructor(phase: number, code: string, message: string) {
    super(`PHASE_${phase} ${code}: ${message}`);
    this.name = "GoldenVerifyError";
    this.phase = phase;
    this.code = code;
  }
}

function fail(phase: number, code: string, message: string): never {
  throw new GoldenVerifyError(phase, code, message);
}

function argumentValue(argv: string[], name: string): string | undefined {
  return argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function writeAtomic(path: string, contents: string): void {
  const output = resolve(path);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, contents, "utf-8");
  renameSync(temporary, output);
}

function run(command: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: "utf-8", env: process.env });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export interface GoldenVerifyOptions {
  runtimePath: string;
  candidateUrl: string;
  runId: string;
  seoLlmAuditPath: string;
  casePath: string;
  oraclePath: string;
  judgePath: string;
  visualOutputPath: string;
  receiptOutputPath: string;
  verdictOutputPath: string;
  baselineUrl?: string;
  clientId?: string;
}

export function parseVerifyArguments(argv: string[]): GoldenVerifyOptions {
  if (!argv.includes("--authorize-paid-visual")) {
    fail(
      0,
      "PAID_VISUAL_NOT_AUTHORIZED",
      "real Golden certification spends on 30 VISUAL_QA calls; pass --authorize-paid-visual",
    );
  }
  const runtimePath = argumentValue(argv, "runtime");
  const candidateUrl = argumentValue(argv, "candidate-url");
  const runId = argumentValue(argv, "run-id");
  const seoLlmAuditPath = argumentValue(argv, "seo-llm-audit");
  for (const [name, value] of [
    ["--runtime", runtimePath],
    ["--candidate-url", candidateUrl],
    ["--run-id", runId],
    ["--seo-llm-audit", seoLlmAuditPath],
  ] as const) {
    if (!value?.trim()) fail(0, "ARGUMENT_MISSING", `${name} is required`);
  }
  return {
    runtimePath: runtimePath as string,
    candidateUrl: candidateUrl as string,
    runId: runId as string,
    seoLlmAuditPath: seoLlmAuditPath as string,
    casePath: argumentValue(argv, "case") ?? "tests/golden/safehaven/case.json",
    oraclePath: argumentValue(argv, "oracle") ?? "tests/golden/safehaven/oracle.json",
    judgePath: argumentValue(argv, "judge") ?? "tests/golden/safehaven/visual-judge.md",
    visualOutputPath: argumentValue(argv, "visual-out") ?? "evidence/safehaven-golden-visual.json",
    receiptOutputPath:
      argumentValue(argv, "receipt-out") ?? "evidence/safehaven-real-golden-receipt.json",
    verdictOutputPath:
      argumentValue(argv, "verdict-out") ?? "evidence/safehaven-real-golden-verdict.json",
    baselineUrl: argumentValue(argv, "baseline-url"),
    clientId: argumentValue(argv, "client-id"),
  };
}

export function assertRuntimeEvidenceUsable(
  runtime: Record<string, unknown>,
  expectedRunId: string,
): void {
  if (runtime.schema !== "l9.safehaven-real-runtime-evidence/v1") {
    fail(
      2,
      "RUNTIME_EVIDENCE_INVALID",
      "runtime evidence schema is not l9.safehaven-real-runtime-evidence/v1",
    );
  }
  const run_ = runtime.run as { run_id?: string } | undefined;
  if (run_?.run_id !== expectedRunId) {
    fail(
      2,
      "RUN_ID_MISMATCH",
      `runtime evidence run_id ${String(run_?.run_id)} != --run-id ${expectedRunId}`,
    );
  }
  const unresolved = runtime.unresolved_external_dependencies;
  if (!Array.isArray(unresolved)) {
    fail(
      2,
      "RUNTIME_EVIDENCE_INVALID",
      "runtime evidence does not declare unresolved_external_dependencies",
    );
  }
  if (unresolved.length > 0) {
    fail(
      2,
      "EXTERNAL_DEPENDENCY_UNRESOLVED",
      `runtime evidence still names unresolved external facts: ${unresolved
        .map((entry: { field?: string }) => entry.field)
        .join(", ")}`,
    );
  }
}

export function assertRenderedPhases(
  rendered: Record<string, unknown>,
  testCase: Record<string, unknown>,
  oracle: Record<string, unknown>,
): void {
  // ---- phase 4: rendered integrity over every frozen route ------------
  const site = rendered.site as { per_route?: unknown[]; reachable_routes?: number } | undefined;
  const expectedRoutes = (testCase.routes as string[]).length;
  if (!Array.isArray(site?.per_route) || site.per_route.length !== expectedRoutes) {
    fail(
      4,
      "SITE_ROUTE_EVIDENCE_INCOMPLETE",
      `expected ${expectedRoutes} rendered route observations`,
    );
  }
  if (site.reachable_routes !== expectedRoutes) {
    fail(
      4,
      "SITE_REACHABILITY_INCOMPLETE",
      `only ${String(site.reachable_routes)}/${expectedRoutes} routes passed rendered integrity`,
    );
  }
  // ---- phase 5: sentinel x viewport captures --------------------------
  const requiredPairs = (oracle.visual_capture as { required_pairs: number }).required_pairs;
  const pairs = (rendered.visual as { pairs?: Array<Record<string, unknown>> } | undefined)?.pairs;
  if (!Array.isArray(pairs) || pairs.length !== requiredPairs) {
    fail(5, "VISUAL_CAPTURE_INCOMPLETE", `expected ${requiredPairs} captured visual pairs`);
  }
  for (const pair of pairs) {
    if (
      typeof pair.candidate_screenshot_digest !== "string" ||
      typeof pair.baseline_screenshot_digest !== "string"
    ) {
      fail(
        5,
        "VISUAL_CAPTURE_DIGEST_MISSING",
        `${String(pair.route)}/${String(pair.viewport)} carries no screenshot digests`,
      );
    }
  }
  // ---- phase 6: blind multi-trial adjudication ------------------------
  const trialsPerPair = (oracle.visual_oracle as { trials_per_pair: number }).trials_per_pair;
  const totalTrials = pairs.reduce(
    (sum, pair) => sum + (Array.isArray(pair.trials) ? pair.trials.length : 0),
    0,
  );
  if (totalTrials !== requiredPairs * trialsPerPair) {
    fail(
      6,
      "VISUAL_ORACLE_MISSING_TRIAL",
      `expected ${requiredPairs * trialsPerPair} blind trials, got ${totalTrials}`,
    );
  }
  const auditRecords = (
    rendered.llm_audit as { operations?: { VISUAL_QA?: unknown[] } } | undefined
  )?.operations?.VISUAL_QA;
  if (!Array.isArray(auditRecords) || auditRecords.length !== totalTrials) {
    fail(6, "LLM_AUDIT_OPERATION_MISSING", "every blind trial must carry a VISUAL_QA audit record");
  }
}

export async function main(argv: string[]): Promise<void> {
  // ---- phase 1 --------------------------------------------------------
  if (process.env.GOLDEN_CALIBRATION_MODE) {
    fail(
      1,
      "GOLDEN_CALIBRATION_MODE_SET",
      "real Golden certification must never run in calibration mode",
    );
  }
  const options = parseVerifyArguments(argv);

  // ---- phase 2 --------------------------------------------------------
  if (!existsSync(options.runtimePath)) {
    fail(2, "RUNTIME_EVIDENCE_MISSING", `no runtime evidence at ${options.runtimePath}`);
  }
  const runtime = readJson(options.runtimePath) as Record<string, unknown>;
  assertRuntimeEvidenceUsable(runtime, options.runId);
  if (!existsSync(options.seoLlmAuditPath)) {
    fail(2, "SEO_AUDIT_MISSING", `no SEO-Bot LLM audit at ${options.seoLlmAuditPath}`);
  }

  // ---- phase 3 --------------------------------------------------------
  if (!/^https:\/\//.test(options.candidateUrl)) {
    fail(3, "CANDIDATE_URL_INVALID", "--candidate-url must be an HTTPS URL");
  }

  // ---- phases 4-6: rendered collection (single fail-closed pass) ------
  const visualArgs = [
    "--import",
    "tsx",
    resolve("scripts/run-safehaven-golden-visual.ts"),
    "--authorize-paid-visual",
    `--candidate-url=${options.candidateUrl}`,
    `--run-id=${options.runId}`,
    `--case=${options.casePath}`,
    `--oracle=${options.oraclePath}`,
    `--judge=${options.judgePath}`,
    `--out=${options.visualOutputPath}`,
  ];
  if (options.baselineUrl) visualArgs.push(`--baseline-url=${options.baselineUrl}`);
  if (options.clientId) visualArgs.push(`--client-id=${options.clientId}`);
  const visual = run(process.execPath, visualArgs);
  if (visual.status !== 0 || !existsSync(options.visualOutputPath)) {
    fail(4, "RENDERED_EVIDENCE_COLLECTION_FAILED", visual.stderr.trim() || visual.stdout.trim());
  }
  assertRenderedPhases(
    readJson(options.visualOutputPath) as Record<string, unknown>,
    readJson(options.casePath) as Record<string, unknown>,
    readJson(options.oraclePath) as Record<string, unknown>,
  );

  // ---- phase 7: strict merge -----------------------------------------
  const merge = run(process.execPath, [
    "--import",
    "tsx",
    resolve("scripts/build-safehaven-real-golden-receipt.ts"),
    `--case=${options.casePath}`,
    `--oracle=${options.oraclePath}`,
    `--runtime=${options.runtimePath}`,
    `--visual=${options.visualOutputPath}`,
    `--seo-llm-audit=${options.seoLlmAuditPath}`,
    `--out=${options.receiptOutputPath}`,
  ]);
  if (merge.status !== 0 || !existsSync(options.receiptOutputPath)) {
    fail(7, "RECEIPT_ASSEMBLY_FAILED", merge.stderr.trim() || merge.stdout.trim());
  }

  // ---- phase 8: sealed verifier ---------------------------------------
  const verify = run(process.execPath, [
    resolve("scripts/verify-safehaven-golden.mjs"),
    options.casePath,
    options.receiptOutputPath,
    options.oraclePath,
  ]);

  // ---- phase 9: persist verifier stdout unconditionally ----------------
  writeAtomic(options.verdictOutputPath, `${verify.stdout.trim()}\n`);

  // ---- phase 10: only a Golden PASS is a pass --------------------------
  let verdict = "UNKNOWN";
  try {
    verdict = (JSON.parse(verify.stdout) as { verdict?: string }).verdict ?? "UNKNOWN";
  } catch {
    fail(
      10,
      "VERIFIER_OUTPUT_UNREADABLE",
      verify.stderr.trim() || "verifier produced no JSON verdict",
    );
  }
  if (verify.status !== 0 || verdict !== "GOLDEN_E2E_PASS_IMPROVED") {
    fail(10, "GOLDEN_E2E_NOT_PASSED", `verifier verdict was ${verdict}`);
  }
  console.log(
    JSON.stringify(
      {
        schema: "l9.safehaven-real-golden-result/v1",
        verdict,
        receipt: options.receiptOutputPath,
        verdict_record: options.verdictOutputPath,
        rendered_evidence: options.visualOutputPath,
      },
      null,
      2,
    ),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).endsWith("run-safehaven-real-golden-verify.ts");
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
