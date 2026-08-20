#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, p), "utf8"));
}

const casePath =
  process.argv[2] ?? "tests/golden/safehaven/case.json";

const receiptPath =
  process.argv[3] ?? process.env.GOLDEN_RECEIPT;

const oraclePath =
  process.argv[4] ?? "tests/golden/safehaven/oracle.json";

if (!receiptPath) {
  console.error(
    "usage: node scripts/verify-safehaven-golden.mjs " +
      "<case.json> <receipt.json> [oracle.json]"
  );
  process.exit(2);
}

const testCase = readJson(casePath);
const receipt = readJson(receiptPath);
const oracle = readJson(oraclePath);

const hardFailures = [];
const inconclusive = [];
const evaluatedOracleProperties = new Set();
const EXPECTED_ORACLE_EVALUATION_COUNT = 101;
const syntheticReceipt =
  receipt.calibration?.synthetic === true;
const calibrationMode =
  process.env.GOLDEN_CALIBRATION_MODE === "1";
if (syntheticReceipt && !calibrationMode) {
  fail(
    "SYNTHETIC_RECEIPT_FORBIDDEN",
    "Synthetic calibration receipt cannot certify a real Golden run"
  );
}
if (calibrationMode && !syntheticReceipt) {
  fail(
    "CALIBRATION_RECEIPT_REQUIRED",
    "Calibration mode requires an explicitly synthetic receipt"
  );
}
const syntheticCalibration =
  syntheticReceipt && calibrationMode;

function recordOracleEvaluation(oraclePath) {
  if (typeof oraclePath !== "string" || !oraclePath) {
    throw new Error("oracle evaluation id must be a non-empty string");
  }
  evaluatedOracleProperties.add(oraclePath);
}

function issue(bucket, code, message, evidence) {
  bucket.push({
    code,
    message,
    ...(evidence === undefined ? {} : { evidence }),
  });
}

function fail(code, message, evidence) {
  issue(hardFailures, code, message, evidence);
}

function markInconclusive(code, message, evidence) {
  issue(inconclusive, code, message, evidence);
}

function requirePresent(value, code, message) {
  if (value === undefined || value === null) {
    fail(code, message);
    return false;
  }
  return true;
}

function requireTrue(value, code, message, evidence) {
  if (value !== true) fail(code, message, evidence ?? value);
}

function requireFalse(value, code, message, evidence) {
  if (value !== false) fail(code, message, evidence ?? value);
}

function requireEq(actual, expected, code, message) {
  if (actual !== expected) {
    fail(code, message, { expected, actual });
  }
}

function requireNonEmpty(value, code, message) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(code, message, value);
  }
}

function requireFullGitSha(value, code, message) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{40}$/i.test(value)
  ) {
    fail(code, message, value);
    return false;
  }
  return true;
}

function requireFiniteNumber(value, code, message) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(code, message, value);
    return false;
  }
  return true;
}

function normalizeRoute(v) {
  if (typeof v !== "string") return String(v);
  const t = v.trim();
  if (t === "/") return "/";
  return t.replace(/\/+$/, "") || "/";
}

function normalizedSet(values) {
  return new Set((values ?? []).map(normalizeRoute));
}

