#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const oraclePath =
  process.argv[2] ?? "tests/golden/safehaven/oracle.json";
const verifierPath =
  process.argv[3] ?? "scripts/verify-safehaven-golden.mjs";
const outputPath =
  process.argv[4] ?? "evidence/oracle-coverage.json";
const EXPECTED = [
  "identity.require_full_git_shas",
  "identity.router_version_rule",
  "identity.require_clean_or_explicitly_recorded_worktrees",
  "identity.require_bot_interop_compatibility",
  "preflight.must_precede_first_seo_build_intelligence_call",
  "preflight.required",
  "preflight.required_checks",
  "execution_graph.build_intent",
  "execution_graph.copy_fallback_used",
  "execution_graph.generic_fallback_used",
  "execution_graph.required_ordered_subsequence",
  "execution_graph.forbidden_stages_under_redesign",
  "competitive_landscape.selected_donor_count",
  "competitive_landscape.unique_normalized_domains",
  "competitive_landscape.evidence_complete",
  "competitive_landscape.ranking_llm_calls",
  "competitive_landscape.every_selected_donor_requires",
  "competitive_landscape.forbidden_selected_classes",
  "donor_evidence.accepted_donors",
  "donor_evidence.per_donor.minimum_successful_pages",
  "donor_evidence.per_donor.minimum_screenshots",
  "donor_evidence.per_donor.require_evidence_digest",
  "donor_evidence.per_donor.require_timestamp",
  "donor_evidence.candidate_donor_asset_hash_matches",
  "website_blueprint.must_reference_exact_competitive_landscape",
  "website_blueprint.required",
  "website_blueprint.visual_asset_requirements_required",
  "seo_content_blueprint.produced_routes",
  "seo_content_blueprint.extra_routes",
  "seo_content_blueprint.batch_size",
  "seo_content_blueprint.expected_batch_count",
  "seo_content_blueprint.must_reference_exact_competitive_landscape",
  "seo_content_blueprint.duplicate_routes",
  "seo_content_blueprint.unknown_content_slots",
  "seo_content_blueprint.invalid_internal_link_targets",
  "page_content_contract.produced_routes",
  "page_content_contract.llm_calls",
  "page_content_contract.unplaced_content_requirements",
  "page_content_contract.invalid_business_facts",
  "page_content_contract.determinism.same_semantic_input_same_digest",
  "structured_content.produced_routes",
  "structured_content.must_reference_exact_page_content_contract",
  "structured_content.schema_invalid_routes",
  "structured_content.unsupported_claims",
  "structured_content.failed_requirements",
  "structured_content.maximum_repairs_per_route",
  "structured_content.maximum_generation_calls_per_route",
  "structured_content.section_alias_fields_forbidden",
  "structured_content.all_section_prose_must_use_blocks",
  "legacy_authority.legacy_content_generation_calls",
  "legacy_authority.legacy_schema_generation_calls",
  "legacy_authority.page_content_contract_llm_calls",
  "legacy_authority.redesign_schema_llm_calls",
  "source_assets.minimum_raw_source_images",
  "source_assets.minimum_authorized_reusable_images",
  "source_assets.minimum_selected_source_images",
  "source_assets.unexplained_reusable_asset_loss",
  "source_assets.required_visual_slots_filled_fraction",
  "source_assets.source_corpus_completed",
  "source_assets.forbidden_candidate_dispositions",
  "source_assets.conditional_rules",
  "site_integrity.built_routes",
  "site_integrity.reachable_routes",
  "site_integrity.broken_internal_links",
  "site_integrity.placeholder_count",
  "site_integrity.per_route",
  "site_integrity.unique_titles",
  "site_integrity.unique_canonical_urls",
  "business_truth.unsupported_claim_count",
  "business_truth.phone_mismatch_count",
  "business_truth.email_mismatch_count",
  "business_truth.prohibition_violations",
  "llm_audit.direct_provider_bypass_count",
  "llm_audit.required_policy.SEO_CONTENT_BLUEPRINT",
  "llm_audit.required_policy.STRUCTURED_CONTENT_GENERATION",
  "llm_audit.required_policy.CONTENT_VALIDATION",
  "llm_audit.required_policy.VISUAL_QA",
  "llm_audit.unsupported_capability_combination_count",
  "visual_capture.required_pairs",
  "visual_capture.candidate_blank_capture_count",
  "visual_capture.baseline_blank_capture_count",
  "visual_capture.route_mismatch_count",
  "visual_capture.viewport_mismatch_count",
  "visual_capture.stale_capture_count",
  "visual_oracle.trials_per_pair",
  "visual_oracle.pass.minimum_pair_majority_wins",
  "visual_oracle.pass.maximum_pair_majority_losses",
  "visual_oracle.pass.minimum_candidate_votes",
  "visual_oracle.pass.wilson_lower_bound_must_exceed",
  "visual_oracle.pass.critical_pairs_may_not_lose",
  "visual_oracle.pass.critical_dimensions_may_not_regress",
  "visual_oracle.pass.minimum_weighted_mean_delta",
  "visual_oracle.dimensions",
  "visual_oracle.reveal_candidate_identity_to_judge",
  "visual_oracle.inconclusive.missing_trial",
  "visual_oracle.inconclusive.judge_disagreement_without_majority",
  "visual_oracle.inconclusive.wilson_interval_crosses_required_boundary",
  "final_verdict.pass_requires.all_hard_gates_pass",
  "final_verdict.pass_requires.visual_oracle_pass",
  "final_verdict.pass_requires.rendered_visual_qa_executed",
  "final_verdict.pass_requires.no_inconclusive_blocking_dimension"
];
if (EXPECTED.length !== 101) {
  throw new Error(
    `internal audit inventory corrupt: expected 101, got ${EXPECTED.length}`
  );
}

