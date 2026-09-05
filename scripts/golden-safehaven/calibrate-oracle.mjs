#!/usr/bin/env node
/**
 * §22–§24 ORACLE CALIBRATION.
 *
 *   1. Positive control: a fully synthetic reference receipt must be ACCEPTED
 *      (prevents an oracle that trivially rejects everything).
 *   2. Negative controls: all 25 mutations of negative-controls.json must be
 *      REJECTED by the SAME production verifier (prevents an oracle that
 *      trivially accepts everything), with the expected semantic failure
 *      observed where practicable.
 *   3. Deterministic replay: two verifier runs over identical inputs produce
 *      identical semantic verdicts/failures/inconclusive states/metrics
 *      (timestamps excluded). No LLM participates anywhere here.
 *
 * Outputs (into --out):
 *   positive-control-receipt.json
 *   negative-control-results.json
 *   determinism.json
 *
 * Exit 0 iff: positive accepted, 25/25 rejected, false_acceptance_count == 0,
 * determinism holds.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");

const casePath = path.resolve(ROOT, "tests/golden/safehaven/case.json");
const oraclePath = path.resolve(ROOT, "tests/golden/safehaven/oracle.json");
const ncPath = path.resolve(ROOT, "tests/golden/safehaven/negative-controls.json");
// CLI-controlled paths are canonicalized and then validated against the
// repository root before any read/write, so a crafted argument cannot
// escape the checkout.
function resolveUnder(root, candidate) {
  const resolved = path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing path outside repository root: ${candidate}`);
  }
  return resolved;
}
const outDir = resolveUnder(ROOT, process.argv[2] ?? "tests/golden/safehaven/calibration");

const { runVerifier } = await import(path.resolve(ROOT, "scripts/verify-safehaven-golden.mjs"));

const CASE = JSON.parse(fs.readFileSync(casePath, "utf8"));
const ORACLE = JSON.parse(fs.readFileSync(oraclePath, "utf8"));
const NC_SPEC = JSON.parse(fs.readFileSync(ncPath, "utf8"));

const ROUTES = CASE.routes;
const DIMENSIONS = Object.keys(ORACLE.visual_oracle.dimensions);
const PREFLIGHT_CHECKS = ORACLE.preflight.required_checks;
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

/** Positive control — a synthetic receipt that MUST satisfy the full oracle. */
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
    title: `Safe Haven Roofing & Renovations - ${route || "Home"} - ${i}`,
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

  const trial = (preference, deltaValue = 0.4) => {
    const delta = {};
    for (const d of DIMENSIONS) delta[d] = deltaValue;
    return {
      blind: true,
      judge_input_manifest: "homepage render pair; left-right order randomized",
      normalized_preference: preference,
      normalized_candidate_delta: delta,
    };
  };
  const visualPair = (route, viewport, prefs) => ({
    route,
    viewport,
    candidate_blank: false,
    baseline_blank: false,
    route_match: true,
    viewport_match: true,
    captured_run_id: "golden-run-2026-08-24",
    trials: prefs.map((p) => trial(p)),
  });
  const pairs = [];
  for (const [route, viewport] of [
    ["/", "desktop"], ["/", "mobile"],
    ["/services/roof-replacement/", "desktop"], ["/services/storm-damage/", "mobile"],
    ["/gallery/", "desktop"], ["/gallery/", "mobile"],
    ["/contact/", "desktop"], ["/contact/", "mobile"],
  ]) pairs.push(visualPair(route, viewport, ["CANDIDATE", "CANDIDATE", "CANDIDATE"]));
  // Two split-vote pairs on the same route/viewport, pushed together
  // (javascript:S7778).
  pairs.push(
    visualPair("/", "desktop", ["CANDIDATE", "CANDIDATE", "BASELINE"]),
    visualPair("/", "desktop", ["CANDIDATE", "CANDIDATE", "BASELINE"]),
  );

  return {
    identity: {
      website_bot: { sha: "a".repeat(40), llm_router_version: "1.1.3", worktree_state: "CLEAN" },
      seo_bot: { sha: "b".repeat(40), llm_router_version: "1.1.3", worktree_state: "CLEAN" },
      llm_router: { sha: "c".repeat(40), package_version: "1.1.3", worktree_state: "CLEAN" },
      bot_interop: { website_bot_version: "3.1.0", seo_bot_version: "2.4.0", compatible: true },
    },
    run: { build_intent: "REDESIGN_IMPROVE", copy_fallback_used: false, generic_fallback_used: false, run_id: "golden-run-2026-08-24" },
    events: STAGE_EVENTS.map((name) => ({ name })),
    preflight: { status: "PASS", checks: PREFLIGHT_CHECKS.map((name) => ({ name, status: "PASS" })) },
    competitive_landscape: { selected_donors: donors, evidence_complete: true, ranking_llm_calls: 0, artifact_ref: "landscape-ref" },
    donor_evidence: donorEvidence,
    website_build_blueprint: {
      artifact_ref: "wbb-ref",
      competitive_landscape_ref: "landscape-ref",
      visual_requirements: { hero: ["authentic imagery"], sections: ["gallery"] },
      project_proof_required: false,
      gallery_required: false,
    },
    seo_content_blueprint: { routes: [...ROUTES], batch_size: 4, batch_count: 8, competitive_landscape_ref: "landscape-ref", unknown_content_slots: 0, invalid_internal_link_targets: 0 },
    page_content_contract: { routes: [...ROUTES], artifact_ref: "pcc-ref", llm_calls: 0, unplaced_requirements: 0, invalid_business_facts: 0, determinism: { digest_run_1: "semantic-digest-1", digest_run_2: "semantic-digest-1" } },
    structured_content: { routes: [...ROUTES], page_content_contract_ref: "pcc-ref", route_results: routeResults },
    legacy: { content_generation_calls: 0, schema_llm_calls: 0, redesign_schema_llm_calls: 0 },
    assets: {
      raw_source_images: 5, authorized_reusable_images: 3, selected_source_images: 2,
      unexplained_reusable_asset_loss: 0, required_visual_slots_filled_fraction: 1, donor_asset_hash_matches: 0,
      source_corpus_completed: true,
      candidate_dispositions: ["SOURCE_CLIENT_OWNED", "SOURCE_LICENSED_REUSE", "GENERATED"],
      eligible_source_project_proof_count: 0, selected_source_project_proof_count: 0,
      eligible_source_gallery_count: 0, selected_source_gallery_count: 0,
    },
    site: { routes: [...ROUTES], reachable_routes: 29, broken_internal_links: 0, placeholder_count: 0, per_route: perRoute },
    business_truth: { unsupported_claim_count: 0, phone_mismatch_count: 0, email_mismatch_count: 0, prohibition_violations: 0 },
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
    visual: { pairs },
  };
}

