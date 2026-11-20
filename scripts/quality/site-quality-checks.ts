// L9_META: layer=script, role=site_quality_checks, status=active, version=1.0.0
//
// Deterministic rendered-site quality checks. Pure functions over the page
// model the browser extractor (scripts/quality/extract-page.ts) produces from
// the RENDERED DOM, so text is what a visitor sees (innerText honours CSS
// text-transform and display:none). No network, no LLM, no randomness.
//
// Every check returns findings; a finding with severity "fail" fails the run.
// The checks target the defects observed on the first production site:
// repeated filler paragraphs, old-site button text pasted as body copy,
// internal component labels rendered as headings, thin pages, cross-client
// literals and broken imagery.

export const SITE_QUALITY_REPORT_SCHEMA = "website-bot.site-quality-report/v1";

export type Severity = "fail" | "warn";

export type CheckId =
  | "duplicate-paragraph"
  | "near-duplicate-paragraph"
  | "cross-page-duplicate-paragraph"
  | "run-on-text"
  | "nav-label-run-on"
  | "button-label-run-on"
  | "controls-as-body-copy"
  | "empty-control-label"
  | "empty-faq-answer"
  | "internal-label-visible"
  | "template-artifact-visible"
  | "heading-equals-business-name"
  | "word-count-floor"
  | "cross-client-literal"
  | "image-missing-src"
  | "image-broken"
  | "image-oversized"
  | "image-missing-alt"
  | "no-h1"
  | "page-unrenderable";

export interface Finding {
  check: CheckId;
  severity: Severity;
  page: string;
  detail: string;
  evidence?: string;
}

export interface ControlModel {
  /** Visible text (innerText). */
  text: string;
  /** Accessible name the extractor resolved (aria-label, labelledby, title, img alt). */
  accessibleName: string;
  href?: string;
  /** True when the control sits inside <nav> or a header navigation list. */
  inNav: boolean;
}

export interface ImageModel {
  src: string;
  alt: string | null;
  /** naturalWidth after load; 0 means the browser could not decode it. */
  naturalWidth: number;
  naturalHeight: number;
  /** Transfer size in bytes when the extractor could measure it, else null. */
  bytes: number | null;
  /** HTTP status of the image request when known, else null. */
  status: number | null;
}

export interface HeadingModel {
  level: number;
  text: string;
  /** True when the heading sits inside the page's hero section. */
  inHero: boolean;
}

export interface FaqModel {
  question: string;
  answer: string;
}

export interface PageModel {
  /** Route path, e.g. "/" or "/contact". */
  path: string;
  /** HTTP status of the document request. */
  status: number;
  title: string;
  headings: HeadingModel[];
  /** Visible body-copy blocks (p, blockquote, dd, li outside nav) in document order. */
  paragraphs: string[];
  controls: ControlModel[];
  faqs: FaqModel[];
  images: ImageModel[];
  /** Short visible labels that are not headings: eyebrows, kickers, badges. */
  labels: string[];
  /** Visible text of the main content (header, nav and footer excluded). */
  mainText: string;
  /** Visible text of the whole document. */
  fullText: string;
}

export interface SiteQualityOptions {
  businessName: string;
  /** Lower-cased literals that belong to other clients' sites. */
  crossClientLiterals: string[];
  /** Internal component/section labels that must never be visible. */
  internalLabels: string[];
  wordFloors: WordFloors;
  /** Image transfer size above which an image fails, in bytes. */
  maxImageBytes: number;
  /** Paragraphs shorter than this (in words) are ignored by duplicate checks. */
  minDuplicateWords: number;
  /** Shingle Jaccard similarity at or above which two paragraphs are near-duplicates. */
  nearDuplicateThreshold: number;
}

export interface WordFloors {
  home: number;
  utility: number;
  content: number;
  /** Route path prefixes that are utility pages (contact, thank-you, legal). */
  utilityPrefixes: string[];
}

export const DEFAULT_WORD_FLOORS: WordFloors = {
  home: 300,
  utility: 60,
  content: 200,
  utilityPrefixes: [
    "/contact",
    "/thank-you",
    "/thanks",
    "/confirmation",
    "/privacy",
    "/terms",
    "/legal",
    "/accessibility",
    "/404",
    "/sitemap",
  ],
};

/** Literals observed leaking between client sites. Matched case-insensitively. */
export const DEFAULT_CROSS_CLIENT_LITERALS = [
  "safe haven",
  "safehaven",
  "safe haven roofing",
  "free roof inspection within 24 hours",
];

