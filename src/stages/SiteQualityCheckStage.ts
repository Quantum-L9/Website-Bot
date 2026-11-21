// L9_META: layer=stage, role=site_quality_check, status=active, version=1.0.0
//
// Rendered-site quality check. Runs after site-build and
// rendered-site-validation in every mode that builds a site, on the dist the
// persisted build proof names, with exactly the rules of the CLI
// (`npx tsx scripts/quality/check-site.ts`, src/validation/site-quality/).
// rendered-site-validation proves every route renders what the accepted
// artifacts require; this stage judges whether the rendered copy is fit to
// ship (repeated filler, controls as body copy, internal labels, thin pages,
// cross-client literals, broken images).
//
//   PASS     the build proceeds; client_build_quality_check is PASS with the
//            report as evidence.
//   FAIL     the build stops (SITE_QUALITY_CHECK_FAILED) listing the findings;
//            the level is FAIL with the report as evidence.
//   BLOCKED  the site could not be judged (no browser, no pages): the build
//            stops the same way and the level is BLOCKED. A checker that did
//            not run is never a pass.
// There is no waiver: the factory does not ship a build its own quality
// authority rejects.

import { relative, resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { ReadinessObservation } from "../pipeline/evidence/ReadinessLadder.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import type { Finding, SiteQualityReport } from "../validation/site-quality/checks.js";
import { runSiteQuality } from "../validation/site-quality/run.js";

const logger = createModuleLogger("stage:site-quality-check");

/** Evidence-store file the quality report is written to. */
export const SITE_QUALITY_REPORT_FILE = "site-quality-report.json";
/** Findings quoted in the failure message; the report holds all of them. */
const QUOTED_FINDINGS = 12;

export type SiteQualityRunner = typeof runSiteQuality;

function describe(finding: Finding): string {
  const evidence = finding.evidence ? ` "${finding.evidence}"` : "";
  return `${finding.check} ${finding.page}: ${finding.detail}${evidence}`;
}

export class SiteQualityCheckStage implements Stage {
  name = "site-quality-check";
  version = "1.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => ["build" as const],
    outputs: (_ctx: BuildContext) => [],
    // The verdict is recomputed on resume rather than trusted from a report.
    resumable: false,
    externalMutation: false,
  };

  constructor(private readonly check: SiteQualityRunner = runSiteQuality) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) {
      logger.info("[dry-run] Would run the rendered-site quality checker on the built site");
      return;
    }
    const build = await ctx.evidenceStore.readBuild();
    if (!build)
      throw new BuildError(
        "EVIDENCE_ARTIFACT_MISSING",
        "site-quality-check requires persisted build evidence",
      );
    const reportPath = resolve(ctx.evidenceStore.rootDir, SITE_QUALITY_REPORT_FILE);
    let report: SiteQualityReport;
    try {
      report = await this.check({
        dist: build.value.distDir,
        businessName: ctx.domainSpec.business_name,
        reportPath,
      });
    } catch (error) {
      this.record(ctx, {
        state: "BLOCKED",
        evidence_ref: null,
        reason: `the quality checker could not run: ${error instanceof Error ? error.message : String(error)}`,
      });
      throw new BuildError(
        "SITE_QUALITY_CHECK_FAILED",
        `rendered-site quality check could not run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    ctx.siteQualityReportPath = reportPath;
    const evidence_ref = relative(process.cwd(), reportPath);

    if (report.status === "PASS") {
      this.record(ctx, { state: "PASS", evidence_ref });
      logger.info(
        { reportPath, pages: report.pages.length, warnings: report.findings.length },
        "Built site passed the rendered-site quality checker",
      );
      return;
    }
    if (report.status === "BLOCKED") {
      const reason = report.errors.join("; ") || "the site could not be judged";
      this.record(ctx, { state: "BLOCKED", evidence_ref: null, reason });
      throw new BuildError(
        "SITE_QUALITY_CHECK_FAILED",
        `rendered-site quality check is BLOCKED (report: ${reportPath}): ${reason}`,
        false,
        { reportPath, errors: report.errors },
      );
    }
    const failures = report.findings.filter((finding) => finding.severity === "fail");
    this.record(ctx, {
      state: "FAIL",
      evidence_ref,
      reason: `${failures.length} failing finding(s)`,
    });
    const quoted = failures.slice(0, QUOTED_FINDINGS).map(describe).join("; ");
    const more =
      failures.length > QUOTED_FINDINGS ? `; +${failures.length - QUOTED_FINDINGS} more` : "";
    throw new BuildError(
      "SITE_QUALITY_CHECK_FAILED",
      `built site failed the rendered-site quality checker with ${failures.length} finding(s) (report: ${reportPath}): ${quoted}${more}`,
      false,
      { reportPath, findings: failures.map(describe) },
    );
  }

  private record(ctx: BuildContext, observation: ReadinessObservation): void {
    ctx.readiness = { ...ctx.readiness, client_build_quality_check: observation };
  }
}
