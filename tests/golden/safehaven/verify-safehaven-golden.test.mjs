/**
 * Unit tests for scripts/verify-safehaven-golden.mjs
 *
 * Covers the six mandated units:
 *   1. weighted mean delta (ORACLE-092 formula)
 *   2. Wilson boundary crossing — inconclusive vs pass (ORACLE-097)
 *   3. A/B orientation normalizer (reversed input reverses preference)
 *   4. critical-pair logic + dynamic oracle config (ORACLE-090/091)
 *   5. multiset route comparison / duplicate detection (ORACLE-033)
 *   6. required-ordered-subsequence + stage alias binding (ORACLE-011)
 * Plus:
 *   - positive-control receipt end-to-end GOLDEN_E2E_PASS_IMPROVED
 *   - determinism replay (identical semantic output across runs)
 *   - missing oracle config fails closed (hard FAIL) or blocking
 *     inconclusive (never hard FAIL) per closure missing_behavior
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  wilsonLowerBound,
  normalizePreference,
  weightedMeanDelta,
  criticalPairKey,
  compareRouteMultiset,
  orderedSubsequenceViolations,
  classifyVerdict,
  runVerifier,
} from "../../../scripts/verify-safehaven-golden.mjs";

const ROOT = process.cwd();
const CASE = path.resolve(ROOT, "tests/golden/safehaven/case.json");
const ORACLE = path.resolve(ROOT, "tests/golden/safehaven/oracle.json");

const baseCase = JSON.parse(fs.readFileSync(CASE, "utf8"));
const ROUTES = baseCase.routes;
const baseOracle = JSON.parse(fs.readFileSync(ORACLE, "utf8"));

/** Write a mutated oracle copy to a temp path; returns the path. */
function tempOracle(mutate) {
  const copy = structuredClone(baseOracle);
  mutate(copy);
  const p = path.join(os.tmpdir(), `oracle-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(copy));
  return p;
}

function tempReceipt(receipt) {
  const p = path.join(os.tmpdir(), `receipt-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(receipt));
  return p;
}

/* ---------------- positive-control receipt builder ---------------- */

const PREFLIGHT_CHECKS = [
  "seo_bot_reachable",
  "seo_bot_machine_auth",
  "competitive_landscape_capability",
  "seo_content_blueprint_capability",
  "structured_content_capability",
  "dataforseo_configured",
  "llm_provider_configured",
  "bot_interop_compatible",
  "llm_router_compatible",
];

const STAGE_EVENTS = [
  "domain-spec-loader",
  "unknown-resolver",
  "seo-build-intelligence-preflight:PASS",
  "seo:createCompetitiveLandscape",
  "competitive-intelligence",
  "source-site-ingestion",
  "design-intelligence",
  "redesign-content-authority",
  "structured-content-projection",
  "redesign-schema-serializer",
  "image-asset-planning",
  "site-assembler",
  "site-build",
  "visual-qa",
  "redesign-integrity-receipt",
  "terminal-convergence",
];

const DIMENSIONS = Object.keys(baseOracle.visual_oracle.dimensions);
const JUDGE_MANIFEST = "homepage render pair; left-right order randomized";

function trial(preference, deltaValue = 0.4) {
  const delta = {};
  for (const dimension of DIMENSIONS) delta[dimension] = deltaValue;
  return {
    blind: true,
    judge_input_manifest: JUDGE_MANIFEST,
    normalized_preference: preference,
    normalized_candidate_delta: delta,
  };
}

function visualPair(route, viewport, trialPrefs) {
  return {
    route,
    viewport,
    candidate_blank: false,
    baseline_blank: false,
    route_match: true,
    viewport_match: true,
    captured_run_id: "golden-run-2026-08-24",
    trials: trialPrefs.map((p) => trial(p)),
  };
}

