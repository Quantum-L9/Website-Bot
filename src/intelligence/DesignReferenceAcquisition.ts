// L9_META: layer=intelligence, role=client_design_reference_acquisition, status=active, version=1.0.0
//
// Client-supplied design references are executable inputs, not descriptions.
//
// Before this module, `DesignReferenceSpec.principles` had to be authored by
// the operator: a client who supplied five URLs and a paragraph of taste per
// URL contributed nothing to the sealed design direction unless somebody hand
// translated the sites into principles (Quantum AI Partners run
// 2026-09-01, GAP-1). This module is the repository-owned stage that does the
// translation:
//
//   1. ACQUIRE   — fetch each accepted reference URL through the same SSRF
//                  policy and fetcher the source-site crawler uses, store the
//                  raw page as evidence (never as transfer material), extract
//                  structured signals, and capture a best-effort screenshot.
//   2. OBSERVE   — reduce the page to deterministic, abstract design
//                  characteristics (density, hierarchy, motion signals,
//                  palette characteristics, conversion signals). No raw copy,
//                  markup, CSS or color literal survives this step.
//   3. ANALYZE   — ask the governed LLM to interpret the OBSERVED evidence
//                  relative to the CLIENT'S REACTION (selection_reason), and
//                  to output abstract principles per the DesignReference
//                  principle vocabulary. The client's words are preference,
//                  not observation, and the prompt says so.
//   4. GUARD     — every output principle is mechanically checked for raw
//                  expression transfer (WBV2-004) AND for verbatim reuse of
//                  the reference's own headings / title (copy transfer).
//
// Failure behavior is explicit: an unreachable or non-HTML reference is
// recorded with its reason and contributes only operator-authored principles;
// the stage that owns the policy decides whether the run may continue.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertNoRawExpressionTransfer, canonicalJson } from "@quantum-l9/bot-interop";
import { createModuleLogger } from "../core/logger.js";
import { extractPage, type ExtractedPage } from "../ingestion/PageExtractor.js";
import { HttpPageFetcher } from "../ingestion/PageFetcher.js";
import { NoopScreenshotCapturer, type ScreenshotCapturer } from "../ingestion/ScreenshotCapturer.js";
import { extractHexColors, inferPalette } from "../ingestion/SourcePalette.js";
import { assertUrlAllowed, isForbiddenAddress, UrlPolicyError } from "../ingestion/UrlPolicy.js";
import { lookup } from "node:dns/promises";
import type { WebsiteFactoryLLM } from "../services/llm.js";
import { extractJson } from "../services/extractJson.js";
import {
  abstractPaletteCharacteristics,
  type DesignReference,
  type DesignReferencePrinciples,
  type DesignReferenceSet,
} from "./design-authority.js";
import { websiteImproveTask } from "./improve-llm-policy.js";
import { textField } from "../lib/coerce-text.js";

const logger = createModuleLogger("intelligence:design-reference-acquisition");

export const DESIGN_REFERENCE_ACQUISITION_SCHEMA =
  "website-bot.design-reference-acquisition/v1" as const;
export const DESIGN_REFERENCE_ANALYZER_VERSION = "1.0.0";

/* ------------------------------------------------------------------ */
/* Evidence types                                                     */
/* ------------------------------------------------------------------ */

export type DesignReferenceAcquisitionStatus =
  | "acquired"
  | "no_url"
  | "invalid_url"
  | "forbidden_host"
  | "unreachable"
  | "not_html";

/**
 * Deterministic, abstract characteristics observed on a reference page.
 * Numbers and closed-vocabulary labels only — the type has no field capable
 * of carrying markup, CSS, prose, or a color literal.
 */
export interface ObservedDesignCharacteristics {
  heading_count: number;
  h1_count: number;
  nav_item_count: number;
  word_count: number;
  image_count: number;
  above_fold_image_count: number;
  video_count: number;
  canvas_or_svg_count: number;
  link_count: number;
  stylesheet_count: number;
  distinct_font_family_count: number;
  css_animation_rule_count: number;
  css_transition_rule_count: number;
  /** words per heading — a proxy for how much prose each idea carries. */
  words_per_heading: number;
  density: "sparse" | "moderate" | "dense";
  hierarchy: "single-h1" | "multi-h1" | "no-h1";
  motion: "static" | "restrained-motion" | "motion-heavy";
  media_emphasis: "text-led" | "balanced" | "media-led";
  conversion_prominence: "none" | "single-primary" | "multiple";
  /** Abstract palette characteristics (WBV2-007 allowed side), never colors. */
  palette_characteristics: string[];
}