/**
 * Section/component labels the factory uses internally. Visible in the rendered
 * page they mean a template printed its own bookkeeping instead of copy.
 */
export const DEFAULT_INTERNAL_LABELS = [
  "trust signals",
  "trust signal",
  "service detail",
  "service details section",
  "services overview",
  "services grid",
  "trust bar",
  "cta banner",
  "prose section",
  "service area",
  "audience paths",
  "compliance note",
  "editorial section",
  "diagram section",
  "structured blocks",
  "section registry",
  "lead form",
  "contact form",
  "hero section",
  "faq section",
  "proof points",
  "social proof",
  "value proposition",
  "primary cta",
  "secondary cta",
];

export const DEFAULT_OPTIONS: Omit<SiteQualityOptions, "businessName"> = {
  crossClientLiterals: DEFAULT_CROSS_CLIENT_LITERALS,
  internalLabels: DEFAULT_INTERNAL_LABELS,
  wordFloors: DEFAULT_WORD_FLOORS,
  maxImageBytes: 1_500_000,
  minDuplicateWords: 8,
  nearDuplicateThreshold: 0.6,
};

/** Rendered text that can only come from a template printing raw data. */
const RAW_VALUE_TOKENS = new Set(["undefined", "null", "NaN"]);
const MARKER_TOKENS = new Set(["TODO", "TBD", "FIXME"]);
const TEMPLATE_ARTIFACTS: Array<[(text: string) => boolean, string]> = [
  [
    (text) => {
      const open = text.indexOf("{{");
      return open !== -1 && text.indexOf("}}", open + 2) !== -1;
    },
    "unrendered {{ }} placeholder",
  ],
  [(text) => text.includes("[object Object]"), "[object Object]"],
  [
    (text) => text.split(/\s/).some((token) => RAW_VALUE_TOKENS.has(token)),
    "raw undefined/null/NaN",
  ],
  [(text) => text.toLowerCase().includes("lorem ipsum"), "lorem ipsum"],
  [(text) => text.split(/[^A-Za-z]/).some((token) => MARKER_TOKENS.has(token)), "TODO/TBD marker"],
  [
    (text) => text.toLowerCase().includes("validated fixture content for"),
    "structural-validator filler copy",
  ],
];

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

export function wordCount(value: string): number {
  return words(value).length;
}

function shingles(value: string, size = 3): Set<string> {
  const tokens = words(value);
  const set = new Set<string>();
  if (tokens.length < size) {
    if (tokens.length) set.add(tokens.join(" "));
    return set;
  }
  for (let index = 0; index + size <= tokens.length; index += 1)
    set.add(tokens.slice(index, index + size).join(" "));
  return set;
}

export function jaccard(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** A same-origin URL reduced to its path, so reports do not carry an ephemeral port. */
export function displaySrc(src: string): string {
  try {
    const url = new URL(src);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost"
      ? `${url.pathname}${url.search}`
      : src;
  } catch {
    return src;
  }
}

function excerpt(value: string, limit = 120): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
}

/**
 * Title-case run-on: a label sequence glued together with no sentence
 * punctuation ("Home Services About Us Contact Get A Free Quote").
 */
export function isTitleCaseRunOn(value: string, minWords = 6): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (/[.!?,:;]/.test(text)) return false;
  const tokens = text.split(" ").filter((token) => /\p{L}/u.test(token));
  if (tokens.length < minWords) return false;
  const minor = new Set(["a", "an", "and", "of", "the", "to", "in", "for", "on", "or", "&", "us"]);
  const capitalized = tokens.filter(
    (token) => /^\p{Lu}/u.test(token) || minor.has(token.toLowerCase()),
  ).length;
  return capitalized / tokens.length >= 0.85;
}

/** Visible copy (headings, paragraphs, labels, controls). */
function visibleStrings(page: PageModel): string[] {
  return [
    ...page.headings.map((heading) => heading.text),
    ...page.paragraphs,
    ...page.labels,
    ...page.controls.map((control) => control.text),
    ...page.faqs.flatMap((faq) => [faq.question, faq.answer]),
  ];
}

export function floorFor(path: string, floors: WordFloors): number {
  if (path === "/" || path === "") return floors.home;
  const normalized = path.toLowerCase();
  if (
    floors.utilityPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    )
  )
    return floors.utility;
  return floors.content;
}

type Add = (check: CheckId, severity: Severity, detail: string, evidence?: string) => void;

const isHttpError = (status: number | null): boolean =>
  status !== null && (status < 200 || status > 299);

