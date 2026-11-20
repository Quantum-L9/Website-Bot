// L9_META: layer=service, role=section_content_contract, status=active, version=1.0.0
//
// The COPY-path content contract (lane wb-content-plumbing). Every section is
// carried as typed structure — heading, paragraphs, steps, FAQ pairs, badges —
// instead of one blank-line-separated string that each template re-parses and
// re-invents structure from. Templates render these fields directly.
//
// Storage: the typed sections ride beside `ctx.generatedContent` (keyed by the
// same `${slug}:${component}` keys) in a WeakMap bound to that Map's identity,
// so no BuildContext field is needed; `generatedContent` keeps the flattened
// plain-text projection that PlaceholderScanStage and legacy consumers read.

export interface FaqPair {
  question: string;
  answer: string;
}

export interface SectionContent {
  /** Normalized component name (hero, faq, process, trust_bar, ...). */
  component: string;
  heading: string;
  subheading?: string;
  paragraphs: string[];
  steps: string[];
  faqs: FaqPair[];
  badges: string[];
  /** Where the copy came from: ported crawl structure or LLM generation. */
  provenance: "source" | "generated";
}

const store = new WeakMap<Map<string, string>, Map<string, SectionContent>>();

export function normalizeComponentKey(component: string): string {
  return component
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Plain-text projection: heading, subheading, then every text field in order. */
export function sectionToText(section: SectionContent): string {
  const parts = [
    section.heading,
    section.subheading ?? "",
    ...section.paragraphs,
    ...section.steps,
    ...section.faqs.flatMap((faq) => [faq.question, faq.answer]),
    ...section.badges,
  ]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join("\n\n");
}

/** Body-only text (everything but the heading) — what duplicate checks compare. */
export function sectionBodyText(section: SectionContent): string {
  return sectionToText({ ...section, heading: "" });
}

export function setSection(
  generatedContent: Map<string, string>,
  key: string,
  section: SectionContent,
): void {
  let sections = store.get(generatedContent);
  if (!sections) {
    sections = new Map();
    store.set(generatedContent, sections);
  }
  sections.set(key, section);
  generatedContent.set(key, sectionToText(section));
}

export function getSection(
  generatedContent: Map<string, string>,
  key: string,
): SectionContent | undefined {
  return store.get(generatedContent)?.get(key);
}

export function allSections(generatedContent: Map<string, string>): Map<string, SectionContent> {
  return new Map(store.get(generatedContent) ?? []);
}