/*
 * Every one of the 101 properties must have an explicit runtime evaluation ID
 * in the verifier. Oracle-path existence alone is never implementation proof.
 */
const EVALUATION_SENTINELS = new Map(
  EXPECTED.map((oraclePath) => [
    oraclePath,
    [`recordOracleEvaluation("${oraclePath}")`]
  ])
);

/*
 * Additional hostile-audit sentinels for known bypass classes. These do not
 * replace the 101 runtime IDs; they prove the hardened verifier contains the
 * concrete fail-closed mechanisms that motivated this audit revision.
 */
const SOUNDNESS_SENTINELS = new Map([
  ["pcc_digest_equality", [
    "PCC_DETERMINISM_DIGEST_MISSING",
    "Same semantic PCC input produced different digests"
  ]],
  ["exact_visual_pair_set", [
    "VISUAL_PAIR_DUPLICATE",
    "VISUAL_PAIR_SET_MISMATCH",
    "expectedVisualPairKeys"
  ]],
  ["visual_score_bounds", [
    "VISUAL_DIMENSION_SCORE_OUT_OF_RANGE",
    "oracle.visual_oracle.score_scale.minimum",
    "oracle.visual_oracle.score_scale.maximum"
  ]],
  ["raw_visual_orientation_normalization", [
    "VISUAL_RAW_JUDGE_EVIDENCE_MISSING",
    "VISUAL_NORMALIZATION_MISMATCH",
    "normalizePreferenceFromRaw",
    "normalizeDeltaFromRaw"
  ]],
  ["raw_donor_domain", ["DONOR_RAW_DOMAIN_MISSING"]],
  ["legacy_pcc_llm_calls", ["LEGACY_PCC_LLM_AUTHORITY_USED"]],
  ["site_built_routes", ["SITE_BUILT_ROUTE_COUNT_MISMATCH"]],
  ["router_version_presence", [
    "ROUTER_VERSION_MISSING",
    "Website-Bot Router version missing",
    "SEO-Bot Router version missing",
    "Router run identity version missing"
  ]],
  ["legacy_schema_generation_authority", [
    "receipt.legacy?.schema_generation_calls",
    "LEGACY_SCHEMA_AUTHORITY_USED"
  ]],
  ["exact_donor_evidence_domain_set", [
    "DONOR_EVIDENCE_DOMAIN_SET_MISMATCH",
    "selectedDonorDomains",
    "evidencedDonorDomains"
  ]],
  ["structured_content_route_result_set", [
    "StructuredContentRouteResults",
    "routeResults.map((route) => route.path)"
  ]],
  ["pcc_scp_lineage_presence", [
    "PCC_ARTIFACT_REF_MISSING",
    "STRUCTURED_CONTENT_PCC_REF_MISSING",
    "STRUCTURED_CONTENT_LINEAGE_MISMATCH"
  ]],
  ["runtime_101_evaluation_gate", ["ORACLE_EVALUATION_COVERAGE_INCOMPLETE"]],
  ["external_calibration_authorization", [
    "SYNTHETIC_RECEIPT_FORBIDDEN",
    "CALIBRATION_RECEIPT_REQUIRED",
    "process.env.GOLDEN_CALIBRATION_MODE"
  ]],
  ["rendered_visual_qa_proof", [
    "RENDERED_VISUAL_QA_NOT_EXECUTED",
    "receipt.visual?.rendered_visual_qa_executed"
  ]]
]);

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, p), "utf8"));
}

