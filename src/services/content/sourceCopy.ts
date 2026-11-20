// L9_META: layer=service, role=source_copy_port, status=active, version=1.0.0
//
// Reconstruction is the only path when a source site was crawled: port observed
// copy, do not ask an LLM to invent a new brochure. Generation is a gap filler.

import type {
  IngestedPage,
  SourceContentBlock,
  SourceSiteManifest,
} from "../../pipeline/evidence/SourceSiteManifest.js";
import { stripMarkdownDecorators } from "./plainText.js";
import { type FaqPair, normalizeComponentKey, type SectionContent } from "./sectionContent.js";

export function pagePath(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    return path || "/";
  } catch {
    return url.replace(/\/$/, "") || "/";
  }
}

export function matchSourcePage(
  manifest: SourceSiteManifest | undefined,
  slug: string,
): IngestedPage | undefined {
  if (!manifest?.pages.length) return undefined;
  const wanted = slug.replace(/\/$/, "") || "/";
  return (
    manifest.pages.find((page) => pagePath(page.url) === wanted) ??
    (wanted === "/" ? manifest.pages.find((page) => page.depth === 0) : undefined)
  );
}

export function isTopNavHref(href: string): boolean {
  let path: string;
  try {
    path = new URL(href, "https://nav.example").pathname.replace(/\/$/, "") || "/";
  } catch {
    path = href.replace(/\/$/, "") || "/";
  }
  const parts = path.split("/").filter(Boolean);
  return parts.length === 1;
}

export function topNavFromSource(
  manifest: SourceSiteManifest | undefined,
): Array<{ href: string; label: string }> {
  const home = matchSourcePage(manifest, "/");
  const items = home?.nav ?? [];
  const seen = new Set<string>();
  const out: Array<{ href: string; label: string }> = [];
  for (const item of items) {
    if (!isTopNavHref(item.href)) continue;
    const href = item.href.replace(/\/$/, "") || "/";
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label: item.label });
    if (out.length >= 8) break;
  }
  return out;
}

export function faqsFromManifest(
  manifest: SourceSiteManifest | undefined,
): Array<{ question: string; answer: string }> {
  if (!manifest?.pages.length) return [];
  const faqPage =
    manifest.pages.find((page) => {
      const path = pagePath(page.url);
      const haystack = `${path} ${page.title ?? ""} ${page.headings.join(" ")}`;
      return /faq/i.test(haystack);
    }) ?? manifest.pages.find((page) => page.headings.some((heading) => heading.includes("?")));
  if (!faqPage) return [];
  if (faqPage.blocks) return faqPairs(faqPage.blocks).slice(0, 8);
  const questions = faqPage.headings
    .map((heading) => heading.trim())
    .filter((heading) => heading.includes("?"));
  const paras = (faqPage.bodyText || faqPage.textExcerpt || "")
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 20 && !part.endsWith("?"));
  const out: Array<{ question: string; answer: string }> = [];
  for (const question of questions) {
    const answer = paras.find((part) => !part.includes(question)) ?? paras[0];
    if (!answer) continue;
    out.push({ question, answer: answer.slice(0, 500) });
    if (out.length >= 8) break;
  }
  return out;
}