/**
 * Mutation registry — one deterministic mutation per negative control.
 * Returns a mutated clone; expected codes are asserted against the result.
 */
const MUTATIONS = {
  "NC-01": (r) => { r.competitive_landscape.selected_donors = r.competitive_landscape.selected_donors.slice(0, 9); },
  "NC-02": (r) => { r.competitive_landscape.selected_donors[1].normalized_domain = r.competitive_landscape.selected_donors[0].normalized_domain; },
  "NC-03": (r) => { r.competitive_landscape.selected_donors[0].class = "directory"; },
  "NC-04": (r) => { r.donor_evidence[0].screenshots = 0; },
  "NC-05": (r) => {
    const preflight = r.events.findIndex((e) => e.name === "seo-build-intelligence-preflight:PASS");
    r.events.splice(preflight, 1);
    r.events.splice(4, 0, { name: "seo-build-intelligence-preflight:PASS" });
  },
  "NC-06": (r) => { r.seo_content_blueprint.routes = ROUTES.slice(0, 28); },
  "NC-07": (r) => { r.seo_content_blueprint.routes = [...ROUTES, "/unknown-route/"]; },
  "NC-08": (r) => { r.website_build_blueprint.competitive_landscape_ref = "other-landscape-ref"; },
  "NC-09": (r) => { r.page_content_contract.llm_calls = 1; },
  "NC-10": (r) => { r.structured_content.page_content_contract_ref = "pcc-ref-X"; },
  "NC-11": (r) => { r.structured_content.route_results[0].sections = [{ content: "raw prose without blocks" }]; r.structured_content.route_results[0].section_alias_fields = ["content"]; r.structured_content.route_results[0].prose_without_blocks = 1; },
  "NC-12": (r) => { r.structured_content.route_results[0].repair_attempts = 2; },
  "NC-13": (r) => { r.legacy.content_generation_calls = 1; },
  "NC-14": (r) => { r.legacy.redesign_schema_llm_calls = 1; },
  "NC-15": (r) => {
    r.website_build_blueprint.project_proof_required = true;
    r.assets.eligible_source_project_proof_count = 2;
    r.assets.selected_source_project_proof_count = 0;
    r.assets.rejected_source_project_proof = [];
  },
  "NC-16": (r) => { r.assets.donor_asset_hash_matches = 1; },
  "NC-17": (r) => { r.identity.seo_bot.llm_router_version = "9.9.9"; },
  "NC-18": (r) => { r.llm_audit.operations.CONTENT_VALIDATION[0].searchRequired = true; },
  "NC-19": (r) => { r.visual.pairs = r.visual.pairs.slice(0, 9); },
  "NC-20": (r) => {
    r.visual.pairs = [
      visualPairSpec("/", "desktop", ["CANDIDATE", "CANDIDATE", "CANDIDATE"]),
      visualPairSpec("/", "mobile", ["CANDIDATE", "CANDIDATE", "CANDIDATE"]),
      visualPairSpec("/services/roof-replacement/", "desktop", ["CANDIDATE", "CANDIDATE", "CANDIDATE"]),
      visualPairSpec("/services/storm-damage/", "mobile", ["CANDIDATE", "CANDIDATE", "CANDIDATE"]),
      visualPairSpec("/gallery/", "desktop", ["CANDIDATE", "CANDIDATE", "CANDIDATE"]),
      visualPairSpec("/gallery/", "mobile", ["CANDIDATE", "CANDIDATE", "CANDIDATE"]),
      ...["/contact/::desktop", "/contact/::mobile", "/::desktop", "/::desktop"].map((k) => {
        const [route, viewport] = k.split("::");
        return visualPairSpec(route, viewport, ["BASELINE", "BASELINE", "BASELINE"]);
      }),
    ];
  },
  "NC-21": (r) => { const p = r.visual.pairs.find((x) => x.route === "/" && x.viewport === "mobile"); p.trials = [trialSpec("BASELINE"), trialSpec("BASELINE"), trialSpec("BASELINE")]; },
  "NC-22": (r) => { for (const p of r.visual.pairs) for (const t of p.trials) t.normalized_candidate_delta.visual_hierarchy = -0.4; },
  "NC-23": (r) => {
    r.business_truth.unsupported_claim_count = 1;
    r.business_truth.prohibition_violations = 1;
    r.structured_content.route_results[0].unsupported_claims = 1;
  },
  "NC-24": (r) => { r.site.reachable_routes = 28; },
  "NC-25": (r) => { r.site.reachable_routes = 28; },
};