function duplicateValues(values) {
  const counts = new Map();

  for (const raw of values ?? []) {
    const value = normalizeRoute(raw);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function requireExactRoutes(actual, expected, label) {
  if (!Array.isArray(actual)) {
    fail(
      "ROUTE_EVIDENCE_MISSING",
      `${label} routes must be an array`
    );
    return;
  }

  const duplicates = duplicateValues(actual);

  if (duplicates.length > 0) {
    fail(
      "DUPLICATE_ROUTE",
      `${label} contains duplicate routes`,
      duplicates
    );
  }

  if (actual.length !== expected.length) {
    fail(
      "ROUTE_COUNT_MISMATCH",
      `${label} route count differs`,
      {
        expected: expected.length,
        actual: actual.length,
      }
    );
  }

  const a = normalizedSet(actual);
  const e = normalizedSet(expected);

  const missing = [...e].filter((x) => !a.has(x));
  const extra = [...a].filter((x) => !e.has(x));

  if (missing.length || extra.length) {
    fail(
      "ROUTE_SET_MISMATCH",
      `${label} must contain the exact frozen route set`,
      { missing, extra }
    );
  }
}

function parseTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function eventNames(events) {
  return (events ?? [])
    .map((e) => e?.name)
    .filter((v) => typeof v === "string");
}

function requireBefore(events, firstName, secondName, code) {
  const names = eventNames(events);
  const first = names.indexOf(firstName);
  const second = names.indexOf(secondName);

  if (first < 0 || second < 0 || first >= second) {
    fail(
      code,
      `${firstName} must occur before ${secondName}`,
      { firstIndex: first, secondIndex: second }
    );
  }
}

function requireOrderedSubsequence(actual, required) {
  let cursor = 0;

  for (const item of actual) {
    if (item === required[cursor]) cursor++;
    if (cursor === required.length) return;
  }

  fail(
    "REQUIRED_STAGE_ORDER_VIOLATION",
    "Required redesign execution subsequence was not observed",
    {
      required,
      observed: actual,
      firstMissing: required[cursor] ?? null,
    }
  );
}

function preflightCheckMap(checks) {
  if (Array.isArray(checks)) {
    const map = new Map();

    for (const check of checks) {
      const name = check?.name ?? check?.id;
      const status = check?.status;

      if (typeof name === "string") {
        if (map.has(name)) {
          fail(
            "PREFLIGHT_CHECK_DUPLICATE",
            `Duplicate preflight check: ${name}`
          );
        }
        map.set(name, status);
      }
    }

    return map;
  }

  if (checks && typeof checks === "object") {
    return new Map(Object.entries(checks));
  }

  return null;
}

function statusPass(value) {
  return value === true || value === "PASS" || value === "READY";
}

function wilsonBounds(successes, n, z = 1.96) {
  if (!n) return { lower: 0, upper: 1 };

  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;

  const center =
    (p + z2 / (2 * n)) / denominator;

  const margin =
    (z *
      Math.sqrt(
        (p * (1 - p)) / n +
          z2 / (4 * n * n)
      )) /
    denominator;

  return {
    lower: center - margin,
    upper: center + margin,
  };
}

function arrayIntersection(a, b) {
  const bSet = new Set(b);
  return [...new Set(a)].filter((x) => bSet.has(x));
}

function normalizeVisualPairKey(value) {
  if (typeof value !== "string") return String(value);
  const split = value.lastIndexOf("::");
  if (split < 0) return value;
  return `${normalizeRoute(value.slice(0, split))}::${value.slice(split + 2)}`;
}

function validateVisualOrientation(orientation, label) {
  if (!orientation || typeof orientation !== "object") {
    fail("VISUAL_ORIENTATION_MISSING", `${label} orientation missing`);
    return null;
  }
  const a = orientation.A;
  const b = orientation.B;
  const valid =
    (a === "CANDIDATE" && b === "BASELINE") ||
    (a === "BASELINE" && b === "CANDIDATE");
  if (!valid) {
    fail(
      "VISUAL_ORIENTATION_INVALID",
      `${label} orientation must map A/B to candidate/baseline exactly once`,
      orientation
    );
    return null;
  }
  return { A: a, B: b };
}

function normalizePreferenceFromRaw(rawPreference, orientation) {
  if (rawPreference === "TIE") return "TIE";
  if (rawPreference !== "A" && rawPreference !== "B") return null;
  return orientation[rawPreference];
}

function normalizeDeltaFromRaw(rawDelta, orientation) {
  return orientation.B === "CANDIDATE" ? rawDelta : -rawDelta;
}

/* =========================================================
 * IDENTITY
 * ======================================================= */

recordOracleEvaluation("identity.require_full_git_shas");
recordOracleEvaluation("identity.router_version_rule");
recordOracleEvaluation("identity.require_clean_or_explicitly_recorded_worktrees");
recordOracleEvaluation("identity.require_bot_interop_compatibility");

for (const repoName of [
  "website_bot",
  "seo_bot",
  "llm_router",
]) {
  const identity = receipt.identity?.[repoName];

  requireFullGitSha(
    identity?.sha,
    "IDENTITY_SHA_INVALID",
    `${repoName} must record a full 40-character git SHA`
  );

  // A01
  if (!requirePresent(
    identity?.worktree_state,
    "WORKTREE_STATE_MISSING",
    `${repoName} worktree state missing`
  )) continue;

  const state = identity.worktree_state;

  const acceptable =
    state === "CLEAN" ||
    state?.clean === true ||
    (
      state?.clean === false &&
      state?.explicitly_recorded === true &&
      typeof state?.diff_identity === "string" &&
      state.diff_identity.length > 0
    );

  if (!acceptable) {
    fail(
      "WORKTREE_STATE_UNRECORDED_DIRTY",
      `${repoName} is dirty without explicit recorded identity`,
      state
    );
  }
}

const websiteRouter =
  receipt.identity?.website_bot?.llm_router_version;

const seoRouter =
  receipt.identity?.seo_bot?.llm_router_version;

const routerIdentity =
  receipt.identity?.llm_router?.package_version;

requireNonEmpty(
  websiteRouter,
  "ROUTER_VERSION_MISSING",
  "Website-Bot Router version missing"
);
requireNonEmpty(
  seoRouter,
  "ROUTER_VERSION_MISSING",
  "SEO-Bot Router version missing"
);
requireNonEmpty(
  routerIdentity,
  "ROUTER_VERSION_MISSING",
  "Router run identity version missing"
);

requireEq(
  websiteRouter,
  seoRouter,
  "ROUTER_VERSION_MISMATCH",
  "Website-Bot and SEO-Bot must load the same Router version"
);

requireEq(
  websiteRouter,
  routerIdentity,
  "ROUTER_IDENTITY_MISMATCH",
  "Consumer Router version must equal Router run identity"
);

// A02
requireTrue(
  receipt.identity?.bot_interop?.compatible,
  "BOT_INTEROP_MISMATCH",
  "Website-Bot and SEO-Bot bot-interop contract must be compatible",
  receipt.identity?.bot_interop
);

/* =========================================================
 * BUILD INTENT
 * ======================================================= */

recordOracleEvaluation("execution_graph.build_intent");
recordOracleEvaluation("execution_graph.copy_fallback_used");
recordOracleEvaluation("execution_graph.generic_fallback_used");

requireEq(
  receipt.run?.build_intent,
  oracle.execution_graph.build_intent,
  "WRONG_BUILD_INTENT",
  "Golden run must execute oracle-specified build intent"
);

requireEq(
  receipt.run?.copy_fallback_used,
  oracle.execution_graph.copy_fallback_used,
  "COPY_FALLBACK_USED",
  "COPY fallback state violates oracle"
);

requireEq(
  receipt.run?.generic_fallback_used,
  oracle.execution_graph.generic_fallback_used,
  "GENERIC_FALLBACK_USED",
  "Generic fallback state violates oracle"
);

/* =========================================================
 * PREFLIGHT — A03/A04
 * ======================================================= */

recordOracleEvaluation("preflight.must_precede_first_seo_build_intelligence_call");
recordOracleEvaluation("preflight.required");
recordOracleEvaluation("preflight.required_checks");

if (oracle.preflight.required === true) {
  requirePresent(
    receipt.preflight,
    "PREFLIGHT_MISSING",
    "Required SEO build-intelligence preflight evidence missing"
  );

  if (receipt.preflight) {
    if (!statusPass(receipt.preflight.status)) {
      fail(
        "PREFLIGHT_NOT_READY",
        "SEO build-intelligence preflight did not PASS",
        receipt.preflight.status
      );
    }

    const checkMap =
      preflightCheckMap(receipt.preflight.checks);

    if (!checkMap) {
      fail(
        "PREFLIGHT_CHECKS_MISSING",
        "Preflight required checks evidence missing"
      );
    } else {
      for (const required of oracle.preflight.required_checks ?? []) {
        if (!checkMap.has(required)) {
          fail(
            "PREFLIGHT_CHECK_MISSING",
            `Required preflight check missing: ${required}`
          );
          continue;
        }

        if (!statusPass(checkMap.get(required))) {
          fail(
            "PREFLIGHT_CHECK_FAILED",
            `Required preflight check failed: ${required}`,
            checkMap.get(required)
          );
        }
      }
    }
  }
}

/* =========================================================
 * EXECUTION GRAPH — A05/A06
 * ======================================================= */

recordOracleEvaluation("execution_graph.required_ordered_subsequence");
recordOracleEvaluation("execution_graph.forbidden_stages_under_redesign");

const events = receipt.events ?? [];
const names = eventNames(events);

requireBefore(
  events,
  "seo-build-intelligence-preflight:PASS",
  "seo:createCompetitiveLandscape",
  "SEO_PREFLIGHT_TOO_LATE"
);

requireOrderedSubsequence(
  names,
  oracle.execution_graph.required_ordered_subsequence ?? []
);

const forbiddenExecuted =
  arrayIntersection(
    names,
    oracle.execution_graph.forbidden_stages_under_redesign ?? []
  );

if (forbiddenExecuted.length > 0) {
  fail(
    "FORBIDDEN_REDESIGN_STAGE_EXECUTED",
    "Forbidden legacy stages executed under REDESIGN_IMPROVE",
    forbiddenExecuted
  );
}

/* =========================================================
 * COMPETITIVE LANDSCAPE — A07 + existing gates
 * ======================================================= */

recordOracleEvaluation("competitive_landscape.selected_donor_count");
recordOracleEvaluation("competitive_landscape.unique_normalized_domains");
recordOracleEvaluation("competitive_landscape.evidence_complete");
recordOracleEvaluation("competitive_landscape.ranking_llm_calls");
recordOracleEvaluation("competitive_landscape.every_selected_donor_requires");
recordOracleEvaluation("competitive_landscape.forbidden_selected_classes");

const competitive =
  receipt.competitive_landscape ?? {};

const donors =
  competitive.selected_donors ?? [];

requireEq(
  donors.length,
  oracle.competitive_landscape.selected_donor_count,
  "COMPETITIVE_EVIDENCE_INCOMPLETE",
  "Selected donor count violates oracle"
);

const donorDomains =
  donors.map((d) => d.normalized_domain);

requireEq(
  new Set(donorDomains).size,
  oracle.competitive_landscape.unique_normalized_domains,
  "DUPLICATE_DONOR_DOMAIN",
  "Selected donors must be unique normalized companies"
);

requireEq(
  competitive.evidence_complete,
  oracle.competitive_landscape.evidence_complete,
  "COMPETITIVE_EVIDENCE_NOT_COMPLETE",
  "CompetitiveLandscape completeness violates oracle"
);

requireEq(
  competitive.ranking_llm_calls,
  oracle.competitive_landscape.ranking_llm_calls,
  "COMPETITIVE_RANKING_LLM_USED",
  "Competitive ranking authority must be deterministic"
);

const forbiddenClasses = new Set(
  oracle.competitive_landscape.forbidden_selected_classes ?? []
);

for (const donor of donors) {
  requireTrue(
    donor.qualified_operating_company,
    "DONOR_NOT_QUALIFIED",
    `Unqualified donor selected: ${donor.normalized_domain}`
  );

  requireTrue(
    donor.real_dataforseo_observation,
    "DONOR_DATAFORSEO_EVIDENCE_MISSING",
    `Real DataForSEO observation missing: ${donor.normalized_domain}`
  );

  requireNonEmpty(
    donor.query_id,
    "DONOR_QUERY_MISSING",
    `Donor query lineage missing: ${donor.normalized_domain}`
  );

  requireNonEmpty(
    donor.url,
    "DONOR_URL_MISSING",
    `Donor URL missing: ${donor.normalized_domain}`
  );

  requireNonEmpty(
    donor.domain,
    "DONOR_RAW_DOMAIN_MISSING",
    "Selected donor raw domain missing"
  );

  requireNonEmpty(
    donor.normalized_domain,
    "DONOR_DOMAIN_MISSING",
    "Selected donor normalized domain missing"
  );

  if (!parseTimestamp(donor.observed_at)) {
    fail(
      "DONOR_OBSERVED_AT_INVALID",
      `Donor observation timestamp missing/invalid: ${donor.normalized_domain}`,
      donor.observed_at
    );
  }

  if (!(Number(donor.rank) >= 1)) {
    fail(
      "DONOR_RANK_INVALID",
      `Invalid donor rank: ${donor.normalized_domain}`,
      donor.rank
    );
  }

  if (!(Number(donor.visibility_contribution) >= 0)) {
    fail(
      "DONOR_VISIBILITY_INVALID",
      `Visibility evidence invalid: ${donor.normalized_domain}`,
      donor.visibility_contribution
    );
  }

  // A07
  if (
    typeof donor.class !== "string" ||
    forbiddenClasses.has(donor.class)
  ) {
    fail(
      "FORBIDDEN_DONOR_CLASS",
      `Forbidden or missing donor class: ${donor.normalized_domain}`,
      donor.class
    );
  }
}

/* =========================================================
 * DONOR EVIDENCE — A08
 * ======================================================= */

recordOracleEvaluation("donor_evidence.accepted_donors");
recordOracleEvaluation("donor_evidence.per_donor.minimum_successful_pages");
recordOracleEvaluation("donor_evidence.per_donor.minimum_screenshots");
recordOracleEvaluation("donor_evidence.per_donor.require_evidence_digest");
recordOracleEvaluation("donor_evidence.per_donor.require_timestamp");
recordOracleEvaluation("donor_evidence.candidate_donor_asset_hash_matches");

const donorEvidence =
  receipt.donor_evidence ?? [];

const selectedDonorDomains =
  donors
    .map((d) => d.normalized_domain)
    .sort();

const evidencedDonorDomains =
  donorEvidence
    .map((d) => d.domain)
    .sort();

if (
  new Set(evidencedDonorDomains).size !== selectedDonorDomains.length ||
  JSON.stringify(evidencedDonorDomains) !==
    JSON.stringify(selectedDonorDomains)
) {
  fail(
    "DONOR_EVIDENCE_DOMAIN_SET_MISMATCH",
    "Donor crawl/screenshot evidence must cover exactly the selected donor domains",
    {
      selected: selectedDonorDomains,
      evidenced: evidencedDonorDomains
    }
  );
}

requireEq(
  donorEvidence.length,
  oracle.donor_evidence.accepted_donors,
  "DONOR_EVIDENCE_INCOMPLETE",
  "Accepted donor evidence count violates oracle"
);

for (const donor of donorEvidence) {
  if (
    (donor.successful_pages ?? 0) <
    oracle.donor_evidence.per_donor.minimum_successful_pages
  ) {
    fail(
      "DONOR_CRAWL_INCOMPLETE",
      `No sufficient successful pages for ${donor.domain}`
    );
  }

  if (
    (donor.screenshots ?? 0) <
    oracle.donor_evidence.per_donor.minimum_screenshots
  ) {
    fail(
      "DONOR_SCREENSHOT_INCOMPLETE",
      `No sufficient screenshots for ${donor.domain}`
    );
  }

  requireNonEmpty(
    donor.evidence_digest,
    "DONOR_DIGEST_MISSING",
    `Evidence digest missing for ${donor.domain}`
  );

  // A08
  if (!parseTimestamp(donor.crawled_at)) {
    fail(
      "DONOR_TIMESTAMP_INVALID",
      `Donor crawl timestamp missing/invalid for ${donor.domain}`,
      donor.crawled_at
    );
  }
}

/* =========================================================
 * WEBSITE BLUEPRINT — A09/A10
 * ======================================================= */

recordOracleEvaluation("website_blueprint.must_reference_exact_competitive_landscape");
recordOracleEvaluation("website_blueprint.required");
recordOracleEvaluation("website_blueprint.visual_asset_requirements_required");

const wbb = receipt.website_build_blueprint;

if (oracle.website_blueprint.required === true) {
  requirePresent(
    wbb,
    "WEBSITE_BLUEPRINT_REQUIRED",
    "WebsiteBuildBlueprint evidence missing"
  );

  if (wbb) {
    requireNonEmpty(
      wbb.artifact_ref,
      "WEBSITE_BLUEPRINT_REF_MISSING",
      "WebsiteBuildBlueprint artifact_ref missing"
    );
  }
}

if (
  oracle.website_blueprint.visual_asset_requirements_required === true
) {
  const vr = wbb?.visual_requirements;

  if (!Array.isArray(vr) || vr.length === 0) {
    fail(
      "BLUEPRINT_VISUAL_REQUIREMENTS_MISSING",
      "WebsiteBuildBlueprint visual asset requirements are required"
    );
  }
}

/* =========================================================
 * ROUTE CHAIN — A11/A12/A13 + existing
 * ======================================================= */

recordOracleEvaluation("seo_content_blueprint.produced_routes");
recordOracleEvaluation("seo_content_blueprint.extra_routes");
recordOracleEvaluation("seo_content_blueprint.batch_size");
recordOracleEvaluation("seo_content_blueprint.expected_batch_count");
recordOracleEvaluation("seo_content_blueprint.must_reference_exact_competitive_landscape");
recordOracleEvaluation("seo_content_blueprint.duplicate_routes");
recordOracleEvaluation("seo_content_blueprint.unknown_content_slots");
recordOracleEvaluation("seo_content_blueprint.invalid_internal_link_targets");

const expectedRoutes = testCase.routes ?? [];

requireExactRoutes(
  receipt.seo_content_blueprint?.routes,
  expectedRoutes,
  "SEOContentBlueprint"
);

requireExactRoutes(
  receipt.page_content_contract?.routes,
  expectedRoutes,
  "PageContentContract"
);

requireExactRoutes(
  receipt.structured_content?.routes,
  expectedRoutes,
  "StructuredContentPackage"
);

requireExactRoutes(
  receipt.site?.routes,
  expectedRoutes,
  "BuiltSite"
);

requireEq(
  receipt.seo_content_blueprint?.produced_routes,
  oracle.seo_content_blueprint.produced_routes,
  "SEO_PRODUCED_ROUTE_COUNT_MISMATCH",
  "SEOContentBlueprint produced_routes violates oracle"
);

requireEq(
  receipt.seo_content_blueprint?.extra_routes,
  oracle.seo_content_blueprint.extra_routes,
  "SEO_EXTRA_ROUTE_COUNT_MISMATCH",
  "SEOContentBlueprint extra_routes violates oracle"
);

requireEq(
  receipt.seo_content_blueprint?.duplicate_routes,
  oracle.seo_content_blueprint.duplicate_routes,
  "SEO_DUPLICATE_ROUTE_COUNT_MISMATCH",
  "SEOContentBlueprint duplicate_routes violates oracle"
);

requireEq(
  receipt.seo_content_blueprint?.batch_size,
  oracle.seo_content_blueprint.batch_size,
  "SEO_BATCH_SIZE_DRIFT",
  "SEO blueprint batch size violates oracle"
);

requireEq(
  receipt.seo_content_blueprint?.batch_count,
  oracle.seo_content_blueprint.expected_batch_count,
  "SEO_BATCH_COUNT_INVALID",
  "SEO blueprint batch count violates oracle"
);

// A12
requireEq(
  receipt.seo_content_blueprint?.unknown_content_slots,
  oracle.seo_content_blueprint.unknown_content_slots,
  "SEO_BLUEPRINT_UNKNOWN_CONTENT_SLOT",
  "SEOContentBlueprint contains unknown ContentSlots"
);

// A13
requireEq(
  receipt.seo_content_blueprint?.invalid_internal_link_targets,
  oracle.seo_content_blueprint.invalid_internal_link_targets,
  "SEO_BLUEPRINT_INVALID_INTERNAL_LINK_TARGET",
  "SEOContentBlueprint contains invalid internal-link targets"
);

/* =========================================================
 * LINEAGE
 * ======================================================= */

const landscapeRef =
  competitive.artifact_ref;

requireNonEmpty(
  landscapeRef,
  "COMPETITIVE_LANDSCAPE_REF_MISSING",
  "CompetitiveLandscape artifact_ref missing"
);

requireEq(
  wbb?.competitive_landscape_ref,
  landscapeRef,
  "WEBSITE_BLUEPRINT_LANDSCAPE_MISMATCH",
  "WebsiteBuildBlueprint must reference exact landscape"
);

requireEq(
  receipt.seo_content_blueprint?.competitive_landscape_ref,
  landscapeRef,
  "SEO_BLUEPRINT_LANDSCAPE_MISMATCH",
  "SEOContentBlueprint must reference exact landscape"
);

requireNonEmpty(
  receipt.page_content_contract?.artifact_ref,
  "PCC_ARTIFACT_REF_MISSING",
  "PageContentContract artifact_ref missing"
);

requireNonEmpty(
  receipt.structured_content?.page_content_contract_ref,
  "STRUCTURED_CONTENT_PCC_REF_MISSING",
  "StructuredContentPackage PCC reference missing"
);

requireEq(
  receipt.structured_content?.page_content_contract_ref,
  receipt.page_content_contract?.artifact_ref,
  "STRUCTURED_CONTENT_LINEAGE_MISMATCH",
  "StructuredContentPackage must reference exact PCC"
);

/* =========================================================
 * PCC — A14/A15
 * ======================================================= */

recordOracleEvaluation("page_content_contract.produced_routes");
recordOracleEvaluation("page_content_contract.llm_calls");
recordOracleEvaluation("page_content_contract.unplaced_content_requirements");
recordOracleEvaluation("page_content_contract.invalid_business_facts");
recordOracleEvaluation("page_content_contract.determinism.same_semantic_input_same_digest");

requireEq(
  receipt.page_content_contract?.produced_routes,
  oracle.page_content_contract.produced_routes,
  "PCC_PRODUCED_ROUTE_COUNT_MISMATCH",
  "PageContentContract produced_routes violates oracle"
);

requireEq(
  receipt.page_content_contract?.llm_calls,
  oracle.page_content_contract.llm_calls,
  "PCC_LLM_USED",
  "PageContentContract must use zero LLM calls"
);

requireEq(
  receipt.page_content_contract?.unplaced_requirements,
  oracle.page_content_contract.unplaced_content_requirements,
  "CONTENT_REQUIREMENT_UNPLACED",
  "All PCC requirements must be placed"
);

// A14
requireEq(
  receipt.page_content_contract?.invalid_business_facts,
  oracle.page_content_contract.invalid_business_facts,
  "PCC_INVALID_BUSINESS_FACT",
  "PCC contains invalid business facts"
);

// A15
const pccDeterminism =
  receipt.page_content_contract?.determinism;

requireTrue(
  pccDeterminism?.same_semantic_input_same_digest,
  "PCC_NONDETERMINISTIC",
  "PCC determinism proof missing"
);
requireNonEmpty(
  pccDeterminism?.digest_run_1,
  "PCC_DETERMINISM_DIGEST_MISSING",
  "PCC determinism digest_run_1 missing"
);
requireNonEmpty(
  pccDeterminism?.digest_run_2,
  "PCC_DETERMINISM_DIGEST_MISSING",
  "PCC determinism digest_run_2 missing"
);
requireEq(
  pccDeterminism?.digest_run_1,
  pccDeterminism?.digest_run_2,
  "PCC_NONDETERMINISTIC",
  "Same semantic PCC input produced different digests"
);

/* =========================================================
 * STRUCTURED CONTENT — A16/A17 + existing
 * ======================================================= */

recordOracleEvaluation("structured_content.produced_routes");
recordOracleEvaluation("structured_content.must_reference_exact_page_content_contract");
recordOracleEvaluation("structured_content.schema_invalid_routes");
recordOracleEvaluation("structured_content.unsupported_claims");
recordOracleEvaluation("structured_content.failed_requirements");
recordOracleEvaluation("structured_content.maximum_repairs_per_route");
recordOracleEvaluation("structured_content.maximum_generation_calls_per_route");
recordOracleEvaluation("structured_content.section_alias_fields_forbidden");
recordOracleEvaluation("structured_content.all_section_prose_must_use_blocks");

requireEq(
  receipt.structured_content?.produced_routes,
  oracle.structured_content.produced_routes,
  "STRUCTURED_CONTENT_PRODUCED_ROUTE_COUNT_MISMATCH",
  "StructuredContent produced_routes violates oracle"
);

const routeResults =
  receipt.structured_content?.route_results;

if (!Array.isArray(routeResults)) {
  fail(
    "STRUCTURED_CONTENT_ROUTE_EVIDENCE_MISSING",
    "StructuredContent route execution evidence missing"
  );
} else {
  requireExactRoutes(
    routeResults.map((route) => route.path),
    expectedRoutes,
    "StructuredContentRouteResults"
  );

  requireEq(
    routeResults.length,
    expectedRoutes.length,
    "STRUCTURED_CONTENT_ROUTE_EVIDENCE_COUNT_MISMATCH",
    "StructuredContent route evidence count must equal route count"
  );

  for (const route of routeResults) {
    if ((route.repair_attempts ?? Infinity) >
      oracle.structured_content.maximum_repairs_per_route) {
      fail(
        "CONTENT_REPAIR_BUDGET_EXCEEDED",
        `${route.route_id} exceeded repair budget`,
        route.repair_attempts
      );
    }

    if ((route.generation_calls ?? Infinity) >
      oracle.structured_content.maximum_generation_calls_per_route) {
      fail(
        "CONTENT_GENERATION_BUDGET_EXCEEDED",
        `${route.route_id} exceeded generation-call budget`,
        route.generation_calls
      );
    }

    requireEq(
      route.schema_errors,
      oracle.structured_content.schema_invalid_routes,
      "STRUCTURED_CONTENT_SCHEMA_INVALID",
      `Schema-invalid structured content: ${route.route_id}`
    );

    requireEq(
      route.unsupported_claims,
      oracle.structured_content.unsupported_claims,
      "UNSUPPORTED_CONTENT_CLAIM",
      `Unsupported content claim: ${route.route_id}`
    );

    requireEq(
      route.failed_requirements,
      oracle.structured_content.failed_requirements,
      "CONTENT_REQUIREMENT_UNSATISFIED",
      `Unsatisfied content requirement: ${route.route_id}`
    );

    // A16
    if (!Array.isArray(route.section_alias_fields)) {
      fail(
        "STRUCTURED_CONTENT_ALIAS_EVIDENCE_MISSING",
        `Section alias evidence missing: ${route.route_id}`
      );
    } else {
      const forbiddenAliasSet = new Set(
        oracle.structured_content.section_alias_fields_forbidden ?? []
      );

      const observed =
        route.section_alias_fields.filter((x) =>
          forbiddenAliasSet.has(x)
        );

      if (observed.length > 0) {
        fail(
          "STRUCTURED_CONTENT_FORBIDDEN_SECTION_ALIAS",
          `Forbidden section aliases detected: ${route.route_id}`,
          observed
        );
      }
    }

    // A17
    requireEq(
      route.prose_without_blocks,
      0,
      "STRUCTURED_CONTENT_BLOCKS_REQUIRED",
      `All section prose must use blocks: ${route.route_id}`
    );
  }
}

/* =========================================================
 * LEGACY AUTHORITY — A18
 * ======================================================= */

recordOracleEvaluation("legacy_authority.legacy_content_generation_calls");
recordOracleEvaluation("legacy_authority.legacy_schema_generation_calls");
recordOracleEvaluation("legacy_authority.page_content_contract_llm_calls");
recordOracleEvaluation("legacy_authority.redesign_schema_llm_calls");

requireEq(
  receipt.legacy?.content_generation_calls,
  oracle.legacy_authority.legacy_content_generation_calls,
  "LEGACY_CONTENT_AUTHORITY_USED",
  "Legacy content-generation authority used"
);

requireEq(
  receipt.legacy?.schema_generation_calls,
  oracle.legacy_authority.legacy_schema_generation_calls,
  "LEGACY_SCHEMA_AUTHORITY_USED",
  "Legacy schema-generation authority used"
);

requireEq(
  receipt.legacy?.page_content_contract_llm_calls,
  oracle.legacy_authority.page_content_contract_llm_calls,
  "LEGACY_PCC_LLM_AUTHORITY_USED",
  "Legacy PageContentContract LLM authority must remain zero"
);

// A18
requireEq(
  receipt.legacy?.redesign_schema_llm_calls,
  oracle.legacy_authority.redesign_schema_llm_calls,
  "REDESIGN_SCHEMA_LLM_AUTHORITY_VIOLATION",
  "Redesign schema serialization must use zero LLM calls"
);

/* =========================================================
 * BUSINESS TRUTH — A25
 * ======================================================= */

recordOracleEvaluation("business_truth.unsupported_claim_count");
recordOracleEvaluation("business_truth.phone_mismatch_count");
recordOracleEvaluation("business_truth.email_mismatch_count");
recordOracleEvaluation("business_truth.prohibition_violations");

requireEq(
  receipt.business_truth?.unsupported_claim_count,
  oracle.business_truth.unsupported_claim_count,
  "UNSUPPORTED_BUSINESS_CLAIM",
  "Candidate contains unsupported business claims"
);

requireEq(
  receipt.business_truth?.phone_mismatch_count,
  oracle.business_truth.phone_mismatch_count,
  "PHONE_TRUTH_MISMATCH",
  "Phone truth mismatch"
);

requireEq(
  receipt.business_truth?.email_mismatch_count,
  oracle.business_truth.email_mismatch_count,
  "EMAIL_TRUTH_MISMATCH",
  "Email truth mismatch"
);

// A25
requireEq(
  receipt.business_truth?.prohibition_violations,
  oracle.business_truth.prohibition_violations,
  "BUSINESS_PROHIBITION_VIOLATION",
  "Candidate violates business/content prohibitions"
);

/* =========================================================
 * SOURCE ASSETS — A19/A20/A21
 * ======================================================= */

recordOracleEvaluation("source_assets.minimum_raw_source_images");
recordOracleEvaluation("source_assets.minimum_authorized_reusable_images");
recordOracleEvaluation("source_assets.minimum_selected_source_images");
recordOracleEvaluation("source_assets.unexplained_reusable_asset_loss");
recordOracleEvaluation("source_assets.required_visual_slots_filled_fraction");
recordOracleEvaluation("source_assets.source_corpus_completed");
recordOracleEvaluation("source_assets.forbidden_candidate_dispositions");
recordOracleEvaluation("source_assets.conditional_rules");

const assets = receipt.assets ?? {};

// A19
requireTrue(
  assets.source_corpus_completed,
  "SOURCE_ASSET_CORPUS_INCOMPLETE",
  "Source asset corpus did not complete"
);

if (
  (assets.raw_source_images ?? 0) <
  oracle.source_assets.minimum_raw_source_images
) {
  fail(
    "SOURCE_ASSET_CORPUS_EMPTY",
    "Insufficient raw source images"
  );
}

if (
  (assets.authorized_reusable_images ?? 0) <
  oracle.source_assets.minimum_authorized_reusable_images
) {
  fail(
    "AUTHORIZED_SOURCE_ASSETS_MISSING",
    "Insufficient authorized reusable source images"
  );
}

if (
  (assets.selected_source_images ?? 0) <
  oracle.source_assets.minimum_selected_source_images
) {
  fail(
    "SOURCE_IMAGE_REUSE_MISSING",
    "Authorized Safe Haven source image selection requirement not met"
  );
}

requireEq(
  assets.unexplained_reusable_asset_loss,
  oracle.source_assets.unexplained_reusable_asset_loss,
  "SOURCE_ASSET_REUSE_UNEXPLAINED",
  "Reusable source assets disappeared without disposition"
);

requireEq(
  assets.required_visual_slots_filled_fraction,
  oracle.source_assets.required_visual_slots_filled_fraction,
  "VISUAL_ASSET_REQUIREMENT_UNSATISFIED",
  "Required visual slots were not fully resolved"
);

requireEq(
  assets.donor_asset_hash_matches,
  oracle.donor_evidence.candidate_donor_asset_hash_matches,
  "DONOR_ASSET_REUSED",
  "Candidate contains donor asset bytes"
);

// A20
if (!Array.isArray(assets.candidate_dispositions)) {
  fail(
    "CANDIDATE_ASSET_DISPOSITION_EVIDENCE_MISSING",
    "Candidate asset disposition evidence missing"
  );
} else {
  const forbidden = new Set(
    oracle.source_assets.forbidden_candidate_dispositions ?? []
  );

  const bad =
    assets.candidate_dispositions.filter((x) => forbidden.has(x));

  if (bad.length > 0) {
    fail(
      "FORBIDDEN_CANDIDATE_ASSET_DISPOSITION",
      "Forbidden candidate asset disposition observed",
      bad
    );
  }
}

// A21
const conditionalInputs = [
  "eligible_source_project_proof_count",
  "selected_source_project_proof_count",
  "eligible_source_gallery_count",
  "selected_source_gallery_count",
];

for (const field of conditionalInputs) {
  requireFiniteNumber(
    assets[field],
    "SOURCE_ASSET_CONDITIONAL_EVIDENCE_MISSING",
    `Missing source-asset conditional evidence: ${field}`
  );
}

requirePresent(
  wbb?.project_proof_required,
  "BLUEPRINT_PROJECT_PROOF_REQUIREMENT_MISSING",
  "Blueprint project-proof requirement evidence missing"
);

requirePresent(
  wbb?.gallery_required,
  "BLUEPRINT_GALLERY_REQUIREMENT_MISSING",
  "Blueprint gallery requirement evidence missing"
);

if (
  assets.eligible_source_project_proof_count > 0 &&
  wbb?.project_proof_required === true &&
  !(assets.selected_source_project_proof_count > 0)
) {
  fail(
    "REQUIRED_SOURCE_PROJECT_PROOF_NOT_SELECTED",
    "Eligible source project-proof photography existed but none was selected"
  );
}

if (
  assets.eligible_source_gallery_count > 0 &&
  wbb?.gallery_required === true &&
  !(assets.selected_source_gallery_count > 0)
) {
  fail(
    "REQUIRED_SOURCE_GALLERY_NOT_SELECTED",
    "Eligible source gallery photography existed but none was selected"
  );
}

/* =========================================================
 * SITE INTEGRITY — A22/A23/A24
 * ======================================================= */

recordOracleEvaluation("site_integrity.built_routes");
recordOracleEvaluation("site_integrity.reachable_routes");
recordOracleEvaluation("site_integrity.broken_internal_links");
recordOracleEvaluation("site_integrity.placeholder_count");
recordOracleEvaluation("site_integrity.per_route");
recordOracleEvaluation("site_integrity.unique_titles");
recordOracleEvaluation("site_integrity.unique_canonical_urls");

const siteRows = receipt.site?.per_route;

if (!Array.isArray(siteRows)) {
  fail(
    "SITE_PER_ROUTE_EVIDENCE_MISSING",
    "Per-route site integrity evidence missing"
  );
} else {
  requireExactRoutes(
    siteRows.map((r) => r.route),
    expectedRoutes,
    "SiteIntegrity"
  );

  for (const row of siteRows) {
    if (row.http_status !== 200) {
      fail(
        "ROUTE_HTTP_STATUS_INVALID",
        `${row.route} did not return HTTP 200`,
        row.http_status
      );
    }

    if (row.h1_count !== 1) {
      fail(
        "ROUTE_H1_COUNT_INVALID",
        `${row.route} must contain exactly one H1`,
        row.h1_count
      );
    }

    requireNonEmpty(
      row.title,
      "ROUTE_TITLE_MISSING",
      `${row.route} title missing`
    );

    requireNonEmpty(
      row.meta_description,
      "ROUTE_META_DESCRIPTION_MISSING",
      `${row.route} meta description missing`
    );

    requireNonEmpty(
      row.canonical,
      "ROUTE_CANONICAL_MISSING",
      `${row.route} canonical missing`
    );

    requireNonEmpty(
      row.lang,
      "ROUTE_LANG_MISSING",
      `${row.route} lang attribute missing`
    );
  }

  // A23
  const uniqueTitles =
    new Set(
      siteRows
        .map((r) => r.title?.trim())
        .filter(Boolean)
    ).size;

  requireEq(
    uniqueTitles,
    oracle.site_integrity.unique_titles,
    "DUPLICATE_PAGE_TITLE",
    "Unique title count violates oracle"
  );

  // A24
  const uniqueCanonicals =
    new Set(
      siteRows
        .map((r) => r.canonical?.trim())
        .filter(Boolean)
    ).size;

  requireEq(
    uniqueCanonicals,
    oracle.site_integrity.unique_canonical_urls,
    "DUPLICATE_CANONICAL_URL",
    "Unique canonical URL count violates oracle"
  );
}

requireEq(
  receipt.site?.built_routes,
  oracle.site_integrity.built_routes,
  "SITE_BUILT_ROUTE_COUNT_MISMATCH",
  "Built route count violates oracle"
);

requireEq(
  receipt.site?.reachable_routes,
  oracle.site_integrity.reachable_routes,
  "SITE_REACHABILITY_INCOMPLETE",
  "All expected routes must be reachable"
);

requireEq(
  receipt.site?.broken_internal_links,
  oracle.site_integrity.broken_internal_links,
  "BROKEN_INTERNAL_LINKS",
  "Candidate contains broken internal links"
);

requireEq(
  receipt.site?.placeholder_count,
  oracle.site_integrity.placeholder_count,
  "PLACEHOLDER_FOUND",
  "Candidate contains placeholder content"
);

/* =========================================================
 * LLM AUDIT — A26/A27
 * ======================================================= */

recordOracleEvaluation("llm_audit.direct_provider_bypass_count");
recordOracleEvaluation("llm_audit.required_policy.SEO_CONTENT_BLUEPRINT");
recordOracleEvaluation("llm_audit.required_policy.STRUCTURED_CONTENT_GENERATION");
recordOracleEvaluation("llm_audit.required_policy.CONTENT_VALIDATION");
recordOracleEvaluation("llm_audit.required_policy.VISUAL_QA");
recordOracleEvaluation("llm_audit.unsupported_capability_combination_count");

requireEq(
  receipt.llm_audit?.direct_provider_bypass_count,
  oracle.llm_audit.direct_provider_bypass_count,
  "PROVIDER_BYPASS_DETECTED",
  "Governed LLM operations bypassed LLM-Router"
);

// Dynamic required-policy coverage includes VISUAL_QA from oracle.json.
for (const [operation, requiredPolicy] of Object.entries(
  oracle.llm_audit.required_policy ?? {}
)) {
  const calls =
    receipt.llm_audit?.operations?.[operation];

  if (!Array.isArray(calls) || calls.length === 0) {
    fail(
      "LLM_AUDIT_OPERATION_MISSING",
      `LLM audit evidence missing for ${operation}`
    );
    continue;
  }

  for (const call of calls) {
    if ("searchRequired" in requiredPolicy) {
      requireEq(
        call.searchRequired,
        requiredPolicy.searchRequired,
        `${operation}_SEARCH_POLICY_VIOLATION`,
        `${operation} searchRequired violates oracle`
      );
    }

    if ("searchPolicySource" in requiredPolicy) {
      requireEq(
        call.searchPolicySource,
        requiredPolicy.searchPolicySource,
        `${operation}_SEARCH_POLICY_SOURCE_VIOLATION`,
        `${operation} searchPolicySource violates oracle`
      );
    }
  }
}

// A27
requireEq(
  receipt.llm_audit?.unsupported_capability_combination_count,
  oracle.llm_audit.unsupported_capability_combination_count,
  "UNSUPPORTED_LLM_CAPABILITY_COMBINATION",
  "Unsupported Router capability combinations occurred"
);

/* =========================================================
 * VISUAL CAPTURE — A28-A32
 * ======================================================= */

recordOracleEvaluation("visual_capture.required_pairs");
recordOracleEvaluation("visual_capture.candidate_blank_capture_count");
recordOracleEvaluation("visual_capture.baseline_blank_capture_count");
recordOracleEvaluation("visual_capture.route_mismatch_count");
recordOracleEvaluation("visual_capture.viewport_mismatch_count");
recordOracleEvaluation("visual_capture.stale_capture_count");

const pairs = receipt.visual?.pairs;

if (!Array.isArray(pairs)) {
  markInconclusive(
    "VISUAL_CAPTURE_MISSING",
    "Visual capture evidence missing"
  );
}

const visualPairs = Array.isArray(pairs) ? pairs : [];

requireEq(
  visualPairs.length,
  oracle.visual_capture.required_pairs,
  "VISUAL_CAPTURE_INCOMPLETE",
  "Visual pair count violates oracle"
);

const expectedVisualPairKeys =
  new Set(
    (testCase.visual_sentinels ?? []).flatMap(
      (sentinel) =>
        (testCase.viewports ?? []).map(
          (viewport) =>
            `${normalizeRoute(sentinel.route)}::${viewport.id}`
        )
    )
  );

requireEq(
  expectedVisualPairKeys.size,
  oracle.visual_capture.required_pairs,
  "VISUAL_EXPECTED_PAIR_CONFIG_MISMATCH",
  "Case sentinel x viewport set must match oracle required pair count"
);

const observedVisualPairKeys =
  visualPairs.map(
    (pair) =>
      `${normalizeRoute(pair.route)}::${pair.viewport}`
  );

const duplicateVisualPairs =
  duplicateValues(observedVisualPairKeys);

if (duplicateVisualPairs.length > 0) {
  fail(
    "VISUAL_PAIR_DUPLICATE",
    "Visual pair set contains duplicates",
    duplicateVisualPairs
  );
}

const observedVisualPairSet =
  new Set(observedVisualPairKeys);
const missingVisualPairs =
  [...expectedVisualPairKeys].filter(
    (key) => !observedVisualPairSet.has(key)
  );
const extraVisualPairs =
  [...observedVisualPairSet].filter(
    (key) => !expectedVisualPairKeys.has(key)
  );

if (missingVisualPairs.length || extraVisualPairs.length) {
  fail(
    "VISUAL_PAIR_SET_MISMATCH",
    "Visual evidence must contain the exact sentinel x viewport set",
    {
      missing: missingVisualPairs,
      extra: extraVisualPairs,
    }
  );
}

let candidateBlankCount = 0;
let baselineBlankCount = 0;
let routeMismatchCount = 0;
let viewportMismatchCount = 0;
let staleCaptureCount = 0;

for (const pair of visualPairs) {
  if (!requirePresent(
    pair.candidate_blank,
    "VISUAL_CAPTURE_STATE_MISSING",
    `${pair.route}/${pair.viewport} candidate blank state missing`
  )) {
    candidateBlankCount++;
  } else if (pair.candidate_blank === true) {
    candidateBlankCount++;
  }

  if (!requirePresent(
    pair.baseline_blank,
    "VISUAL_CAPTURE_STATE_MISSING",
    `${pair.route}/${pair.viewport} baseline blank state missing`
  )) {
    baselineBlankCount++;
  } else if (pair.baseline_blank === true) {
    baselineBlankCount++;
  }

  if (pair.route_match !== true) {
    routeMismatchCount++;
  }

  if (pair.viewport_match !== true) {
    viewportMismatchCount++;
  }

  if (
    typeof receipt.run?.run_id !== "string" ||
    pair.candidate_run_id !== receipt.run.run_id
  ) {
    staleCaptureCount++;
  }
}

requireEq(
  candidateBlankCount,
  oracle.visual_capture.candidate_blank_capture_count,
  "CANDIDATE_BLANK_CAPTURE",
  "Candidate blank capture count violates oracle"
);

requireEq(
  baselineBlankCount,
  oracle.visual_capture.baseline_blank_capture_count,
  "BASELINE_BLANK_CAPTURE",
  "Baseline blank capture count violates oracle"
);

requireEq(
  routeMismatchCount,
  oracle.visual_capture.route_mismatch_count,
  "VISUAL_ROUTE_MISMATCH",
  "Visual route mismatch count violates oracle"
);

requireEq(
  viewportMismatchCount,
  oracle.visual_capture.viewport_mismatch_count,
  "VISUAL_VIEWPORT_MISMATCH",
  "Visual viewport mismatch count violates oracle"
);

requireEq(
  staleCaptureCount,
  oracle.visual_capture.stale_capture_count,
  "STALE_VISUAL_CAPTURE",
  "Stale candidate capture count violates oracle"
);

/* =========================================================
 * VISUAL ORACLE — A33-A39
 * ======================================================= */

recordOracleEvaluation("visual_oracle.trials_per_pair");
recordOracleEvaluation("visual_oracle.pass.minimum_pair_majority_wins");
recordOracleEvaluation("visual_oracle.pass.maximum_pair_majority_losses");
recordOracleEvaluation("visual_oracle.pass.minimum_candidate_votes");
recordOracleEvaluation("visual_oracle.pass.wilson_lower_bound_must_exceed");
recordOracleEvaluation("visual_oracle.pass.critical_pairs_may_not_lose");
recordOracleEvaluation("visual_oracle.pass.critical_dimensions_may_not_regress");
recordOracleEvaluation("visual_oracle.pass.minimum_weighted_mean_delta");
recordOracleEvaluation("visual_oracle.dimensions");
recordOracleEvaluation("visual_oracle.reveal_candidate_identity_to_judge");
recordOracleEvaluation("visual_oracle.inconclusive.missing_trial");
recordOracleEvaluation("visual_oracle.inconclusive.judge_disagreement_without_majority");
recordOracleEvaluation("visual_oracle.inconclusive.wilson_interval_crosses_required_boundary");

const configuredDimensions =
  oracle.visual_oracle.dimensions ?? {};

const dimensionNames =
  Object.keys(configuredDimensions);

const weightSum =
  Object.values(configuredDimensions)
    .reduce((sum, n) => sum + Number(n), 0);

if (Math.abs(weightSum - 1) > 1e-9) {
  fail(
    "VISUAL_DIMENSION_WEIGHT_INVALID",
    "Visual oracle weights must sum to 1",
    weightSum
  );
}

let candidateVotes = 0;
let totalVotes = 0;
let majorityWins = 0;
let majorityLosses = 0;

const dimensionTotals =
  new Map(dimensionNames.map((d) => [d, 0]));

const dimensionCounts =
  new Map(dimensionNames.map((d) => [d, 0]));

const criticalPairs =
  new Set(
    (oracle.visual_oracle.pass
      .critical_pairs_may_not_lose ?? [])
      .map(normalizeVisualPairKey)
  );

const pairMajorityThreshold =
  Math.floor(oracle.visual_oracle.trials_per_pair / 2) + 1;

for (const pair of visualPairs) {
  const trials = pair.trials;

  // A36
  if (!Array.isArray(trials)) {
    markInconclusive(
      "VISUAL_ORACLE_MISSING_TRIAL",
      `${pair.route}/${pair.viewport} trials missing`
    );
    continue;
  }

  if (
    trials.length !==
    oracle.visual_oracle.trials_per_pair
  ) {
    markInconclusive(
      "VISUAL_ORACLE_MISSING_TRIAL",
      `${pair.route}/${pair.viewport} requires exact trial count`,
      {
        expected: oracle.visual_oracle.trials_per_pair,
        actual: trials.length,
      }
    );
  }

  let pairCandidateVotes = 0;
  let pairBaselineVotes = 0;
  let trialOneOrientation = null;

  for (let trialIndex = 0; trialIndex < trials.length; trialIndex++) {
    const trial = trials[trialIndex];
    totalVotes++;

    // A35 — blindness
    if (
      oracle.visual_oracle.reveal_candidate_identity_to_judge === false
    ) {
      if (trial.blind !== true) {
        fail(
          "VISUAL_JUDGE_NOT_BLIND",
          "Visual trial was not recorded as blind",
          {
            route: pair.route,
            viewport: pair.viewport,
          }
        );
      }

      const manifest = trial.judge_input_manifest;

      if (!manifest) {
        fail(
          "VISUAL_BLINDING_EVIDENCE_MISSING",
          "Judge input manifest missing",
          {
            route: pair.route,
            viewport: pair.viewport,
          }
        );
      } else {
        for (const key of [
          "candidate_identity_exposed",
          "baseline_identity_exposed",
          "repository_identity_exposed",
          "quality_delta_exposed",
          "previous_verdict_exposed",
        ]) {
          if (manifest[key] !== false) {
            fail(
              "VISUAL_JUDGE_NOT_BLIND",
              `Forbidden judge context exposure: ${key}`,
              manifest[key]
            );
          }
        }
      }
    }

    let normalizedPreference =
      trial.normalized_preference;
    let deltas =
      trial.normalized_candidate_delta;

    if (!syntheticCalibration) {
      const label =
        `${pair.route}/${pair.viewport}/trial-${trialIndex + 1}`;
      const orientation =
        validateVisualOrientation(trial.orientation, label);
      const rawJudge = trial.raw_judge;

      if (!rawJudge || typeof rawJudge !== "object") {
        fail(
          "VISUAL_RAW_JUDGE_EVIDENCE_MISSING",
          `${label} raw judge evidence missing`
        );
      }

      if (trialIndex === 0) {
        if (trial.orientation?.randomized !== true) {
          fail(
            "VISUAL_ORIENTATION_RANDOMIZATION_EVIDENCE_MISSING",
            `${label} must record randomized orientation selection`
          );
        }
        trialOneOrientation = orientation;
      } else if (trialIndex === 1) {
        if (trial.orientation?.reversed_from_trial_1 !== true) {
          fail(
            "VISUAL_ORIENTATION_REVERSAL_EVIDENCE_MISSING",
            `${label} must record reversal from trial 1`
          );
        }
        if (
          orientation &&
          trialOneOrientation &&
          !(
            orientation.A === trialOneOrientation.B &&
            orientation.B === trialOneOrientation.A
          )
        ) {
          fail(
            "VISUAL_ORIENTATION_REVERSAL_INVALID",
            `${label} is not the reverse of trial 1`,
            { trial_1: trialOneOrientation, trial_2: orientation }
          );
        }
      } else if (trialIndex === 2) {
        if (
          trial.orientation?.randomized !== true ||
          trial.orientation?.independent !== true
        ) {
          fail(
            "VISUAL_ORIENTATION_RANDOMIZATION_EVIDENCE_MISSING",
            `${label} must record independent randomized orientation selection`
          );
        }
      }

      if (orientation && rawJudge && typeof rawJudge === "object") {
        const recomputedPreference =
          normalizePreferenceFromRaw(rawJudge.preference, orientation);

        if (recomputedPreference === null) {
          markInconclusive(
            "VISUAL_RAW_PREFERENCE_INVALID",
            `${label} raw preference missing/invalid`,
            rawJudge.preference
          );
        } else {
          requireEq(
            normalizedPreference,
            recomputedPreference,
            "VISUAL_NORMALIZATION_MISMATCH",
            `${label} normalized preference does not match raw A/B orientation`
          );
          normalizedPreference = recomputedPreference;
        }

        const rawDimensions = rawJudge.dimensions;
        if (!rawDimensions || typeof rawDimensions !== "object") {
          markInconclusive(
            "VISUAL_RAW_DIMENSIONS_MISSING",
            `${label} raw judge dimensions missing`
          );
        } else {
          const recomputedDeltas = {};
          for (const dimension of dimensionNames) {
            const rawDelta = rawDimensions[dimension];
            if (
              typeof rawDelta !== "number" ||
              !Number.isFinite(rawDelta)
            ) {
              markInconclusive(
                "VISUAL_RAW_DIMENSION_MISSING",
                `${label} raw visual dimension missing: ${dimension}`
              );
              continue;
            }
            if (
              rawDelta < oracle.visual_oracle.score_scale.minimum ||
              rawDelta > oracle.visual_oracle.score_scale.maximum
            ) {
              fail(
                "VISUAL_RAW_DIMENSION_SCORE_OUT_OF_RANGE",
                `${label} raw visual dimension outside oracle score scale: ${dimension}`,
                {
                  value: rawDelta,
                  minimum: oracle.visual_oracle.score_scale.minimum,
                  maximum: oracle.visual_oracle.score_scale.maximum,
                }
              );
              continue;
            }
            recomputedDeltas[dimension] =
              normalizeDeltaFromRaw(rawDelta, orientation);
          }

          if (!deltas || typeof deltas !== "object") {
            markInconclusive(
              "VISUAL_DIMENSIONS_MISSING",
              `${label} normalized visual dimensions missing`
            );
          } else {
            for (const [dimension, recomputedDelta] of
              Object.entries(recomputedDeltas)) {
              requireEq(
                deltas[dimension],
                recomputedDelta,
                "VISUAL_NORMALIZATION_MISMATCH",
                `${label} normalized dimension does not match raw A/B orientation: ${dimension}`
              );
            }
          }
          deltas = recomputedDeltas;
        }
      }
    }

    if (
      normalizedPreference === "CANDIDATE"
    ) {
      pairCandidateVotes++;
      candidateVotes++;
    } else if (
      normalizedPreference === "BASELINE"
    ) {
      pairBaselineVotes++;
    } else if (
      normalizedPreference !== "TIE"
    ) {
      markInconclusive(
        "VISUAL_PREFERENCE_INVALID",
        "Visual trial preference missing/invalid",
        normalizedPreference
      );
    }

    if (!deltas || typeof deltas !== "object") {
      markInconclusive(
        "VISUAL_DIMENSIONS_MISSING",
        "Visual dimension result missing"
      );
      continue;
    }

    for (const dimension of dimensionNames) {
      const delta = deltas[dimension];
      if (
        typeof delta !== "number" ||
        !Number.isFinite(delta)
      ) {
        markInconclusive(
          "VISUAL_DIMENSION_MISSING",
          `Visual dimension missing: ${dimension}`
        );
        continue;
      }
      if (
        delta < oracle.visual_oracle.score_scale.minimum ||
        delta > oracle.visual_oracle.score_scale.maximum
      ) {
        fail(
          "VISUAL_DIMENSION_SCORE_OUT_OF_RANGE",
          `Visual dimension outside oracle score scale: ${dimension}`,
          {
            value: delta,
            minimum: oracle.visual_oracle.score_scale.minimum,
            maximum: oracle.visual_oracle.score_scale.maximum,
          }
        );
        continue;
      }

      dimensionTotals.set(
        dimension,
        dimensionTotals.get(dimension) + delta
      );

      dimensionCounts.set(
        dimension,
        dimensionCounts.get(dimension) + 1
      );
    }
  }

  if (pairCandidateVotes >= pairMajorityThreshold) {
    majorityWins++;
  } else if (pairBaselineVotes >= pairMajorityThreshold) {
    majorityLosses++;
  } else {
    // A37
    markInconclusive(
      "VISUAL_PAIR_NO_MAJORITY",
      `${pair.route}/${pair.viewport} has no trial majority`,
      {
        candidate: pairCandidateVotes,
        baseline: pairBaselineVotes,
      }
    );
  }

  const pairKey =
    `${normalizeRoute(pair.route)}::${pair.viewport}`;

  if (
    criticalPairs.has(pairKey) &&
    pairBaselineVotes >= pairMajorityThreshold
  ) {
    fail(
      "CRITICAL_VISUAL_PAIR_REGRESSED",
      `${pairKey} lost the blind pairwise comparison`
    );
  }
}

if (
  majorityWins <
  oracle.visual_oracle.pass.minimum_pair_majority_wins
) {
  fail(
    "VISUAL_IMPROVEMENT_INSUFFICIENT",
    "Candidate did not win enough visual pairs",
    majorityWins
  );
}

if (
  majorityLosses >
  oracle.visual_oracle.pass.maximum_pair_majority_losses
) {
  fail(
    "VISUAL_REGRESSION_TOO_BROAD",
    "Candidate lost too many visual pairs",
    majorityLosses
  );
}

if (
  candidateVotes <
  oracle.visual_oracle.pass.minimum_candidate_votes
) {
  fail(
    "VISUAL_VOTE_CONFIDENCE_INSUFFICIENT",
    "Candidate did not receive enough blind votes",
    { candidateVotes, totalVotes }
  );
}

if (
  totalVotes !==
  oracle.visual_oracle.pass.total_votes
) {
  markInconclusive(
    "VISUAL_TOTAL_VOTE_COUNT_INCOMPLETE",
    "Visual vote count differs from oracle",
    {
      expected:
        oracle.visual_oracle.pass.total_votes,
      actual: totalVotes,
    }
  );
}

// A38
const wilson =
  wilsonBounds(candidateVotes, totalVotes);

const wilsonBoundary =
  oracle.visual_oracle.pass
    .wilson_lower_bound_must_exceed;

if (!(wilson.lower > wilsonBoundary)) {
  markInconclusive(
    "VISUAL_WILSON_INTERVAL_INCONCLUSIVE",
    "Wilson confidence interval does not clear required boundary",
    {
      candidateVotes,
      totalVotes,
      lower: wilson.lower,
      upper: wilson.upper,
      boundary: wilsonBoundary,
    }
  );
}

/* A34 + A33 */

const dimensionMeans = {};
let weightedMeanDelta = 0;

for (const dimension of dimensionNames) {
  const count =
    dimensionCounts.get(dimension);

  if (!count) {
    markInconclusive(
      "VISUAL_DIMENSION_MISSING",
      `No valid observations for ${dimension}`
    );
    continue;
  }

  const mean =
    dimensionTotals.get(dimension) / count;

  dimensionMeans[dimension] = mean;

  weightedMeanDelta +=
    mean * Number(configuredDimensions[dimension]);
}

if (
  weightedMeanDelta <
  oracle.visual_oracle.pass.minimum_weighted_mean_delta
) {
  fail(
    "VISUAL_WEIGHTED_MEAN_DELTA_INSUFFICIENT",
    "Weighted visual-quality improvement is below oracle threshold",
    {
      weightedMeanDelta,
      required:
        oracle.visual_oracle.pass
          .minimum_weighted_mean_delta,
    }
  );
}

for (
  const dimension of
  oracle.visual_oracle.pass
    .critical_dimensions_may_not_regress ?? []
) {
  const mean =
    dimensionMeans[dimension];

  if (typeof mean !== "number") {
    markInconclusive(
      "CRITICAL_VISUAL_DIMENSION_MISSING",
      `Critical visual dimension missing: ${dimension}`
    );
  } else if (mean < 0) {
    fail(
      "CRITICAL_VISUAL_DIMENSION_REGRESSED",
      `${dimension} regressed`,
      { mean }
    );
  }
}

/* =========================================================
 * FINAL VERDICT — A39
 * ======================================================= */

recordOracleEvaluation("final_verdict.pass_requires.all_hard_gates_pass");
recordOracleEvaluation("final_verdict.pass_requires.visual_oracle_pass");
recordOracleEvaluation("final_verdict.pass_requires.rendered_visual_qa_executed");
requireTrue(
  receipt.visual?.rendered_visual_qa_executed,
  "RENDERED_VISUAL_QA_NOT_EXECUTED",
  "Golden PASS requires rendered visual QA"
);
recordOracleEvaluation("final_verdict.pass_requires.no_inconclusive_blocking_dimension");

const passNames =
  oracle.final_verdict;

if (
  evaluatedOracleProperties.size !==
  EXPECTED_ORACLE_EVALUATION_COUNT
) {
  fail(
    "ORACLE_EVALUATION_COVERAGE_INCOMPLETE",
    "Verifier did not execute all declared oracle property evaluations",
    {
      expected: EXPECTED_ORACLE_EVALUATION_COUNT,
      actual: evaluatedOracleProperties.size,
      evaluated: [...evaluatedOracleProperties].sort(),
    }
  );
}

let verdict;

if (
  hardFailures.length === 0 &&
  inconclusive.length === 0
) {
  verdict =
    passNames.pass_name;
} else if (
  hardFailures.length === 0 &&
  inconclusive.length > 0
) {
  verdict =
    passNames.structural_only_name;
} else {
  verdict =
    passNames.fail_name;
}

const result = {
  schema: "l9.golden-oracle-result/v2",

  oracle_id:
    oracle.oracle_id,

  case_id:
    testCase.case_id,

  evaluated_at:
    new Date().toISOString(),

  hard_gate_failures:
    hardFailures,

  blocking_inconclusive_states:
    inconclusive,

  oracle_evaluation_coverage: {
    expected: EXPECTED_ORACLE_EVALUATION_COUNT,
    executed: evaluatedOracleProperties.size,
    evaluation_ids: [...evaluatedOracleProperties].sort(),
  },

  calibration: {
      synthetic: syntheticCalibration,
      synthetic_receipt: syntheticReceipt,
      calibration_mode: calibrationMode
    },

  metrics: {
    candidate_visual_votes: candidateVotes,
    total_visual_votes: totalVotes,

    visual_majority_wins: majorityWins,
    visual_majority_losses: majorityLosses,

    visual_wilson_lower_bound:
      wilson.lower,

    visual_wilson_upper_bound:
      wilson.upper,

    visual_dimension_means:
      dimensionMeans,

    visual_weighted_mean_delta:
      weightedMeanDelta,
  },

  verdict,
};

console.log(
  JSON.stringify(result, null, 2)
);

/*
 * A Golden PASS is the only zero exit.
 * STRUCTURAL_E2E_PASS_VISUAL_UNPROVEN is intentionally nonzero:
 * it is not a Golden PASS.
 */
process.exit(
  verdict === passNames.pass_name
    ? 0
    : 1
);