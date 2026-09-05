// L9_META: layer=intelligence, role=design_input_authority, status=active, version=1.0.0
//
// First-party design input authorities for WebsiteBuildBlueprintV2 (ADR-0018).
//
// These types are deliberately Website-Bot-local and are NOT part of
// @quantum-l9/bot-interop: SEO-Bot must stay design-blind (WBV2-002), and the
// cleanest enforcement is that it cannot import them at all. Only their
// provenance digests cross into the sealed blueprint.
import { createHash } from "node:crypto";
import {
  assertNoRawExpressionTransfer,
  assertPaletteNonAuthority,
  type BlueprintDesignDirection,
  canonicalJson,
  type PaletteAuthority,
} from "@quantum-l9/bot-interop";
import type { DomainSpec } from "../pipeline/BuildContext.js";

/* ------------------------------------------------------------------ */
/* Typed failures (WBV2-018)                                          */
/* ------------------------------------------------------------------ */
export type DesignAuthorityErrorCode =
  | "CLIENT_VISION_INVALID"
  | "DESIGN_REFERENCE_INVALID"
  | "DESIGN_REFERENCE_RAW_TRANSFER"
  | "PALETTE_AUTHORITY_LEAK";

export class DesignAuthorityError extends Error {
  readonly code: DesignAuthorityErrorCode;
  constructor(code: DesignAuthorityErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "DesignAuthorityError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* ClientVision — explicit client design intent (WBV2-003)            */
/* ------------------------------------------------------------------ */

/**
 * `declared: false` is an honest record of "the client stated no design
 * intent", not a fabricated vision. It still digests to real provenance
 * (WBV2-009); what it does not do is occupy the ClientVision tier of the
 * WBV2-019 priority ladder.
 */
export interface ClientVision {
  declared: boolean;
  desired_outcomes: string[];
  brand_attributes: string[];
  visual_preferences: string[];
  liked_examples: string[];
  disliked_examples: string[];
  preserve: string[];
  change: string[];
  conversion_priorities: string[];
  explicit_constraints: string[];
  /**
   * Explicit client color intent. This is the ONLY observation-independent
   * route by which a color becomes authoritative (WBV2-007).
   */
  palette: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* DesignReferenceSet — accepted reference portfolio (WBV2-004)       */
/* ------------------------------------------------------------------ */
export interface DesignReferencePrinciples {
  layout: string[];
  hierarchy: string[];
  interaction: string[];
  density: string[];
  typography: string[];
  imagery: string[];
  conversion: string[];
  positive: string[];
  negative: string[];
}

/**
 * Where a reference's principles came from. `operator_authored` is the legacy
 * path (the operator hand-translated the reference); `system_derived` means the
 * design-reference-acquisition stage fetched, observed and analyzed the actual
 * reference; `none` means the reference contributed nothing (declared without
 * principles and not acquired).
 */
export type DesignReferencePrincipleSource =
  | "operator_authored"
  | "system_derived"
  | "operator_and_system"
  | "none";

export interface DesignReference {
  reference_id: string;
  url?: string;
  selection_reason: string;
  evidence_refs: string[];
  principles: DesignReferencePrinciples;
  /** Present once the acquisition stage has run for this reference. */
  acquisition?: {
    status:
      | "acquired"
      | "no_url"
      | "invalid_url"
      | "forbidden_host"
      | "unreachable"
      | "not_html";
    fetched_at: string;
    final_url?: string;
    content_digest?: string;
    failure_reason?: string;
  };
  principle_source?: DesignReferencePrincipleSource;
  /** System-derived interpretation (abstract; observed evidence vs preference). */
  analysis?: {
    client_relationship: string;
    observed_design_characteristics: string[];
    portable_principles: string[];
    prohibited_transfers: string[];
    differentiation_implications: string[];
    analysis_digest: string;
  };
}

export interface DesignReferenceSet {
  accepted_references: DesignReference[];
  rejected_references: Array<{ reference_id: string; url?: string; rejection_reason: string }>;
  provenance: { source: "domain_spec" | "domain_spec+acquisition"; declared: boolean };
}

/** Accepted references that carry a URL the acquisition stage must fetch. */
export function acquirableReferences(set: DesignReferenceSet): DesignReference[] {
  return set.accepted_references.filter((reference) => Boolean(reference.url?.trim()));
}

/* ------------------------------------------------------------------ */
/* DesignReferenceIntelligence — abstracted evidence (WBV2-004)       */
/* ------------------------------------------------------------------ */

/**
 * Normalized design principles. There is deliberately no field on this type
 * capable of carrying raw copy, markup, CSS or imagery: the prohibition is
 * structural first, and mechanically re-checked by
 * `assertNoRawExpressionTransfer`.
 */
export interface DesignReferenceIntelligence {
  declared: boolean;
  positive_patterns: string[];
  negative_patterns: string[];
  layout_principles: string[];
  hierarchy_principles: string[];
  interaction_principles: string[];
  density_principles: string[];
  typography_characteristics: string[];
  imagery_characteristics: string[];
  conversion_patterns: string[];
  prohibited_transfers: string[];
  evidence_refs: string[];
}

/** Transfers that are forbidden regardless of what any reference exhibits. */
export const PROHIBITED_TRANSFERS: readonly string[] = [
  "raw_reference_copy",
  "raw_reference_markup",
  "raw_reference_css",
  "raw_reference_imagery",
  "proprietary_expression",
  "observed_palette_as_theme",
];

/* ------------------------------------------------------------------ */
/* Resolution                                                         */
/* ------------------------------------------------------------------ */
function strings(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new DesignAuthorityError("CLIENT_VISION_INVALID", `${field} must be an array of strings`);
  }
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Order-preserving variant for fields whose ORDER is the client's statement:
 * `conversion_priorities[0]` is the primary action (WBV2-019). Sorting it, as
 * `strings()` does for set-like fields, silently elected an alphabetically
 * earlier action as primary (L2-S11-001).
 */
function orderedStrings(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new DesignAuthorityError("CLIENT_VISION_INVALID", `${field} must be an array of strings`);
  }
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}

function isCssColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ||
      /^rgba?\([\d.,\s%/]+\)$/i.test(value) ||
      /^hsla?\([\d.,\s%/]+\)$/i.test(value) ||
      /^[a-zA-Z]+$/.test(value))
  );
}

