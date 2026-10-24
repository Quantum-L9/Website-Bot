// L9_META: layer=stage, role=visual_qa, stage_index=13, status=active, version=4.0.0
//
// Deployed-site visual QA. The verifier script captures every spec route at
// every required viewport and has the vision evaluator judge each screenshot;
// this stage then re-verifies the structured report it wrote for this run.
// PASS requires a current, complete, conclusive report, never a zero exit or
// the absence of a marker string. Local dist/ rendering stays with
// RenderedSiteValidationStage; nothing here re-renders or re-checks the build.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { normalizeRouteSlug } from "../validation/validate-generated-site.js";

const logger = createModuleLogger("stage:visual-qa");
const QA_SCRIPT = "scripts/verify-visual-qa.mjs";
export const VISUAL_QA_REPORT_SCHEMA = "website-bot.visual-qa-report/v1";
/** Every viewport the verifier knows; full coverage is required. */
export const VISUAL_QA_VIEWPORTS: readonly string[] = [
  "desktop_1920",
  "desktop_1440",
  "ipad",
  "iphone_14",
  "pixel_7",
];
const MIN_TIMEOUT_MS = 120_000;
const TIMEOUT_PER_CAPTURE_MS = 30_000;

/** Injectable seam over `execFileSync` for the QA verifier subprocess (deterministic unit tests). */
export type VisualQaExec = (
  command: string,
  args: string[],
  options: { encoding: "utf-8"; timeout: number; stdio: "pipe" },
) => string;

interface ReportCapture {
  page?: unknown;
  viewport?: unknown;
  url?: unknown;
  http_status?: unknown;
  status?: unknown;
  screenshot?: { path?: unknown; sha256?: unknown } | null;
}

interface ReportEvaluation {
  page?: unknown;
  viewport?: unknown;
  verdict?: unknown;
}

interface VisualQaReport {
  schema?: unknown;
  run_id?: unknown;
  status?: unknown;
  reasons?: unknown;
  target_url?: unknown;
  requested?: { pages?: unknown; viewports?: unknown };
  captures?: unknown;
  evaluations?: unknown;
}

/** The exact invocation a report must answer for. */
export interface VisualQaRun {
  runId: string;
  url: string;
  pages: readonly string[];
  viewports: readonly string[];
  reportPath: string;
  exitedZero: boolean;
}

/**
 * Judge one verifier report against the run that requested it. `problems` is
 * empty only for a PASS; `critical` is true when the evaluator reported a
 * critical defect. The report's own status is necessary, never sufficient.
 */
export function assessVisualQaReport(
  raw: unknown,
  run: VisualQaRun,
): { problems: string[]; critical: boolean } {
  if (!raw || typeof raw !== "object")
    return { problems: ["report is not an object"], critical: false };
  const report = raw as VisualQaReport;
  const problems: string[] = [];
  const captures = Array.isArray(report.captures) ? (report.captures as ReportCapture[]) : [];
  const evaluations = Array.isArray(report.evaluations)
    ? (report.evaluations as ReportEvaluation[])
    : [];
  const critical = evaluations.some((evaluation) => evaluation?.verdict === "critical");

  if (report.schema !== VISUAL_QA_REPORT_SCHEMA) problems.push("unknown report schema");
  if (report.run_id !== run.runId) problems.push("report belongs to a different run");
  if (report.target_url !== run.url) problems.push("report targets a different URL");
  if (JSON.stringify(report.requested?.pages) !== JSON.stringify(run.pages))
    problems.push("report covers different routes");
  if (JSON.stringify(report.requested?.viewports) !== JSON.stringify(run.viewports))
    problems.push("report covers different viewports");
  if (report.status !== "PASS") problems.push(`verifier status ${String(report.status)}`);
  if (!Array.isArray(report.reasons) || report.reasons.length > 0)
    problems.push(`verifier reasons ${JSON.stringify(report.reasons ?? null)}`);
  if (!run.exitedZero) problems.push("verifier exited non-zero");

  const runDir = dirname(resolve(run.reportPath));
  for (const page of run.pages) {
    for (const viewport of run.viewports) {
      const pair = `${page}@${viewport}`;
      const matches = captures.filter(
        (capture) => capture?.page === page && capture?.viewport === viewport,
      );
      const capture = matches[0];
      if (matches.length !== 1 || !capture) {
        problems.push(`${pair}: ${matches.length} captures`);
      } else {
        const status = capture.http_status;
        if (capture.url !== `${run.url}${page}`) problems.push(`${pair}: captured another URL`);
        if (typeof status !== "number" || status < 200 || status > 299)
          problems.push(`${pair}: HTTP ${String(status)}`);
        const shot = capture.screenshot;
        const path = typeof shot?.path === "string" ? resolve(shot.path) : undefined;
        if (capture.status !== "captured" || !path) problems.push(`${pair}: no screenshot`);
        else if (relative(runDir, path).startsWith(".."))
          problems.push(`${pair}: screenshot outside this run`);
        else if (!existsSync(path) || statSync(path).size === 0)
          problems.push(`${pair}: screenshot missing on disk`);
        else if (createHash("sha256").update(readFileSync(path)).digest("hex") !== shot?.sha256)
          problems.push(`${pair}: screenshot digest mismatch`);
      }
      const verdicts = evaluations.filter(
        (evaluation) => evaluation?.page === page && evaluation?.viewport === viewport,
      );
      if (verdicts.length !== 1 || verdicts[0]?.verdict !== "ok")
        problems.push(
          `${pair}: evaluator verdict ${verdicts.map((evaluation) => String(evaluation?.verdict)).join(",") || "missing"}`,
        );
    }
  }
  return { problems, critical };
}