/** Ten winning pairs: 8 x 3/3 candidate + 2 x 2/1 candidate = 26/30 votes. */
function winningPairs() {
  const pairs = [];
  for (const [route, viewport] of [
    ["/", "desktop"],
    ["/", "mobile"],
    ["/services/roof-replacement/", "desktop"],
    ["/services/storm-damage/", "mobile"],
    ["/gallery/", "desktop"],
    ["/gallery/", "mobile"],
    ["/contact/", "desktop"],
    ["/contact/", "mobile"],
  ]) {
    pairs.push(visualPair(route, viewport, ["CANDIDATE", "CANDIDATE", "CANDIDATE"]));
  }
  pairs.push(visualPair("/", "desktop", ["CANDIDATE", "CANDIDATE", "BASELINE"]));
  pairs.push(visualPair("/", "desktop", ["CANDIDATE", "CANDIDATE", "BASELINE"]));
  return pairs;
}

function buildPositiveReceipt() {
  const donors = Array.from({ length: 10 }, (_, i) => ({
    normalized_domain: `donor-${i}.example.com`,
    qualified_operating_company: true,
    real_dataforseo_observation: true,
    query_id: `q-${i}`,
    url: `https://donor-${i}.example.com/`,
    domain: `donor-${i}.example.com`,
    observed_at: "2026-08-18T00:00:00Z",
    rank: i + 1,
    visibility_contribution: 0.5,
    class: "operating-company",
  }));
  const donorEvidence = Array.from({ length: 10 }, (_, i) => ({
    domain: `donor-${i}.example.com`,
    successful_pages: 3,
    screenshots: 2,
    evidence_digest: `dig-${i}`,
    crawled_at: "2026-08-19T00:00:00Z",
  }));
  const perRoute = ROUTES.map((route, i) => ({
    route,
    http_status: 200,
    h1_count: 1,
    title_present: true,
    meta_description_present: true,
    canonical_present: true,
    lang_present: true,
    title: `Safe Haven Roofing & Renovations - ${route || "Home"}`,
    canonical: `https://www.safehavenrr.com${route}`,
  }));
  const routeResults = ROUTES.map((route) => ({
    route_id: route,
    schema_errors: 0,
    unsupported_claims: 0,
    failed_requirements: 0,
    repair_attempts: 0,
    generation_calls: 0,
    prose_without_blocks: 0,
    sections: [{ type: "heading", text: "Example section" }],
    section_alias_fields: [],
  }));
  return {
    identity: {
      website_bot: { sha: "a".repeat(40), llm_router_version: "1.1.3", worktree_state: "CLEAN" },
      seo_bot: { sha: "b".repeat(40), llm_router_version: "1.1.3", worktree_state: "CLEAN" },
      llm_router: { sha: "c".repeat(40), package_version: "1.1.3", worktree_state: "CLEAN" },
      bot_interop: { website_bot_version: "3.1.0", seo_bot_version: "2.4.0", compatible: true },
    },
    run: {
      build_intent: "REDESIGN_IMPROVE",
      copy_fallback_used: false,
      generic_fallback_used: false,
      run_id: "golden-run-2026-08-24",
    },
    events: STAGE_EVENTS.map((name) => ({ name })),
    preflight: {
      status: "PASS",
      checks: PREFLIGHT_CHECKS.map((name) => ({ name, status: "PASS" })),
    },
    competitive_landscape: {
      selected_donors: donors,
      evidence_complete: true,
      ranking_llm_calls: 0,
      artifact_ref: "landscape-ref",
    },
    donor_evidence: donorEvidence,
    website_build_blueprint: {
      artifact_ref: "wbb-ref",
      competitive_landscape_ref: "landscape-ref",
      visual_requirements: { hero: ["authentic imagery"], sections: ["gallery"] },
      project_proof_required: false,
      gallery_required: false,
    },
    seo_content_blueprint: {
      routes: [...ROUTES],
      batch_size: 4,
      batch_count: 8,
      competitive_landscape_ref: "landscape-ref",
      unknown_content_slots: 0,
      invalid_internal_link_targets: 0,
    },
    page_content_contract: {
      routes: [...ROUTES],
      artifact_ref: "pcc-ref",
      llm_calls: 0,
      unplaced_requirements: 0,
      invalid_business_facts: 0,
      determinism: { digest_run_1: "semantic-digest-1", digest_run_2: "semantic-digest-1" },
    },
    structured_content: {
      routes: [...ROUTES],
      page_content_contract_ref: "pcc-ref",
      route_results: routeResults,
    },
    legacy: { content_generation_calls: 0, schema_llm_calls: 0, redesign_schema_llm_calls: 0 },
    assets: {
      raw_source_images: 5,
      authorized_reusable_images: 3,
      selected_source_images: 2,
      unexplained_reusable_asset_loss: 0,
      required_visual_slots_filled_fraction: 1,
      donor_asset_hash_matches: 0,
      source_corpus_completed: true,
      candidate_dispositions: ["SOURCE_CLIENT_OWNED", "SOURCE_LICENSED_REUSE", "GENERATED"],
      eligible_source_project_proof_count: 0,
      selected_source_project_proof_count: 0,
      eligible_source_gallery_count: 0,
      selected_source_gallery_count: 0,
    },
    site: {
      routes: [...ROUTES],
      reachable_routes: 29,
      broken_internal_links: 0,
      placeholder_count: 0,
      per_route: perRoute,
    },
    business_truth: {
      unsupported_claim_count: 0,
      phone_mismatch_count: 0,
      email_mismatch_count: 0,
      prohibition_violations: 0,
    },
    llm_audit: {
      direct_provider_bypass_count: 0,
      unsupported_capability_combination_count: 0,
      operations: {
        SEO_CONTENT_BLUEPRINT: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
        STRUCTURED_CONTENT_GENERATION: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
        CONTENT_VALIDATION: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
        VISUAL_QA: [{ searchRequired: false }],
      },
    },
    visual: { pairs: winningPairs() },
  };
}