/**
 * Resolve explicit client design intent from the first-party spec. Fails
 * closed on a malformed declaration rather than degrading to "not declared":
 * a client who spoke and was misheard is worse than a client who said nothing.
 */
export function resolveClientVision(spec: DomainSpec): ClientVision {
  const raw = spec.client_vision;
  const empty: ClientVision = {
    declared: false,
    desired_outcomes: [],
    brand_attributes: [],
    visual_preferences: [],
    liked_examples: [],
    disliked_examples: [],
    preserve: [],
    change: [],
    conversion_priorities: [],
    explicit_constraints: [],
    palette: {},
  };
  if (raw === undefined) return empty;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DesignAuthorityError("CLIENT_VISION_INVALID", "client_vision must be an object");
  }

  const palette: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.palette ?? {})) {
    if (!isCssColor(value)) {
      throw new DesignAuthorityError(
        "CLIENT_VISION_INVALID",
        `client_vision.palette.${key} must be a valid CSS color`,
      );
    }
    palette[key] = value.trim();
  }

  const vision: ClientVision = {
    declared: true,
    desired_outcomes: strings(raw.desired_outcomes, "client_vision.desired_outcomes"),
    brand_attributes: strings(raw.brand_attributes, "client_vision.brand_attributes"),
    visual_preferences: strings(raw.visual_preferences, "client_vision.visual_preferences"),
    liked_examples: strings(raw.liked_examples, "client_vision.liked_examples"),
    disliked_examples: strings(raw.disliked_examples, "client_vision.disliked_examples"),
    preserve: strings(raw.preserve, "client_vision.preserve"),
    change: strings(raw.change, "client_vision.change"),
    conversion_priorities: orderedStrings(
      raw.conversion_priorities,
      "client_vision.conversion_priorities",
    ),
    explicit_constraints: strings(raw.explicit_constraints, "client_vision.explicit_constraints"),
    palette,
  };

  // Liked/disliked examples ARE statements of intent: a client who only says
  // "like A, dislike B" has declared a vision (L2-S8-001).
  const stated = [
    ...vision.desired_outcomes,
    ...vision.brand_attributes,
    ...vision.visual_preferences,
    ...vision.liked_examples,
    ...vision.disliked_examples,
    ...vision.preserve,
    ...vision.change,
    ...vision.conversion_priorities,
    ...vision.explicit_constraints,
  ];
  if (stated.length === 0 && Object.keys(palette).length === 0) {
    throw new DesignAuthorityError(
      "CLIENT_VISION_INVALID",
      "client_vision was declared but states nothing; omit the block instead of declaring an empty vision",
    );
  }
  return vision;
}