export class VisualQAStage implements Stage {
  name = "visual-qa";
  version = "4.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => ["deployment" as const],
    outputs: (_ctx: BuildContext) => [],
    resumable: false,
    externalMutation: true,
  };

  constructor(
    private readonly exec: VisualQaExec = (command, args, options) =>
      execFileSync(command, args, options),
    private readonly scriptPath: string = QA_SCRIPT,
    private readonly newRunId: () => string = randomUUID,
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    ctx.visualQaPassed = false;
    if (ctx.dryRun) {
      ctx.qualityEvidence.visualQa = "skipped";
      logger.info("[dry-run] Would run visual QA checks");
      return;
    }
    // Every path below that does not reach a verified PASS leaves the gate failed.
    ctx.qualityEvidence.visualQa = "failed";
    if (!existsSync(this.scriptPath)) {
      logger.error({ script: this.scriptPath }, "Visual QA script not found; gate failed");
      return;
    }
    const deployment = await ctx.evidenceStore.requireDeploymentEvidence();
    const url = deployment.value.deploymentUrl?.replace(/\/+$/, "");
    if (!url) {
      logger.error("No deployment URL available; visual QA gate failed");
      return;
    }

    const pages = [
      ...new Set(ctx.domainSpec.routes.map((route) => normalizeRouteSlug(route.slug))),
    ];
    const viewports = VISUAL_QA_VIEWPORTS;
    // A fresh directory per invocation: no earlier report can certify this run.
    const runId = this.newRunId();
    const reportPath = resolve(clientAssetRoot(ctx), "visual-qa", runId, "report.json");
    let exitedZero = true;
    try {
      this.exec(
        process.execPath,
        [
          this.scriptPath,
          "--url",
          url,
          "--pages",
          pages.join(","),
          "--viewports",
          viewports.join(","),
          "--report",
          reportPath,
          "--run-id",
          runId,
          "--client-id",
          ctx.clientId,
        ],
        {
          encoding: "utf-8",
          timeout: Math.max(
            MIN_TIMEOUT_MS,
            pages.length * viewports.length * TIMEOUT_PER_CAPTURE_MS,
          ),
          stdio: "pipe",
        },
      );
    } catch (error) {
      exitedZero = false;
      logger.warn(
        { error: error instanceof Error ? error.message.slice(0, 500) : String(error) },
        "Visual QA verifier exited non-zero",
      );
    }

    let report: unknown;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf-8"));
    } catch {
      logger.error({ reportPath }, "Visual QA verifier wrote no readable report; gate failed");
      return;
    }
    const { problems, critical } = assessVisualQaReport(report, {
      runId,
      url,
      pages,
      viewports,
      reportPath,
      exitedZero,
    });
    if (critical)
      throw new BuildError(
        "VISUAL_QA_FAILED",
        `Visual QA evaluator reported critical defects (report: ${reportPath})`,
        false,
        { reportPath },
      );
    if (problems.length) {
      logger.error(
        { reportPath, problems: problems.slice(0, 20), total: problems.length },
        "Visual QA did not pass; gate failed",
      );
      return;
    }
    ctx.visualQaPassed = true;
    ctx.qualityEvidence.visualQa = "passed";
    logger.info(
      { url, reportPath, routes: pages.length, viewports: viewports.length },
      "Visual QA passed",
    );
  }
}
