// L9_META: layer=stage, role=structured_content_projection, status=active, version=2.0.0
//
// Campaign 7 R9: under REDESIGN_IMPROVE the StructuredContentPackage received
// from SEO-Bot is the FINAL page prose authority. This stage projects it
// verbatim into the assembler's content map. It performs zero LLM calls and
// zero rewriting — deterministic text layout of the received blocks only.
// The legacy ContentGenerationStage is NOT in the redesign execution plan;
// its authority is absent, not merely reduced.
//
// WB-GLUE-01: accepted content is joined to the accepted WebsiteBuildBlueprint
// and PageContentContract by stable identity — (route_id, section_id) — never
// by array position. The blueprint owns section order; the package owns copy.

import type {
  ContentBlock,
  PageContentContractRoute,
  PageContentContractSection,
  StructuredContentRoute,
  WebsiteBlueprintRoute,
  WebsiteBlueprintSection,
} from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:structured-content-projection");

export type StructuredSection = StructuredContentRoute["sections"][number];

/** One blueprint section joined to its contract section and accepted copy. */
export interface JoinedRedesignSection {
  sectionId: string;
  blueprint: WebsiteBlueprintSection;
  contract: PageContentContractSection;
  structured: StructuredSection;
}

/** One canonical DomainSpec route joined across the three redesign authorities. */
export interface JoinedRedesignRoute {
  routeId: string;
  path: string;
  title: string;
  blueprint: WebsiteBlueprintRoute;
  contract: PageContentContractRoute;
  structured: StructuredContentRoute;
  /** In blueprint section order. */
  sections: JoinedRedesignSection[];
}

function renderBlock(block: ContentBlock): string {
  switch (block.kind) {
    case "paragraph":
      return block.text;
    case "bullets":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "quote":
      return block.attribution ? `"${block.text}" — ${block.attribution}` : `"${block.text}"`;
  }
}

/**
 * Deterministic verbatim projection of one SCP section into headline+body text.
 * A compatibility and placeholder-scan projection only: it is never the
 * redesign rendering authority (the structured section is).
 */
export function renderStructuredSection(
  section: StructuredSection,
  fallbackHeadline: string,
): string {
  const headline = (section.heading ?? section.eyebrow ?? fallbackHeadline).trim();
  const parts: string[] = [];
  if (section.subheading) parts.push(section.subheading);
  for (const block of section.blocks) parts.push(renderBlock(block));
  if (section.cta) parts.push(section.cta.label);
  return `${headline}\n\n${parts.join("\n\n")}`;
}

function sectionIdentityError(message: string): BuildError {
  return new BuildError("VALIDATION_FAILED", `section-identity: ${message}`);
}

/** Index rows by key, rejecting a duplicate key (deterministic contract error). */
function indexUnique<T>(
  rows: readonly T[],
  key: (row: T) => string,
  label: string,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    if (index.has(id)) {
      throw new BuildError(
        "ROUTE_SET_MISMATCH",
        `${label} carries duplicate route ${JSON.stringify(id)}`,
      );
    }
    index.set(id, row);
  }
  return index;
}

function indexSections<T extends { section_id: string }>(
  rows: readonly T[],
  label: string,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    if (typeof row.section_id !== "string" || !row.section_id.trim()) {
      throw sectionIdentityError(`${label} carries a section without a section_id`);
    }
    if (index.has(row.section_id)) {
      throw sectionIdentityError(
        `${label} carries duplicate section_id ${JSON.stringify(row.section_id)}`,
      );
    }
    index.set(row.section_id, row);
  }
  return index;
}

function assertSameSectionSet(
  expected: Map<string, unknown>,
  actual: Map<string, unknown>,
  expectedLabel: string,
  actualLabel: string,
): void {
  for (const id of expected.keys()) {
    if (!actual.has(id)) {
      throw sectionIdentityError(
        `${actualLabel} is missing section ${JSON.stringify(id)} required by ${expectedLabel}`,
      );
    }
  }
  for (const id of actual.keys()) {
    if (!expected.has(id)) {
      throw sectionIdentityError(
        `${actualLabel} carries unexpected section ${JSON.stringify(id)} absent from ${expectedLabel}`,
      );
    }
  }
}

function assertRouteSet(
  labels: string,
  produced: Map<string, unknown>,
  canonical: Set<string>,
): void {
  for (const routeId of produced.keys()) {
    if (!canonical.has(routeId)) {
      throw new BuildError(
        "ROUTE_SET_MISMATCH",
        `${labels} route ${JSON.stringify(routeId)} is not a DomainSpec route`,
      );
    }
  }
}

/**
 * Join every canonical DomainSpec route to exactly one accepted blueprint,
 * page-content-contract and structured-content route, and each blueprint
 * section to its contract section and accepted copy by section_id.
 *
 * DomainSpec owns the route set; the blueprint orders and describes the
 * sections; the content package owns their final copy. Missing, duplicate,
 * unexpected or disagreeing identities fail with a deterministic contract
 * error. Reordering the package's section array cannot change the result.
 */