export interface DesignReferenceEvidence {
  reference_id: string;
  url?: string;
  final_url?: string;
  status: DesignReferenceAcquisitionStatus;
  http_status?: number;
  fetched_at: string;
  content_digest?: string;
  content_bytes?: number;
  evidence_dir?: string;
  page_path?: string;
  extracted_path?: string;
  screenshot_path?: string;
  failure_reason?: string;
  observed?: ObservedDesignCharacteristics;
  /** Reference title + headings retained ONLY for the copy-transfer guard. */
  copy_guard_terms: string[];
}

export type ClientReferenceRelationship =
  | "category_reference"
  | "quality_benchmark"
  | "positive_inspiration"
  | "negative_inspiration"
  | "differentiation_target"
  | "mixed";

export const CLIENT_REFERENCE_RELATIONSHIPS: readonly ClientReferenceRelationship[] = [
  "category_reference",
  "quality_benchmark",
  "positive_inspiration",
  "negative_inspiration",
  "differentiation_target",
  "mixed",
];

/** System-derived interpretation of one acquired reference. */
export interface DesignReferenceAnalysis {
  reference_id: string;
  source: "system_derived";
  analyzer_version: string;
  client_relationship: ClientReferenceRelationship;
  observed_design_characteristics: string[];
  positive_patterns: string[];
  negative_patterns: string[];
  layout: string[];
  hierarchy: string[];
  interaction: string[];
  density: string[];
  typography: string[];
  imagery: string[];
  conversion: string[];
  portable_principles: string[];
  prohibited_transfers: string[];
  differentiation_implications: string[];
  evidence_digest: string;
  analysis_digest: string;
}

