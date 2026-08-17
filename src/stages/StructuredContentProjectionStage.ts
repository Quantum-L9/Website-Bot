// L9_META: layer=stage, role=structured_content_projection, status=active, version=1.0.0
//
// Campaign 7 R9: under REDESIGN_IMPROVE the StructuredContentPackage received
// from SEO-Bot is the FINAL page prose authority. This stage projects it
// verbatim into the assembler's content map. It performs zero LLM calls and
// zero rewriting — deterministic text layout of the received blocks only.
// The legacy ContentGenerationStage is NOT in the redesign execution plan;
// its authority is absent, not merely reduced.

import type { ContentBlock, StructuredContentRoute } from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:structured-content-projection");

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

/** Deterministic verbatim projection of one SCP section into headline+body text. */
export function renderStructuredSection(
  section: StructuredContentRoute["sections"][number],
  fallbackHeadline: string,
): string {
  const headline = (section.heading ?? section.eyebrow ?? fallbackHeadline).trim();
  const parts: string[] = [];
  if (section.subheading) parts.push(section.subheading);
  for (const block of section.blocks) parts.push(renderBlock(block));
  if (section.cta) parts.push(section.cta.label);
  return `${headline}\n\n${parts.join("\n\n")}`;
}

export class StructuredContentProjectionStage implements Stage {
  name = "structured-content-projection";
  version = "1.0.0";

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info({ intent: ctx.buildIntent }, "not a redesign build; projection skipped");
      return;
    }
    if (ctx.dryRun) {
      logger.info("[dry-run] Would project StructuredContentPackage into route content");
      return;
    }
    const contentPackage = ctx.structuredContentPackage;
    if (!contentPackage) {
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

    const routesById = new Map(
      contentPackage.payload.routes.map((route) => [route.route_id, route]),
    );
    let projected = 0;
    for (const route of ctx.domainSpec.routes) {
      const structured = routesById.get(route.slug);
      if (!structured) {
        throw new BuildError(
          "ROUTE_SET_MISMATCH",
          `StructuredContentPackage carries no route ${route.slug}`,
        );
      }
      if (structured.sections.length < route.components.length) {
        throw new BuildError(
          "VALIDATION_FAILED",
          `StructuredContentPackage route ${route.slug} has ${structured.sections.length} sections; the spec requires ${route.components.length}`,
        );
      }
      route.components.forEach((component, index) => {
        const section = structured.sections[index];
        ctx.generatedContent.set(
          `${route.slug}:${component}`,
          renderStructuredSection(section, route.title),
        );
        projected += 1;
      });
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
      "StructuredContentPackage projected verbatim (legacy content authority bypassed)",
    );
  }
}
