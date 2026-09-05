// L9_META: layer=stage, role=rendered_site_validation, status=active, version=1.0.0
//
// Runs after site-build in every mode that builds: the persisted build proof
// names the dist/, every spec route is rendered at desktop and mobile widths
// in a real browser, and the report is written beside the run's evidence.
// A failing render is a failed build (RENDERED_SITE_VALIDATION_FAILED), and an
// unavailable browser is the same failure, never a skipped gate.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import {
  DEFAULT_RENDER_VIEWPORTS,
  PlaywrightSiteRenderer,
  type RenderedSiteValidationReport,
  type RenderViewport,
  type SiteRenderer,
} from "../validation/rendered-site.js";

const logger = createModuleLogger("stage:rendered-site-validation");

export class RenderedSiteValidationStage implements Stage {
  name = "rendered-site-validation";
  version = "1.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => ["build" as const],
    outputs: (_ctx: BuildContext) => [],
    resumable: true,
    externalMutation: false,
  };

  constructor(
    private readonly renderer: SiteRenderer = new PlaywrightSiteRenderer(),
    private readonly viewports: readonly RenderViewport[] = DEFAULT_RENDER_VIEWPORTS,
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) {
      logger.info("[dry-run] Would render every route in a browser and validate it");
      return;
    }
    const build = await ctx.evidenceStore.readBuild();
    if (!build) {
      throw new BuildError(
        "EVIDENCE_ARTIFACT_MISSING",
        "rendered-site-validation requires persisted build evidence",
      );
    }
    const distDir = build.value.distDir;
    let report: RenderedSiteValidationReport;
    try {
      report = await this.renderer.render({
        buildId: ctx.buildId,
        clientId: ctx.clientId,
        distDir,
        routes: ctx.domainSpec.routes.map((route) => ({
          slug: route.slug,
          title: route.title,
          noindex: route.noindex,
        })),
        viewports: this.viewports,
        screenshotDir: resolve(clientAssetRoot(ctx), "renders"),
      });
    } catch (error) {
      throw new BuildError(
        "RENDERED_SITE_VALIDATION_FAILED",
        `rendered-site validation could not run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const reportPath = resolve(ctx.evidenceStore.rootDir, "rendered-site-validation.json");
    mkdirSync(ctx.evidenceStore.rootDir, { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    ctx.renderedSiteValidationPath = reportPath;

    if (report.status !== "PASS") {
      const failures = [
        ...report.site_checks
          .filter((check) => check.status === "FAIL")
          .map((check) => `site:${check.name}: ${check.detail}`),
        ...report.routes.flatMap((route) =>
          route.checks
            .filter((check) => check.status === "FAIL")
            .map((check) => `${route.route}@${route.viewport}:${check.name}: ${check.detail}`),
        ),
      ];
      throw new BuildError(
        "RENDERED_SITE_VALIDATION_FAILED",
        `${report.summary.failed} of ${report.summary.renders} route renders failed (report: ${reportPath}): ${failures.slice(0, 12).join("; ")}${failures.length > 12 ? `; +${failures.length - 12} more` : ""}`,
        false,
        { reportPath, failures },
      );
    }
    logger.info(
      {
        reportPath,
        routes: report.summary.routes,
        renders: report.summary.renders,
        browser: report.browser.version,
      },
      "Every route rendered and validated in a real browser",
    );
  }
}