function checkDuplicates(page: PageModel, options: SiteQualityOptions, add: Add): void {
  const seen = new Map<string, number>();
  for (const paragraph of page.paragraphs) {
    if (wordCount(paragraph) < options.minDuplicateWords) continue;
    const key = normalizeText(paragraph);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen)
    if (count > 1)
      add("duplicate-paragraph", "fail", `paragraph repeated ${count}x on the page`, key);
  const unique = [...seen.keys()];
  unique.forEach((left, index) => {
    for (const right of unique.slice(index + 1)) {
      const similarity = jaccard(left, right);
      if (similarity >= options.nearDuplicateThreshold)
        add(
          "near-duplicate-paragraph",
          "fail",
          `two paragraphs are ${Math.round(similarity * 100)}% similar`,
          `${left} ⟷ ${right}`,
        );
    }
  });
}

function checkControl(control: ControlModel, add: Add): void {
  const name = control.text.trim() || control.accessibleName.trim();
  if (!name) {
    const kind = control.href === undefined ? "button" : "link";
    add(
      "empty-control-label",
      "fail",
      `${kind} has no visible text or accessible name`,
      control.href,
    );
    return;
  }
  const count = wordCount(control.text);
  if (control.inNav && count > 5)
    add("nav-label-run-on", "fail", `navigation label has ${count} words`, control.text);
  else if (!control.inNav && control.href === undefined && count > 8)
    add("button-label-run-on", "fail", `button label has ${count} words`, control.text);
  else if (isTitleCaseRunOn(control.text, 7))
    add("run-on-text", "fail", "control text is a run-on of title-case labels", control.text);
}

/** How many control labels a paragraph is made of, and the words left over. */
function labelCoverage(paragraph: string, labels: string[]): { matched: number; rest: string } {
  let rest = ` ${normalizeText(paragraph)} `;
  let matched = 0;
  for (const label of labels) {
    const needle = ` ${label} `;
    while (rest.includes(needle)) {
      rest = rest.replace(needle, " ");
      matched += 1;
    }
  }
  return { matched, rest };
}

/** The old site's buttons pasted in as body copy: a paragraph that is mostly this page's own control labels. */
function checkControlsAsCopy(page: PageModel, add: Add): void {
  const labels = [
    ...new Set(
      page.controls
        .map((control) => normalizeText(control.text))
        .filter((label) => label && label.split(" ").length <= 6),
    ),
  ];
  if (labels.length < 2) return;
  labels.sort((a, b) => b.length - a.length || a.localeCompare(b));
  for (const paragraph of page.paragraphs) {
    const { matched, rest } = labelCoverage(paragraph, labels);
    const total = wordCount(paragraph);
    if (matched >= 2 && total >= 4 && wordCount(rest) / total <= 0.25)
      add(
        "controls-as-body-copy",
        "fail",
        `body copy is made of ${matched} navigation/button labels`,
        paragraph,
      );
  }
}

function checkCopy(page: PageModel, options: SiteQualityOptions, add: Add): void {
  for (const control of page.controls) checkControl(control, add);
  for (const paragraph of page.paragraphs)
    if (isTitleCaseRunOn(paragraph))
      add("run-on-text", "fail", "body copy is a run-on of title-case labels", paragraph);
  checkControlsAsCopy(page, add);
  for (const faq of page.faqs)
    if (!faq.answer.trim())
      add("empty-faq-answer", "fail", "FAQ question has no answer", faq.question);
  const internal = new Set(options.internalLabels.map(normalizeText));
  const shortCopy = page.paragraphs.filter((paragraph) => wordCount(paragraph) <= 4);
  const labelled = new Set([
    ...page.headings.map((heading) => heading.text),
    ...page.labels,
    ...shortCopy,
  ]);
  for (const text of labelled)
    if (internal.has(normalizeText(text)))
      add("internal-label-visible", "fail", "internal component label is visible", text);
  for (const text of visibleStrings(page))
    for (const [matches, name] of TEMPLATE_ARTIFACTS)
      if (matches(text)) add("template-artifact-visible", "fail", name, text);
}

function checkStructure(page: PageModel, options: SiteQualityOptions, add: Add): void {
  const business = normalizeText(options.businessName);
  for (const heading of page.headings)
    if (
      business &&
      heading.level <= 2 &&
      !heading.inHero &&
      normalizeText(heading.text) === business
    )
      add(
        "heading-equals-business-name",
        "fail",
        `H${heading.level} is only the business name outside the hero`,
        heading.text,
      );
  if (!page.headings.some((heading) => heading.level === 1)) add("no-h1", "fail", "page has no H1");
  const count = wordCount(page.mainText);
  const floor = floorFor(page.path, options.wordFloors);
  if (count < floor)
    add("word-count-floor", "fail", `main content has ${count} words; floor is ${floor}`);
  const fullText = ` ${normalizeText(`${page.title} ${page.fullText}`)} `;
  for (const literal of options.crossClientLiterals) {
    const needle = normalizeText(literal);
    if (needle && !business.includes(needle) && fullText.includes(` ${needle} `))
      add("cross-client-literal", "fail", `another client's literal "${literal}" is rendered`);
  }
}

