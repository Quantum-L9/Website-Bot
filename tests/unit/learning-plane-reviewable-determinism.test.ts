// L9_META: layer=test, role=reviewable_determinism, status=active, version=1.0.0
// Determinism contracts 1, 2, 10:
//   - reviewable predicate is deterministic for identical inputs
//   - repeated evaluation yields the same semantic identity
//   - unknowns and inconclusives do not disappear between runs

import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateEvaluation } from "../../src/campaigns/candidate-evaluation.js";
import { buildQualityDeltaIndex } from "../../src/campaigns/quality-delta-index.js";
import { buildQualityDimensionResult } from "../../src/campaigns/quality-dimension-result.js";
import { isReviewable } from "../../src/campaigns/reviewable.js";
import { payloadDigestOf } from "../../src/campaigns/semantic-digest.js";

function passResult(dimension: string, verdict: "IMPROVED" | "NON_REGRESSED" = "NON_REGRESSED") {
  return buildQualityDimensionResult({
    dimension,
    candidate_id: "C1",
    campaign_id: "fixture-001",
    verdict_vs_baseline: verdict,
    verdict_vs_champion: verdict,
    hard_gate: true,
    status: "PASS",
  });
}

function reviewableIndex() {
  return buildQualityDeltaIndex({
    campaign_id: "fixture-001",
    candidate_id: "C1",
    results: [
      passResult("business.fact_accuracy", "NON_REGRESSED"),
      passResult("architecture.route_coverage", "NON_REGRESSED"),
      passResult("architecture.section_conformance", "NON_REGRESSED"),
      passResult("content.requirement_coverage", "NON_REGRESSED"),
      passResult("content.unsupported_claims", "NON_REGRESSED"),
      passResult("seo.metadata", "NON_REGRESSED"),
      passResult("seo.internal_links", "NON_REGRESSED"),
      passResult("seo.intent_alignment", "NON_REGRESSED"),
      passResult("conversion.primary_cta", "IMPROVED"),
      passResult("conversion.mobile_cta", "IMPROVED"),
      passResult("conversion.trust_visibility", "NON_REGRESSED"),
      passResult("visual.hierarchy", "NON_REGRESSED"),
      passResult("visual.legibility", "NON_REGRESSED"),
      passResult("visual.spacing", "NON_REGRESSED"),
      passResult("visual.coherence", "NON_REGRESSED"),
      passResult("visual.brand_distinction", "NON_REGRESSED"),
      passResult("responsive.overflow", "NON_REGRESSED"),
      passResult("responsive.navigation", "NON_REGRESSED"),
      passResult("responsive.touch_targets", "NON_REGRESSED"),
      passResult("accessibility.contrast", "NON_REGRESSED"),
      passResult("accessibility.structure", "NON_REGRESSED"),
      passResult("performance.asset_weight", "NON_REGRESSED"),
      passResult("runtime.broken_links", "NON_REGRESSED"),
      passResult("runtime.asset_failures", "NON_REGRESSED"),
    ],
  });
}

function baseReviewableInput(index: ReturnType<typeof reviewableIndex>) {
  return {
    index,
    build_passed: true,
    business_truth_passed: true,
    artifact_lineage_passed: true,
    blueprint_conformance_passed: true,
    seo_content_contract_passed: true,
    campaign_confidence_sufficient: true,
    champion_index: null,
  };
}

test("reviewable predicate is deterministic for identical inputs", () => {
  const index = reviewableIndex();
  const outcomes = new Set<string>();
  for (let run = 0; run < 25; run++) {
    outcomes.add(String(isReviewable(baseReviewableInput(index))));
  }
  assert.equal(outcomes.size, 1, "identical inputs must produce an identical boolean");
  assert.equal([...outcomes][0], "true");
});

test("reviewable predicate rejects on hard-gate failure regardless of other verdicts", () => {
  const index = buildQualityDeltaIndex({
    campaign_id: "fixture-001",
    candidate_id: "C1",
    results: [
      ...reviewableIndex().results.filter(
        (result) => result.dimension !== "business.fact_accuracy",
      ),
      buildQualityDimensionResult({
        dimension: "business.fact_accuracy",
        candidate_id: "C1",
        campaign_id: "fixture-001",
        hard_gate: true,
        status: "FAIL",
      }),
    ],
  });
  assert.equal(isReviewable(baseReviewableInput(index)), false);
});

test("reviewable predicate rejects blocking INCONCLUSIVE", () => {
  const index = buildQualityDeltaIndex({
    campaign_id: "fixture-001",
    candidate_id: "C1",
    results: [
      passResult("conversion.primary_cta", "IMPROVED"),
      buildQualityDimensionResult({
        dimension: "accessibility.contrast",
        candidate_id: "C1",
        campaign_id: "fixture-001",
        hard_gate: true,
        status: "INCONCLUSIVE",
      }),
    ],
  });
  assert.equal(isReviewable(baseReviewableInput(index)), false);
});

test("reviewable predicate rejects regression vs champion (candidate >= champion)", () => {
  const index = reviewableIndex();
  const champion = reviewableIndex();
  const challengerResult = buildQualityDimensionResult({
    dimension: "visual.hierarchy",
    candidate_id: "C2",
    campaign_id: "fixture-001",
    verdict_vs_baseline: "NON_REGRESSED",
    verdict_vs_champion: "REGRESSED",
    hard_gate: true,
    status: "PASS",
  });
  const challenger = buildQualityDeltaIndex({
    campaign_id: "fixture-001",
    candidate_id: "C2",
    results: [challengerResult],
  });
  const input = { ...baseReviewableInput(index), champion_index: champion };
  assert.equal(isReviewable({ ...input, index: challenger }), false);
});

test("repeated evaluation yields the same semantic identity", () => {
  const index = reviewableIndex();
  const first = buildCandidateEvaluation({
    campaign_id: "fixture-001",
    candidate_id: "C1",
    index,
    reviewable: true,
  });
  const second = buildCandidateEvaluation({
    campaign_id: "fixture-001",
    candidate_id: "C1",
    index: reviewableIndex(),
    reviewable: true,
  });
  assert.equal(first.integrity.payload_digest, second.integrity.payload_digest);
  assert.equal(
    payloadDigestOf({
      protocol: "l9",
      protocol_version: "1",
      artifact_type: "CandidateEvaluation",
      input_refs: [],
      payload: first,
    }),
    payloadDigestOf({
      protocol: "l9",
      protocol_version: "1",
      artifact_type: "CandidateEvaluation",
      input_refs: [],
      payload: second,
    }),
  );
});

test("unknowns and inconclusives do not disappear between runs", () => {
  const index = buildQualityDeltaIndex({
    campaign_id: "fixture-001",
    candidate_id: "C1",
    results: [
      buildQualityDimensionResult({
        dimension: "visual.brand_distinction",
        candidate_id: "C1",
        campaign_id: "fixture-001",
        hard_gate: false,
        status: "INCONCLUSIVE",
      }),
    ],
  });
  const first = JSON.stringify(index.aggregate.inconclusive);
  const second = JSON.stringify(index.aggregate.inconclusive);
  assert.equal(first, second);
  assert.deepEqual(index.aggregate.inconclusive, ["visual.brand_distinction"]);
});
