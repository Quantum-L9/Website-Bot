// L9_META: layer=service, role=section_content_validation, status=active, version=1.0.0
//
// Observational checks over structured sections (L9-VALIDATION-001: nothing
// here repairs a section). Each check names the section key and the defect so
// the generation loop can feed it back to the model, and a reconstruction run
// can fail with an exact reason.

import { type SectionContent, sectionBodyText } from "./sectionContent.js";

export const MAX_HEADING_WORDS = 12;
const MAX_BADGE_WORDS = 8;
/** Body-shingle Jaccard similarity at or above which two sections are near-duplicates. */
export const NEAR_DUPLICATE_THRESHOLD = 0.5;
const SHINGLE = 4;
/** Consecutive Title-Case tokens that read as pasted navigation or button text. */
const RUN_ON_TOKENS = 7;

const words = (value: string): string[] => value.trim().split(/\s+/).filter(Boolean);

export interface SectionIssue {
  key: string;
  message: string;
}

function shingles(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const out = new Set<string>();
  if (tokens.length < SHINGLE) {
    if (tokens.length) out.add(tokens.join(" "));
    return out;
  }
  for (let i = 0; i + SHINGLE <= tokens.length; i += 1)
    out.add(tokens.slice(i, i + SHINGLE).join(" "));
  return out;
}

export function similarity(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  // Overlap relative to the smaller body: a short section copied inside a long one is a duplicate.
  return shared / Math.min(left.size, right.size);
}

/** A run of many short Title-Case tokens (nav labels, button text) or a repeated phone number. */
export function runOnDefect(text: string): string | undefined {
  for (const line of text.split(/\n+/)) {
    let run = 0;
    for (const token of words(line)) {
      if (/^[A-Z0-9(][\w'’().-]*$/.test(token) || /^[&|•·/-]$/.test(token)) {
        run += 1;
        if (run >= RUN_ON_TOKENS)
          return `navigation/button run-on (${RUN_ON_TOKENS}+ consecutive Title-Case tokens) in "${line.slice(0, 80)}"`;
      } else run = 0;
    }
  }
  const phones = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? [];
  const digits = phones.map((phone) => phone.replace(/\D/g, ""));
  const repeated = digits.find((value, index) => digits.indexOf(value) !== index);
  if (repeated) return `phone number ${repeated} repeated within one section`;
  return undefined;
}

/** Shape checks for one section: the structure its component renders must be real. */
export function shapeIssues(
  key: string,
  section: SectionContent,
  minProseWords: number,
): SectionIssue[] {
  const issues: SectionIssue[] = [];
  const add = (message: string) => issues.push({ key, message });
  const component = section.component;
  const heading = section.heading.trim();
  if (!heading) add("empty heading");
  else if (words(heading).length > MAX_HEADING_WORDS)
    add(`heading has ${words(heading).length} words, maximum ${MAX_HEADING_WORDS}`);
  for (const faq of section.faqs) {
    if (!faq.question.trim()) add("FAQ entry with an empty question");
    if (!faq.answer.trim()) add(`FAQ "${faq.question}" has an empty answer`);
  }
  for (const badge of section.badges) {
    if (words(badge).length > MAX_BADGE_WORDS)
      add(
        `badge "${badge.slice(0, 60)}" has ${words(badge).length} words, maximum ${MAX_BADGE_WORDS}`,
      );
  }
  if (component === "faq" && section.faqs.length === 0)
    add("FAQ section has no question/answer pairs");
  if (component === "process" && section.steps.length < 2)
    add(`process section has ${section.steps.length} steps, minimum 2`);
  if ((component === "trust_bar" || component === "trust_signals") && section.badges.length === 0)
    add("trust section has no badges");
  if (component === "hero" && !section.subheading?.trim() && section.paragraphs.length === 0)
    add("hero has no supporting line");
  const generic =
    !/^(hero|faq|process|trust_bar|trust_signals|gallery|cta|final_cta|contact_form)$/.test(
      component,
    );
  if (generic) {
    const proseWords = words([section.subheading ?? "", ...section.paragraphs].join(" ")).length;
    if (proseWords < minProseWords)
      add(`section body has ${proseWords} words, minimum ${minProseWords}`);
  }
  const runOn = runOnDefect(
    [section.subheading ?? "", ...section.paragraphs, ...section.steps].join("\n"),
  );
  if (runOn) add(runOn);
  return issues;
}

/**
 * Cross-section checks over every accepted section of the site so far plus the
 * candidates: duplicate headings, duplicate or near-duplicate bodies, and the
 * business name used as a heading anywhere but the hero.
 */
export function crossSectionIssues(
  accepted: ReadonlyMap<string, SectionContent>,
  candidates: ReadonlyMap<string, SectionContent>,
  businessName: string,
): SectionIssue[] {
  const issues: SectionIssue[] = [];
  const all = [...accepted, ...candidates];
  const business = businessName.trim().toLowerCase();
  const bodies = all.map(([key, section]) => [key, sectionBodyText(section)] as const);
  for (const [key, section] of candidates) {
    const heading = section.heading.trim().toLowerCase();
    if (business && heading === business && section.component !== "hero")
      issues.push({
        key,
        message: `heading repeats the business name "${businessName}" outside the hero`,
      });
    for (const [otherKey, other] of all) {
      if (otherKey === key) break;
      if (other.heading.trim().toLowerCase() === heading && heading)
        issues.push({ key, message: `duplicate heading "${section.heading}" (also ${otherKey})` });
    }
    const body = sectionBodyText(section);
    if (!body.trim()) continue;
    for (const [otherKey, otherBody] of bodies) {
      if (otherKey === key) break;
      if (!otherBody.trim()) continue;
      const score = similarity(body, otherBody);
      if (score >= NEAR_DUPLICATE_THRESHOLD)
        issues.push({
          key,
          message: `body duplicates ${otherKey} (${Math.round(score * 100)}% shared phrasing)`,
        });
    }
  }
  return issues;
}
