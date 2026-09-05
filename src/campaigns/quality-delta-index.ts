// L9_META: layer=campaign, role=quality_delta_index, status=active, version=1.0.0
/**
 * QualityDeltaIndex — the aggregate over atomic QualityDimensionResults
 * (design contract §7). Stored as candidates/<Cn>/quality-delta.json.
 */

import { validateQualityDimensionResult } from "./quality-dimension-result.js";
import { isHardGateDimension } from "./quality-dimensions.js";
import type { QualityDeltaIndex, QualityDimension, QualityDimensionResult } from "./types.js";

export interface BuildQualityDeltaIndexInput {
  campaign_id: string;
  candidate_id: string;
  results: QualityDimensionResult[];
}

function assertIndexInputs(input: BuildQualityDeltaIndexInput): void {
  const seen = new Set<string>();
  for (const result of input.results) {
    const errors = validateQualityDimensionResult(result);
    if (errors.length > 0) {
      throw new Error(
        `Invalid QualityDimensionResult for ${result.dimension}: ${errors.join("; ")}`,
      );
    }
    if (result.campaign_id !== input.campaign_id || result.candidate_id !== input.candidate_id) {
      throw new Error(
        `Dimension result ${result.dimension} belongs to ${result.campaign_id}/${result.candidate_id}`,
      );
    }
    if (seen.has(result.dimension))
      throw new Error(`Duplicate dimension in index: ${result.dimension}`);
    seen.add(result.dimension);
  }
}

function aggregateResults(results: QualityDimensionResult[]): QualityDeltaIndex["aggregate"] {
  const hardGateFailures: QualityDimension[] = [];
  const regressionsVsBaseline: QualityDimension[] = [];
  const regressionsVsChampion: QualityDimension[] = [];
  const inconclusive: QualityDimension[] = [];
  for (const result of results) {
    if (result.status === "FAIL" && result.hard_gate) hardGateFailures.push(result.dimension);
    if (result.verdict_vs_baseline === "REGRESSED") regressionsVsBaseline.push(result.dimension);
    if (result.verdict_vs_champion === "REGRESSED") regressionsVsChampion.push(result.dimension);
    if (result.status === "INCONCLUSIVE") inconclusive.push(result.dimension);
  }
  return {
    hard_gate_failures: hardGateFailures,
    regressions_vs_baseline: regressionsVsBaseline,
    regressions_vs_champion: regressionsVsChampion,
    inconclusive,
  };
}

export function buildQualityDeltaIndex(input: BuildQualityDeltaIndexInput): QualityDeltaIndex {
  assertIndexInputs(input);
  return {
    schema: "website-bot.quality-delta-index/v1",
    schema_version: "1.0.0",
    campaign_id: input.campaign_id,
    candidate_id: input.candidate_id,
    results: [...input.results].sort((a, b) => a.dimension.localeCompare(b.dimension)),
    aggregate: aggregateResults(input.results),
  };
}

export function dimensionResultOf(
  index: QualityDeltaIndex,
  dimension: QualityDimension,
): QualityDimensionResult | null {
  return index.results.find((result) => result.dimension === dimension) ?? null;
}

/** Number of improved minus regressed hard-gate dimensions — a deterministic utility measure. */
export function utilityOf(index: QualityDeltaIndex): number {
  let utility = 0;
  for (const result of index.results) {
    if (!isHardGateDimension(result.dimension)) continue;
    if (result.verdict_vs_baseline === "IMPROVED") utility += 1;
    if (result.verdict_vs_baseline === "REGRESSED") utility -= 1;
  }
  return utility;
}

/** Dimensions a query over the index must surface, keyed by problem-first retrieval. */
export function queryIndex(
  index: QualityDeltaIndex,
  options: {
    hard_gate_only?: boolean;
    regressed_only?: boolean;
    responsible_layer?: string;
  } = {},
): QualityDimensionResult[] {
  return index.results.filter((result) => {
    if (options.hard_gate_only && !result.hard_gate) return false;
    if (
      options.regressed_only &&
      result.verdict_vs_baseline !== "REGRESSED" &&
      result.verdict_vs_champion !== "REGRESSED"
    ) {
      return false;
    }
    if (options.responsible_layer && result.responsible_layer !== options.responsible_layer)
      return false;
    return true;
  });
}