export function joinRedesignRoutes(ctx: BuildContext): JoinedRedesignRoute[] {
  const blueprint = ctx.websiteBlueprint;
  const contract = ctx.pageContentContract;
  const contentPackage = ctx.structuredContentPackage;
  const missing = [
    !blueprint && "WebsiteBuildBlueprint",
    !contract && "PageContentContract",
    !contentPackage && "StructuredContentPackage",
  ].filter(Boolean);
  if (!blueprint || !contract || !contentPackage) {
    throw new BuildError(
      "REDESIGN_PIPELINE_INCOMPLETE",
      `REDESIGN_IMPROVE requires the accepted ${missing.join(", ")}`,
    );
  }
  const blueprintRoutes = indexUnique(
    blueprint.payload.routes,
    (r) => r.route_id,
    "WebsiteBuildBlueprint",
  );
  const contractRoutes = indexUnique(
    contract.payload.routes,
    (r) => r.route_id,
    "PageContentContract",
  );
  const structuredRoutes = indexUnique(
    contentPackage.payload.routes,
    (r) => r.route_id,
    "StructuredContentPackage",
  );
  const canonical = new Set(ctx.domainSpec.routes.map((route) => route.slug));
  assertRouteSet("WebsiteBuildBlueprint", blueprintRoutes, canonical);
  assertRouteSet("PageContentContract", contractRoutes, canonical);
  assertRouteSet("StructuredContentPackage", structuredRoutes, canonical);

  return ctx.domainSpec.routes.map((route) => {
    const routeId = route.slug;
    const blueprintRoute = blueprintRoutes.get(routeId);
    const contractRoute = contractRoutes.get(routeId);
    const structuredRoute = structuredRoutes.get(routeId);
    for (const [label, row] of [
      ["WebsiteBuildBlueprint", blueprintRoute],
      ["PageContentContract", contractRoute],
      ["StructuredContentPackage", structuredRoute],
    ] as const) {
      if (!row) {
        throw new BuildError("ROUTE_SET_MISMATCH", `${label} carries no route ${routeId}`);
      }
      if (row.path !== routeId) {
        throw new BuildError(
          "ROUTE_SET_MISMATCH",
          `${label} route ${JSON.stringify(routeId)} has path ${JSON.stringify(row.path)}; the DomainSpec route requires ${JSON.stringify(routeId)}`,
        );
      }
    }
    if (!blueprintRoute || !contractRoute || !structuredRoute) {
      throw new BuildError("ROUTE_SET_MISMATCH", `route ${routeId} is not joinable`);
    }
    const where = `route ${JSON.stringify(routeId)}`;
    const blueprintSections = indexSections(
      blueprintRoute.sections,
      `WebsiteBuildBlueprint ${where}`,
    );
    const contractSections = indexSections(contractRoute.sections, `PageContentContract ${where}`);
    const structuredSections = indexSections(
      structuredRoute.sections,
      `StructuredContentPackage ${where}`,
    );
    assertSameSectionSet(
      blueprintSections,
      contractSections,
      `WebsiteBuildBlueprint ${where}`,
      `PageContentContract ${where}`,
    );
    assertSameSectionSet(
      contractSections,
      structuredSections,
      `PageContentContract ${where}`,
      `StructuredContentPackage ${where}`,
    );
    const sections = blueprintRoute.sections.map((section) => ({
      sectionId: section.section_id,
      blueprint: section,
      // Present by the set equality checks above.
      contract: contractSections.get(section.section_id) as PageContentContractSection,
      structured: structuredSections.get(section.section_id) as StructuredSection,
    }));
    return {
      routeId,
      path: routeId,
      title: route.title,
      blueprint: blueprintRoute,
      contract: contractRoute,
      structured: structuredRoute,
      sections,
    };
  });
}

/** Content-map key for a redesign section: stable section identity, never position. */
export function redesignContentKey(routeId: string, sectionId: string): string {
  return `${routeId}:${sectionId}`;
}

export class StructuredContentProjectionStage implements Stage {
  name = "structured-content-projection";
  version = "2.0.0";

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info({ intent: ctx.buildIntent }, "not a redesign build; projection skipped");
      return;
    }
    if (ctx.dryRun) {
      logger.info("[dry-run] Would project StructuredContentPackage into route content");
      return;
    }
    if (!ctx.structuredContentPackage) {
      throw new BuildError(
        "REDESIGN_PIPELINE_INCOMPLETE",
        "structured-content-projection requires the accepted StructuredContentPackage",
      );
    }
    ctx.redesignCounters ??= {
      pageContentContractLlmCalls: 0,
      legacyContentGenerationCalls: 0,
      redesignSchemaLlmCalls: 0,
    };

    let projected = 0;
    for (const route of joinRedesignRoutes(ctx)) {
      for (const section of route.sections) {
        ctx.generatedContent.set(
          redesignContentKey(route.routeId, section.sectionId),
          renderStructuredSection(section.structured, route.title),
        );
        projected += 1;
      }
    }
    // Runtime proof for the receipt: legacy final-copy generation never ran.
    if (ctx.redesignCounters.legacyContentGenerationCalls !== 0) {
      throw new BuildError(
        "LEGACY_CONTENT_AUTHORITY_USED",
        `legacy content generation was invoked ${ctx.redesignCounters.legacyContentGenerationCalls} time(s) under REDESIGN_IMPROVE`,
      );
    }
    logger.info(
      { sections: projected, legacyCalls: ctx.redesignCounters.legacyContentGenerationCalls },
      "StructuredContentPackage projected verbatim by section identity (legacy content authority bypassed)",
    );
  }
}