/* ---------------- 1. weighted mean delta (ORACLE-092) ---------------- */

test("weightedMeanDelta computes sum(mean_delta[d] * weight[d])", () => {
  const totals = new Map([
    ["a", 0.6],
    ["b", 0.4],
  ]);
  assert.ok(Math.abs(weightedMeanDelta(totals, 2, { a: 0.5, b: 0.5 }) - 0.25) < 1e-12);
  assert.ok(Math.abs(weightedMeanDelta(totals, 2, { a: 0.75, b: 0.25 }) - 0.275) < 1e-12);
});

test("weightedMeanDelta returns null when no trial evidence exists", () => {
  assert.equal(weightedMeanDelta(new Map(), 0, { a: 1 }), null);
});

test("weightedMeanDelta respects oracle weight sum; weights are never defaulted", () => {
  const oracleWeights = baseOracle.visual_oracle.dimensions;
  const sum = Object.values(oracleWeights).reduce((a, b) => a + b, 0);
  assert.equal(Math.abs(sum - 1.0), 0, "oracle dimension weights must sum to 1.0");
});

/* ---------------- 2. Wilson boundary crossing (ORACLE-097) ---------------- */

test("wilsonLowerBound: 21/30 strictly exceeds 0.5; 20/30 crosses below", () => {
  assert.ok(wilsonLowerBound(21, 30) > 0.5);
  assert.ok(wilsonLowerBound(20, 30) < 0.5);
  assert.equal(wilsonLowerBound(21, 30).toFixed(4), "0.5212");
  assert.equal(wilsonLowerBound(20, 30).toFixed(4), "0.4878");
});

test("boundary crossing produces a blocking inconclusive state, never a hard FAIL", () => {
  const oracle = tempOracle((copy) => {
    // lower the vote-confidence gate so the Wilson crossing is the only blocker
    copy.visual_oracle.pass.minimum_candidate_votes = 19;
  });
  const receipt = buildPositiveReceipt();
  // 10 pairs each 2/1 candidate -> 20/30 candidate votes, 10 pair majorities, 0 losses
  receipt.visual.pairs = Array.from({ length: 10 }, () =>
    visualPair("/", "desktop", ["CANDIDATE", "CANDIDATE", "BASELINE"]),
  );
  const { result, exitCode } = runVerifier(CASE, tempReceipt(receipt), oracle);
  assert.equal(exitCode, 1, "STRUCTURAL verdict must exit non-zero");
  assert.equal(result.hard_gate_failures.length, 0, "boundary crossing is not a hard FAIL");
  const wilson = result.blocking_inconclusive_states.find((s) => s.code === "VISUAL_WILSON_INTERVAL_INCONCLUSIVE");
  assert.ok(wilson, "Wilson boundary crossing must be recorded as blocking inconclusive");
  assert.equal(result.verdict, "STRUCTURAL_E2E_PASS_VISUAL_UNPROVEN");
});

