// L9_META: layer=stage, role=content_generation, stage_index=4, status=active, version=3.0.0
//
// COPY-path content authority. Two sources, one structured contract
// (services/content/sectionContent.ts):
//  - a crawled source site is ported block by block, each component claiming
//    its own heading/paragraphs/list/Q&A structure (sourceCopy.ts);
//  - without a crawl, each page is generated in ONE call as JSON — every
//    section of the page together, grounded in the spec's business facts,
//    value proposition, conversion authority and client vision.
// Both paths pass the same validation: shape (non-empty FAQ answers, real
// steps, short badges), no navigation/button run-ons, no business-name
// headings outside the hero, and no duplicate or near-duplicate bodies across
// any two sections of the site.
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext, DomainSpec } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { stripMarkdownDecorators } from "../services/content/plainText.js";
import {
  type FaqPair,
  normalizeComponentKey,
  type SectionContent,
  setSection,
} from "../services/content/sectionContent.js";
import {
  crossSectionIssues,
  MAX_HEADING_WORDS,
  type SectionIssue,
  shapeIssues,
} from "../services/content/sectionValidation.js";
import {
  matchSourcePage,
  reconstructPageSections,
  SourceReconstructionError,
} from "../services/content/sourceCopy.js";
import { extractJson, JsonExtractionError } from "../services/extractJson.js";

const logger = createModuleLogger("stage:content-generation");
/** Minimum prose words for a generic (paragraph) section. */
const PROSE_MIN_WORDS = 40;
const BANNED_CLAIMS = ["guaranteed", "we guarantee", "100% success", "always win"];
const MAX_RETRIES = 2;

type Route = DomainSpec["routes"][number];

/** What each component must carry, stated to the model and checked by shapeIssues. */
const COMPONENT_GUIDE: Record<string, string> = {
  hero: `"heading" (the page's single H1) and "subheading" (one or two sentences on who this page serves and why).`,
  faq: `"heading" and "faqs": 3-6 objects {"question","answer"}; every answer is 1-3 complete sentences.`,
  process: `"heading", optional "subheading", and "steps": 3-5 strings, each one concrete action in one sentence.`,
  trust_bar: `"heading" and "badges": 3-5 short trust points (at most 8 words each) taken only from the business facts; omit any you cannot support.`,
  trust_signals: `"heading" and "badges": 3-5 short trust points (at most 8 words each) taken only from the business facts.`,
  service_area: `"heading" and "paragraphs": 1-2 paragraphs naming only the states/areas given.`,
  cta: `"heading" and "paragraphs": one sentence inviting the visitor to act.`,
  final_cta: `"heading" and "paragraphs": one sentence inviting the visitor to act.`,
  contact_form: `"heading" and "paragraphs": one sentence on what happens after someone gets in touch.`,
  gallery: `"heading" and optionally one short paragraph introducing the work shown.`,
};
const PROSE_GUIDE = `"heading" and "paragraphs": 2-3 paragraphs, at least ${PROSE_MIN_WORDS} words in total, specific to this section's topic.`;

const bannedClaim = (value: string, extra: readonly string[]) =>
  [...BANNED_CLAIMS, ...extra].find(
    (claim) => claim && value.toLowerCase().includes(claim.toLowerCase()),
  );

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map(cleanText)
    .filter(Boolean);
}

function cleanText(value: string): string {
  return stripMarkdownDecorators(value).replace(/\s+/g, " ").trim();
}

function asFaqs(value: unknown): FaqPair[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): FaqPair[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const question = typeof record.question === "string" ? cleanText(record.question) : "";
    const answer = typeof record.answer === "string" ? cleanText(record.answer) : "";
    return [{ question, answer }];
  });
}

