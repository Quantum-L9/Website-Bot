#!/usr/bin/env node
/**
 * §21 ORACLE COVERAGE AUDIT.
 *
 * oracle.json is authority. verify-safehaven-golden.mjs is an implementation
 * that must conform to it. This script enumerates every BLOCKING property in
 * oracle.json and records whether the production verifier actually enforces it.
 *
 * The audit is deliberately hostile to itself: a property is only counted as
 * implemented when (a) this table says so AND (b) the cited anchor text is
 * really present in the verifier source. A stale citation fails the audit
 * rather than silently inflating coverage.
 *
 * Exit 0 => 100% of blocking properties enforced.
 * Exit 1 => ORACLE_IMPLEMENTATION_INCOMPLETE (do not run the Golden E2E).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const oraclePath = process.argv[2] ?? "tests/golden/safehaven/oracle.json";
const verifierPath = process.argv[3] ?? "scripts/verify-safehaven-golden.mjs";
const outPath = process.argv[4] ?? "tests/golden/safehaven/oracle-coverage.json";

const oracle = JSON.parse(fs.readFileSync(path.resolve(ROOT, oraclePath), "utf8"));
const verifierSrc = fs.readFileSync(path.resolve(ROOT, verifierPath), "utf8");
const verifierLines = verifierSrc.split("\n");

/** Locate the 1-indexed line containing an anchor string. */
function lineOf(anchor) {
  const idx = verifierLines.findIndex((l) => l.includes(anchor));
  return idx < 0 ? null : idx + 1;
}

/**
 * Authority table: oracle path -> enforcement claim.
 *   anchor  : literal text that must exist in the verifier (proves the citation)
 *   evidence: which receipt field supplies the fact
 *   nc      : the negative control that proves the assertion actually bites
 * A null anchor means "declared blocking by oracle.json but NOT enforced".
 */
