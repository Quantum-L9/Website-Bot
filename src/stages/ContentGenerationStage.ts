// L9_META: layer=stage, role=content_generation, stage_index=4, status=active, version=2.3.0
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { stripMarkdownDecorators } from "../services/content/plainText.js";
import { assembleSourceSection, matchSourcePage } from "../services/content/sourceCopy.js";

const logger = createModuleLogger("stage:content-generation");
const MIN_WORDS = 80;
const SHORT_SECTION_MIN_WORDS = 8;
const SHORT_SECTIONS = /^(gallery|cta|final_cta|contact_form|trust_bar|trust_signals)$/;
const MAX_H1_WORDS = 12;
const BANNED_CLAIMS = ["guaranteed", "we guarantee", "100% success", "always win"];
const MAX_RETRIES = 2;
const countWords = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const bannedClaim = (value: string) =>
  BANNED_CLAIMS.find((claim) => value.toLowerCase().includes(claim));
const sectionKey = (component: string) =>
  component
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
const minWordsFor = (component: string) =>
  SHORT_SECTIONS.test(sectionKey(component)) ? SHORT_SECTION_MIN_WORDS : MIN_WORDS;

function stripHeadlineMarkup(headline: string): string {
  return headline
    .replace(/^\*\*(.*)\*\*$/s, "$1")
    .replace(/^__(.*)__$/s, "$1")
    .replace(/^\*+|\*+$/g, "")
    .trim();
}

function parseHeadlineAndBody(content: string): { headline: string; body: string } {
  const normalized = content.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const headline = stripHeadlineMarkup((lines[0] ?? "").trim());
  let blankIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "") {
      blankIndex = i;
      break;
    }
  }
  const body =
    blankIndex === -1
      ? ""
      : lines
          .slice(blankIndex + 1)
          .join("\n")
          .trim();
  return { headline, body };
}

function formatTakenList(label: string, values: readonly string[]): string {
  if (values.length === 0) return "";
  return [label, ...values.map((value) => `- "${value}"`)].join("\n");
}

function takenHeadlineBlock(headlines: readonly string[]): string {
  return formatTakenList(
    "Already used headlines (do not repeat, even paraphrased as the same CTA):",
    headlines,
  );
}

type SlotIssue = {
  message: string;
  correction: string;
};

