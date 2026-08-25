// L9_META: layer=stage, role=competitive_intelligence, stage_index=3, status=active, version=1.0.0
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  type CompetitiveLandscapeArtifact,
  type ContentSlot,
  canonicalJson,
  refForArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type VisualRequirement,
  type WebsiteBlueprintRoute,
  type WebsiteBlueprintSection,
  type WebsiteBuildBlueprintArtifact,
  type WebsiteBuildBlueprintV1,
} from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../core/logger.js";
import {
  type AcceptedDonorEvidence,
  type DonorIngestor,
  HttpDonorIngestor,
} from "../intelligence/DonorIngestion.js";
import { websiteImproveTask } from "../intelligence/improve-llm-policy.js";
import { SeoBuildIntelligenceHttpClient } from "../intelligence/SeoBuildIntelligenceHttpClient.js";
import type { SeoBuildIntelligencePort } from "../intelligence/SeoBuildIntelligencePort.js";
import { type BuildContext, clientAssetRoot } from "../pipeline/BuildContext.js";
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
    // The model may emit a multi-part disposition ("PORT,MERGE_WITH_EXISTING").
    // Split on commas/semicolons, validate each part against the allowed set,
    // and keep the sorted unique joined form.
    const rawDisposition = String(entry.disposition ?? "");
    const dispositionParts = [...new Set(
      rawDisposition
        .split(/[,;]/)
        .map((part) => part.trim())
        .filter(Boolean),
    )].sort();
    if (dispositionParts.length === 0) {
      throw new BuildError(
        "INTELLIGENCE_PARSE_FAILED",
        `${source}: pattern ${index} has no disposition`,
      );
    }
    for (const part of dispositionParts) {
      if (!(ALLOWED_DISPOSITIONS as readonly string[]).includes(part)) {
        throw new BuildError(
          "INTELLIGENCE_PARSE_FAILED",
          `${source}: pattern ${index} has invalid disposition ${JSON.stringify(rawDisposition)}`,
        );
      }
    }
    const disposition = dispositionParts.join(",");
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

/** Campaign 7 R4: hard production invariant — exactly ten qualified donors. */
export const REQUIRED_DONOR_COUNT = 10;

interface DonorCandidate {
  domain: string;
  observation_ids: string[];
}

/**
 * Ordered qualified donor candidate pool: selected_donors first, then the
 * remaining ranked domains (by aggregate visibility) for bounded replacement.
 * Excluded classes (directories, social, publishers, aggregators,
 * marketplaces, …) never occupy candidate positions.
 */
export function qualifiedDonorCandidates(
  landscape: CompetitiveLandscapeArtifact,
): DonorCandidate[] {
  const excluded = new Set(landscape.payload.exclusions.map((entry) => entry.domain));
  const seen = new Set<string>();
  const pool: DonorCandidate[] = [];
  for (const donor of landscape.payload.selected_donors) {
    if (excluded.has(donor.domain) || seen.has(donor.domain)) continue;
    seen.add(donor.domain);
    pool.push({ domain: donor.domain, observation_ids: donor.observation_ids });
  }
  const ranked = [...landscape.payload.domains].sort(
    (a, b) => b.aggregate_visibility - a.aggregate_visibility,
  );
  for (const domain of ranked) {
    if (excluded.has(domain.domain) || seen.has(domain.domain)) continue;
    seen.add(domain.domain);
    pool.push({ domain: domain.domain, observation_ids: domain.observation_ids });
  }
  return pool;
}