function compact(value) {
  return String(value).replace(/\s+/g, "");
}

function sourceContains(source, needle) {
  return compact(source).includes(compact(needle));
}

function oracleHasPath(oracle, oraclePath) {
  const verdictPrefix = "final_verdict.pass_requires.";
  if (oraclePath.startsWith(verdictPrefix)) {
    const requirement = oraclePath.slice(verdictPrefix.length);
    return Array.isArray(oracle.final_verdict?.pass_requires) &&
      oracle.final_verdict.pass_requires.includes(requirement);
  }
  const parts = oraclePath.split(".");
  let current = oracle;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return false;
    }
    current = current[part];
  }
  return true;
}

function lineOf(source, needle) {
  const compactNeedle = compact(needle);
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let candidate = lines[i];
    for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      if (compact(candidate).includes(compactNeedle)) return i + 1;
      candidate += lines[j];
    }
    if (compact(candidate).includes(compactNeedle)) return i + 1;
  }
  return null;
}

function deriveHardcodedOracleFindings(source, oracle) {
  const findings = [];
  const patterns = [
    ["selected_donor_count", /donors\.length\s*,\s*10\b/],
    ["route_count_29", /(?:routes|reachable_routes|built_routes)\s*[,)]\s*29\b/],
    ["visual_pair_count_10", /visualPairs\.length\s*[,)]\s*10\b/],
    ["visual_min_pair_wins_7", /majorityWins\s*<\s*7\b/],
    ["visual_max_pair_losses_2", /majorityLosses\s*>\s*2\b/],
    ["visual_min_candidate_votes_21", /candidateVotes\s*<\s*21\b/],
    ["visual_wilson_boundary_0_5", /wilson(?:\.lower)?\s*[<>]=?\s*0\.5\b/],
    ["visual_weighted_delta_0_25", /weightedMeanDelta\s*<\s*0\.25\b/],
    ["seo_batch_size_4", /batch_size\s*[,)]\s*4\b/],
    ["seo_batch_count_8", /batch_count\s*[,)]\s*8\b/]
  ];
  for (const [id, regex] of patterns) {
    if (regex.test(source)) findings.push({ id, pattern: String(regex) });
  }
  for (const pair of oracle.visual_oracle?.pass?.critical_pairs_may_not_lose ?? []) {
    const literal = JSON.stringify(pair);
    if (source.includes(literal)) {
      findings.push({ id: "critical_pair_literal", value: pair });
    }
  }
  return findings;
}

const oracle = readJson(oraclePath);
const verifierSource =
  fs.readFileSync(path.resolve(ROOT, verifierPath), "utf8");