function validateSlot(
  key: string,
  content: string,
  seenH1s: Set<string>,
  takenHeadlines: readonly string[],
  minWords: number,
): SlotIssue | undefined {
  const { headline, body } = parseHeadlineAndBody(content);
  const h1Words = countWords(headline);
  const bodyWords = countWords(body);
  const banned = bannedClaim(content);

  if (!headline) {
    return {
      message: `${key}: empty H1`,
      correction: `The headline (line 1) was empty; put a unique headline of at most ${MAX_H1_WORDS} words on line 1.`,
    };
  }
  if (h1Words > MAX_H1_WORDS) {
    return {
      message: `${key}: H1 has ${h1Words} words, maximum ${MAX_H1_WORDS}`,
      correction: `The headline had ${h1Words} words; keep line 1 to ${MAX_H1_WORDS} words or fewer.`,
    };
  }
  if (!body) {
    return {
      message: `${key}: missing body after headline`,
      correction: `The body after the headline was missing; add a blank line, then at least ${minWords} words.`,
    };
  }
  if (bodyWords < minWords) {
    return {
      message: `${key}: generated content has ${bodyWords} words, minimum ${minWords}`,
      correction: `It contained ${bodyWords} words; provide at least ${minWords}.`,
    };
  }
  if (banned) {
    return {
      message: `${key}: banned claim "${banned}" persists after retry`,
      correction: `It contained the prohibited claim "${banned}"; remove that claim and any equivalent promise.`,
    };
  }
  const h1Key = headline.toLowerCase();
  if (seenH1s.has(h1Key)) {
    return {
      message: `${key}: duplicate H1 "${headline}"`,
      correction: [
        `The headline collided with another section ("${headline}"); write a unique headline.`,
        takenHeadlineBlock(takenHeadlines),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  return undefined;
}

export class ContentGenerationStage implements Stage {
  name = "content-generation";
  version = "2.3.0";

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
    const { vertical, business_name, geography, routes } = ctx.domainSpec;
    const phone = ctx.domainSpec.seo_contract?.phone?.trim();
    const seenH1s = new Set<string>();
    const takenHeadlines: string[] = [];
    for (const route of routes) {
      for (const component of route.components) {
        const key = `${route.slug}:${component}`;
        if (hasPages) {
          ctx.generatedContent.set(key, this.reconstructSection(ctx, route, component, key));
          continue;
        }
        await this.generateSection(ctx, {
          route,
          component,
          key,
          phone,
          vertical,
          business_name,
          geography,
          seenH1s,
          takenHeadlines,
        });
      }
    }
    logger.info({ sections: ctx.generatedContent.size }, "Content generation complete");
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

  private reconstructSection(
    ctx: BuildContext,
    route: BuildContext["domainSpec"]["routes"][number],
    component: string,
    key: string,
  ): string {
    const page = matchSourcePage(ctx.sourceSiteManifest, route.slug);
    if (!page) {
      throw new BuildError(
        "CONTENT_VALIDATION_FAILED",
        `${key}: source-site reconstruction is on but no crawled page matched ${route.slug}`,
      );
    }
    return assembleSourceSection(page, component);
  }

  private async generateSection(
    ctx: BuildContext,
    section: {
      route: BuildContext["domainSpec"]["routes"][number];
      component: string;
      key: string;
      phone: string | undefined;
      vertical: string;
      business_name: string;
      geography: { states: string[] };
      seenH1s: Set<string>;
      takenHeadlines: string[];
    },
  ): Promise<void> {
    const { route, component, key, phone, seenH1s, takenHeadlines } = section;
    const minWords = minWordsFor(component);
    const keyName = sectionKey(component);
    const ctaHint = /^(contact_form|cta|final_cta)$/.test(keyName)
      ? 'First line must be a concrete offer headline. For roofing and home services use exactly: Free Roof Inspection Within 24 Hours. Never write "Tell us about the job", "Take the next step", or similar uninviting filler.'
      : "";
    let content = "";
    let correction = "";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      content = await ctx.llm.generateContent(
        [
          `Write the ${component} section for the "${route.title}" page of a ${section.vertical} business.`,
          `This page is route slug "${route.slug}" titled "${route.title}"; headlines must be specific to this page and must not reuse a home-page CTA.`,
          `Business: ${section.business_name}. States served: ${section.geography.states.join(", ")}.`,
          phone
            ? `Known phone: ${phone}. Use this number when a phone is needed. Never invent a number and never write bracketed placeholders such as [phone number].`
            : "No phone is on file. Omit phone numbers. Never write bracketed placeholders such as [phone number].",
          `Line 1 must be the headline (at most ${MAX_H1_WORDS} words, unique across pages).`,
          `Then a blank line.`,
          `Then the body: minimum ${minWords} words. Similar roofing copy across pages is acceptable.`,
          `Do not include guaranteed outcomes, win rates, or legal advice.`,
          `Never invent years of experience, awards, certifications, guarantees, statistics, or third-party brand endorsements. State only facts given in this prompt; otherwise omit them.`,
          "Use active voice and second person. Output plain text only. Do not wrap the headline in markdown.",
          ctaHint,
          takenHeadlineBlock(takenHeadlines),
          correction,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      if (phone) {
        content = content.replace(/\[(?:your |insert |add |enter )?phone(?: number)?\]/gi, phone);
      }
      content = stripMarkdownDecorators(content);
      const issue = validateSlot(key, content, seenH1s, takenHeadlines, minWords);
      if (!issue) break;
      if (attempt === MAX_RETRIES) {
        throw new BuildError("CONTENT_VALIDATION_FAILED", issue.message);
      }
      correction = [
        "Your previous answer failed validation.",
        issue.correction,
        "Rewrite the complete section from scratch.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    const { headline, body } = parseHeadlineAndBody(content);
    if (seenH1s.has(headline.toLowerCase())) {
      throw new BuildError("CONTENT_VALIDATION_FAILED", `${key}: duplicate H1 "${headline}"`);
    }
    seenH1s.add(headline.toLowerCase());
    takenHeadlines.push(headline);
    ctx.generatedContent.set(key, `${headline}\n\n${body}`);
  }
}