export function firstSourcePhone(manifest: SourceSiteManifest | undefined): string | undefined {
  for (const page of manifest?.pages ?? []) {
    const phone = page.phones?.[0];
    if (phone) return phone;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Structured reconstruction (lane wb-content-plumbing).
//
// Each component claims its own block(s) from the crawled page's structure.
// A block is used by at most one section, so no two sections can share text.
// A component with no material of its own is reported, never filled with
// another section's copy.

export class SourceReconstructionError extends Error {
  readonly missing: string[];
  constructor(message: string, missing: string[]) {
    super(message);
    this.name = "SourceReconstructionError";
    this.missing = missing;
  }
}

export interface ReconstructionInput {
  page: IngestedPage;
  components: readonly string[];
  /** Operator CTA label (domain_spec.conversion_authority.primary_action). */
  primaryAction?: string;
  businessName: string;
  /** Blocks already ported on an earlier page (boilerplate repeated site-wide). */
  seenBlockFingerprints?: Set<string>;
}

const KEYWORDS: Record<string, RegExp> = {
  faq: /\b(faqs?|frequently asked|questions)\b/i,
  process: /\b(process|how it works|how we work|steps?|what to expect)\b/i,
  trust_bar:
    /\b(why (choose|homeowners|customers|clients)|why us|trust|licen[cs]ed|insured|certif\w*|credentials|guarantee|warrant\w*)\b/i,
  service_area:
    /\b(areas?|service area|we serve|serving|locations?|counties|cities|neighborhoods)\b/i,
  // Whole words only: "workmanship" or "network" are not a gallery.
  gallery: /\b(gallery|portfolio|our work|recent work|projects|before (and|&) after|photos)\b/i,
  contact:
    /\b(contact|get in touch|get started|quote|estimate|schedule|book|talk|reach us|call us)\b/i,
};
const CONVERSION = /^(cta|final_cta|contact_form)$/;

export function blockFingerprint(block: SourceContentBlock): string {
  return [
    block.heading ?? "",
    ...block.paragraphs,
    ...block.items,
    ...block.qa.flatMap((qa) => [qa.question, qa.answer]),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function blockText(block: SourceContentBlock): string[] {
  return [...block.paragraphs, ...block.qa.map((qa) => qa.answer)];
}

/** FAQ pairs: an FAQ-headed group (heading + deeper blocks), else runs of 2+ Q/A blocks. */
export function faqPairs(blocks: readonly SourceContentBlock[]): FaqPair[] {
  return faqGroup(blocks).flatMap((index) => blocks[index].qa);
}

function faqGroup(blocks: readonly SourceContentBlock[], claimed?: Set<number>): number[] {
  const free = (index: number) => !claimed?.has(index);
  const head = blocks.findIndex(
    (block, index) =>
      free(index) && block.heading !== undefined && KEYWORDS.faq.test(block.heading),
  );
  if (head >= 0) {
    const group = [head];
    for (let index = head + 1; index < blocks.length; index += 1) {
      if (blocks[index].level <= blocks[head].level && blocks[index].level > 0) break;
      if (free(index)) group.push(index);
    }
    if (group.some((index) => blocks[index].qa.length > 0)) return group;
  }
  for (let start = 0; start < blocks.length; start += 1) {
    const run: number[] = [];
    for (
      let index = start;
      index < blocks.length && free(index) && blocks[index].qa.length;
      index += 1
    )
      run.push(index);
    if (run.length >= 2 || (run.length === 1 && blocks[run[0]].qa.length >= 2)) return run;
  }
  return [];
}

function clean(value: string): string {
  return stripMarkdownDecorators(value).replace(/\s+/g, " ").trim();
}

function emptySection(component: string, heading: string): SectionContent {
  return {
    component,
    heading: clean(heading),
    paragraphs: [],
    steps: [],
    faqs: [],
    badges: [],
    provenance: "source",
  };
}

/**
 * Port one crawled page into one structured section per component. Blocks are
 * claimed in a fixed order (hero, FAQ, process, trust, area, gallery,
 * conversion, then generic sections in document order), each block at most
 * once. Throws SourceReconstructionError naming every component that has no
 * material of its own.
 */
export function reconstructPageSections(input: ReconstructionInput): Map<string, SectionContent> {
  const { page, components } = input;
  if (page.blocks === undefined) {
    throw new SourceReconstructionError(
      `${pagePath(page.url)} was crawled without content structure (crawler < 1.2.0); re-crawl the source site before reconstructing`,
      [...components],
    );
  }
  const blocks = page.blocks;
  const claimed = new Set<number>();
  const seen = input.seenBlockFingerprints;
  // Boilerplate already ported on an earlier page is never ported again.
  blocks.forEach((block, index) => {
    if (seen?.has(blockFingerprint(block))) claimed.add(index);
  });
  const out = new Map<string, SectionContent>();
  const missing: string[] = [];
  const keys = components.map((component) => normalizeComponentKey(component));
  const claim = (predicate: (block: SourceContentBlock) => boolean): number => {
    const index = blocks.findIndex((block, position) => !claimed.has(position) && predicate(block));
    if (index >= 0) claimed.add(index);
    return index;
  };
  const byKeyword = (pattern: RegExp, need: (block: SourceContentBlock) => boolean) =>
    claim((block) => block.heading !== undefined && pattern.test(block.heading) && need(block));

  const order = (key: string): number => {
    const rank = ["hero", "faq", "process", "trust_bar", "service_area", "gallery"].indexOf(key);
    if (rank >= 0) return rank;
    return CONVERSION.test(key) ? 6 : 7;
  };
  const sequence = components
    .map((component, position) => ({ component, key: keys[position], position }))
    .sort((a, b) => order(a.key) - order(b.key) || a.position - b.position);

  for (const { component, key } of sequence) {
    let section: SectionContent | undefined;
    if (key === "hero") {
      const index = claim((block) => block.level === 1);
      const at = index >= 0 ? index : claim((block) => block.heading !== undefined);
      const block = at >= 0 ? blocks[at] : undefined;
      if (block?.heading) {
        section = emptySection(key, block.heading);
        // The hero's own lead paragraph first; the meta description only when
        // the hero block has none (meta descriptions are often site-wide).
        const [lead, ...rest] = block.paragraphs;
        const description =
          page.description && clean(page.description) !== clean(page.title ?? "")
            ? page.description
            : undefined;
        const sub = lead ?? description;
        if (sub) section.subheading = clean(sub);
        section.paragraphs = (lead ? rest : []).map(clean);
      }
    } else if (key === "faq") {
      const group = faqGroup(blocks, claimed);
      const faqs = group.flatMap((index) => blocks[index].qa);
      if (faqs.length) {
        for (const index of group) claimed.add(index);
        const headed = blocks[group[0]].heading;
        section = emptySection(
          key,
          headed && KEYWORDS.faq.test(headed) ? headed : "Frequently asked questions",
        );
        section.faqs = faqs.map((faq) => ({
          question: clean(faq.question),
          answer: clean(faq.answer),
        }));
      }
    } else if (key === "process") {
      let index = byKeyword(KEYWORDS.process, (block) => block.items.length >= 2);
      if (index < 0) index = byKeyword(KEYWORDS.process, (block) => block.paragraphs.length >= 2);
      if (index >= 0) {
        const block = blocks[index];
        section = emptySection(key, block.heading ?? "");
        if (block.items.length >= 2) {
          section.steps = block.items.map(clean);
          section.paragraphs = block.paragraphs.map(clean);
        } else {
          section.steps = block.paragraphs.map(clean);
        }
      }
    } else if (key === "trust_bar" || key === "trust_signals") {
      const short = (block: SourceContentBlock) =>
        block.items.length >= 2 && block.items.every((item) => item.split(/\s+/).length <= 10);
      let index = byKeyword(KEYWORDS.trust_bar, short);
      if (index < 0) index = claim(short);
      if (index >= 0) {
        const block = blocks[index];
        section = emptySection(key, block.heading ?? "");
        section.badges = block.items.map(clean);
        section.paragraphs = block.paragraphs.map(clean);
      }
    } else if (key === "service_area") {
      const index = byKeyword(
        KEYWORDS.service_area,
        (block) => blockText(block).length > 0 || block.items.length > 0,
      );
      if (index >= 0) {
        const block = blocks[index];
        section = emptySection(key, block.heading ?? "");
        section.paragraphs = blockText(block).map(clean);
        section.badges = block.items.map(clean);
      }
    } else if (key === "gallery") {
      const index = byKeyword(KEYWORDS.gallery, () => true);
      if (index >= 0) {
        const block = blocks[index];
        section = emptySection(key, block.heading ?? "");
        section.paragraphs = blockText(block).map(clean);
      } else {
        // Gallery copy is optional: the section renders its images alone.
        continue;
      }
    } else if (CONVERSION.test(key)) {
      const index = byKeyword(KEYWORDS.contact, (block) => blockText(block).length > 0);
      const block = index >= 0 ? blocks[index] : undefined;
      // The offer is the operator's own primary action; nothing is invented.
      const heading =
        input.primaryAction?.trim() || block?.heading || `Contact ${input.businessName}`;
      section = emptySection(key, heading);
      if (block) section.paragraphs = blockText(block).map(clean);
    } else {
      const tokens = key.split("_").filter((token) => token.length > 3);
      const has = (block: SourceContentBlock) =>
        blockText(block).length > 0 && block.heading !== undefined;
      let index = claim(
        (block) =>
          has(block) && tokens.some((token) => block.heading?.toLowerCase().includes(token)),
      );
      if (index < 0) index = claim(has);
      if (index >= 0) {
        const block = blocks[index];
        section = emptySection(key, block.heading ?? "");
        section.paragraphs = blockText(block).map(clean);
        section.badges = block.items.length ? block.items.map(clean) : [];
      }
    }
    if (!section?.heading) {
      missing.push(component);
      continue;
    }
    out.set(component, section);
  }
  if (missing.length) {
    missing.sort((a, b) => components.indexOf(a) - components.indexOf(b));
    const available = blocks
      .map(
        (block, index) =>
          `${claimed.has(index) ? "used" : "free"}:${JSON.stringify(block.heading ?? "(unheaded)")}`,
      )
      .join(", ");
    throw new SourceReconstructionError(
      `no crawled material of its own for ${missing.join(", ")} on ${pagePath(page.url)} (blocks: ${available || "none"})`,
      missing,
    );
  }
  // Every block of this page is now spoken for: a later page carrying the same
  // block (site-wide boilerplate) cannot port it again.
  if (seen) for (const block of blocks) seen.add(blockFingerprint(block));
  return out;
}