if (oracle.oracle_id !== "safehaven-redesign-oracle-v1") {
  throw new Error(`wrong oracle: ${oracle.oracle_id ?? "<missing>"}`);
}

const properties = EXPECTED.map((oraclePath) => {
  const authorityPresent = oracleHasPath(oracle, oraclePath);
  const requiredSentinels = EVALUATION_SENTINELS.get(oraclePath) ?? [];
  const missingSentinels = requiredSentinels.filter(
    (needle) => !sourceContains(verifierSource, needle)
  );
  const implemented =
    authorityPresent &&
    requiredSentinels.length > 0 &&
    missingSentinels.length === 0;
  const firstSentinel = requiredSentinels[0] ?? null;
  return {
    oracle_path: oraclePath,
    implemented,
    authority_present: authorityPresent,
    evaluation_id_present: requiredSentinels.length > 0,
    verifier_location:
      firstSentinel && implemented
        ? `${verifierPath}:${lineOf(verifierSource, firstSentinel) ?? "dynamic"}`
        : null,
    required_sentinels: requiredSentinels,
    missing_sentinels: missingSentinels
  };
});

const staleCitations = properties
  .filter(
    (p) =>
      !p.authority_present ||
      !p.evaluation_id_present ||
      p.missing_sentinels.length > 0
  )
  .map((p) => ({
    oracle_path: p.oracle_path,
    authority_present: p.authority_present,
    evaluation_id_present: p.evaluation_id_present,
    missing_sentinels: p.missing_sentinels
  }));

const soundnessChecks = [...SOUNDNESS_SENTINELS.entries()].map(
  ([id, sentinels]) => {
    const missing = sentinels.filter(
      (needle) => !sourceContains(verifierSource, needle)
    );
    return {
      id,
      pass: missing.length === 0,
      required_sentinels: sentinels,
      missing_sentinels: missing
    };
  }
);
const soundnessFailures = soundnessChecks.filter((x) => !x.pass);

const hardcodedOracleValueFindings =
  deriveHardcodedOracleFindings(verifierSource, oracle);

const enforced = properties.filter((p) => p.implemented).length;
const coveragePct =
  Number(((enforced / EXPECTED.length) * 100).toFixed(1));
const unenforced = properties
  .filter((p) => !p.implemented)
  .map((p) => p.oracle_path);

const result = {
  schema: "l9.golden-oracle-coverage/v3",
  oracle_id: oracle.oracle_id,
  generated_from: {
    oracle: oraclePath,
    verifier: verifierPath
  },
  methodology: {
    fail_closed_on_missing_evaluation_id: true,
    oracle_path_existence_alone_is_implementation_evidence: false,
    explicit_runtime_evaluation_ids_required: true,
    soundness_sentinels_required: true,
    hardcoded_oracle_value_scan_derived: true
  },
  blocking_properties_total: EXPECTED.length,
  blocking_properties_enforced: enforced,
  coverage_pct: coveragePct,
  stale_citations: staleCitations,
  unenforced_properties: unenforced,
  soundness_checks: soundnessChecks,
  soundness_failure_count: soundnessFailures.length,
  hardcoded_oracle_values_remaining: hardcodedOracleValueFindings.length,
  hardcoded_oracle_value_findings: hardcodedOracleValueFindings,
  properties,
  verdict:
    enforced === EXPECTED.length &&
    staleCitations.length === 0 &&
    soundnessFailures.length === 0 &&
    hardcodedOracleValueFindings.length === 0
      ? "ORACLE_IMPLEMENTATION_COMPLETE"
      : "ORACLE_IMPLEMENTATION_INCOMPLETE"
};

fs.mkdirSync(
  path.dirname(path.resolve(ROOT, outputPath)),
  { recursive: true }
);
fs.writeFileSync(
  path.resolve(ROOT, outputPath),
  JSON.stringify(result, null, 2) + "\n"
);
console.log(JSON.stringify(result, null, 2));
process.exit(
  result.verdict === "ORACLE_IMPLEMENTATION_COMPLETE" ? 0 : 1
);