export function parsePageSections(
  raw: string,
  components: readonly string[],
): { sections: Map<string, SectionContent>; problems: string[] } {
  const problems: string[] = [];
  const sections = new Map<string, SectionContent>();
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (error) {
    const detail = error instanceof JsonExtractionError ? error.message : String(error);
    return { sections, problems: [`response was not JSON (${detail})`] };
  }
  const list =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { sections?: unknown }).sections)
      ? ((parsed as { sections: unknown[] }).sections ?? [])
      : [];
  const byComponent = new Map<string, Record<string, unknown>>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.component === "string")
      byComponent.set(normalizeComponentKey(record.component), record);
  }
  for (const component of components) {
    const key = normalizeComponentKey(component);
    const record = byComponent.get(key);
    if (!record) {
      problems.push(`missing section for component "${component}"`);
      continue;
    }
    const subheading =
      typeof record.subheading === "string" ? cleanText(record.subheading) : undefined;
    sections.set(component, {
      component: key,
      heading: typeof record.heading === "string" ? cleanText(record.heading) : "",
      ...(subheading ? { subheading } : {}),
      paragraphs: asStrings(record.paragraphs),
      steps: asStrings(record.steps),
      faqs: asFaqs(record.faqs),
      badges: asStrings(record.badges),
      provenance: "generated",
    });
  }
  return { sections, problems };
}