function referencePrinciples(raw: unknown, referenceId: string): DesignReferencePrinciples {
  const row = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const at = (key: keyof DesignReferencePrinciples): string[] => {
    const values = strings(row[key], `design_references[${referenceId}].principles.${key}`);
    assertNoRawExpressionTransfer(values, `design_references[${referenceId}].principles.${key}`);
    return values;
  };
  return {
    layout: at("layout"),
    hierarchy: at("hierarchy"),
    interaction: at("interaction"),
    density: at("density"),
    typography: at("typography"),
    imagery: at("imagery"),
    conversion: at("conversion"),
    positive: at("positive"),
    negative: at("negative"),
  };
}

/** Resolve the accepted/rejected reference portfolio from the first-party spec. */
export function resolveDesignReferenceSet(spec: DomainSpec): DesignReferenceSet {
  const raw = spec.design_references;
  if (raw === undefined) {
    return {
      accepted_references: [],
      rejected_references: [],
      provenance: { source: "domain_spec", declared: false },
    };
  }
  if (!Array.isArray(raw)) {
    throw new DesignAuthorityError(
      "DESIGN_REFERENCE_INVALID",
      "design_references must be an array",
    );
  }

  const accepted: DesignReference[] = [];
  const rejected: DesignReferenceSet["rejected_references"] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new DesignAuthorityError(
        "DESIGN_REFERENCE_INVALID",
        `design_references[${index}] must be an object`,
      );
    }
    const referenceId = typeof entry.reference_id === "string" ? entry.reference_id.trim() : "";
    if (!referenceId) {
      throw new DesignAuthorityError(
        "DESIGN_REFERENCE_INVALID",
        `design_references[${index}] requires a reference_id`,
      );
    }
    if (seen.has(referenceId)) {
      throw new DesignAuthorityError(
        "DESIGN_REFERENCE_INVALID",
        `duplicate design reference ${referenceId}`,
      );
    }
    seen.add(referenceId);

    if (entry.accepted === false) {
      const reason = typeof entry.rejection_reason === "string" ? entry.rejection_reason.trim() : "";
      if (!reason) {
        throw new DesignAuthorityError(
          "DESIGN_REFERENCE_INVALID",
          `rejected reference ${referenceId} requires a rejection_reason`,
        );
      }
      rejected.push({
        reference_id: referenceId,
        ...(typeof entry.url === "string" ? { url: entry.url } : {}),
        rejection_reason: reason,
      });
      continue;
    }
    const selectionReason =
      typeof entry.selection_reason === "string" ? entry.selection_reason.trim() : "";
    if (!selectionReason) {
      throw new DesignAuthorityError(
        "DESIGN_REFERENCE_INVALID",
        `accepted reference ${referenceId} requires a selection_reason`,
      );
    }
    accepted.push({
      reference_id: referenceId,
      ...(typeof entry.url === "string" ? { url: entry.url } : {}),
      selection_reason: selectionReason,
      evidence_refs: strings(entry.evidence_refs, `design_references[${referenceId}].evidence_refs`),
      principles: referencePrinciples(entry.principles, referenceId),
    });
  }

  accepted.sort((a, b) => a.reference_id.localeCompare(b.reference_id));
  rejected.sort((a, b) => a.reference_id.localeCompare(b.reference_id));
  return {
    accepted_references: accepted,
    rejected_references: rejected,
    provenance: { source: "domain_spec", declared: true },
  };
}

