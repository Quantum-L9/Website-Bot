// L9_META: layer=stage, role=rendered_site_validation, status=active, version=1.1.0
//
// Runs after site-build in every mode that builds: the persisted build proof
// names the dist/, every spec route is rendered at desktop and mobile widths
// in a real browser, and the report is written beside the run's evidence.
// A failing render is a failed build (RENDERED_SITE_VALIDATION_FAILED), and an
// unavailable browser is the same failure, never a skipped gate.
//
// Each route is handed what the accepted artifacts require of it: the
// blueprint's section order and, per identity-bound image slot, the published
// file it must show in its section; the published logo on every route. These
// come from the blueprint, the image plan and the published asset registry,
// never from the rendered output. A REDESIGN_IMPROVE build without its
// accepted blueprint cannot be checked and fails closed.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WebsiteBlueprintRoute } from "@quantum-l9/bot-interop";
import { resolveSectionRenderer } from "../../astro_template/src/components/SectionRegistry.js";
import { createModuleLogger } from "../core/logger.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import {
  placementRole,
  placementSectionId,
  routeSlugFromPlacement,
} from "../services/images/ImageAssetPlanner.js";
import {
  DEFAULT_RENDER_VIEWPORTS,
  PlaywrightSiteRenderer,
  type RenderedSiteValidationReport,
  type RenderViewport,
  type RouteVisualExpectation,
  type SiteRenderer,
} from "../validation/rendered-site.js";
import {
  normalizeComponentName,
  normalizeRouteSlug,
} from "../validation/validate-generated-site.js";
import { sectionShowsBoundImage } from "./SiteAssemblerStage.js";

const logger = createModuleLogger("stage:rendered-site-validation");

/** The registered renderer (or generic class) a blueprint section renders through. */
function sectionRenderer(componentClass: string): string {
  const normalized = normalizeComponentName(componentClass);
  const resolution = resolveSectionRenderer(normalized);
  return resolution.kind === "registered" ? resolution.name : normalized;
}

/**
 * The blueprint section an identity-bound image renders in, or undefined when
 * assembly would not show it there: a hero image goes to the route's hero
 * renderer, anything else to the section its identity names, and only where
 * the template can show an image of that role.
 */
function identitySection(
  route: WebsiteBlueprintRoute,
  named: string,
  role: string,
): WebsiteBlueprintRoute["sections"][number] | undefined {
  const hero =
    role === "hero"
      ? route.sections.find((entry) => sectionRenderer(entry.component_class) === "hero")
      : undefined;
  const section = hero ?? route.sections.find((entry) => entry.section_id === named);
  if (!section || !sectionShowsBoundImage(sectionRenderer(section.component_class), role)) {
    return undefined;
  }
  return section;
}

/** Published file per placement: what the asset registry republishes into the site. */
function publishedImages(ctx: BuildContext): Map<string, string> {
  return new Map(
    [...(ctx.resolvedImages?.values() ?? [])]
      .filter((asset) => asset.disposition === "approved-client-owned")
      .map((asset) => [asset.placement, `/images/${asset.outputFileName}`]),
  );
}

/**
 * Add each published image the plan fulfilled to the route that must show it,
 * in the section its identity names (the blueprint requirement, else the
 * client's section-qualified placement). One image per section, in assembly's
 * binding order: required placements first, then by key.
 */
function addIdentityBoundImages(
  ctx: BuildContext,
  blueprint: NonNullable<BuildContext["websiteBlueprint"]>,
  routes: Map<string, WebsiteBlueprintRoute>,
  expectations: Map<string, RouteVisualExpectation>,
  published: Map<string, string>,
): void {
  const logo = published.get("global:logo");
  const requirementSections = new Map(
    blueprint.payload.visual_requirements.map((requirement) => [
      requirement.slot_id,
      requirement.section_id,
    ]),
  );
  const filled = new Set<string>();
  const planned = [...(ctx.imageAssetPlan?.assets ?? [])].sort(
    (a, b) => Number(b.required) - Number(a.required) || a.placement.localeCompare(b.placement),
  );
  for (const asset of planned) {
    const src = published.get(asset.placement);
    const routeSlug = routeSlugFromPlacement(asset.placement);
    if (asset.resolution.source === "unresolved" || !src || !routeSlug) continue;
    const slug = normalizeRouteSlug(routeSlug);
    const route = routes.get(slug);
    const expectation = expectations.get(slug);
    const named = requirementSections.get(asset.slotId) ?? placementSectionId(asset.placement);
    if (!route || !expectation || named === undefined) continue;
    const role = placementRole(asset.placement);
    // Hero.astro withholds a hero file identical to the logo (no double logo).
    if (role === "hero" && src === logo) continue;
    const section = identitySection(route, named, role);
    if (!section || filled.has(`${slug}#${section.section_id}`)) continue;
    filled.add(`${slug}#${section.section_id}`);
    expectation.images.push({ slot: asset.placement, src, section_id: section.section_id });
  }
}

/**
 * Per normalized route slug, what the accepted artifacts require the rendered
 * route to show: the blueprint's section order, the published logo, and each
 * published image the plan fulfilled in the section its identity names (the
 * blueprint requirement, else the client's section-qualified placement; a
 * hero image in the route's hero). Placements bound only by role fallback,
 * and sections the template cannot show an image in, are left to assembly's
 * own fail-closed checks. Mirrors SiteAssemblerStage.bindByIdentity.
 */
export function routeVisualExpectations(ctx: BuildContext): Map<string, RouteVisualExpectation> {
  const blueprint = ctx.websiteBlueprint;
  if (ctx.buildIntent === "REDESIGN_IMPROVE" && !blueprint) {
    throw new BuildError(
      "RENDERED_SITE_VALIDATION_FAILED",
      "rendered-site validation of a REDESIGN_IMPROVE build requires the accepted website blueprint",
    );
  }
  const published = publishedImages(ctx);
  const logo = published.get("global:logo");
  const expectations = new Map<string, RouteVisualExpectation>(
    ctx.domainSpec.routes.map((route) => [
      normalizeRouteSlug(route.slug),
      { images: logo ? [{ slot: "global:logo", src: logo }] : [] },
    ]),
  );
  if (!blueprint) return expectations;

  const routes = new Map(
    blueprint.payload.routes.map((route) => [normalizeRouteSlug(route.route_id), route]),
  );
  for (const [slug, route] of routes) {
    const expectation = expectations.get(slug);
    if (expectation) {
      expectation.section_order = route.sections.map((section) => section.section_id);
    }
  }
  addIdentityBoundImages(ctx, blueprint, routes, expectations, published);
  return expectations;
}

export class RenderedSiteValidationStage implements Stage {
  name = "rendered-site-validation";
  version = "1.1.0";
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
    const expectations = routeVisualExpectations(ctx);
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
          expect: expectations.get(normalizeRouteSlug(route.slug)),
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
