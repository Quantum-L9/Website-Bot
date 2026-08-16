// L9_META: layer=stage, role=competitive_intelligence, stage_index=3, status=active, version=1.0.0
import { createHash } from "node:crypto";
import {
  type CompetitiveLandscapeArtifact,
  type ContentSlot,
  canonicalJson,
  refForArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type WebsiteBlueprintRoute,
  type WebsiteBlueprintSection,
  type WebsiteBuildBlueprintArtifact,
  type WebsiteBuildBlueprintV1,
} from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../core/logger.js";
import {
  WEBSITE_IMPROVE_LLM_POLICY,
  websiteImproveTask,
} from "../intelligence/improve-llm-policy.js";
import { SeoBuildIntelligenceHttpClient } from "../intelligence/SeoBuildIntelligenceHttpClient.js";
import type { SeoBuildIntelligencePort } from "../intelligence/SeoBuildIntelligencePort.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { extractJson } from "../services/extractJson.js";

const logger = createModuleLogger("stage:competitive-intelligence");

const ALLOWED_DISPOSITIONS = [
  "PORT",
  "PORT_WITH_HARDENING",
  "CONFIGURE",
  "MERGE_WITH_EXISTING",
  "KEEP_LOCAL",
  "MIGRATION_CONTEXT",
  "REJECT",
  "UNKNOWN",
] as const;
type Disposition = (typeof ALLOWED_DISPOSITIONS)[number];

interface HarvestedPattern {
  pattern_id: string;
  evidence: string;
  invariant: string;
  disposition: Disposition;
  beneficiary_destination: string;
  risk: string;
  acceptance_test: string;
  donor_frequency: number;
}

interface PatternPortfolio {
  patterns: HarvestedPattern[];
}

const STATE_NAME: Record<string, string> = {
  AL: "Alabama,United States",
  AZ: "Arizona,United States",
  CA: "California,United States",
  CO: "Colorado,United States",
  FL: "Florida,United States",
  GA: "Georgia,United States",
  NC: "North Carolina,United States",
  SC: "South Carolina,United States",
  TN: "Tennessee,United States",
  TX: "Texas,United States",
  VA: "Virginia,United States",
};