/** Ranked page URLs for a donor from the landscape's SERP observations. */
export function donorCandidateUrls(
  landscape: CompetitiveLandscapeArtifact,
  candidate: DonorCandidate,
): string[] {
  const byId = new Map(
    landscape.payload.observations.map((observation) => [observation.observation_id, observation]),
  );
  const fromRefs = candidate.observation_ids
    .map((id) => byId.get(id))
    .filter((observation): observation is NonNullable<typeof observation> => Boolean(observation))
    .sort((a, b) => a.rank - b.rank)
    .map((observation) => observation.url);
  const fromDomain = landscape.payload.observations
    .filter((observation) => observation.domain === candidate.domain)
    .sort((a, b) => a.rank - b.rank)
    .map((observation) => observation.url);
  const urls = [...new Set([...fromRefs, ...fromDomain])];
  // Bounded discovery of the highest-value page even when the SERP only
  // observed deep URLs: the site root is a legitimate high-value page.
  try {
    const first = urls[0] ? new URL(urls[0]) : new URL(`https://${candidate.domain}`);
    const root = `${first.protocol}//${first.host}/`;
    if (!urls.includes(root)) urls.push(root);
  } catch {
    // Unparseable URL: leave the observed list as-is.
  }
  return urls;
}

/**
 * Bounded acquisition (Campaign 7 R4+R5): walk the qualified pool, acquire
 * real crawl + screenshot evidence per donor, replace unusable candidates,
 * and fail closed unless exactly REQUIRED_DONOR_COUNT donors satisfy BOTH the
 * qualification policy and the minimum evidence policy.
 */
