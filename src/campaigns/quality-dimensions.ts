// L9_META: layer=campaign, role=quality_dimension_vocabulary, status=active, version=1.0.0
/**
 * Locked quality-dimension vocabulary for the learning plane (design contract §7).
 * Deterministic measurements may carry real numbers; subjective aesthetics carry
 * verdicts only — numeric scores are never invented for them.
 */

export const QUALITY_DIMENSIONS = [
  "business.fact_accuracy",
  "architecture.route_coverage",
  "architecture.section_conformance",
  "content.requirement_coverage",
  "content.unsupported_claims",
  "seo.metadata",
  "seo.internal_links",
  "seo.intent_alignment",
  "conversion.primary_cta",
  "conversion.mobile_cta",
  "conversion.trust_visibility",
  "visual.hierarchy",
  "visual.legibility",
  "visual.spacing",
  "visual.coherence",
  "visual.brand_distinction",
  "responsive.overflow",
  "responsive.navigation",
  "responsive.touch_targets",
  "accessibility.contrast",
  "accessibility.structure",
  "performance.asset_weight",
  "runtime.broken_links",
  "runtime.asset_failures",
] as const;

export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

export const QUALITY_VERDICTS = ["IMPROVED", "REGRESSED", "NON_REGRESSED"] as const;
export type QualityVerdict = (typeof QUALITY_VERDICTS)[number];

export const DIMENSION_STATUSES = ["PASS", "FAIL", "INCONCLUSIVE"] as const;
export type DimensionStatus = (typeof DIMENSION_STATUSES)[number];

export const CONFIDENCE_CLASSES = ["LOW", "MEDIUM", "HIGH"] as const;
export type ConfidenceClass = (typeof CONFIDENCE_CLASSES)[number];

/** Deterministic measurements permitted by the design source. */
export const DETERMINISTIC_MEASUREMENTS = [
  "contrast_ratio",
  "dom_depth",
  "cta_count",
  "scroll_depth",
  "lcp",
  "heading_count",
  "link_errors",
  "viewport_overflow_pixels",
  "asset_weight",
  "content_requirement_coverage",
] as const;
export type DeterministicMeasurement = (typeof DETERMINISTIC_MEASUREMENTS)[number];

const FAMILIES: Array<[string, string]> = [
  ["business", "business"],
  ["architecture", "architecture"],
  ["content", "content"],
  ["seo", "seo"],
  ["conversion", "conversion"],
  ["visual", "visual"],
  ["responsive", "responsive"],
  ["accessibility", "accessibility"],
  ["performance", "performance"],
  ["runtime", "runtime"],
];

/** Family prefix of a dimension key, e.g. "conversion" for conversion.primary_cta. */
export function dimensionFamily(dimension: string): string {
  const family = FAMILIES.find(
    ([prefix]) => dimension === prefix || dimension.startsWith(`${prefix}.`),
  );
  if (!family) throw new Error(`Unknown quality dimension family for: ${dimension}`);
  return family[1];
}

export function isQualityDimension(value: string): value is QualityDimension {
  return (QUALITY_DIMENSIONS as readonly string[]).includes(value);
}

export function assertQualityDimension(value: string): QualityDimension {
  if (!isQualityDimension(value)) throw new Error(`Not a locked quality dimension: ${value}`);
  return value;
}

/** Hard-gate dimensions: their FAIL or INCONCLUSIVE state blocks REVIEWABLE. */
export const HARD_GATE_DIMENSIONS: readonly QualityDimension[] = [
  "business.fact_accuracy",
  "architecture.route_coverage",
  "architecture.section_conformance",
  "content.requirement_coverage",
  "content.unsupported_claims",
  "seo.metadata",
  "seo.internal_links",
  "seo.intent_alignment",
  "conversion.primary_cta",
  "conversion.mobile_cta",
  "conversion.trust_visibility",
  "accessibility.contrast",
  "accessibility.structure",
  "responsive.overflow",
  "responsive.navigation",
  "responsive.touch_targets",
  "runtime.broken_links",
  "runtime.asset_failures",
];

export function isHardGateDimension(dimension: QualityDimension): boolean {
  return (HARD_GATE_DIMENSIONS as readonly string[]).includes(dimension);
}
