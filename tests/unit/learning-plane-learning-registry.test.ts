// L9_META: layer=test, role=learning_registry, status=active, version=1.0.0
// Retrieval is problem-first with the six keys; promotion is proposal-only;
// a single run cannot create a high-confidence global learning.

import assert from "node:assert/strict";
import test from "node:test";
import { buildLearningEvent } from "../../src/campaigns/learning-event.js";
import {
  buildPromotionCandidate,
  isAllowedPromotion,
  retrieveRelevantLearnings,
} from "../../src/campaigns/learning-registry.js";

function event(overrides: Partial<Parameters<typeof buildLearningEvent>[0]> = {}) {
  return buildLearningEvent({
    learning_id: "LE-00001",
    campaign_id: "safehaven-001",
    candidate_id: "C2",
    parent_candidate_id: "C1",
    context: {
      vertical: "roofing",
      page_archetype: "homepage",
      component: "hero",
      viewport: "mobile",
      quality_dimension: "conversion.primary_cta",
    },
    hypothesis: "Increasing CTA contrast improves mobile conversion clarity",
    mutation_ref: null,
    before: { quality_result: "NON_REGRESSED" },
    after: { quality_result: "IMPROVED" },
    side_effects: { "accessibility.contrast": "IMPROVED", "visual.hierarchy": "NON_REGRESSED" },
    outcome: "CONFIRMED_FOR_CAMPAIGN",
    ...overrides,
  });
}

test("retrieval ranks by context similarity and separates anti-patterns", () => {
  const confirmed = event();
  const antiPattern = event({
    learning_id: "LE-00002",
    outcome: "REJECTED",
    anti_pattern: { invariant: "Adding proof density above fold can overload mobile hierarchy" },
  });
  const unrelated = event({
    learning_id: "LE-00003",
    context: {
      vertical: "saas",
      page_archetype: "pricing",
      component: "pricing-table",
      viewport: "desktop",
      quality_dimension: "visual.spacing",
    },
  });
  const result = retrieveRelevantLearnings([unrelated, antiPattern, confirmed], {
    layer: "DESIGN",
    dimension: "conversion.primary_cta",
    archetype: "homepage",
    component: "hero",
    vertical: "roofing",
  });
  assert.equal(result.confirmed.length, 1);
  assert.equal(result.confirmed[0].event.learning_id, "LE-00001");
  assert.equal(result.anti_patterns.length, 1);
  assert.equal(result.anti_patterns[0].event.learning_id, "LE-00002");
});

test("negative learning is first-class and retrievable", () => {
  const rejected = event({
    outcome: "REJECTED",
    anti_pattern: { invariant: "second CTA regressed hierarchy" },
  });
  const result = retrieveRelevantLearnings([rejected], {
    layer: "DESIGN",
    dimension: "conversion.primary_cta",
    vertical: "roofing",
  });
  assert.equal(result.anti_patterns.length, 1);
});

test("promotion confidence is evidence-weighted and deterministic", () => {
  const base = {
    promotion_id: "PROMO-001",
    learning_ids: ["LE-00001"],
    scope: "SITE" as const,
    owning_component: "hero",
    proposed_invariant: "Stronger immediate trust adjacency improves hero conversion clarity",
    acceptance_test: "mobile conversion clarity improves without hierarchy regression",
    risk: "none",
  };
  const low = buildPromotionCandidate({ ...base, wins: 1, losses: 0 });
  assert.equal(low.confidence, "LOW");
  const medium = buildPromotionCandidate({ ...base, wins: 2, losses: 1 });
  assert.equal(medium.confidence, "MEDIUM");
  const high = buildPromotionCandidate({
    ...base,
    wins: 5,
    losses: 0,
    human_approved_campaigns: 1,
  });
  assert.equal(high.confidence, "HIGH");
});

test("a single run cannot create a high-confidence global learning", () => {
  const promotion = buildPromotionCandidate({
    promotion_id: "PROMO-002",
    learning_ids: ["LE-00001"],
    scope: "GLOBAL",
    owning_component: "hero",
    proposed_invariant: "every website must do this",
    acceptance_test: "t",
    risk: "none",
    wins: 10,
    losses: 0,
    human_approved_campaigns: 0,
  });
  // Strong evidence but no human approval: never HIGH confidence, never confirmed.
  assert.notEqual(promotion.confidence, "HIGH");
  assert.equal(promotion.promotion_state, "GLOBAL_CANDIDATE");
  assert.equal(promotion.human_approval_required, true);
  const verdict = isAllowedPromotion(promotion);
  assert.equal(verdict.allowed, true, "a candidate proposal is allowed; confirmation is not");
});

test("promotion states follow the scope ladder", () => {
  const site = buildPromotionCandidate({
    promotion_id: "PROMO-003",
    learning_ids: [],
    scope: "SITE",
    owning_component: "hero",
    proposed_invariant: "i",
    acceptance_test: "t",
    risk: "none",
  });
  assert.equal(site.promotion_state, "SITE_CONFIRMED");
  const vertical = buildPromotionCandidate({
    promotion_id: "PROMO-004",
    learning_ids: [],
    scope: "VERTICAL",
    owning_component: "hero",
    proposed_invariant: "i",
    acceptance_test: "t",
    risk: "none",
  });
  assert.equal(vertical.promotion_state, "VERTICAL_CANDIDATE");
});