test("classifyVerdict: GOLDEN requires zero failures AND zero inconclusive states", () => {
  assert.equal(classifyVerdict([], []), "GOLDEN_E2E_PASS_IMPROVED");
  assert.equal(classifyVerdict([], [{ code: "VISUAL_PAIR_NO_MAJORITY" }]), "STRUCTURAL_E2E_PASS_VISUAL_UNPROVEN");
  assert.equal(classifyVerdict([{ code: "BROKEN_INTERNAL_LINKS" }], []), "GOLDEN_E2E_FAIL");
  assert.equal(classifyVerdict([{ code: "BROKEN_INTERNAL_LINKS" }], [{ code: "X" }]), "GOLDEN_E2E_FAIL");
});

/* ---------------- 3. A/B orientation normalizer ---------------- */

test("normalizePreference: raw score maps to CANDIDATE/BASELINE by rendered side", () => {
  assert.equal(normalizePreference(-2, true), "CANDIDATE"); // strongly A/left, candidate on left
  assert.equal(normalizePreference(+2, true), "BASELINE"); // strongly B/right, candidate on left
  assert.equal(normalizePreference(0, true), "TIE");
});

test("normalizePreference: reversing orientation reverses the preference", () => {
  assert.equal(normalizePreference(-2, false), "BASELINE");
  assert.equal(normalizePreference(+2, false), "CANDIDATE");
  assert.equal(normalizePreference(-1, true), "CANDIDATE");
  assert.equal(normalizePreference(-1, false), "BASELINE");
});

test("normalizePreference: non-finite scores are TIE, never a vote", () => {
  assert.equal(normalizePreference(Number.NaN, true), "TIE");
  assert.equal(normalizePreference(undefined, false), "TIE");
});

/* ---------------- 4. critical-pair logic (ORACLE-090/091) ---------------- */

test("criticalPairKey normalizes routes", () => {
  assert.equal(criticalPairKey("/gallery/", "desktop"), "/gallery::desktop");
  assert.equal(criticalPairKey("/", "mobile"), "/::mobile");
});

test("ORACLE-090: losing a critical pair reads the list from oracle.json", () => {
  const oracle = tempOracle((copy) => {
    copy.visual_oracle.pass.critical_pairs_may_not_lose = ["/::desktop"];
  });
  const receipt = buildPositiveReceipt();
  const pairs = winningPairs();
  pairs[0].trials = [trial("BASELINE"), trial("BASELINE"), trial("CANDIDATE")]; // "/::desktop" loses
  receipt.visual.pairs = pairs;
  const { result } = runVerifier(CASE, tempReceipt(receipt), oracle);
  assert.ok(result.hard_gate_failures.some((f) => f.code === "CRITICAL_VISUAL_PAIR_REGRESSED"));
});

test("ORACLE-090: same receipt passes when the oracle no longer lists that pair", () => {
  const oracle = tempOracle((copy) => {
    copy.visual_oracle.pass.critical_pairs_may_not_lose = ["/gallery/::desktop"];
  });
  const receipt = buildPositiveReceipt();
  const pairs = winningPairs();
  pairs[0].trials = [trial("BASELINE"), trial("BASELINE"), trial("CANDIDATE")]; // "/::desktop" loses but is NOT critical here
  receipt.visual.pairs = pairs;
  const { result } = runVerifier(CASE, tempReceipt(receipt), oracle);
  assert.ok(!result.hard_gate_failures.some((f) => f.code === "CRITICAL_VISUAL_PAIR_REGRESSED"));
});