function trialSpec(preference, deltaValue = 0.4) {
  const delta = {};
  for (const d of DIMENSIONS) delta[d] = deltaValue;
  return { blind: true, judge_input_manifest: "render pair; left-right order randomized", normalized_preference: preference, normalized_candidate_delta: delta };
}
function visualPairSpec(route, viewport, prefs) {
  return { route, viewport, candidate_blank: false, baseline_blank: false, route_match: true, viewport_match: true, captured_run_id: "golden-run-2026-08-24", trials: prefs.map((p) => trialSpec(p)) };
}

const EXPECTED_CODES = {
  "NC-01": ["COMPETITIVE_EVIDENCE_INCOMPLETE"],
  "NC-02": ["DUPLICATE_DONOR_DOMAIN"],
  "NC-03": ["FORBIDDEN_DONOR_CLASS"],
  "NC-04": ["DONOR_SCREENSHOT_INCOMPLETE"],
  "NC-05": ["SEO_PREFLIGHT_TOO_LATE"],
  "NC-06": ["ROUTE_SET_MISMATCH"],
  "NC-07": ["ROUTE_SET_MISMATCH"],
  "NC-08": ["WEBSITE_BLUEPRINT_LANDSCAPE_MISMATCH", "SEO_BLUEPRINT_LANDSCAPE_MISMATCH"],
  "NC-09": ["PCC_LLM_USED"],
  "NC-10": ["STRUCTURED_CONTENT_LINEAGE_MISMATCH"],
  "NC-11": ["STRUCTURED_CONTENT_FORBIDDEN_SECTION_ALIAS", "STRUCTURED_CONTENT_BLOCKS_REQUIRED"],
  "NC-12": ["CONTENT_REPAIR_BUDGET_EXCEEDED"],
  "NC-13": ["LEGACY_CONTENT_AUTHORITY_USED"],
  "NC-14": ["REDESIGN_SCHEMA_LLM_AUTHORITY_VIOLATION"],
  "NC-15": ["REQUIRED_SOURCE_PROJECT_PROOF_NOT_SELECTED"],
  "NC-16": ["DONOR_ASSET_REUSED"],
  "NC-17": ["ROUTER_VERSION_MISMATCH"],
  "NC-18": ["UNEXPECTED_SEARCH_ROUTING"],
  "NC-19": ["VISUAL_CAPTURE_INCOMPLETE"],
  "NC-20": ["VISUAL_IMPROVEMENT_INSUFFICIENT", "VISUAL_VOTE_CONFIDENCE_INSUFFICIENT"],
  "NC-21": ["CRITICAL_VISUAL_PAIR_REGRESSED"],
  "NC-22": ["CRITICAL_VISUAL_DIMENSION_REGRESSED"],
  "NC-23": ["UNSUPPORTED_BUSINESS_CLAIM", "BUSINESS_PROHIBITION_VIOLATION", "UNSUPPORTED_CONTENT_CLAIM"],
  "NC-24": ["SITE_REACHABILITY_INCOMPLETE"],
  "NC-25": ["SITE_REACHABILITY_INCOMPLETE"],
};