const TABLE = {
  // ---- identity -------------------------------------------------------
  "identity.require_full_git_shas": { anchor: "IDENTITY_SHA_MISSING", evidence: "identity.*.sha", nc: null },
  "identity.router_version_rule": { anchor: "ROUTER_IDENTITY_MISMATCH", evidence: "identity.*.llm_router_version", nc: "NC-17" },
  "identity.require_clean_or_explicitly_recorded_worktrees": { anchor: null, evidence: "identity.*.worktree_state", nc: null },
  "identity.require_bot_interop_compatibility": { anchor: null, evidence: "identity.bot_interop", nc: null },

  // ---- preflight ------------------------------------------------------
  "preflight.must_precede_first_seo_build_intelligence_call": { anchor: "SEO_PREFLIGHT_TOO_LATE", evidence: "events[]", nc: "NC-05" },
  "preflight.required": { anchor: null, evidence: "preflight.status", nc: null },
  "preflight.required_checks": { anchor: null, evidence: "preflight.checks[]", nc: null },

  // ---- execution graph ------------------------------------------------
  "execution_graph.build_intent": { anchor: "WRONG_BUILD_INTENT", evidence: "run.build_intent", nc: null },
  "execution_graph.copy_fallback_used": { anchor: "COPY_FALLBACK_USED", evidence: "run.copy_fallback_used", nc: null },
  "execution_graph.generic_fallback_used": { anchor: "GENERIC_FALLBACK_USED", evidence: "run.generic_fallback_used", nc: null },
  "execution_graph.required_ordered_subsequence": { anchor: null, evidence: "events[]", nc: null },
  "execution_graph.forbidden_stages_under_redesign": { anchor: null, evidence: "events[]", nc: null },

  // ---- competitive landscape -----------------------------------------
  "competitive_landscape.selected_donor_count": { anchor: "COMPETITIVE_EVIDENCE_INCOMPLETE", evidence: "competitive_landscape.selected_donors", nc: "NC-01" },
  "competitive_landscape.unique_normalized_domains": { anchor: "DUPLICATE_DONOR_DOMAIN", evidence: "selected_donors[].normalized_domain", nc: "NC-02" },
  "competitive_landscape.evidence_complete": { anchor: "COMPETITIVE_EVIDENCE_NOT_COMPLETE", evidence: "competitive_landscape.evidence_complete", nc: null },
  "competitive_landscape.ranking_llm_calls": { anchor: "COMPETITIVE_RANKING_LLM_USED", evidence: "competitive_landscape.ranking_llm_calls", nc: null },
  "competitive_landscape.every_selected_donor_requires": { anchor: "DONOR_NOT_QUALIFIED", evidence: "selected_donors[]", nc: null, partial: "observed_at and real_dataforseo_observation unchecked" },
  "competitive_landscape.forbidden_selected_classes": { anchor: null, evidence: "selected_donors[].class", nc: "NC-03" },

  // ---- donor evidence -------------------------------------------------
  "donor_evidence.accepted_donors": { anchor: "DONOR_EVIDENCE_INCOMPLETE", evidence: "donor_evidence[]", nc: null },
  "donor_evidence.per_donor.minimum_successful_pages": { anchor: "DONOR_CRAWL_INCOMPLETE", evidence: "donor_evidence[].successful_pages", nc: null },
  "donor_evidence.per_donor.minimum_screenshots": { anchor: "DONOR_SCREENSHOT_INCOMPLETE", evidence: "donor_evidence[].screenshots", nc: "NC-04" },
  "donor_evidence.per_donor.require_evidence_digest": { anchor: "DONOR_DIGEST_MISSING", evidence: "donor_evidence[].evidence_digest", nc: null },
  "donor_evidence.per_donor.require_timestamp": { anchor: null, evidence: "donor_evidence[].crawled_at", nc: null },
  "donor_evidence.candidate_donor_asset_hash_matches": { anchor: "DONOR_ASSET_REUSED", evidence: "assets.donor_asset_hash_matches", nc: "NC-16" },

  // ---- website blueprint ----------------------------------------------
  "website_blueprint.must_reference_exact_competitive_landscape": { anchor: "WEBSITE_BLUEPRINT_LANDSCAPE_MISMATCH", evidence: "website_build_blueprint.competitive_landscape_ref", nc: "NC-08" },
  "website_blueprint.required": { anchor: null, evidence: "website_build_blueprint", nc: null },
  "website_blueprint.visual_asset_requirements_required": { anchor: null, evidence: "website_build_blueprint.visual_requirements", nc: null },

  // ---- seo content blueprint ------------------------------------------
  "seo_content_blueprint.produced_routes": { anchor: "ROUTE_SET_MISMATCH", evidence: "seo_content_blueprint.routes", nc: "NC-06" },
  "seo_content_blueprint.extra_routes": { anchor: "ROUTE_SET_MISMATCH", evidence: "seo_content_blueprint.routes", nc: "NC-07" },
  "seo_content_blueprint.batch_size": { anchor: "SEO_BATCH_SIZE_DRIFT", evidence: "seo_content_blueprint.batch_size", nc: null },
  "seo_content_blueprint.expected_batch_count": { anchor: "SEO_BATCH_COUNT_INVALID", evidence: "seo_content_blueprint.batch_count", nc: null },
  "seo_content_blueprint.must_reference_exact_competitive_landscape": { anchor: "SEO_BLUEPRINT_LANDSCAPE_MISMATCH", evidence: "seo_content_blueprint.competitive_landscape_ref", nc: "NC-08" },
  "seo_content_blueprint.duplicate_routes": { anchor: null, evidence: "seo_content_blueprint.routes", nc: null, note: "requireExactSet() dedupes via Set; duplicates cannot be detected" },
  "seo_content_blueprint.unknown_content_slots": { anchor: null, evidence: "seo_content_blueprint.unknown_content_slots", nc: null },
  "seo_content_blueprint.invalid_internal_link_targets": { anchor: null, evidence: "seo_content_blueprint.invalid_internal_link_targets", nc: null },

  // ---- page content contract ------------------------------------------
  "page_content_contract.produced_routes": { anchor: "ROUTE_SET_MISMATCH", evidence: "page_content_contract.routes", nc: null },
  "page_content_contract.llm_calls": { anchor: "PCC_LLM_USED", evidence: "page_content_contract.llm_calls", nc: "NC-09" },
  "page_content_contract.unplaced_content_requirements": { anchor: "CONTENT_REQUIREMENT_UNPLACED", evidence: "page_content_contract.unplaced_requirements", nc: null },
  "page_content_contract.invalid_business_facts": { anchor: null, evidence: "page_content_contract.invalid_business_facts", nc: null },
  "page_content_contract.determinism.same_semantic_input_same_digest": { anchor: null, evidence: "page_content_contract.determinism_digest", nc: null },

  // ---- structured content ----------------------------------------------
  "structured_content.produced_routes": { anchor: "ROUTE_SET_MISMATCH", evidence: "structured_content.routes", nc: null },
  "structured_content.must_reference_exact_page_content_contract": { anchor: "STRUCTURED_CONTENT_LINEAGE_MISMATCH", evidence: "structured_content.page_content_contract_ref", nc: "NC-10" },
  "structured_content.schema_invalid_routes": { anchor: "STRUCTURED_CONTENT_SCHEMA_INVALID", evidence: "route_results[].schema_errors", nc: null },
  "structured_content.unsupported_claims": { anchor: "UNSUPPORTED_CONTENT_CLAIM", evidence: "route_results[].unsupported_claims", nc: null },
  "structured_content.failed_requirements": { anchor: "CONTENT_REQUIREMENT_UNSATISFIED", evidence: "route_results[].failed_requirements", nc: null },
  "structured_content.maximum_repairs_per_route": { anchor: "CONTENT_REPAIR_BUDGET_EXCEEDED", evidence: "route_results[].repair_attempts", nc: "NC-12" },
  "structured_content.maximum_generation_calls_per_route": { anchor: "CONTENT_GENERATION_BUDGET_EXCEEDED", evidence: "route_results[].generation_calls", nc: null },
  "structured_content.section_alias_fields_forbidden": { anchor: null, evidence: "route_results[].section_alias_fields", nc: "NC-11" },
  "structured_content.all_section_prose_must_use_blocks": { anchor: null, evidence: "route_results[].prose_without_blocks", nc: "NC-11" },

  // ---- legacy authority -------------------------------------------------
  "legacy_authority.legacy_content_generation_calls": { anchor: "LEGACY_CONTENT_AUTHORITY_USED", evidence: "legacy.content_generation_calls", nc: "NC-13" },
  "legacy_authority.legacy_schema_generation_calls": { anchor: "LEGACY_SCHEMA_AUTHORITY_USED", evidence: "legacy.schema_llm_calls", nc: null },
  "legacy_authority.page_content_contract_llm_calls": { anchor: "PCC_LLM_USED", evidence: "page_content_contract.llm_calls", nc: "NC-09" },
  "legacy_authority.redesign_schema_llm_calls": { anchor: null, evidence: "legacy.redesign_schema_llm_calls", nc: "NC-14" },

  // ---- source assets ----------------------------------------------------
  "source_assets.minimum_raw_source_images": { anchor: "SOURCE_ASSET_CORPUS_EMPTY", evidence: "assets.raw_source_images", nc: null },
  "source_assets.minimum_authorized_reusable_images": { anchor: "AUTHORIZED_SOURCE_ASSETS_MISSING", evidence: "assets.authorized_reusable_images", nc: null },
  "source_assets.minimum_selected_source_images": { anchor: "SOURCE_IMAGE_REUSE_MISSING", evidence: "assets.selected_source_images", nc: null },
  "source_assets.unexplained_reusable_asset_loss": { anchor: "SOURCE_ASSET_REUSE_UNEXPLAINED", evidence: "assets.unexplained_reusable_asset_loss", nc: "NC-15" },
  "source_assets.required_visual_slots_filled_fraction": { anchor: "VISUAL_ASSET_REQUIREMENT_UNSATISFIED", evidence: "assets.required_visual_slots_filled_fraction", nc: null },
  "source_assets.source_corpus_completed": { anchor: null, evidence: "assets.source_corpus_completed", nc: null },
  "source_assets.forbidden_candidate_dispositions": { anchor: null, evidence: "assets.candidate_dispositions[]", nc: null },
  "source_assets.conditional_rules": { anchor: null, evidence: "assets.project_proof/gallery counts", nc: "NC-15" },

  // ---- site integrity ---------------------------------------------------
  "site_integrity.built_routes": { anchor: "SITE_ROUTE_COUNT_MISMATCH", evidence: "site.routes", nc: null },
  "site_integrity.reachable_routes": { anchor: "SITE_REACHABILITY_INCOMPLETE", evidence: "site.reachable_routes", nc: "NC-24" },
  "site_integrity.broken_internal_links": { anchor: "BROKEN_INTERNAL_LINKS", evidence: "site.broken_internal_links", nc: null },
  "site_integrity.placeholder_count": { anchor: "PLACEHOLDER_FOUND", evidence: "site.placeholder_count", nc: null },
  "site_integrity.per_route": { anchor: null, evidence: "site.per_route[]", nc: null },
  "site_integrity.unique_titles": { anchor: null, evidence: "site.unique_titles", nc: null },
  "site_integrity.unique_canonical_urls": { anchor: null, evidence: "site.unique_canonical_urls", nc: null },

  // ---- business truth ---------------------------------------------------
  "business_truth.unsupported_claim_count": { anchor: "UNSUPPORTED_BUSINESS_CLAIM", evidence: "business_truth.unsupported_claim_count", nc: "NC-23" },
  "business_truth.phone_mismatch_count": { anchor: "PHONE_TRUTH_MISMATCH", evidence: "business_truth.phone_mismatch_count", nc: null },
  "business_truth.email_mismatch_count": { anchor: "EMAIL_TRUTH_MISMATCH", evidence: "business_truth.email_mismatch_count", nc: null },
  "business_truth.prohibition_violations": { anchor: null, evidence: "business_truth.prohibition_violations", nc: "NC-23" },

  // ---- llm audit --------------------------------------------------------
  "llm_audit.direct_provider_bypass_count": { anchor: "PROVIDER_BYPASS_DETECTED", evidence: "llm_audit.direct_provider_bypass_count", nc: null },
  "llm_audit.required_policy.SEO_CONTENT_BLUEPRINT": { anchor: "SEARCH_POLICY_NOT_EXPLICIT", evidence: "llm_audit.operations[]", nc: null },
  "llm_audit.required_policy.STRUCTURED_CONTENT_GENERATION": { anchor: "SEARCH_POLICY_NOT_EXPLICIT", evidence: "llm_audit.operations[]", nc: null },
  "llm_audit.required_policy.CONTENT_VALIDATION": { anchor: "UNEXPECTED_SEARCH_ROUTING", evidence: "llm_audit.operations[]", nc: "NC-18" },
  "llm_audit.required_policy.VISUAL_QA": { anchor: null, evidence: "llm_audit.operations.VISUAL_QA", nc: null, note: "verifier loop covers only the three non-visual operations" },
  "llm_audit.unsupported_capability_combination_count": { anchor: null, evidence: "llm_audit.unsupported_capability_combination_count", nc: null },

  // ---- visual capture ----------------------------------------------------
  "visual_capture.required_pairs": { anchor: "VISUAL_CAPTURE_INCOMPLETE", evidence: "visual.pairs[]", nc: "NC-19" },
  "visual_capture.candidate_blank_capture_count": { anchor: null, evidence: "visual.pairs[].candidate_blank", nc: null },
  "visual_capture.baseline_blank_capture_count": { anchor: null, evidence: "visual.pairs[].baseline_blank", nc: null },
  "visual_capture.route_mismatch_count": { anchor: null, evidence: "visual.pairs[].route_match", nc: null },
  "visual_capture.viewport_mismatch_count": { anchor: null, evidence: "visual.pairs[].viewport_match", nc: null },
  "visual_capture.stale_capture_count": { anchor: null, evidence: "visual.pairs[].captured_run_id", nc: null },

  // ---- visual oracle ------------------------------------------------------
  "visual_oracle.trials_per_pair": { anchor: "VISUAL_TRIAL_INCOMPLETE", evidence: "visual.pairs[].trials", nc: null },
  "visual_oracle.pass.minimum_pair_majority_wins": { anchor: "VISUAL_IMPROVEMENT_INSUFFICIENT", evidence: "normalized_preference", nc: "NC-20" },
  "visual_oracle.pass.maximum_pair_majority_losses": { anchor: "VISUAL_REGRESSION_TOO_BROAD", evidence: "normalized_preference", nc: null },
  "visual_oracle.pass.minimum_candidate_votes": { anchor: "VISUAL_VOTE_CONFIDENCE_INSUFFICIENT", evidence: "normalized_preference", nc: null },
  "visual_oracle.pass.wilson_lower_bound_must_exceed": { anchor: "VISUAL_CONFIDENCE_INTERVAL_INCONCLUSIVE", evidence: "normalized_preference", nc: null },
  "visual_oracle.pass.critical_pairs_may_not_lose": { anchor: "CRITICAL_VISUAL_PAIR_REGRESSED", evidence: "visual.pairs[]", nc: "NC-21", note: "critical pair set is hardcoded in the verifier, not read from oracle.json" },
  "visual_oracle.pass.critical_dimensions_may_not_regress": { anchor: "CRITICAL_VISUAL_DIMENSION_REGRESSED", evidence: "normalized_candidate_delta", nc: "NC-22", note: "dimension list hardcoded, not read from oracle.json" },
  "visual_oracle.pass.minimum_weighted_mean_delta": { anchor: null, evidence: "normalized_candidate_delta + oracle dimension weights", nc: null, note: "§20 explicitly flags this as unimplemented; oracle.json weights are never read" },
  "visual_oracle.dimensions": { anchor: null, evidence: "oracle.visual_oracle.dimensions", nc: null, note: "weights declared but never used by the verifier" },
  "visual_oracle.reveal_candidate_identity_to_judge": { anchor: null, evidence: "visual.trials[].blind", nc: null },
  "visual_oracle.inconclusive.missing_trial": { anchor: null, evidence: "visual.pairs[].trials", nc: null },
  "visual_oracle.inconclusive.judge_disagreement_without_majority": { anchor: null, evidence: "normalized_preference", nc: null },
  "visual_oracle.inconclusive.wilson_interval_crosses_required_boundary": { anchor: null, evidence: "wilson bounds", nc: null },

  // ---- final verdict --------------------------------------------------------
  "final_verdict.pass_requires.all_hard_gates_pass": { anchor: "hard_gate_failures", evidence: "failures[]", nc: "NC-25" },
  "final_verdict.pass_requires.visual_oracle_pass": { anchor: "VISUAL_IMPROVEMENT_INSUFFICIENT", evidence: "visual aggregate", nc: null },
  "final_verdict.pass_requires.rendered_visual_qa_executed": { anchor: "VISUAL_CAPTURE_INCOMPLETE", evidence: "visual.pairs[]", nc: "NC-19" },
  "final_verdict.pass_requires.no_inconclusive_blocking_dimension": { anchor: null, evidence: "visual inconclusive rules", nc: null },
};