/** DataForSEO accepts canonical names, not state codes ("NC" yields task errors). */
function canonicalLocationName(primaryState: string): string {
  return STATE_NAME[primaryState.trim().toUpperCase()] ?? "United States";
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePatterns(value: unknown, source: string): HarvestedPattern[] {
  if (!Array.isArray(value))
    throw new BuildError(
      "INTELLIGENCE_PARSE_FAILED",
      `${source}: expected a JSON array of patterns`,
    );
  return value.map((entry, index) => {
    if (!isRecord(entry))
      throw new BuildError(
        "INTELLIGENCE_PARSE_FAILED",
        `${source}: pattern ${index} is not an object`,
      );
    const disposition = String(entry.disposition ?? "");
    if (!(ALLOWED_DISPOSITIONS as readonly string[]).includes(disposition)) {
      throw new BuildError(
        "INTELLIGENCE_PARSE_FAILED",
        `${source}: pattern ${index} has invalid disposition ${JSON.stringify(disposition)}`,
      );
    }
    return {
      pattern_id: String(entry.pattern_id ?? `p-${index}`),
      evidence: String(entry.evidence ?? ""),
      invariant: String(entry.invariant ?? ""),
      disposition: disposition as Disposition,
      beneficiary_destination: String(entry.beneficiary_destination ?? entry.beneficiary ?? ""),
      risk: String(entry.risk ?? ""),
      acceptance_test: String(entry.acceptance_test ?? ""),
      donor_frequency: Number(entry.donor_frequency ?? 1),
    };
  });
}

/**
 * Single bounded repair for JSON-shaped improve ops: parse, and on failure retry
 * once with the rejection reason. A second failure is terminal.
 */
async function strategizeJson(
  ctx: BuildContext,
  operation: "DONOR_NUGGET_EXTRACTION" | "PATTERN_SYNTHESIS" | "WEBSITE_BLUEPRINT",
  description: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown>> {
  const task = websiteImproveTask(operation, ctx.clientId, description);
  const first = await ctx.llm.strategize(task, systemPrompt, userPrompt);
  try {
    const parsed = extractJson(first) as Record<string, unknown>;
    if (!isRecord(parsed)) throw new Error("expected a JSON object");
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn({ operation, reason }, "Improve-op JSON invalid; attempting one bounded repair");
    const repairPrompt = `${userPrompt}\n\n---\nYour previous response was rejected: ${reason}\nRespond again with ONLY a single valid JSON value. No prose, no markdown fences.`;
    const second = await ctx.llm.strategize(task, systemPrompt, repairPrompt);
    return extractJson(second) as Record<string, unknown>;
  }
}

const CONTENT_SLOTS: readonly string[] = [
  "primary_offer",
  "service_overview",
  "differentiation",
  "trust",
  "process",
  "project_proof",
  "local_relevance",
  "objection_handling",
  "faq",
  "conversion",
  "metadata",
];

function contentSlots(value: unknown): ContentSlot[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter((slot): slot is ContentSlot => CONTENT_SLOTS.includes(slot));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function strategyOf(value: unknown): WebsiteBuildBlueprintV1["strategy"] {
  const row = isRecord(value) ? value : {};
  return {
    experience_attributes: stringArray(row.experience_attributes),
    differentiation: stringArray(row.differentiation),
    preserve: stringArray(row.preserve),
    evolve: stringArray(row.evolve),
    forbid: stringArray(row.forbid),
  };
}

function guardrailsOf(value: unknown): WebsiteBuildBlueprintV1["content_guardrails"] {
  const row = isRecord(value) ? value : {};
  return { forbidden_claims: stringArray(row.forbidden_claims) };
}

function conversionOf(value: unknown): WebsiteBuildBlueprintV1["conversion"] {
  const row = isRecord(value) ? value : {};
  return {
    primary_action:
      typeof row.primary_action === "string" ? row.primary_action : "Request a free inspection",
    secondary_actions: stringArray(row.secondary_actions),
    persistent_mobile_action: row.persistent_mobile_action !== false,
  };
}

/** ADR-0004 BLUEPRINT GATE: structural validation before any design/content generation. */
function validateWebsiteBuildBlueprint(
  blueprint: WebsiteBuildBlueprintArtifact,
  landscape: CompetitiveLandscapeArtifact,
  portfolio: PatternPortfolio,
  expectedRoutes: Array<{ route_id: string; path: string; purpose: string }>,
): void {
  const payload = blueprint.payload;
  if (payload.build_intent !== "REDESIGN_IMPROVE") {
    throw new BuildError(
      "BLUEPRINT_GATE_FAILED",
      "blueprint build_intent must be REDESIGN_IMPROVE",
    );
  }
  if (payload.competitive_landscape_ref.artifact_id !== refForArtifact(landscape).artifact_id) {
    throw new BuildError(
      "BLUEPRINT_GATE_FAILED",
      "blueprint references a different competitive landscape",
    );
  }
  if (payload.pattern_portfolio_digest !== digestOf(portfolio)) {
    throw new BuildError("BLUEPRINT_GATE_FAILED", "blueprint pattern portfolio digest mismatch");
  }
  const expectedIds = new Set(expectedRoutes.map((route) => route.route_id));
  const actualIds = new Set(payload.routes.map((route) => route.route_id));
  if (actualIds.size !== expectedIds.size || [...expectedIds].some((id) => !actualIds.has(id))) {
    throw new BuildError(
      "BLUEPRINT_GATE_FAILED",
      "blueprint route set must equal the spec route set",
    );
  }
  const patternIds = new Set(portfolio.patterns.map((pattern) => pattern.pattern_id));
  for (const route of payload.routes) {
    for (const section of route.sections) {
      for (const ref of section.pattern_refs) {
        if (!patternIds.has(ref))
          throw new BuildError(
            "BLUEPRINT_GATE_FAILED",
            `section ${section.section_id} references unknown pattern ${ref}`,
          );
      }
    }
  }
  const adopted = portfolio.patterns.filter(
    (pattern) => !["REJECT", "UNKNOWN"].includes(pattern.disposition),
  );
  for (const pattern of adopted) {
    if (!pattern.acceptance_test.trim()) {
      throw new BuildError(
        "BLUEPRINT_GATE_FAILED",
        `adopted pattern ${pattern.pattern_id} lacks an acceptance test`,
      );
    }
  }
}

export class CompetitiveIntelligenceStage implements Stage {
  name = "competitive-intelligence";
  version = "1.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    resumable: false,
    externalMutation: false,
  };

  constructor(
    private readonly portFactory: (ctx: BuildContext) => SeoBuildIntelligencePort = defaultPort,
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info(
        { intent: ctx.buildIntent },
        "COPY intent — competitive intelligence stage not required",
      );
      return;
    }
    const seoBotUrl = process.env.SEO_BOT_URL?.trim();
    const seoBotKey = process.env.SEO_BOT_API_KEY?.trim();
    if (!seoBotUrl || !seoBotKey) {
      throw new BuildError(
        "INTELLIGENCE_UNAVAILABLE",
        "REDESIGN_IMPROVE requires SEO_BOT_URL and SEO_BOT_API_KEY (ADR-0004: research is a prerequisite, not an advisory)",
      );
    }

    const port = this.portFactory(ctx);
    const keywords = (ctx.domainSpec.seo_contract?.target_keywords ?? []).filter((keyword) =>
      keyword.trim(),
    );
    const seedQueries =
      keywords.length > 0
        ? keywords.slice(0, 10)
        : ctx.domainSpec.routes
            .slice(0, 10)
            .map((route) => `${route.title} ${ctx.domainSpec.geography.primary_state}`);
    if (seedQueries.length === 0)
      throw new BuildError(
        "INTELLIGENCE_UNAVAILABLE",
        "REDESIGN_IMPROVE requires target keywords or routes to seed competitive research",
      );

    logger.info(
      { donors: 10, queries: seedQueries.length },
      "Fetching competitive landscape from SEO-Bot",
    );
    const landscape = await port.createCompetitiveLandscape({
      client_id: ctx.clientId,
      build_id: ctx.buildId,
      market: {
        niche: ctx.domainSpec.vertical,
        country: "US",
        // DataForSEO expects canonical language names ('English'), not ISO codes ('en').
        language: "English",
        device: "desktop" as const,
        // DataForSEO requires canonical location names ("North Carolina,United
        // States"); bare state codes (NC) return task errors, not results.
        location_name: canonicalLocationName(ctx.domainSpec.geography.primary_state),
      },
      seed_queries: seedQueries,
      desired_donor_count: 10,
    });
    const donors = landscape.payload.selected_donors.slice(0, 10);
    if (donors.length === 0)
      throw new BuildError(
        "INTELLIGENCE_EVIDENCE_INCOMPLETE",
        "competitive landscape selected no donors",
      );
    logger.info(
      { donors: donors.length, landscapeId: landscape.artifact_id },
      "Competitive landscape sealed",
    );

    // Bounded donor ingestion: per-donor nugget extraction (abstracts only —
    // competitor prose/images never enter generation inputs).
    const nuggets: Array<
      Omit<HarvestedPattern, "pattern_id" | "donor_frequency"> & { donor: string }
    > = [];
    for (const donor of donors) {
      const prompt = [
        `Extract the strongest user-facing concepts from this competitor's SEO landscape evidence.`,
        `Return ONLY JSON: {"nuggets": [{"evidence": "...", "invariant": "abstract, reusable statement", "disposition": "one of PORT|PORT_WITH_HARDENING|CONFIGURE|MERGE_WITH_EXISTING|KEEP_LOCAL|REJECT", "beneficiary_destination": "which part of the site benefits", "risk": "...", "acceptance_test": "..."}]}.`,
        `No competitor prose, no images, no trademarked phrasing — only abstract invariants.`,
        `Donor: ${JSON.stringify(donor)}`,
      ].join("\n\n");
      const parsed = await strategizeJson(
        ctx,
        "DONOR_NUGGET_EXTRACTION",
        `[intelligence] donor nuggets for ${donor.domain}`,
        "You harvest reusable design concepts from market evidence. Never copy competitor prose or visual treatments.",
        prompt,
      );
      for (const nugget of parsePatterns(parsed.nuggets ?? [], `donor ${donor.domain}`)) {
        nuggets.push({ ...nugget, donor: donor.domain });
      }
    }

    // Cross-donor synthesis into the pattern portfolio.
    const synthesis = await strategizeJson(
      ctx,
      "PATTERN_SYNTHESIS",
      "[intelligence] cross-donor pattern synthesis",
      "You synthesize harvested concepts across competitors into a pattern portfolio. Every pattern carries evidence, an abstract invariant, a disposition, a beneficiary destination, a risk, and an acceptance test.",
      `Nuggets across ${nuggets.length} donor observations (deduplicate by invariant, merge donor_frequency): ${JSON.stringify(nuggets)}\n\nReturn ONLY JSON: {"patterns": [{"pattern_id","evidence","invariant","disposition","beneficiary_destination","risk","acceptance_test","donor_frequency"}]}`,
    );
    const portfolio: PatternPortfolio = {
      patterns: parsePatterns(synthesis.patterns ?? [], "pattern synthesis"),
    };
    if (portfolio.patterns.length === 0)
      throw new BuildError("INTELLIGENCE_PARSE_FAILED", "pattern synthesis produced no patterns");

    // Website blueprint via the strategy op, with route identity re-asserted from
    // the spec (the model cannot invent routes).
    const routesContext = ctx.domainSpec.routes.map((route) => ({
      route_id: route.slug,
      path: route.slug,
      purpose: route.title,
      spec_components: route.components,
    }));
    const model = await strategizeJson(
      ctx,
      "WEBSITE_BLUEPRINT",
      "[intelligence] website build blueprint",
      "You produce a website build blueprint: strategy, guardrails, conversion, and per-route sections referencing pattern portfolio ids. No layout/design/prose generation — abstractions only.",
      `Pattern portfolio: ${JSON.stringify(portfolio)}\nRoutes (identity is fixed — you may only choose sections, objectives, content slots, pattern refs, and proof requirements): ${JSON.stringify(routesContext)}\nReturn ONLY JSON: {"strategy":{"experience_attributes":[],"differentiation":[],"preserve":[],"evolve":[],"forbid":[]},"content_guardrails":{"forbidden_claims":[]},"conversion":{"primary_action":"","secondary_actions":[],"persistent_mobile_action":true},"routes":[{"route_id","sections":[{"section_id","component_class","objective","content_slots":[],"pattern_refs":[],"proof_requirements":[]}]}],"acceptance_tests":[]}`,
    );
    const expectedRoutes = ctx.domainSpec.routes.map((route) => ({
      route_id: route.slug,
      path: route.slug,
      purpose: route.title,
    }));
    const modelRoutes = (Array.isArray(model.routes) ? model.routes : []) as Array<
      Record<string, unknown>
    >;
    const routes: WebsiteBlueprintRoute[] = expectedRoutes.map((expected) => {
      const produced = modelRoutes.find((route) => route.route_id === expected.route_id);
      const sections: WebsiteBlueprintSection[] = (
        Array.isArray(produced?.sections) ? produced.sections : []
      ).map((section, index) => {
        const row = section as Record<string, unknown>;
        return {
          section_id: String(row.section_id ?? `s-${index}`),
          component_class: String(row.component_class ?? "prose"),
          objective: String(row.objective ?? ""),
          content_slots: contentSlots(row.content_slots),
          pattern_refs: Array.isArray(row.pattern_refs) ? row.pattern_refs.map(String) : [],
          proof_requirements: Array.isArray(row.proof_requirements)
            ? row.proof_requirements.map(String)
            : [],
        };
      });
      return {
        route_id: expected.route_id,
        path: expected.path,
        purpose: expected.purpose,
        sections,
      };
    });
    const payload: WebsiteBuildBlueprintV1 = {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint,
      build_intent: "REDESIGN_IMPROVE",
      competitive_landscape_ref: refForArtifact(landscape),
      baseline_digest: digestOf(ctx.domainSpec.routes),
      pattern_portfolio_digest: digestOf(portfolio),
      strategy: strategyOf(model.strategy),
      content_guardrails: guardrailsOf(model.content_guardrails),
      conversion: conversionOf(model.conversion),
      routes,
      acceptance_tests: stringArray(model.acceptance_tests),
    };
    const blueprint = sealIntelligenceArtifact({
      artifact_type: "website_build_blueprint",
      client_id: ctx.clientId,
      build_id: ctx.buildId,
      producer: { repo: "Website-Bot", version: "3.1.0" },
      input_refs: [refForArtifact(landscape)],
      payload,
    });

    validateWebsiteBuildBlueprint(blueprint, landscape, portfolio, expectedRoutes);
    ctx.websiteBlueprint = blueprint;
    logger.info(
      {
        artifactId: blueprint.artifact_id,
        patterns: portfolio.patterns.length,
        routes: routes.length,
      },
      "Website build blueprint sealed and gated",
    );
  }
}

function defaultPort(ctx: BuildContext): SeoBuildIntelligencePort {
  return new SeoBuildIntelligenceHttpClient(
    process.env.SEO_BOT_URL?.trim() ?? "",
    process.env.SEO_BOT_API_KEY?.trim() ?? "",
  );
}