function tempReceipt(receipt, tag) {
  const p = path.join(outDir, `._tmp-${tag}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(receipt));
  return p;
}

fs.mkdirSync(outDir, { recursive: true });

const results = [];
let falseAcceptances = 0;

// ---- 1. Positive control ------------------------------------------------
const positive = buildPositiveReceipt();
const positivePath = path.join(outDir, "positive-control-receipt.json");
fs.writeFileSync(positivePath, JSON.stringify(positive, null, 2));
const positiveRun = runVerifier(casePath, positivePath, oraclePath);
if (positiveRun.exitCode !== 0 || positiveRun.result.verdict !== "GOLDEN_E2E_PASS_IMPROVED") {
  console.error("POSITIVE CONTROL REJECTED — ORACLE_FALSE_REJECTION");
  console.error(JSON.stringify(positiveRun.result, null, 2).slice(0, 2000));
  process.exit(1);
}
console.log(`positive control: ACCEPTED (${positiveRun.result.verdict}, exit ${positiveRun.exitCode})`);

// ---- 2. Negative controls ------------------------------------------------
for (const spec of NC_SPEC.required_mutations) {
  const mutated = structuredClone(buildPositiveReceipt());
  const mutate = MUTATIONS[spec.id];
  if (!mutate) { results.push({ id: spec.id, applied: false, note: "no mutator defined" }); continue; }
  mutate(mutated);
  const p = tempReceipt(mutated, `nc-${spec.id}`);
  const run = runVerifier(casePath, p, oraclePath);
  fs.rmSync(p, { force: true });
  const failures = run.result.hard_gate_failures ?? [];
  const codes = failures.map((f) => f.code);
  const expected = EXPECTED_CODES[spec.id] ?? [];
  const semanticHit = expected.filter((c) => codes.includes(c));
  const rejected = run.exitCode !== 0 && failures.length > 0;
  if (!rejected) falseAcceptances += 1;
  results.push({
    id: spec.id,
    reason: spec.reason,
    expected: spec.expected,
    rejected,
    exit_code: run.exitCode,
    observed_codes: codes,
    expected_semantic_hit: semanticHit,
    semantic_ok: semanticHit.length > 0,
    verdict: run.result.verdict,
  });
  console.log(`  ${spec.id}: ${rejected ? "REJECTED" : "FALSE_ACCEPTANCE"} codes=${codes.join(",") || "-"} semantic=${semanticHit.join(",") || "MISS"}`);
}

const negativeRun = results.filter((r) => r.rejected).length;
const summary = {
  schema: "l9.golden-oracle-negative-control-results/v1",
  negative_controls_run: results.length,
  negative_controls_rejected: negativeRun,
  false_acceptance_count: falseAcceptances,
  semantic_misses: results.filter((r) => r.rejected && !r.semantic_ok).map((r) => r.id),
  results,
};
fs.writeFileSync(path.join(outDir, "negative-control-results.json"), `${JSON.stringify(summary, null, 2)}\n`);

// ---- 3. Deterministic replay ---------------------------------------------
const run1 = runVerifier(casePath, positivePath, oraclePath);
const run2 = runVerifier(casePath, positivePath, oraclePath);
const strip = (r) => {
  const c = structuredClone(r.result);
  for (const f of c.hard_gate_failures ?? []) delete f.timestamp;
  delete c.evaluated_at;
  return c;
};
const d1 = JSON.stringify(strip(run1));
const d2 = JSON.stringify(strip(run2));
const deterministic = d1 === d2;
fs.writeFileSync(path.join(outDir, "determinism.json"), `${JSON.stringify({ schema: "l9.golden-oracle-determinism/v1", deterministic, run1_exit: run1.exitCode, run2_exit: run2.exitCode }, null, 2)}\n`);
console.log(`deterministic replay: ${deterministic ? "IDENTICAL" : "DIVERGED"} (exit ${run1.exitCode} / ${run2.exitCode})`);

const ok = positiveRun.exitCode === 0 && summary.negative_controls_run === 25 && summary.negative_controls_rejected === 25 && falseAcceptances === 0 && deterministic;
console.log(`\nCALIBRATION: ${ok ? "COMPLETE" : "FAILED"} — run=${summary.negative_controls_run} rejected=${summary.negative_controls_rejected} falseAccepts=${falseAcceptances} determinism=${deterministic}`);
process.exit(ok ? 0 : 1);