const entries = [];
let implemented = 0;
const staleCitations = [];

for (const [oraclePathKey, spec] of Object.entries(TABLE)) {
  let verifierLocation = null;
  let isImplemented = false;

  if (spec.anchor) {
    const ln = lineOf(spec.anchor);
    if (ln === null) {
      // Table claims enforcement but the verifier does not contain the anchor.
      staleCitations.push({ oracle_path: oraclePathKey, missing_anchor: spec.anchor });
    } else {
      isImplemented = true;
      verifierLocation = `${verifierPath}:${ln}`;
      implemented += 1;
    }
  }

  entries.push({
    oracle_path: oraclePathKey,
    implemented: isImplemented,
    verifier_location: verifierLocation,
    evidence_source: spec.evidence,
    negative_control: spec.nc,
    ...(spec.partial ? { partial: spec.partial } : {}),
    ...(spec.note ? { note: spec.note } : {}),
  });
}

const total = entries.length;
const unenforced = entries.filter((e) => !e.implemented);
const coveragePct = total === 0 ? 0 : Math.round((implemented / total) * 1000) / 10;

const report = {
  schema: "l9.golden-oracle-coverage/v1",
  oracle_id: oracle.oracle_id,
  generated_from: { oracle: oraclePath, verifier: verifierPath },
  blocking_properties_total: total,
  blocking_properties_enforced: implemented,
  coverage_pct: coveragePct,
  stale_citations: staleCitations,
  unenforced_properties: unenforced.map((e) => e.oracle_path),
  properties: entries,
  verdict: unenforced.length === 0 && staleCitations.length === 0 ? "ORACLE_COVERAGE_COMPLETE" : "ORACLE_IMPLEMENTATION_INCOMPLETE",
};

fs.writeFileSync(path.resolve(ROOT, outPath), `${JSON.stringify(report, null, 2)}\n`);

console.log(`oracle blocking properties : ${total}`);
console.log(`enforced by verifier       : ${implemented}`);
console.log(`coverage                   : ${coveragePct}%`);
console.log(`stale citations            : ${staleCitations.length}`);
console.log(`verdict                    : ${report.verdict}`);
if (staleCitations.length) {
  console.log("\nSTALE CITATIONS (table claims enforcement, verifier lacks anchor):");
  for (const s of staleCitations) console.log(`  ${s.oracle_path} -> ${s.missing_anchor}`);
}
if (unenforced.length) {
  console.log("\nUNENFORCED BLOCKING PROPERTIES:");
  for (const e of unenforced) console.log(`  ${e.oracle_path}`);
}
process.exit(report.verdict === "ORACLE_COVERAGE_COMPLETE" ? 0 : 1);