function checkImage(image: ImageModel, options: SiteQualityOptions, add: Add): void {
  if (!image.src.trim()) {
    add("image-missing-src", "fail", "img has no src");
    return;
  }
  const src = displaySrc(image.src);
  if (isHttpError(image.status))
    add("image-broken", "fail", `image returned HTTP ${image.status}`, src);
  else if (image.naturalWidth === 0)
    add("image-broken", "fail", "image did not decode (naturalWidth 0)", src);
  if (image.bytes !== null && image.bytes > options.maxImageBytes)
    add(
      "image-oversized",
      "fail",
      `image is ${image.bytes} bytes; limit is ${options.maxImageBytes}`,
      src,
    );
  if (image.alt === null) add("image-missing-alt", "warn", "img has no alt attribute", src);
}

export function checkPage(page: PageModel, options: SiteQualityOptions): Finding[] {
  const findings: Finding[] = [];
  const add: Add = (check, severity, detail, evidence) =>
    findings.push({
      check,
      severity,
      page: page.path,
      detail,
      ...(evidence ? { evidence: excerpt(evidence) } : {}),
    });
  if (isHttpError(page.status)) {
    add("page-unrenderable", "fail", `document returned HTTP ${page.status}`);
    return findings;
  }
  checkDuplicates(page, options, add);
  checkCopy(page, options, add);
  checkStructure(page, options, add);
  for (const image of page.images) checkImage(image, options, add);
  return findings;
}

/** Cross-page checks: the same body copy pasted onto several routes. */
export function checkSite(pages: PageModel[], options: SiteQualityOptions): Finding[] {
  const owners = new Map<string, Set<string>>();
  for (const page of pages)
    for (const paragraph of page.paragraphs) {
      if (wordCount(paragraph) < options.minDuplicateWords) continue;
      const key = normalizeText(paragraph);
      const set = owners.get(key) ?? new Set<string>();
      set.add(page.path);
      owners.set(key, set);
    }
  const findings: Finding[] = [];
  for (const [key, set] of owners)
    if (set.size > 1)
      findings.push({
        check: "cross-page-duplicate-paragraph",
        severity: "fail",
        page: [...set].sort((a, b) => a.localeCompare(b)).join(","),
        detail: `paragraph repeated on ${set.size} pages`,
        evidence: excerpt(key),
      });
  return findings;
}

export interface SiteQualityReport {
  schema: typeof SITE_QUALITY_REPORT_SCHEMA;
  status: "PASS" | "FAIL" | "BLOCKED";
  target: string;
  business_name: string;
  pages: Array<{ path: string; status: number; words: number; floor: number; findings: number }>;
  summary: { pages: number; fail: number; warn: number; by_check: Record<string, number> };
  findings: Finding[];
  errors: string[];
}

export function buildReport(
  target: string,
  pages: PageModel[],
  options: SiteQualityOptions,
  errors: string[] = [],
): SiteQualityReport {
  const perPage = pages.map((page) => ({ page, findings: checkPage(page, options) }));
  const findings = [...perPage.flatMap((entry) => entry.findings), ...checkSite(pages, options)];
  const byCheck: Record<string, number> = {};
  for (const finding of findings) byCheck[finding.check] = (byCheck[finding.check] ?? 0) + 1;
  const fail = findings.filter((finding) => finding.severity === "fail").length;
  let status: SiteQualityReport["status"] = "PASS";
  if (errors.length || pages.length === 0) status = "BLOCKED";
  else if (fail) status = "FAIL";
  return {
    schema: SITE_QUALITY_REPORT_SCHEMA,
    status,
    target,
    business_name: options.businessName,
    pages: perPage.map(({ page, findings: pageFindings }) => ({
      path: page.path,
      status: page.status,
      words: wordCount(page.mainText),
      floor: floorFor(page.path, options.wordFloors),
      findings: pageFindings.length,
    })),
    summary: {
      pages: pages.length,
      fail,
      warn: findings.length - fail,
      by_check: byCheck,
    },
    findings,
    errors,
  };
}