function listFacts(spec: DomainSpec): string[] {
  const lines: string[] = [];
  const facts = spec.business_facts ?? {};
  const factLines = Object.entries(facts).map(
    ([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join("; ") : String(value)}`,
  );
  lines.push(
    factLines.length
      ? ["Verified business facts (the ONLY facts you may state):", ...factLines].join("\n")
      : "No verified business facts are on file: make no factual claims about years, licences, awards, ratings, warranties, response times or offers.",
  );
  const vp = spec.value_proposition;
  if (vp) {
    const parts: Array<[string, string[]]> = [
      ["Target customers", vp.target_customer],
      ["Problems solved", vp.problem],
      ["Outcomes", vp.outcome],
      ["How", vp.mechanism],
      ["Differentiators", vp.differentiators],
      ["Reasons to believe", vp.reasons_to_believe],
      ["Boundaries (do not claim beyond these)", vp.boundaries],
    ];
    for (const [label, values] of parts)
      if (values?.length) lines.push(`${label}: ${values.join("; ")}`);
  }
  const ca = spec.conversion_authority;
  if (ca?.primary_action) {
    lines.push(`Primary call to action (use verbatim as the CTA heading): ${ca.primary_action}`);
    if (ca.secondary_actions.length)
      lines.push(`Secondary actions: ${ca.secondary_actions.join("; ")}`);
  } else {
    lines.push(
      "No primary offer is defined: never invent an offer (free, discount, within N hours).",
    );
  }
  const vision = spec.client_vision;
  if (vision) {
    const parts: Array<[string, string[] | undefined]> = [
      ["Client's desired outcomes", vision.desired_outcomes],
      ["Brand attributes (tone)", vision.brand_attributes],
      ["Conversion priorities", vision.conversion_priorities],
      ["Explicit constraints", vision.explicit_constraints],
    ];
    for (const [label, values] of parts)
      if (values?.length) lines.push(`${label}: ${values.join("; ")}`);
  }
  const forbidden = spec.content_guardrails?.forbidden_claims ?? [];
  if (forbidden.length) lines.push(`Forbidden claims: ${forbidden.join("; ")}`);
  return lines;
}

export class ContentGenerationStage implements Stage {
  name = "content-generation";
  version = "3.0.0";

  async run(ctx: BuildContext): Promise<void> {
    this.assertNotRedesign(ctx);
    if (ctx.dryRun) {
      logger.info(
        { routes: ctx.domainSpec.routes.length },
        "[dry-run] Would generate route content",
      );
      return;
    }
    const sourceEnabled = ctx.domainSpec.assets?.sourceSite?.enabled === true;
    const hasPages = Boolean(ctx.sourceSiteManifest?.pages.length);
    if (sourceEnabled && !hasPages) {
      throw new BuildError(
        "CONTENT_VALIDATION_FAILED",
        "Source-site reconstruction requires crawled pages. Refusing to invent copy.",
      );
    }
    const accepted = new Map<string, SectionContent>();
    if (hasPages) this.reconstruct(ctx, accepted);
    else {
      for (const route of ctx.domainSpec.routes) await this.generatePage(ctx, route, accepted);
    }
    logger.info({ sections: accepted.size }, "Content generation complete");
  }

  private assertNotRedesign(ctx: BuildContext): void {
    // Campaign 7 R9 tripwire: under REDESIGN_IMPROVE the legacy content
    // authority is absent from the execution plan. If anything still invokes
    // it, the attempt is counted and the build fails closed.
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") return;
    if (ctx.redesignCounters) ctx.redesignCounters.legacyContentGenerationCalls += 1;
    throw new BuildError(
      "LEGACY_CONTENT_AUTHORITY_USED",
      "legacy ContentGenerationStage must not generate final prose under REDESIGN_IMPROVE (StructuredContentPackage is the content authority)",
    );
  }

  /** Port every route from its own crawled page; validation is the same as generation's. */
  private reconstruct(ctx: BuildContext, accepted: Map<string, SectionContent>): void {
    const seen = new Set<string>();
    const spec = ctx.domainSpec;
    for (const route of spec.routes) {
      const page = matchSourcePage(ctx.sourceSiteManifest, route.slug);
      if (!page) {
        throw new BuildError(
          "CONTENT_VALIDATION_FAILED",
          `${route.slug}: source-site reconstruction is on but no crawled page matched ${route.slug}`,
        );
      }
      let sections: Map<string, SectionContent>;
      try {
        sections = reconstructPageSections({
          page,
          components: route.components,
          primaryAction: spec.conversion_authority?.primary_action,
          businessName: spec.business_name,
          seenBlockFingerprints: seen,
        });
      } catch (error) {
        if (error instanceof SourceReconstructionError)
          throw new BuildError("CONTENT_VALIDATION_FAILED", `${route.slug}: ${error.message}`);
        throw error;
      }
      const candidates = this.keyed(route, sections);
      // Source copy is ported verbatim; only structural defects are checked
      // (no word floor: the client's own copy is not padded).
      const issues = this.validate(ctx, accepted, candidates, 0);
      if (issues.length) {
        throw new BuildError(
          "CONTENT_VALIDATION_FAILED",
          `source reconstruction of ${route.slug} failed validation: ${issues.map((issue) => `${issue.key}: ${issue.message}`).join("; ")}`,
        );
      }
      this.commit(ctx, accepted, candidates);
    }
  }

  private keyed(route: Route, sections: Map<string, SectionContent>): Map<string, SectionContent> {
    const out = new Map<string, SectionContent>();
    for (const component of route.components) {
      const section = sections.get(component);
      if (section) out.set(`${route.slug}:${component}`, section);
    }
    return out;
  }

  private validate(
    ctx: BuildContext,
    accepted: Map<string, SectionContent>,
    candidates: Map<string, SectionContent>,
    minProseWords: number,
  ): SectionIssue[] {
    const forbidden = ctx.domainSpec.content_guardrails?.forbidden_claims ?? [];
    const issues: SectionIssue[] = [];
    for (const [key, section] of candidates) {
      issues.push(...shapeIssues(key, section, minProseWords));
      const text = [
        section.heading,
        section.subheading ?? "",
        ...section.paragraphs,
        ...section.steps,
        ...section.badges,
        ...section.faqs.flatMap((faq) => [faq.question, faq.answer]),
      ].join(" ");
      if (/\[[^\]]*(phone|name|address|email|city)[^\]]*\]/i.test(text))
        issues.push({ key, message: "contains a bracketed placeholder" });
      if (section.provenance === "generated") {
        const banned = bannedClaim(text, forbidden);
        if (banned) issues.push({ key, message: `prohibited claim "${banned}"` });
      }
    }
    issues.push(...crossSectionIssues(accepted, candidates, ctx.domainSpec.business_name));
    return issues;
  }

  private commit(
    ctx: BuildContext,
    accepted: Map<string, SectionContent>,
    candidates: Map<string, SectionContent>,
  ): void {
    for (const [key, section] of candidates) {
      accepted.set(key, section);
      setSection(ctx.generatedContent, key, section);
    }
  }

  private pagePrompt(
    ctx: BuildContext,
    route: Route,
    accepted: Map<string, SectionContent>,
    correction: string,
  ): string {
    const spec = ctx.domainSpec;
    const phone = spec.seo_contract?.phone?.trim();
    const sectionsWanted = route.components.map((component) => {
      const key = normalizeComponentKey(component);
      return `- "${component}": ${COMPONENT_GUIDE[key] ?? PROSE_GUIDE}`;
    });
    const written = [...accepted.values()].map(
      (section) =>
        `- "${section.heading}": ${(section.subheading ?? section.paragraphs[0] ?? section.steps[0] ?? section.faqs[0]?.question ?? "").slice(0, 120)}`,
    );
    return [
      `Write every section of the "${route.title}" page (route slug "${route.slug}") for ${spec.business_name}, a ${spec.vertical} business serving ${spec.geography.states.join(", ")}.`,
      route.purpose ? `Page purpose: ${route.purpose}` : "",
      ...listFacts(spec),
      phone
        ? `Known phone: ${phone}. Mention it at most once on the page. Never invent another number or write placeholders.`
        : "No phone is on file. Omit phone numbers. Never write placeholders such as [phone number].",
      "Sections, in page order, each with the fields named:",
      ...sectionsWanted,
      "Each section covers a different aspect of this page: never restate another section's points, sentences or headings.",
      `Every heading is unique across the site, at most ${MAX_HEADING_WORDS} words, and is not the business name (except the hero may be).`,
      "Never invent years of experience, awards, certifications, ratings, guarantees, statistics, prices, response times or third-party endorsements; state only facts given above.",
      "Use active voice and second person. Plain text inside JSON strings; no markdown.",
      written.length
        ? [
            "Already written elsewhere on the site (do not repeat these headings or points):",
            ...written,
          ].join("\n")
        : "",
      'Respond with JSON only: {"sections":[{"component":"<name>","heading":"...","subheading":"...","paragraphs":["..."],"steps":["..."],"faqs":[{"question":"...","answer":"..."}],"badges":["..."]}]} — one object per component listed, omitting fields that component does not use.',
      correction,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async generatePage(
    ctx: BuildContext,
    route: Route,
    accepted: Map<string, SectionContent>,
  ): Promise<void> {
    const phone = ctx.domainSpec.seo_contract?.phone?.trim();
    const primaryAction = ctx.domainSpec.conversion_authority?.primary_action?.trim();
    let correction = "";
    let lastIssues: string[] = [];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let raw = await ctx.llm.generateContent(this.pagePrompt(ctx, route, accepted, correction));
      if (phone) raw = raw.replace(/\[(?:your |insert |add |enter )?phone(?: number)?\]/gi, phone);
      const { sections, problems } = parsePageSections(raw, route.components);
      // The CTA heading is the operator's primary action whenever one exists.
      if (primaryAction) {
        for (const section of sections.values()) {
          if (/^(cta|final_cta|contact_form)$/.test(section.component))
            section.heading = primaryAction;
        }
      }
      const candidates = this.keyed(route, sections);
      const issues = [
        ...problems,
        ...this.validate(ctx, accepted, candidates, PROSE_MIN_WORDS).map(
          (issue) => `${issue.key}: ${issue.message}`,
        ),
      ];
      if (!issues.length) {
        this.commit(ctx, accepted, candidates);
        return;
      }
      lastIssues = issues;
      correction = [
        "Your previous answer failed validation:",
        ...issues.map((issue) => `- ${issue}`),
        "Rewrite the complete page JSON from scratch.",
      ].join("\n");
    }
    throw new BuildError(
      "CONTENT_VALIDATION_FAILED",
      `${route.slug}: generated page failed validation after ${MAX_RETRIES + 1} attempts: ${lastIssues.join("; ")}`,
    );
  }
}