test("ORACLE-090: missing critical-pair oracle config fails closed", () => {
  const oracle = tempOracle((copy) => {
    delete copy.visual_oracle.pass.critical_pairs_may_not_lose;
  });
  const { result } = runVerifier(CASE, tempReceipt(buildPositiveReceipt()), oracle);
  assert.ok(result.hard_gate_failures.some((f) => f.code === "VISUAL_ORACLE_CONFIG_INVALID"));
});

test("ORACLE-091: critical dimension regression is read dynamically", () => {
  const oracle = tempOracle((copy) => {
    copy.visual_oracle.pass.critical_dimensions_may_not_regress = ["visual_hierarchy"];
  });
  const receipt = buildPositiveReceipt();
  receipt.visual.pairs = winningPairs().map((pair) => ({
    ...pair,
    trials: pair.trials.map((t) => ({
      ...t,
      normalized_candidate_delta: { ...t.normalized_candidate_delta, visual_hierarchy: -0.5 },
    })),
  }));
  const { result } = runVerifier(CASE, tempReceipt(receipt), oracle);
  assert.ok(result.hard_gate_failures.some((f) => f.code === "CRITICAL_VISUAL_DIMENSION_REGRESSED"));
});

test("ORACLE-091: dimension no longer critical in oracle does not fire", () => {
  const oracle = tempOracle((copy) => {
    copy.visual_oracle.pass.critical_dimensions_may_not_regress = ["brand_coherence"];
  });
  const receipt = buildPositiveReceipt();
  receipt.visual.pairs = winningPairs().map((pair) => ({
    ...pair,
    trials: pair.trials.map((t) => ({
      ...t,
      normalized_candidate_delta: { ...t.normalized_candidate_delta, visual_hierarchy: -0.5 },
    })),
  }));
  const { result } = runVerifier(CASE, tempReceipt(receipt), oracle);
  assert.ok(!result.hard_gate_failures.some((f) => f.code === "CRITICAL_VISUAL_DIMENSION_REGRESSED"));
});

/* ---------------- 5. multiset route comparison (ORACLE-033) ---------------- */

test("compareRouteMultiset detects a duplicated route (set comparison would not)", () => {
  const { duplicates, missing, extra } = compareRouteMultiset(["/a/", "/a/", "/b/"], ["/a/", "/b/"]);
  assert.deepEqual(duplicates, [["/a", 1]]);
  assert.equal(missing.length, 0);
  assert.equal(extra.length, 0);
});

test("compareRouteMultiset reports missing and extra routes", () => {
  const { missing, extra, duplicates } = compareRouteMultiset(["/a/", "/x/"], ["/a/", "/b/"]);
  assert.deepEqual(missing, [["/b", 1]]);
  assert.deepEqual(extra, [["/x", 1]]);
  assert.equal(duplicates.length, 0);
});

test("ORACLE-033: a duplicated route in the blueprint fails the end-to-end verifier", () => {
  const receipt = buildPositiveReceipt();
  receipt.seo_content_blueprint.routes = ["/", "/", ...ROUTES.slice(1)];
  const { result } = runVerifier(CASE, tempReceipt(receipt), ORACLE);
  assert.ok(result.hard_gate_failures.some((f) => f.code === "SEO_BLUEPRINT_DUPLICATE_ROUTE"));
});

/* ---------------- 6. required-ordered-subsequence (ORACLE-011) ---------------- */

test("orderedSubsequenceViolations: correct order passes including the alias binding", () => {
  const required = baseOracle.execution_graph.required_ordered_subsequence;
  const events = STAGE_EVENTS.map((name) => ({ name }));
  assert.deepEqual(orderedSubsequenceViolations(required, events), []);
});

test("orderedSubsequenceViolations: missing stage is reported", () => {
  const events = STAGE_EVENTS.filter((name) => name !== "site-build").map((name) => ({ name }));
  const violations = orderedSubsequenceViolations(baseOracle.execution_graph.required_ordered_subsequence, events);
  const missing = violations.find((v) => v.code === "REQUIRED_STAGE_MISSING");
  assert.ok(missing, "missing stage must be reported");
  assert.equal(missing.stage, "site-build");
  assert.equal(missing.expectedEventName, "site-build");
});