function merge(values: string[][]): string[] {
  return [...new Set(values.flat().filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Derive abstracted design intelligence from the accepted reference portfolio.
 *
 * Deterministic by construction: it abstracts what the operator accepted and
 * invents nothing. An empty portfolio yields the well-formed "not declared"
 * record — honest provenance rather than a fabricated one (WBV2-018).
 */
export function deriveDesignReferenceIntelligence(
  set: DesignReferenceSet,
): DesignReferenceIntelligence {
  const accepted = set.accepted_references;
  const pick = (key: keyof DesignReferencePrinciples): string[] =>
    merge(accepted.map((reference) => reference.principles[key]));

  const intelligence: DesignReferenceIntelligence = {
    declared: accepted.length > 0,
    positive_patterns: pick("positive"),
    negative_patterns: pick("negative"),
    layout_principles: pick("layout"),
    hierarchy_principles: pick("hierarchy"),
    interaction_principles: pick("interaction"),
    density_principles: pick("density"),
    typography_characteristics: pick("typography"),
    imagery_characteristics: pick("imagery"),
    conversion_patterns: pick("conversion"),
    prohibited_transfers: [...PROHIBITED_TRANSFERS],
    evidence_refs: merge(accepted.map((reference) => reference.evidence_refs)),
  };

  for (const [field, values] of [
    ["positive_patterns", intelligence.positive_patterns],
    ["negative_patterns", intelligence.negative_patterns],
    ["layout_principles", intelligence.layout_principles],
    ["hierarchy_principles", intelligence.hierarchy_principles],
    ["interaction_principles", intelligence.interaction_principles],
    ["density_principles", intelligence.density_principles],
    ["typography_characteristics", intelligence.typography_characteristics],
    ["imagery_characteristics", intelligence.imagery_characteristics],
    ["conversion_patterns", intelligence.conversion_patterns],
  ] as const) {
    assertNoRawExpressionTransfer(values, `design_reference_intelligence.${field}`);
  }
  return intelligence;
}

/* ------------------------------------------------------------------ */
/* Palette authority (WBV2-007)                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve the authoritative palette under the WBV2-019 ladder.
 *
 * An explicit first-party design spec outranks explicit client intent;
 * observed evidence — source site, donors, references — outranks nothing and
 * may only contribute abstract characteristics.
 */
export function resolvePaletteAuthority(input: {
  spec: DomainSpec;
  clientVision: ClientVision;
  observedCharacteristics?: string[];
}): PaletteAuthority {
  const observed = [...new Set(input.observedCharacteristics ?? [])].sort((a, b) =>
    a.localeCompare(b),
  );

  const firstParty = input.spec.design?.status === "resolved" ? input.spec.design.palette : undefined;
  let authority: PaletteAuthority;
  if (firstParty && Object.keys(firstParty).length > 0) {
    authority = {
      source: "first_party_design_spec",
      tokens: { ...firstParty },
      observed_characteristics: observed,
    };
  } else if (Object.keys(input.clientVision.palette).length > 0) {
    authority = {
      source: "client_vision",
      tokens: { ...input.clientVision.palette },
      observed_characteristics: observed,
    };
  } else {
    authority = { source: "none", tokens: {}, observed_characteristics: observed };
  }
  assertPaletteNonAuthority(authority);
  return authority;
}

/* ------------------------------------------------------------------ */
/* Design direction (WBV2-019)                                        */
/* ------------------------------------------------------------------ */

/**
 * Compose the blueprint's design direction in strict priority order:
 *
 *   explicit first-party constraint
 *     > explicit ClientVision preference
 *     > accepted DesignReferenceIntelligence
 *     > synthesized PatternPortfolio
 *     > generic model preference
 *
 * Composition is additive and order-preserving: a lower authority contributes
 * only what a higher authority has not already claimed, and a lower authority
 * never removes a higher one's attribute. An attribute the client rejected can
 * therefore never be reintroduced by a reference or a pattern.
 */
export function resolveDesignDirection(input: {
  clientVision: ClientVision;
  designReferenceIntelligence: DesignReferenceIntelligence;
  patternPrinciples?: string[];
  modelPrinciples?: string[];
  referencePatternRefs?: string[];
  paletteAuthority: PaletteAuthority;
}): BlueprintDesignDirection {
  const intelligence = input.designReferenceIntelligence;

  // Higher authority first; `ladder` preserves that order while de-duplicating.
  const ladder = (...tiers: string[][]): string[] => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const tier of tiers) {
      for (const value of tier) {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        ordered.push(value);
      }
    }
    return ordered;
  };

  // What the client explicitly wants changed is the highest-authority
  // rejection; accepted references contribute their negative patterns beneath
  // it. Both are authoritative rejections.
  const rejected = ladder(input.clientVision.change, intelligence.negative_patterns);
  // A rejected attribute must never be reintroduced by a lower tier, so it is
  // filtered out of every lower-authority contribution below.
  const rejectedKeys = new Set(rejected.map((value) => value.toLowerCase()));
  const withoutRejected = (values: string[]): string[] =>
    values.filter((value) => !rejectedKeys.has(value.toLowerCase()));

  const direction: BlueprintDesignDirection = {
    principles: ladder(
      input.clientVision.explicit_constraints,
      withoutRejected(input.clientVision.visual_preferences),
      withoutRejected(intelligence.layout_principles),
      withoutRejected(intelligence.hierarchy_principles),
      withoutRejected(intelligence.interaction_principles),
      withoutRejected(intelligence.density_principles),
      withoutRejected(input.patternPrinciples ?? []),
      withoutRejected(input.modelPrinciples ?? []),
    ),
    desired_attributes: ladder(
      withoutRejected(input.clientVision.brand_attributes),
      withoutRejected(input.clientVision.preserve),
      withoutRejected(intelligence.positive_patterns),
      withoutRejected(intelligence.typography_characteristics),
      withoutRejected(intelligence.imagery_characteristics),
      withoutRejected(intelligence.conversion_patterns),
    ),
    rejected_attributes: rejected,
    reference_pattern_refs: [...new Set(input.referencePatternRefs ?? [])].sort((a, b) =>
      a.localeCompare(b),
    ),
    prohibited_transfers: [...intelligence.prohibited_transfers],
    palette_authority: input.paletteAuthority,
  };

  assertNoRawExpressionTransfer(direction.principles, "design_direction.principles");
  assertNoRawExpressionTransfer(direction.desired_attributes, "design_direction.desired_attributes");
  assertNoRawExpressionTransfer(
    direction.rejected_attributes,
    "design_direction.rejected_attributes",
  );
  assertPaletteNonAuthority(direction.palette_authority);
  return direction;
}

/* ------------------------------------------------------------------ */
/* Provenance digests (WBV2-009)                                      */
/* ------------------------------------------------------------------ */

/** Canonical sha256 over any design-authority record. */
export function digestDesignAuthority(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/* ------------------------------------------------------------------ */
/* Observation → abstraction (WBV2-007 allowed side)                  */
/* ------------------------------------------------------------------ */

/** Relative luminance of a hex color, or null when it is not parseable hex. */
/**
 * WCAG contrast band for a computed ratio. AAA is 7:1, AA is 4.5:1; below AA is
 * low contrast. Named rather than a ternary chain so the standard's two
 * thresholds are visible (typescript:S3358).
 */
function contrastBand(ratio: number): string {
  if (ratio >= 7) return "high-contrast";
  return ratio >= 4.5 ? "readable-contrast" : "low-contrast";
}

function hexLuminance(value: string): number | null {
  const hex = value.trim().replace(/^#/, "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  const channel = (offset: number): number => {
    const srgb = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * Distil an observed palette into abstract, explicitly non-authoritative
 * characteristics (WBV2-007's allowed side).
 *
 * This is the ONLY sanctioned path from an observed color to the blueprint, and
 * it is lossy by design: `#0b0b0b` becomes `dark-dominant`, never `#0b0b0b`.
 * The result can never be reconstituted into a theme token, which is precisely
 * the property the invariant needs.
 */
export function abstractPaletteCharacteristics(
  observed: Record<string, string | undefined> | undefined,
): string[] {
  if (!observed) return [];
  const background = observed.background ? hexLuminance(observed.background) : null;
  const text = observed.text ? hexLuminance(observed.text) : null;
  const characteristics: string[] = [];

  if (background !== null) {
    characteristics.push(background < 0.2 ? "dark-dominant" : "light-dominant");
  }
  if (background !== null && text !== null) {
    // WCAG contrast ratio between the two observed luminances.
    const [lighter, darker] = background > text ? [background, text] : [text, background];
    const ratio = (lighter + 0.05) / (darker + 0.05);
    // WCAG AAA is 7:1 and AA is 4.5:1; anything under AA is low contrast.
    characteristics.push(contrastBand(ratio));
  }
  const primary = observed.primary ? hexLuminance(observed.primary) : null;
  if (primary !== null && background !== null) {
    characteristics.push(Math.abs(primary - background) > 0.35 ? "assertive-accent" : "restrained-accent");
  }
  return [...new Set(characteristics)].sort((a, b) => a.localeCompare(b));
}