export async function acquireAcceptedDonors(
  landscape: CompetitiveLandscapeArtifact,
  ingestor: DonorIngestor,
  outputDir: string,
  maxPagesPerDonor = 3,
): Promise<AcceptedDonorEvidence[]> {
  const pool = qualifiedDonorCandidates(landscape);
  const accepted: AcceptedDonorEvidence[] = [];
  for (const candidate of pool) {
    if (accepted.length === REQUIRED_DONOR_COUNT) break;
    const evidence = await ingestor.ingest({
      domain: candidate.domain,
      candidate_urls: donorCandidateUrls(landscape, candidate),
      serp_observation_ids: candidate.observation_ids,
      output_dir: outputDir,
      max_pages: maxPagesPerDonor,
    });
    if (!evidence) continue; // unusable — bounded replacement continues
    if (evidence.pages.length === 0) {
      throw new BuildError(
        "DONOR_EVIDENCE_INCOMPLETE",
        `donor ${candidate.domain} was accepted without crawl evidence`,
      );
    }
    if (evidence.screenshot_paths.length === 0) {
      throw new BuildError(
        "DONOR_SCREENSHOT_INCOMPLETE",
        `donor ${candidate.domain} was accepted without screenshot evidence`,
      );
    }
    accepted.push(evidence);
  }
  if (accepted.length !== REQUIRED_DONOR_COUNT) {
    throw new BuildError(
      "COMPETITIVE_EVIDENCE_INCOMPLETE",
      `REDESIGN_IMPROVE requires exactly ${REQUIRED_DONOR_COUNT} qualified usable donors; ` +
        `bounded selection produced ${accepted.length} from a pool of ${pool.length}`,
    );
  }
  return accepted;
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

function uniqueSlots(slots: ContentSlot[]): ContentSlot[] {
  const seen = new Set<ContentSlot>();
  const ordered: ContentSlot[] = [];
  for (const slot of CONTENT_SLOTS) {
    if (slots.includes(slot as ContentSlot) && !seen.has(slot as ContentSlot)) {
      seen.add(slot as ContentSlot);
      ordered.push(slot as ContentSlot);
    }
  }
  return ordered;
}

/**
 * Spec-component → canonical slot hints. Used only to place missing slots on
 * the most relevant existing section; leftover slots still land on section 0.
 */
function slotsForSpecComponent(component: string): ContentSlot[] {
  const name = component.toLowerCase();
  if (name.includes("hero")) return ["primary_offer"];
  if (name.includes("service")) return ["service_overview", "primary_offer"];
  if (name.includes("trust") || name.includes("warranty")) return ["trust"];
  if (name.includes("faq")) return ["faq"];
  if (name.includes("contact") || name.includes("cta") || name.includes("map"))
    return ["conversion"];
  if (name.includes("storm") || name.includes("area"))
    return ["local_relevance", "objection_handling"];
  if (name.includes("process")) return ["process"];
  if (name.includes("gallery") || name.includes("project") || name.includes("proof"))
    return ["project_proof"];
  return [];
}

function sectionMatchesComponent(section: WebsiteBlueprintSection, component: string): boolean {
  const needle = component.toLowerCase();
  return (
    section.section_id.toLowerCase() === needle ||
    section.section_id.toLowerCase().includes(needle) ||
    section.component_class.toLowerCase().includes(needle)
  );
}

/**
 * Deterministic completeness for Campaign 7 PCC compilation: every sealed
 * route must expose the full canonical ContentSlot set. SEO-Bot may require
 * any of those slots; an LLM-sparse section list must not make a valid
 * required requirement unplaceable. CONTENT_REQUIREMENT_UNPLACED still
 * fires if a requirement targets a slot outside this closed set.
 */
export function ensureCanonicalSlotCoverage(
  sections: WebsiteBlueprintSection[],
  specComponents: string[] = [],
): WebsiteBlueprintSection[] {
  const next: WebsiteBlueprintSection[] =
    sections.length > 0
      ? sections.map((section) => ({
          ...section,
          content_slots: uniqueSlots(section.content_slots),
        }))
      : [
          {
            section_id: "canonical-coverage",
            component_class: "prose",
            objective: "canonical content-slot coverage",
            content_slots: [],
            pattern_refs: [],
            proof_requirements: [],
          },
        ];

  for (const component of specComponents) {
    const derived = slotsForSpecComponent(component);
    if (derived.length === 0) continue;
    const match = next.find((section) => sectionMatchesComponent(section, component)) ?? next[0];
    match.content_slots = uniqueSlots([...match.content_slots, ...derived]);
  }

  const covered = new Set<ContentSlot>(next.flatMap((section) => section.content_slots));
  const missing = CONTENT_SLOTS.filter((slot): slot is ContentSlot => !covered.has(slot as ContentSlot));
  if (missing.length > 0) {
    next[0].content_slots = uniqueSlots([...next[0].content_slots, ...missing]);
  }
  return next;
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

/**
 * Deterministic blueprint-owned visual requirement derivation (Campaign 7
 * R11). The blueprint defines WHY and WHERE imagery is needed from route and
 * section structure; ImageAssetPlanning later selects WHICH eligible asset
 * satisfies each requirement. Never an LLM decision, never a planner default.
 */
function pushHomeRequirement(
  requirements: VisualRequirement[],
  route: WebsiteBlueprintRoute,
): void {
  const isHome = route.path === "/" || route.route_id === "/";
  if (!isHome) return;
  requirements.push({
    requirement_id: `vr-${route.route_id}-hero`,
    route_id: route.route_id,
    section_id: route.sections[0]?.section_id ?? "hero",
    slot_id: `${route.route_id}:hero`,
    role: "hero",
    required: true,
    min_count: 1,
    preferred_provenance: ["source", "licensed", "generated"],
    device_suitability: ["desktop", "mobile"],
    composition_guidance: "above-fold hero establishing the trade and locality",
  });
}

function pushSectionRequirements(
  requirements: VisualRequirement[],
  route: WebsiteBlueprintRoute,
): void {
  for (const section of route.sections) {
    const slots = new Set(section.content_slots);
    const component = section.component_class.toLowerCase();
    if (slots.has("project_proof") || component.includes("gallery")) {
      requirements.push({
        requirement_id: `vr-${route.route_id}-${section.section_id}-proof`,
        route_id: route.route_id,
        section_id: section.section_id,
        slot_id: `${route.route_id}:${section.section_id}:project_proof`,
        role: component.includes("gallery") ? "gallery" : "project_proof",
        required: false,
        min_count: component.includes("gallery") ? 3 : 1,
        preferred_provenance: ["source", "licensed", "generated"],
        device_suitability: ["desktop", "mobile"],
        composition_guidance: "authentic completed-work photography preferred",
      });
    }
    if (slots.has("service_overview")) {
      requirements.push({
        requirement_id: `vr-${route.route_id}-${section.section_id}-service`,
        route_id: route.route_id,
        section_id: section.section_id,
        slot_id: `${route.route_id}:${section.section_id}:service`,
        role: "service",
        required: false,
        min_count: 1,
        preferred_provenance: ["source", "licensed", "generated"],
        device_suitability: ["desktop", "mobile"],
      });
    }
    if (slots.has("trust")) {
      requirements.push({
        requirement_id: `vr-${route.route_id}-${section.section_id}-trust`,
        route_id: route.route_id,
        section_id: section.section_id,
        slot_id: `${route.route_id}:${section.section_id}:trust`,
        role: "trust",
        required: false,
        min_count: 1,
        preferred_provenance: ["source", "licensed", "generated"],
        device_suitability: ["desktop", "mobile"],
      });
    }
  }
}

export function deriveVisualRequirements(routes: WebsiteBlueprintRoute[]): VisualRequirement[] {
  const requirements: VisualRequirement[] = [
    {
      requirement_id: "vr-global-logo",
      route_id: "global",
      section_id: "global",
      slot_id: "global:logo",
      role: "logo",
      required: true,
      min_count: 1,
      preferred_provenance: ["source", "generated"],
      device_suitability: ["desktop", "mobile"],
    },
  ];
  for (const route of routes) {
    pushHomeRequirement(requirements, route);
    pushSectionRequirements(requirements, route);
  }
  // Deterministic identity: one requirement per slot_id, stable order.
  const bySlot = new Map<string, VisualRequirement>();
  for (const requirement of requirements) {
    if (!bySlot.has(requirement.slot_id)) bySlot.set(requirement.slot_id, requirement);
  }
  return [...bySlot.values()].sort((a, b) => a.slot_id.localeCompare(b.slot_id));
}

/** ADR-0004 BLUEPRINT GATE: structural validation before any design/content generation. */
function assertBlueprintIdentity(
  payload: WebsiteBuildBlueprintArtifact["payload"],
  landscape: CompetitiveLandscapeArtifact,
  portfolio: PatternPortfolio,
): void {
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
}

function assertBlueprintRouteSet(
  payload: WebsiteBuildBlueprintArtifact["payload"],
  expectedRoutes: Array<{ route_id: string; path: string; purpose: string }>,
): void {
  const expectedIds = new Set(expectedRoutes.map((route) => route.route_id));
  const actualIds = new Set(payload.routes.map((route) => route.route_id));
  if (actualIds.size !== expectedIds.size || [...expectedIds].some((id) => !actualIds.has(id))) {
    throw new BuildError(
      "BLUEPRINT_GATE_FAILED",
      "blueprint route set must equal the spec route set",
    );
  }
}

function assertBlueprintPatternRefs(
  payload: WebsiteBuildBlueprintArtifact["payload"],
  portfolio: PatternPortfolio,
): void {
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
}

function assertAdoptedPatternTests(portfolio: PatternPortfolio): void {
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

function validateWebsiteBuildBlueprint(
  blueprint: WebsiteBuildBlueprintArtifact,
  landscape: CompetitiveLandscapeArtifact,
  portfolio: PatternPortfolio,
  expectedRoutes: Array<{ route_id: string; path: string; purpose: string }>,
): void {
  const payload = blueprint.payload;
  assertBlueprintIdentity(payload, landscape, portfolio);
  assertBlueprintRouteSet(payload, expectedRoutes);
  assertBlueprintPatternRefs(payload, portfolio);
  assertAdoptedPatternTests(portfolio);
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
    private readonly ingestorFactory: (ctx: BuildContext) => DonorIngestor = defaultIngestor,
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
        "COMPETITIVE_INTELLIGENCE_REQUIRED",
        "REDESIGN_IMPROVE requires SEO_BOT_URL and SEO_BOT_API_KEY (ADR-0004: research is a prerequisite, not an advisory)",
      );
    }

    const port = this.portFactory(ctx);

    // Preflight BEFORE the first SEO-Bot build-intelligence call (oracle
    // ORACLE-005: seo-build-intelligence-preflight must precede
    // seo:createCompetitiveLandscape). Ordering proof is server-side:
    // SEO-Bot stamps the preflight report (produced_at) and the sealed
    // landscape artifact (produced_at) — the receipt compares the two.
    const preflightSnapshot = await port.preflight();
    ctx.seoBotOrdering = {
      preflight_produced_at: preflightSnapshot.produced_at ?? "",
      landscape_produced_at: "",
    };

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
        "COMPETITIVE_INTELLIGENCE_REQUIRED",
        "REDESIGN_IMPROVE requires target keywords or routes to seed competitive research",
      );

    logger.info(
      { donors: REQUIRED_DONOR_COUNT, queries: seedQueries.length },
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
      desired_donor_count: REQUIRED_DONOR_COUNT,
    });
    ctx.competitiveLandscape = landscape;
    if (ctx.seoBotOrdering) {
      ctx.seoBotOrdering.landscape_produced_at = landscape.produced_at;
    }
    logger.info(
      {
        landscapeId: landscape.artifact_id,
        selected: landscape.payload.selected_donors.length,
        domains: landscape.payload.domains.length,
      },
      "Competitive landscape sealed; beginning bounded donor acquisition",
    );

    // Campaign 7 R4+R5: exactly ten qualified donors, each with real crawl
    // and screenshot evidence. Unusable candidates are replaced from the
    // qualified pool; a shortfall fails closed.
    const ingestor = this.ingestorFactory(ctx);
    let accepted: AcceptedDonorEvidence[];
    try {
      accepted = await acquireAcceptedDonors(
        landscape,
        ingestor,
        resolve(clientAssetRoot(ctx), "donor-evidence"),
      );
    } finally {
      await ingestor.close();
    }
    ctx.acceptedDonors = accepted;
    logger.info(
      {
        accepted: accepted.length,
        crawlManifests: accepted.filter((donor) => donor.pages.length > 0).length,
        screenshotSets: accepted.filter((donor) => donor.screenshot_paths.length > 0).length,
      },
      "Donor evidence acquisition complete (10/10)",
    );

    // Per-donor nugget extraction (abstracts only — competitor prose/images
    // never enter generation inputs; donor assets stay DONOR_REFERENCE_ONLY).
    const nuggets: Array<
      Omit<HarvestedPattern, "pattern_id" | "donor_frequency"> & { donor: string }
    > = [];
    for (const donor of accepted) {
      const prompt = [
        `Extract the strongest user-facing concepts from this competitor's SEO landscape and crawl evidence.`,
        `Return ONLY JSON: {"nuggets": [{"evidence": "...", "invariant": "abstract, reusable statement", "disposition": "one of PORT|PORT_WITH_HARDENING|CONFIGURE|MERGE_WITH_EXISTING|KEEP_LOCAL|REJECT", "beneficiary_destination": "which part of the site benefits", "risk": "...", "acceptance_test": "..."}]}.`,
        `No competitor prose, no images, no trademarked phrasing — only abstract invariants.`,
        `Donor domain: ${donor.domain}`,
        `Crawled page evidence (URLs, digests only): ${JSON.stringify(
          donor.pages.map((page) => ({ url: page.url, digest: page.content_digest })),
        )}`,
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
      spec_components: route.components,
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
        sections: ensureCanonicalSlotCoverage(sections, expected.spec_components),
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
      visual_requirements: deriveVisualRequirements(routes),
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

function defaultIngestor(_ctx: BuildContext): DonorIngestor {
  return new HttpDonorIngestor();
}