test("orderedSubsequenceViolations: reordered stage is reported", () => {
  const events = [...STAGE_EVENTS];
  const idxBuild = events.indexOf("site-build");
  const idxAssembler = events.indexOf("site-assembler");
  events[idxBuild] = "site-assembler";
  events[idxAssembler] = "site-build";
  const violations = orderedSubsequenceViolations(baseOracle.execution_graph.required_ordered_subsequence, events.map((name) => ({ name })));
  const reordered = violations.find((v) => v.code === "REQUIRED_STAGE_ORDER_VIOLATION");
  assert.ok(reordered, "reordered stage must be reported");
  assert.equal(reordered.stage, "site-build");
});

test("orderedSubsequenceViolations: stage alias binds to the runtime event name", () => {
  const required = ["seo-build-intelligence-preflight"];
  const events = [{ name: "seo-build-intelligence-preflight:PASS" }];
  assert.deepEqual(orderedSubsequenceViolations(required, events), []);
});

test("ORACLE-011: dropping a required stage fails the end-to-end verifier", () => {
  const receipt = buildPositiveReceipt();
  receipt.events = STAGE_EVENTS.filter((name) => name !== "site-build").map((name) => ({ name }));
  const { result } = runVerifier(CASE, tempReceipt(receipt), ORACLE);
  assert.ok(result.hard_gate_failures.some((f) => f.code === "REQUIRED_STAGE_MISSING"));
});

test("ORACLE-012: forbidden stage under redesign fails the end-to-end verifier", () => {
  const receipt = buildPositiveReceipt();
  receipt.events = [...STAGE_EVENTS.map((name) => ({ name })), { name: "content-generation" }];
  const { result } = runVerifier(CASE, tempReceipt(receipt), ORACLE);
  assert.ok(result.hard_gate_failures.some((f) => f.code === "FORBIDDEN_REDESIGN_STAGE_EXECUTED"));
});

/* ---------------- positive control + determinism ---------------- */

test("positive-control receipt reaches GOLDEN_E2E_PASS_IMPROVED with exit 0", () => {
  const { result, exitCode } = runVerifier(CASE, tempReceipt(buildPositiveReceipt()), ORACLE);
  assert.equal(exitCode, 0);
  assert.equal(result.verdict, "GOLDEN_E2E_PASS_IMPROVED");
  assert.equal(result.hard_gate_failures.length, 0);
  assert.equal(result.blocking_inconclusive_states.length, 0);
  assert.equal(result.metrics.candidate_visual_votes, 28);
  assert.ok(Math.abs(result.metrics.visual_weighted_mean_delta - 0.4) < 1e-9);
  assert.ok(result.metrics.visual_wilson_lower_bound > 0.5);
});

test("determinism replay: identical semantic output across two runs", () => {
  const receiptPath = tempReceipt(buildPositiveReceipt());
  const first = runVerifier(CASE, receiptPath, ORACLE).result;
  const second = runVerifier(CASE, receiptPath, ORACLE).result;
  const strip = (r) => {
    const copy = structuredClone(r);
    delete copy.evaluated_at;
    return copy;
  };
  assert.deepEqual(strip(first), strip(second));
});

test("ORACLE-092/093: missing dimension config is blocking INCONCLUSIVE, not a hard FAIL", () => {
  const oracle = tempOracle((copy) => {
    delete copy.visual_oracle.dimensions;
  });
  const { result } = runVerifier(CASE, tempReceipt(buildPositiveReceipt()), oracle);
  assert.equal(result.hard_gate_failures.length, 0);
  const codes = result.blocking_inconclusive_states.map((s) => s.code);
  assert.ok(codes.includes("VISUAL_DIMENSION_MISSING"));
  assert.ok(codes.includes("VISUAL_WEIGHTED_MEAN_DELTA_INSUFFICIENT"));
  assert.equal(result.verdict, "STRUCTURAL_E2E_PASS_VISUAL_UNPROVEN");
});