export interface DesignReferenceAcquisitionManifest {
  schema: typeof DESIGN_REFERENCE_ACQUISITION_SCHEMA;
  client_id: string;
  build_id: string;
  acquired_at: string;
  references: DesignReferenceEvidence[];
  analyses: DesignReferenceAnalysis[];
  summary: {
    declared: number;
    with_url: number;
    acquired: number;
    failed: number;
    analyzed: number;
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha12(value: string): string {
  return sha256(value).slice(0, 12);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function isHtml(contentType: string | undefined): boolean {
  return !contentType || /text\/html|application\/xhtml\+xml/i.test(contentType);
}

/* ------------------------------------------------------------------ */
/* Observation (deterministic)                                        */
/* ------------------------------------------------------------------ */

function countMatches(html: string, pattern: RegExp): number {
  // matchAll rather than String#match: the pattern is global, and this wants
  // the number of matches rather than a captured group (typescript:S6594).
  return [...html.matchAll(pattern)].length;
}

function classify<T extends string>(value: number, low: number, high: number, labels: [T, T, T]): T {
  if (value < low) return labels[0];
  if (value < high) return labels[1];
  return labels[2];
}

/**
 * Bucket an exact count as none / exactly one / more than one. The sibling of
 * classify() for the cases where the boundaries are counts rather than
 * thresholds, so neither has to be written as a ternary chain
 * (typescript:S3358).
 */
/**
 * Where a reference's design principles came from. A 2x2 truth table over two
 * independent facts, which reads as four named outcomes rather than a nested
 * ternary (typescript:S3358).
 */
function principleSource(
  hasAnalysis: boolean,
  operatorAuthored: boolean,
): "operator_and_system" | "system_derived" | "operator_authored" | "none" {
  if (hasAnalysis) return operatorAuthored ? "operator_and_system" : "system_derived";
  return operatorAuthored ? "operator_authored" : "none";
}

function classifyCount<T extends string>(count: number, labels: [T, T, T]): T {
  if (count === 0) return labels[0];
  if (count === 1) return labels[1];
  return labels[2];
}

/**
 * Reduce a fetched page (+ any collected CSS) to abstract characteristics.
 * Pure and deterministic over its inputs; identical HTML yields identical
 * characteristics on every run.
 */
export function observeDesignCharacteristics(
  html: string,
  extracted: ExtractedPage,
  css: string,
): ObservedDesignCharacteristics {
  const h1Count = countMatches(html, /<h1\b/gi);
  const headingCount = countMatches(html, /<h[1-3]\b/gi);
  const wordCount = (extracted.bodyText ?? "").split(/\s+/).filter(Boolean).length;
  const imageCount = extracted.images.filter((image) => image.origin === "img").length;
  const aboveFold = extracted.images.filter(
    (image) => image.origin === "img" && image.isAboveFold,
  ).length;
  const videoCount = countMatches(html, /<video\b/gi);
  const canvasOrSvg = countMatches(html, /<(?:canvas|svg)\b/gi);
  const fontFamilies = new Set(
    [...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((match) =>
      match[1]
        .split(",")[0]
        .replace(/["']/g, "")
        .trim()
        .toLowerCase(),
    ),
  );
  const animationRules = countMatches(css, /\banimation(?:-name)?\s*:/gi) + countMatches(css, /@keyframes\b/gi);
  const transitionRules = countMatches(css, /\btransition(?:-property)?\s*:/gi);
  const aboveFoldButtons = countMatches(
    html.slice(0, 24_000),
    /<(?:a|button)\b[^>]*class\s*=\s*["'][^"']*\b(?:btn|button|cta)\b[^"']*["'][^>]*>/gi,
  );
  const wordsPerHeading = headingCount === 0 ? wordCount : Math.round(wordCount / headingCount);
  const motionScore = animationRules + transitionRules + videoCount * 3 + canvasOrSvg;
  const observedPalette = inferPalette(extractHexColors(css));

  return {
    heading_count: headingCount,
    h1_count: h1Count,
    nav_item_count: extracted.nav.length,
    word_count: wordCount,
    image_count: imageCount,
    above_fold_image_count: aboveFold,
    video_count: videoCount,
    canvas_or_svg_count: canvasOrSvg,
    link_count: extracted.links.length,
    stylesheet_count: extracted.stylesheets.length,
    distinct_font_family_count: fontFamilies.size,
    css_animation_rule_count: animationRules,
    css_transition_rule_count: transitionRules,
    words_per_heading: wordsPerHeading,
    density: classify(wordsPerHeading, 25, 70, ["sparse", "moderate", "dense"]),
    hierarchy: classifyCount(h1Count, ["no-h1", "single-h1", "multi-h1"]),
    motion: classify(motionScore, 3, 15, ["static", "restrained-motion", "motion-heavy"]),
    media_emphasis:
      wordCount === 0
        ? "media-led"
        : classify((imageCount + videoCount * 2) / Math.max(1, wordCount / 200), 0.5, 2, [
            "text-led",
            "balanced",
            "media-led",
          ]),
    conversion_prominence: classifyCount(aboveFoldButtons, ["none", "single-primary", "multiple"]),
    palette_characteristics: abstractPaletteCharacteristics(
      observedPalette ? (observedPalette as unknown as Record<string, string | undefined>) : undefined,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Acquisition                                                        */
/* ------------------------------------------------------------------ */

export interface AcquireDesignReferenceOptions {
  outputDir: string;
  fetcher?: HttpPageFetcher;
  screenshots?: ScreenshotCapturer;
  /** Test-only: permit loopback/private hosts so a local fixture server is reachable. */
  allowPrivateHosts?: boolean;
  navigationTimeoutMs?: number;
  now?: () => Date;
}

async function assertResolvedSafe(hostname: string): Promise<void> {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return;
  const records = await lookup(hostname, { all: true });
  for (const record of records) {
    if (isForbiddenAddress(record.address))
      throw new UrlPolicyError(
        `hostname ${hostname} resolves to forbidden address ${record.address}`,
        "forbidden-address",
      );
  }
}

/** Copy-guard terms: the title and every heading long enough to be distinctive. */
export function copyGuardTerms(extracted: ExtractedPage): string[] {
  const terms = [extracted.title ?? "", ...extracted.headings]
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 12);
  return [...new Set(terms)];
}

/**
 * Acquire one accepted design reference. Never throws for a bad reference —
 * every failure is a typed status with a reason so the manifest is an honest
 * ledger of what was and was not observed.
 */
export async function acquireDesignReference(
  reference: Pick<DesignReference, "reference_id" | "url">,
  options: AcquireDesignReferenceOptions,
): Promise<DesignReferenceEvidence> {
  const now = options.now ?? (() => new Date());
  const fetchedAt = now().toISOString();
  const base: DesignReferenceEvidence = {
    reference_id: reference.reference_id,
    url: reference.url,
    status: "no_url",
    fetched_at: fetchedAt,
    copy_guard_terms: [],
  };
  if (!reference.url?.trim()) return base;

  const validate = async (url: string): Promise<void> => {
    const parsed = options.allowPrivateHosts
      ? new URL(url)
      : assertUrlAllowed(url);
    if (options.allowPrivateHosts) {
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new UrlPolicyError(`Protocol not allowed: ${parsed.protocol}`, "forbidden-protocol");
      return;
    }
    await assertResolvedSafe(parsed.hostname);
  };

  try {
    await validate(reference.url);
  } catch (error) {
    const reason = error instanceof UrlPolicyError ? error.reason : String(error);
    return {
      ...base,
      status: reason === "invalid-url" ? "invalid_url" : "forbidden_host",
      failure_reason: error instanceof Error ? error.message : String(error),
    };
  }

  const fetcher =
    options.fetcher ??
    new HttpPageFetcher({
      validateUrl: validate,
      navigationTimeoutMs: options.navigationTimeoutMs ?? 20_000,
    });

  let fetched: Awaited<ReturnType<HttpPageFetcher["fetch"]>>;
  try {
    fetched = await fetcher.fetch(reference.url);
  } catch (error) {
    return {
      ...base,
      status: "unreachable",
      failure_reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (fetched.status >= 400) {
    return {
      ...base,
      status: "unreachable",
      http_status: fetched.status,
      final_url: fetched.finalUrl,
      failure_reason: `reference responded with HTTP ${fetched.status}`,
    };
  }
  if (!isHtml(fetched.contentType)) {
    return {
      ...base,
      status: "not_html",
      http_status: fetched.status,
      final_url: fetched.finalUrl,
      failure_reason: `reference content-type ${fetched.contentType ?? "unknown"} is not HTML`,
    };
  }

  const html = fetched.body.toString("utf8");
  const extracted = extractPage(html, fetched.finalUrl);
  const cssChunks: string[] = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
    (match) => match[1],
  );
  for (const href of extracted.stylesheets.slice(0, 4)) {
    try {
      const sheet = await fetcher.fetch(href);
      if (sheet.status < 400 && (!sheet.contentType || /css|text\/plain/i.test(sheet.contentType)))
        cssChunks.push(sheet.body.toString("utf8"));
    } catch (error) {
      logger.warn(
        { reference: reference.reference_id, href, reason: String(error) },
        "reference stylesheet fetch failed; continuing with inline CSS only",
      );
    }
  }
  const observed = observeDesignCharacteristics(html, extracted, cssChunks.join("\n"));

  const evidenceDir = resolve(options.outputDir, sha12(reference.reference_id));
  mkdirSync(evidenceDir, { recursive: true });
  const pagePath = resolve(evidenceDir, "page.html");
  const extractedPath = resolve(evidenceDir, "extracted.json");
  writeFileSync(pagePath, html, "utf-8");
  writeFileSync(
    extractedPath,
    `${JSON.stringify(
      {
        title: extracted.title,
        description: extracted.description,
        canonicalUrl: extracted.canonicalUrl,
        headings: extracted.headings,
        nav: extracted.nav,
        stylesheets: extracted.stylesheets,
        image_count: extracted.images.length,
        link_count: extracted.links.length,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  let screenshotPath: string | undefined;
  const screenshots = options.screenshots ?? new NoopScreenshotCapturer();
  try {
    screenshotPath = await screenshots.capture({
      url: fetched.finalUrl,
      outputPath: resolve(evidenceDir, "screenshot.png"),
    });
  } catch {
    screenshotPath = undefined;
  }

  return {
    ...base,
    status: "acquired",
    http_status: fetched.status,
    final_url: fetched.finalUrl,
    content_digest: sha256(html),
    content_bytes: fetched.body.byteLength,
    evidence_dir: evidenceDir,
    page_path: pagePath,
    extracted_path: extractedPath,
    screenshot_path: screenshotPath,
    observed,
    copy_guard_terms: copyGuardTerms(extracted),
  };
}

/* ------------------------------------------------------------------ */
/* Analysis (governed LLM) + guards                                   */
/* ------------------------------------------------------------------ */

export class DesignReferenceAnalysisError extends Error {
  readonly code = "DESIGN_REFERENCE_ANALYSIS_INVALID";
  constructor(message: string) {
    super(`DESIGN_REFERENCE_ANALYSIS_INVALID: ${message}`);
    this.name = "DesignReferenceAnalysisError";
  }
}

/**
 * Copy-transfer guard: no derived principle may reproduce the reference's own
 * title or a heading verbatim. Abstract statements pass; lifted copy does not.
 */
export function assertNoReferenceCopyTransfer(
  values: readonly string[],
  guardTerms: readonly string[],
  field: string,
): void {
  for (const value of values) {
    const lower = value.toLowerCase();
    for (const term of guardTerms) {
      if (term && lower.includes(term)) {
        throw new DesignReferenceAnalysisError(
          `${field} reproduces reference copy verbatim: ${JSON.stringify(value)}`,
        );
      }
    }
  }
}

const ANALYSIS_LIST_FIELDS = [
  "observed_design_characteristics",
  "positive_patterns",
  "negative_patterns",
  "layout",
  "hierarchy",
  "interaction",
  "density",
  "typography",
  "imagery",
  "conversion",
  "portable_principles",
  "prohibited_transfers",
  "differentiation_implications",
] as const;

export function parseDesignReferenceAnalysis(
  raw: unknown,
  evidence: DesignReferenceEvidence,
): DesignReferenceAnalysis {
  if (!isRecord(raw)) throw new DesignReferenceAnalysisError("analysis must be a JSON object");
  const relationship = textField(raw.client_relationship);
  if (!(CLIENT_REFERENCE_RELATIONSHIPS as readonly string[]).includes(relationship)) {
    throw new DesignReferenceAnalysisError(
      `client_relationship must be one of ${CLIENT_REFERENCE_RELATIONSHIPS.join("|")}`,
    );
  }
  const lists = Object.fromEntries(
    ANALYSIS_LIST_FIELDS.map((field) => [field, stringList(raw[field])]),
  ) as Record<(typeof ANALYSIS_LIST_FIELDS)[number], string[]>;
  for (const field of ANALYSIS_LIST_FIELDS) {
    assertNoRawExpressionTransfer(lists[field], `design_reference_analysis.${field}`);
    assertNoReferenceCopyTransfer(lists[field], evidence.copy_guard_terms, field);
  }
  const stated =
    lists.positive_patterns.length +
    lists.negative_patterns.length +
    lists.layout.length +
    lists.hierarchy.length +
    lists.interaction.length +
    lists.density.length +
    lists.typography.length +
    lists.imagery.length +
    lists.conversion.length;
  if (stated === 0) {
    throw new DesignReferenceAnalysisError("analysis derived no principles from the reference");
  }
  const body = {
    reference_id: evidence.reference_id,
    source: "system_derived" as const,
    analyzer_version: DESIGN_REFERENCE_ANALYZER_VERSION,
    client_relationship: relationship as ClientReferenceRelationship,
    ...lists,
    evidence_digest: evidence.content_digest ?? "",
  };
  return { ...body, analysis_digest: sha256(canonicalJson(body)) };
}

function analysisPrompt(
  reference: Pick<DesignReference, "reference_id" | "url" | "selection_reason">,
  evidence: DesignReferenceEvidence,
  clientContext: { brand_attributes: string[]; change: string[]; explicit_constraints: string[] },
): { system: string; user: string } {
  const system = [
    "You analyze a client-supplied design reference website for a website redesign.",
    "You receive OBSERVED EVIDENCE (deterministic, abstract measurements of the actual page) and the CLIENT'S REACTION (their words about why they supplied this reference).",
    "The client's reaction is a PREFERENCE, never an observation. Do not restate it as if it were observed. Where the reaction and the evidence disagree, say so in differentiation_implications.",
    "Output abstract, transferable design principles only. Never output the reference's copy, headings, taglines, CSS, markup, colors (no hex/rgb/hsl), font names, or any concrete visual expression. Describe characteristics ('editorial typography', 'generous whitespace', 'single primary action above the fold'), never assets.",
    "Respond with ONLY one JSON object. No prose, no markdown fences.",
  ].join(" ");
  const user = JSON.stringify(
    {
      task: "analyze_client_design_reference",
      reference_id: reference.reference_id,
      reference_url: reference.url,
      client_reaction_preference_not_observation: reference.selection_reason,
      client_design_intent: clientContext,
      observed_evidence: evidence.observed,
      output_contract: {
        client_relationship: CLIENT_REFERENCE_RELATIONSHIPS.join(" | "),
        observed_design_characteristics: "string[] — what the evidence shows, abstract",
        positive_patterns: "string[] — patterns worth transferring as abstractions",
        negative_patterns: "string[] — patterns to avoid (from evidence and/or client reaction)",
        layout: "string[]",
        hierarchy: "string[]",
        interaction: "string[]",
        density: "string[]",
        typography: "string[] — characteristics, never font names",
        imagery: "string[] — characteristics, never assets",
        conversion: "string[]",
        portable_principles: "string[] — the principles this reference contributes to the client's own direction",
        prohibited_transfers: "string[] — what must NOT be copied from this reference",
        differentiation_implications:
          "string[] — how the client should differ from this reference, especially where the client rejected something",
      },
    },
    null,
    2,
  );
  return { system, user };
}

/**
 * Analyze one ACQUIRED reference with the governed LLM. One bounded repair on
 * an invalid response; a second failure is terminal.
 */
export async function analyzeDesignReference(
  llm: WebsiteFactoryLLM,
  clientId: string,
  reference: Pick<DesignReference, "reference_id" | "url" | "selection_reason">,
  evidence: DesignReferenceEvidence,
  clientContext: { brand_attributes: string[]; change: string[]; explicit_constraints: string[] },
): Promise<DesignReferenceAnalysis> {
  if (evidence.status !== "acquired" || !evidence.observed) {
    throw new DesignReferenceAnalysisError(
      `reference ${reference.reference_id} was not acquired; nothing to analyze`,
    );
  }
  const task = websiteImproveTask(
    "DESIGN_REFERENCE_ANALYSIS",
    clientId,
    `[intelligence] design reference analysis for ${reference.reference_id}`,
  );
  const { system, user } = analysisPrompt(reference, evidence, clientContext);
  const first = await llm.strategize(task, system, user);
  try {
    return parseDesignReferenceAnalysis(extractJson(first), evidence);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(
      { reference: reference.reference_id, reason },
      "reference analysis invalid; attempting one bounded repair",
    );
    const repair = `${user}\n\n---\nYour previous response was rejected: ${reason}\nRespond again with ONLY a single valid JSON object matching output_contract. Abstract principles only; never the reference's own words.`;
    const second = await llm.strategize(task, system, repair);
    return parseDesignReferenceAnalysis(extractJson(second), evidence);
  }
}

/* ------------------------------------------------------------------ */
/* Merge into the DesignReferenceSet                                  */
/* ------------------------------------------------------------------ */

export function principlesFromAnalysis(analysis: DesignReferenceAnalysis): DesignReferencePrinciples {
  return {
    layout: analysis.layout,
    hierarchy: analysis.hierarchy,
    interaction: analysis.interaction,
    density: analysis.density,
    typography: analysis.typography,
    imagery: analysis.imagery,
    conversion: analysis.conversion,
    positive: analysis.positive_patterns,
    negative: analysis.negative_patterns,
  };
}

function mergeStrings(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
}

/**
 * Apply acquisition + analysis results to the operator-declared reference
 * set. Operator-authored principles are kept and unioned with system-derived
 * ones; evidence refs gain the content-addressed acquisition evidence; and
 * every accepted reference records exactly what happened to it.
 */
export function applyAcquisitionToReferenceSet(
  declared: DesignReferenceSet,
  manifest: DesignReferenceAcquisitionManifest,
): DesignReferenceSet {
  const evidenceById = new Map(manifest.references.map((entry) => [entry.reference_id, entry]));
  const analysisById = new Map(manifest.analyses.map((entry) => [entry.reference_id, entry]));
  const accepted = declared.accepted_references.map((reference): DesignReference => {
    const evidence = evidenceById.get(reference.reference_id);
    const analysis = analysisById.get(reference.reference_id);
    const derived = analysis ? principlesFromAnalysis(analysis) : undefined;
    const principles: DesignReferencePrinciples = derived
      ? {
          layout: mergeStrings(reference.principles.layout, derived.layout),
          hierarchy: mergeStrings(reference.principles.hierarchy, derived.hierarchy),
          interaction: mergeStrings(reference.principles.interaction, derived.interaction),
          density: mergeStrings(reference.principles.density, derived.density),
          typography: mergeStrings(reference.principles.typography, derived.typography),
          imagery: mergeStrings(reference.principles.imagery, derived.imagery),
          conversion: mergeStrings(reference.principles.conversion, derived.conversion),
          positive: mergeStrings(reference.principles.positive, derived.positive),
          negative: mergeStrings(reference.principles.negative, derived.negative),
        }
      : reference.principles;
    const evidenceRefs = mergeStrings(
      reference.evidence_refs,
      evidence?.status === "acquired" && evidence.content_digest
        ? [`design-reference-evidence:${reference.reference_id}:sha256:${evidence.content_digest}`]
        : [],
    );
    const operatorAuthored = Object.values(reference.principles).some((list) => list.length > 0);
    return {
      ...reference,
      evidence_refs: evidenceRefs,
      principles,
      acquisition: evidence
        ? {
            status: evidence.status,
            fetched_at: evidence.fetched_at,
            ...(evidence.final_url ? { final_url: evidence.final_url } : {}),
            ...(evidence.content_digest ? { content_digest: evidence.content_digest } : {}),
            ...(evidence.failure_reason ? { failure_reason: evidence.failure_reason } : {}),
          }
        : { status: "no_url", fetched_at: manifest.acquired_at },
      principle_source: principleSource(Boolean(analysis), operatorAuthored),
      ...(analysis
        ? {
            analysis: {
              client_relationship: analysis.client_relationship,
              observed_design_characteristics: analysis.observed_design_characteristics,
              portable_principles: analysis.portable_principles,
              prohibited_transfers: analysis.prohibited_transfers,
              differentiation_implications: analysis.differentiation_implications,
              analysis_digest: analysis.analysis_digest,
            },
          }
        : {}),
    };
  });
  return {
    accepted_references: accepted,
    rejected_references: declared.rejected_references,
    provenance: { source: "domain_spec+acquisition", declared: declared.provenance.declared },
  };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                      */
/* ------------------------------------------------------------------ */

export interface AcquireAndAnalyzeOptions extends AcquireDesignReferenceOptions {
  llm: WebsiteFactoryLLM;
  clientId: string;
  buildId: string;
  clientContext: { brand_attributes: string[]; change: string[]; explicit_constraints: string[] };
}

/**
 * Acquire and analyze every accepted reference. Failures never abort the loop;
 * the manifest records each outcome and the caller applies run policy.
 */
export async function acquireAndAnalyzeDesignReferences(
  declared: DesignReferenceSet,
  options: AcquireAndAnalyzeOptions,
): Promise<DesignReferenceAcquisitionManifest> {
  const now = options.now ?? (() => new Date());
  const references: DesignReferenceEvidence[] = [];
  const analyses: DesignReferenceAnalysis[] = [];
  for (const reference of declared.accepted_references) {
    const evidence = await acquireDesignReference(reference, options);
    references.push(evidence);
    if (evidence.status !== "acquired") {
      logger.warn(
        { reference: reference.reference_id, status: evidence.status, reason: evidence.failure_reason },
        "design reference not acquired",
      );
      continue;
    }
    analyses.push(
      await analyzeDesignReference(
        options.llm,
        options.clientId,
        reference,
        evidence,
        options.clientContext,
      ),
    );
  }
  const withUrl = declared.accepted_references.filter((reference) => reference.url?.trim()).length;
  const acquired = references.filter((entry) => entry.status === "acquired").length;
  const manifest: DesignReferenceAcquisitionManifest = {
    schema: DESIGN_REFERENCE_ACQUISITION_SCHEMA,
    client_id: options.clientId,
    build_id: options.buildId,
    acquired_at: now().toISOString(),
    references,
    analyses,
    summary: {
      declared: declared.accepted_references.length,
      with_url: withUrl,
      acquired,
      failed: withUrl - acquired,
      analyzed: analyses.length,
    },
  };
  mkdirSync(options.outputDir, { recursive: true });
  writeFileSync(
    resolve(options.outputDir, "design-reference-acquisition.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
  return manifest;
}
