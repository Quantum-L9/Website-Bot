#!/usr/bin/env node
/**
 * Safe Haven Golden E2E verifier — conformed to tests/golden/safehaven/oracle.json.
 *
 * oracle.json is the normative authority; this implementation reads oracle
 * configuration dynamically (preflight checks, ordered subsequence, forbidden
 * stages, donor classes, batch sizes, repair/generation budgets, section
 * aliases, critical pairs/dimensions, dimension weights, thresholds, route
 * requirements, forbidden dispositions). Missing oracle configuration fails
 * closed — it is never silently defaulted to a passing value.
 *
 * Philosophy (oracle.json `philosophy`):
 *   - missing_evidence_is_failure: true   -> absent evidence FAILS closed
 *   - inconclusive_is_pass: false         -> a blocking inconclusive state
 *                                            cannot produce GOLDEN_E2E_PASS_IMPROVED
 *   - structural_pass_can_claim_visual_improvement: false
 *
 * Three verdicts (oracle `final_verdict`):
 *   GOLDEN_E2E_PASS_IMPROVED             hard_gate_failures == 0 AND
 *                                        blocking_inconclusive_states == 0
 *   STRUCTURAL_E2E_PASS_VISUAL_UNPROVEN  hard_gate_failures == 0 but a
 *                                        blocking inconclusive state exists
 *   GOLDEN_E2E_FAIL                      any hard gate failure
 *
 * Determinism: this verifier is pure deterministic JS. It never invokes an
 * LLM and produces identical semantic output across runs (excluding
 * `evaluated_at`).
 *
 * Receipt schema consumed (receipt.* paths read by this verifier):
 *   identity.<website_bot|seo_bot|llm_router>.sha             (required, full SHA)
 *   identity.<website_bot|seo_bot>.llm_router_version         (equal versions)
 *   identity.llm_router.package_version                       (== bot versions)
 *   identity.<website_bot|seo_bot|llm_router>.worktree_state  ("CLEAN" | {status:"DIRTY", deterministic_identity})
 *   identity.bot_interop.{website_bot_version,seo_bot_version,compatible}
 *   run.build_intent (REDESIGN_IMPROVE), run.copy_fallback_used, run.generic_fallback_used
 *   run.run_id                                                (stale-capture anchor)
 *   events[]                                                  ({name} ordered stage log)
 *   preflight.{status, checks[]}
 *   competitive_landscape.{selected_donors[], evidence_complete, ranking_llm_calls, artifact_ref}
 *   donor_evidence[]                                          ({domain, successful_pages, screenshots, evidence_digest, crawled_at})
 *   website_build_blueprint.{artifact_ref, competitive_landscape_ref, visual_requirements, project_proof_required, gallery_required}
 *   seo_content_blueprint.{routes, batch_size, batch_count, competitive_landscape_ref, unknown_content_slots, invalid_internal_link_targets}
 *   page_content_contract.{routes, artifact_ref, llm_calls, unplaced_requirements, invalid_business_facts, determinism{digest_run_1,digest_run_2}}
 *   structured_content.{routes, page_content_contract_ref, route_results[]}
 *   structured_content.route_results[i].{route_id, schema_errors, unsupported_claims, failed_requirements, repair_attempts, generation_calls, prose_without_blocks, sections[], section_alias_fields[]}
 *   legacy.{content_generation_calls, schema_llm_calls, redesign_schema_llm_calls}
 *   assets.{raw_source_images, authorized_reusable_images, selected_source_images, unexplained_reusable_asset_loss,
 *           required_visual_slots_filled_fraction, donor_asset_hash_matches, source_corpus_completed,
 *           candidate_dispositions[], eligible_source_project_proof_count, selected_source_project_proof_count,
 *           eligible_source_gallery_count, selected_source_gallery_count}
 *   site.{routes, reachable_routes, broken_internal_links, placeholder_count, per_route[]}
 *   site.per_route[i].{route, http_status, h1_count, title_present, meta_description_present, canonical_present, lang_present, title, canonical}
 *   business_truth.{unsupported_claim_count, phone_mismatch_count, email_mismatch_count, prohibition_violations}
 *   llm_audit.{direct_provider_bypass_count, unsupported_capability_combination_count, operations{}}
 *   llm_audit.operations.<SEO_CONTENT_BLUEPRINT|STRUCTURED_CONTENT_GENERATION|CONTENT_VALIDATION|VISUAL_QA>[i].{searchRequired, searchPolicySource}
 *   visual.pairs[] ({route, viewport, candidate_blank, baseline_blank, route_match, viewport_match, captured_run_id, trials[]})
 *   visual.pairs[i].trials[j].{normalized_preference, normalized_candidate_delta{}, judge_input_manifest, blind}
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonWithinRoot } from "./lib/repo-path.mjs";

const ROOT = process.cwd();
/** Parse a JSON input, refusing anything that resolves outside the checkout. */
function readJson(candidatePath, label) {
  return readJsonWithinRoot(ROOT, candidatePath, label);
}

/**
 * Identifier whitelist applied before any externally sourced id is echoed
 * into the printed result. The output is rebuilt character-by-character
 * from this constant alphabet (never sliced out of the input), so nothing
 * outside [A-Za-z0-9._-] — and no tainted bytes — can reach the log sink.
 */
const IDENTIFIER_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-";
function sanitizeIdentifier(value) {
  let out = "";
  for (const ch of String(value ?? "").slice(0, 128)) {
    const idx = IDENTIFIER_ALPHABET.indexOf(ch);
    if (idx >= 0) out += IDENTIFIER_ALPHABET[idx];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Pure helpers (exported for the unit suite under tests/golden/safehaven)
 * ------------------------------------------------------------------ */

/** Normalized route key: trimmed, trailing slashes removed, "/" preserved. */
export function normalizedRoute(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") || "/" : String(value);
}

/** Wilson score lower bound (95% default). */
export function wilsonLowerBound(successes, n, z = 1.96) {
  if (!n) return 0;
  const p = successes / n;
  const z2 = z * z;
  const numerator = p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const denominator = 1 + z2 / n;
  return numerator / denominator;
}

/**
 * A/B orientation normalizer (oracle `score_scale` before orientation
 * normalization: -2 strongly A/left, +2 strongly B/right, 0 tie).
 * `candidateOnLeft` tells which side the candidate was rendered on.
 * Reversing the orientation reverses the normalized preference.
 */
export function normalizePreference(rawScore, candidateOnLeft) {
  const score = Number(rawScore);
  if (!Number.isFinite(score) || score === 0) return "TIE";
  const rightSideWins = score > 0;
  const winnerIsCandidate = candidateOnLeft ? !rightSideWins : rightSideWins;
  return winnerIsCandidate ? "CANDIDATE" : "BASELINE";
}

/**
 * Weighted mean candidate delta (oracle ORACLE-092 formula):
 *   sum(mean_candidate_delta[d] * weight[d]) over all configured dimensions.
 * Returns null when no delta evidence exists at all.
 */
export function weightedMeanDelta(dimensionTotals, dimensionTrials, weights) {
  if (!dimensionTrials) return null;
  let sum = 0;
  for (const [dimension, weight] of Object.entries(weights ?? {})) {
    sum += ((dimensionTotals.get(dimension) ?? 0) / dimensionTrials) * weight;
  }
  return sum;
}

/** Visual pair key used for critical-pair matching ("/::desktop"). */
export function criticalPairKey(route, viewport) {
  return `${normalizedRoute(route)}::${viewport}`;
}

/** Route multiset: normalized route -> occurrence count (cardinality preserved). */
export function routeMultiset(values) {
  const multiset = new Map();
  for (const value of values ?? []) {
    const key = normalizedRoute(value);
    multiset.set(key, (multiset.get(key) ?? 0) + 1);
  }
  return multiset;
}

/**
 * Multiset route comparison. Returns { missing, extra, duplicates } where
 * each entry is [normalizedRoute, count]. Set-only comparison is forbidden
 * for ORACLE-033: a duplicated route must be detected, not deduped away.
 */
export function compareRouteMultiset(actual, expected) {
  const a = routeMultiset(actual);
  const e = routeMultiset(expected);
  const missing = [];
  const extra = [];
  const duplicates = [];
  for (const [key, expectedCount] of e) {
    const actualCount = a.get(key) ?? 0;
    if (actualCount < expectedCount) missing.push([key, expectedCount - actualCount]);
  }
  for (const [key, actualCount] of a) {
    const expectedCount = e.get(key) ?? 0;
    if (actualCount > expectedCount) {
      if (expectedCount === 0) extra.push([key, actualCount]);
      else duplicates.push([key, actualCount - expectedCount]);
    }
  }
  return { missing, extra, duplicates };
}

/**
 * Event alias binding (ORACLE-011): the oracle stage
 * `seo-build-intelligence-preflight` maps to the receipt event name
 * `seo-build-intelligence-preflight:PASS` (as the verifier already consumes it);
 * the other 14 stage names match runtime literals.
 */
export const STAGE_ALIASES = { "seo-build-intelligence-preflight": "seo-build-intelligence-preflight:PASS" };

/**
 * Required-ordered-subsequence (ORACLE-011). Returns violations as
 * { code: "REQUIRED_STAGE_MISSING" | "REQUIRED_STAGE_ORDER_VIOLATION", stage, ... }.
 */
export function orderedSubsequenceViolations(requiredStages, events) {
  const nameOf = (stage) => STAGE_ALIASES[stage] ?? stage;
  const indexOf = (stage) => {
    const name = nameOf(stage);
    return events.findIndex((event) => event?.name === name);
  };
  const violations = [];
  let lastIndex = -1;
  for (const stage of requiredStages) {
    const index = indexOf(stage);
    if (index < 0) violations.push({ code: "REQUIRED_STAGE_MISSING", stage, expectedEventName: nameOf(stage) });
    else if (index <= lastIndex) violations.push({ code: "REQUIRED_STAGE_ORDER_VIOLATION", stage, index, lastIndex });
    else lastIndex = index;
  }
  return violations;
}

/** Three-verdict classification (oracle ORACLE-101 closure). */
export function classifyVerdict(hardFailures, blockingInconclusiveStates) {
  if (hardFailures.length === 0 && blockingInconclusiveStates.length === 0) return "GOLDEN_E2E_PASS_IMPROVED";
  if (hardFailures.length === 0) return "STRUCTURAL_E2E_PASS_VISUAL_UNPROVEN";
  return "GOLDEN_E2E_FAIL";
}

/* ------------------------------------------------------------------ *
 * Verifier state
 * ------------------------------------------------------------------ */

function createVerifier(oracle) {
  const failures = [];
  const blockingInconclusive = [];
  function fail(code, message, evidence = undefined) {
    failures.push({ code, message, evidence });
  }
  function inconclusive(code, message, evidence = undefined, oracleIds = []) {
    blockingInconclusive.push({ code, message, evidence, ...(oracleIds.length ? { oracle_ids: oracleIds } : {}) });
  }
  function requireTrue(value, code, message, evidence) {
    if (value !== true) fail(code, message, evidence ?? value);
  }
  function requireFalse(value, code, message, evidence) {
    if (value !== false) fail(code, message, evidence ?? value);
  }
  function requireEq(actual, expected, code, message) {
    if (actual !== expected) fail(code, message, { expected, actual });
  }
  function requireNonEmpty(value, code, message) {
    if (typeof value !== "string" || value.trim() === "") fail(code, message, value);
  }

  /** Oracle-config helpers: missing configuration fails closed with the given code. */
  function oracleNumber(section, key, code, message) {
    const value = section?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(code, `oracle configuration missing: ${message ?? key}`);
      return undefined;
    }
    return value;
  }
  function oracleBool(section, key, code, message) {
    const value = section?.[key];
    if (typeof value !== "boolean") {
      fail(code, `oracle configuration missing: ${message ?? key}`);
      return undefined;
    }
    return value;
  }
  function oracleNonEmptyArray(section, key, code, message) {
    const value = section?.[key];
    if (!Array.isArray(value) || value.length === 0) {
      fail(code, `oracle configuration missing: ${message ?? key}`);
      return undefined;
    }
    return value;
  }
  function oracleString(section, key, code, message) {
    const value = section?.[key];
    if (typeof value !== "string" || value.trim() === "") {
      fail(code, `oracle configuration missing: ${message ?? key}`);
      return undefined;
    }
    return value;
  }

  function normalizedSet(values) {
    return new Set((values ?? []).map((v) => (typeof v === "string" ? normalizedRoute(v) : String(v))));
  }
  function requireExactSet(actual, expected, code, message) {
    const a = normalizedSet(actual);
    const e = normalizedSet(expected);
    const missing = [...e].filter((x) => !a.has(x));
    const extra = [...a].filter((x) => !e.has(x));
    if (missing.length || extra.length) fail(code, message, { missing, extra, actualCount: a.size, expectedCount: e.size });
  }
  /** Multiset variant (ORACLE-033): duplicates additionally fail. */
  function requireExactRouteMultiset(actual, expected, code, message, duplicateCode) {
    const { missing, extra, duplicates } = compareRouteMultiset(actual, expected);
    if (missing.length || extra.length) fail(code, message, { missing, extra });
    for (const [route, copies] of duplicates) {
      fail(duplicateCode, `${route} appears ${copies + 1} times in the route set`, { route, extraCopies: copies });
    }
  }
  function requireBefore(events, firstName, secondName, code) {
    const first = events.findIndex((e) => e.name === firstName);
    const second = events.findIndex((e) => e.name === secondName);
    if (first < 0 || second < 0 || first >= second) fail(code, `${firstName} must occur before ${secondName}`, { firstIndex: first, secondIndex: second });
  }

  function verify(receipt, testCase) {
    /* ---------------- IDENTITY (ORACLE-001..004) ---------------- */
    for (const repo of ["website_bot", "seo_bot", "llm_router"]) requireNonEmpty(receipt.identity?.[repo]?.sha, "IDENTITY_SHA_MISSING", `${repo} full SHA missing`);

    const websiteRouter = receipt.identity?.website_bot?.llm_router_version;
    const seoRouter = receipt.identity?.seo_bot?.llm_router_version;
    const routerIdentity = receipt.identity?.llm_router?.package_version;
    requireEq(websiteRouter, seoRouter, "ROUTER_VERSION_MISMATCH", "Website-Bot and SEO-Bot must load the same Router version");
    requireEq(websiteRouter, routerIdentity, "ROUTER_IDENTITY_MISMATCH", "Consumer Router version must equal tested Router package identity");

    // ORACLE-003 require_clean_or_explicitly_recorded_worktrees
    for (const repo of ["website_bot", "seo_bot", "llm_router"]) {
      const state = receipt.identity?.[repo]?.worktree_state;
      if (state === undefined || state === null) fail("WORKTREE_STATE_MISSING", `${repo} worktree_state evidence missing`);
      else if (state === "CLEAN") {
        /* accepted */
      } else if (
        typeof state === "object" &&
        state.status === "DIRTY" &&
        typeof state.deterministic_identity === "string" &&
        state.deterministic_identity.trim() !== ""
      ) {
        /* explicitly recorded deterministic dirty-state identity — accepted */
      } else {
        fail("WORKTREE_STATE_UNRECORDED_DIRTY", `${repo} worktree is DIRTY without a recorded deterministic dirty-state identity`, state);
      }
    }

    // ORACLE-004 require_bot_interop_compatibility
    const botInterop = receipt.identity?.bot_interop;
    if (botInterop === undefined || botInterop === null) {
      fail("BOT_INTEROP_EVIDENCE_MISSING", "identity.bot_interop evidence missing");
    } else {
      requireNonEmpty(botInterop.website_bot_version, "BOT_INTEROP_EVIDENCE_MISSING", "bot interop website_bot_version missing");
      requireNonEmpty(botInterop.seo_bot_version, "BOT_INTEROP_EVIDENCE_MISSING", "bot interop seo_bot_version missing");
      if (botInterop.compatible !== true) fail("BOT_INTEROP_MISMATCH", "bot interop compatibility not proven", botInterop.compatible);
    }

    /* ---------------- EXECUTION GRAPH (ORACLE-008..012) ---------------- */
    const execGraph = oracle.execution_graph ?? {};
    const buildIntent = oracleString(execGraph, "build_intent", "WRONG_BUILD_INTENT", "execution_graph.build_intent");
    if (buildIntent !== undefined) requireEq(receipt.run?.build_intent, buildIntent, "WRONG_BUILD_INTENT", "Golden run must execute REDESIGN_IMPROVE");
    const copyFallbackAllowed = oracleBool(execGraph, "copy_fallback_used", "COPY_FALLBACK_USED", "execution_graph.copy_fallback_used");
    if (copyFallbackAllowed !== undefined) requireFalse(receipt.run?.copy_fallback_used, "COPY_FALLBACK_USED", "COPY fallback is forbidden");
    const genericFallbackAllowed = oracleBool(execGraph, "generic_fallback_used", "GENERIC_FALLBACK_USED", "execution_graph.generic_fallback_used");
    if (genericFallbackAllowed !== undefined) requireFalse(receipt.run?.generic_fallback_used, "GENERIC_FALLBACK_USED", "Generic fallback is forbidden");

    const events = receipt.events ?? [];
    requireBefore(events, "seo-build-intelligence-preflight:PASS", "seo:createCompetitiveLandscape", "SEO_PREFLIGHT_TOO_LATE");

    // ORACLE-011 required_ordered_subsequence (15 stages, relative order)
    const requiredStages = oracleNonEmptyArray(execGraph, "required_ordered_subsequence", "REQUIRED_STAGE_MISSING", "execution_graph.required_ordered_subsequence");
    if (requiredStages !== undefined) {
      for (const violation of orderedSubsequenceViolations(requiredStages, events)) {
        fail(violation.code, violation.code === "REQUIRED_STAGE_MISSING" ? `required stage ${violation.stage} missing` : `stage ${violation.stage} executed out of order`, { stage: violation.stage, expectedEventName: violation.expectedEventName, index: violation.index, lastIndex: violation.lastIndex });
      }
    }

    // ORACLE-012 forbidden_stages_under_redesign
    const forbiddenStages = oracleNonEmptyArray(execGraph, "forbidden_stages_under_redesign", "FORBIDDEN_REDESIGN_STAGE_EXECUTED", "execution_graph.forbidden_stages_under_redesign");
    if (forbiddenStages !== undefined) {
      for (const event of events) {
        const name = event?.name ?? "";
        for (const forbidden of forbiddenStages) {
          if (name === forbidden || name.startsWith(`${forbidden}:`)) {
            fail("FORBIDDEN_REDESIGN_STAGE_EXECUTED", `forbidden stage ${forbidden} executed under REDESIGN_IMPROVE`, event);
          }
        }
      }
    }

    /* ---------------- PREFLIGHT (ORACLE-005..007) ---------------- */
    // ORACLE-006 preflight.required
    const preflight = receipt.preflight;
    if (preflight?.status === undefined || preflight?.status === null) {
      fail("PREFLIGHT_MISSING", "preflight.status evidence missing");
    } else if (preflight.status !== "PASS") {
      fail("PREFLIGHT_NOT_READY", "preflight did not report PASS", preflight.status);
    }
    // ORACLE-007 preflight.required_checks
    const requiredChecks = oracleNonEmptyArray(oracle.preflight ?? {}, "required_checks", "PREFLIGHT_CHECK_MISSING", "preflight.required_checks");
    if (requiredChecks !== undefined) {
      const checks = preflight?.checks;
      if (!Array.isArray(checks)) {
        fail("PREFLIGHT_CHECK_MISSING", "preflight.checks evidence missing");
      } else {
        const seen = new Set();
        for (const check of checks) {
          const name = check?.name;
          const status = check?.status;
          if (typeof name !== "string" || name.trim() === "") {
            fail("PREFLIGHT_CHECK_MISSING", "a preflight check lacks a name", check);
            continue;
          }
          if (seen.has(name)) fail("PREFLIGHT_CHECK_DUPLICATE", `preflight check ${name} recorded more than once`, name);
          seen.add(name);
          if (status !== "PASS") fail("PREFLIGHT_CHECK_FAILED", `preflight check ${name} did not PASS`, status);
        }
        for (const required of requiredChecks) {
          if (!seen.has(required)) fail("PREFLIGHT_CHECK_MISSING", `required preflight check ${required} missing`, required);
        }
      }
    }

    /* ---------------- COMPETITIVE LANDSCAPE (ORACLE-013..018) ---------------- */
    const competitive = receipt.competitive_landscape ?? {};
    const oracleCompetitive = oracle.competitive_landscape ?? {};
    const selectedDonorCount = oracleNumber(oracleCompetitive, "selected_donor_count", "COMPETITIVE_EVIDENCE_INCOMPLETE", "competitive_landscape.selected_donor_count");
    const forbiddenDonorClasses = oracleNonEmptyArray(oracleCompetitive, "forbidden_selected_classes", "FORBIDDEN_DONOR_CLASS", "competitive_landscape.forbidden_selected_classes");
    if (selectedDonorCount !== undefined) requireEq(competitive.selected_donors?.length, selectedDonorCount, "COMPETITIVE_EVIDENCE_INCOMPLETE", `Exactly ${selectedDonorCount} selected donors required`);
    const domains = (competitive.selected_donors ?? []).map((d) => d.normalized_domain);
    requireEq(new Set(domains).size, selectedDonorCount, "DUPLICATE_DONOR_DOMAIN", "Selected donors must be ten unique normalized companies");
    requireTrue(competitive.evidence_complete, "COMPETITIVE_EVIDENCE_NOT_COMPLETE", "CompetitiveLandscape must be complete");
    requireEq(competitive.ranking_llm_calls, 0, "COMPETITIVE_RANKING_LLM_USED", "Competitive rank authority must be deterministic");
    for (const donor of competitive.selected_donors ?? []) {
      requireTrue(donor.qualified_operating_company, "DONOR_NOT_QUALIFIED", `Unqualified donor selected: ${donor.normalized_domain}`);
      requireNonEmpty(donor.query_id, "DONOR_QUERY_MISSING", `Donor query lineage missing: ${donor.normalized_domain}`);
      requireNonEmpty(donor.url, "DONOR_URL_MISSING", `Donor URL missing: ${donor.normalized_domain}`);
      if (!(Number(donor.rank) >= 1)) fail("DONOR_RANK_INVALID", `Invalid donor rank: ${donor.normalized_domain}`, donor.rank);
      if (!(Number(donor.visibility_contribution) >= 0)) fail("DONOR_VISIBILITY_INVALID", `Visibility evidence missing: ${donor.normalized_domain}`);
      // ORACLE-018 forbidden_selected_classes
      const donorClass = donor.class;
      if (donorClass === undefined || donorClass === null || (typeof donorClass === "string" && donorClass.trim() === "")) {
        fail("DONOR_CLASS_MISSING", `Donor class missing: ${donor.normalized_domain}`, donorClass);
      } else if (forbiddenDonorClasses.includes(donorClass)) {
        fail("FORBIDDEN_DONOR_CLASS", `Forbidden donor class ${donorClass}: ${donor.normalized_domain}`, donorClass);
      }
    }

    /* ---------------- DONOR EVIDENCE (ORACLE-019..024) ---------------- */
    const donorEvidence = receipt.donor_evidence;
    const acceptedDonors = oracleNumber(oracle.donor_evidence ?? {}, "accepted_donors", "DONOR_EVIDENCE_INCOMPLETE", "donor_evidence.accepted_donors");
    if (acceptedDonors !== undefined) requireEq(donorEvidence?.length, acceptedDonors, "DONOR_EVIDENCE_INCOMPLETE", `${acceptedDonors} donor evidence sets required`);
    if (!Array.isArray(donorEvidence)) {
      // missing required evidence: every per-donor property fails closed
      fail("DONOR_CRAWL_INCOMPLETE", "donor_evidence evidence missing");
      fail("DONOR_SCREENSHOT_INCOMPLETE", "donor_evidence evidence missing");
      fail("DONOR_DIGEST_MISSING", "donor_evidence evidence missing");
      fail("DONOR_TIMESTAMP_MISSING", "donor_evidence evidence missing");
    } else {
      for (const donor of donorEvidence) {
        if (typeof donor.successful_pages !== "number" || donor.successful_pages < 1) fail("DONOR_CRAWL_INCOMPLETE", `No successful page for ${donor.domain}`, donor.successful_pages);
        if (typeof donor.screenshots !== "number" || donor.screenshots < 1) fail("DONOR_SCREENSHOT_INCOMPLETE", `No screenshot evidence for ${donor.domain}`, donor.screenshots);
        requireNonEmpty(donor.evidence_digest, "DONOR_DIGEST_MISSING", `Evidence digest missing for ${donor.domain}`);
        // ORACLE-023 per_donor.require_timestamp
        const timestamp = donor.crawled_at;
        if (typeof timestamp !== "string" || timestamp.trim() === "") fail("DONOR_TIMESTAMP_MISSING", `Crawl timestamp missing for ${donor.domain}`, timestamp);
        else if (Number.isNaN(Date.parse(timestamp))) fail("DONOR_TIMESTAMP_INVALID", `Crawl timestamp unparseable for ${donor.domain}`, timestamp);
      }
    }

    /* ---------------- WEBSITE BLUEPRINT (ORACLE-025..027) ---------------- */
    const websiteBlueprint = receipt.website_build_blueprint;
    if (websiteBlueprint === undefined || websiteBlueprint === null) {
      fail("WEBSITE_BLUEPRINT_REQUIRED", "website_build_blueprint evidence missing");
    } else {
      requireNonEmpty(websiteBlueprint.artifact_ref, "WEBSITE_BLUEPRINT_INVALID", "WebsiteBuildBlueprint artifact_ref missing");
      const visualRequirements = websiteBlueprint.visual_requirements;
      const empty = visualRequirements === undefined || visualRequirements === null ||
        (Array.isArray(visualRequirements) && visualRequirements.length === 0) ||
        (typeof visualRequirements === "object" && !Array.isArray(visualRequirements) && Object.keys(visualRequirements).length === 0);
      if (empty) fail("BLUEPRINT_VISUAL_REQUIREMENTS_MISSING", "WebsiteBuildBlueprint visual_requirements missing or empty");
    }

    /* ---------------- SEO CONTENT BLUEPRINT (ORACLE-028..035) ---------------- */
    const expectedRoutes = testCase.routes;
    const seoBlueprint = receipt.seo_content_blueprint ?? {};
    // ORACLE-028/029/033 — multiset comparison preserves cardinality and detects duplicates
    requireExactRouteMultiset(seoBlueprint.routes, expectedRoutes, "ROUTE_SET_MISMATCH", "SEOContentBlueprint must contain the exact frozen Safe Haven route set", "SEO_BLUEPRINT_DUPLICATE_ROUTE");
    const oracleSeo = oracle.seo_content_blueprint ?? {};
    const batchSize = oracleNumber(oracleSeo, "batch_size", "SEO_BATCH_SIZE_DRIFT", "seo_content_blueprint.batch_size");
    if (batchSize !== undefined) requireEq(seoBlueprint.batch_size, batchSize, "SEO_BATCH_SIZE_DRIFT", "SEOContentBlueprint batch size must remain deterministic");
    const batchCount = oracleNumber(oracleSeo, "expected_batch_count", "SEO_BATCH_COUNT_INVALID", "seo_content_blueprint.expected_batch_count");
    if (batchCount !== undefined) requireEq(seoBlueprint.batch_count, batchCount, "SEO_BATCH_COUNT_INVALID", "29 routes at batch size four must use eight batches");

    const landscapeRef = competitive.artifact_ref;
    requireEq(receipt.website_build_blueprint?.competitive_landscape_ref, landscapeRef, "WEBSITE_BLUEPRINT_LANDSCAPE_MISMATCH", "WebsiteBuildBlueprint must reference exact landscape");
    requireEq(seoBlueprint.competitive_landscape_ref, landscapeRef, "SEO_BLUEPRINT_LANDSCAPE_MISMATCH", "SEOContentBlueprint must reference exact landscape");

    // ORACLE-034 unknown_content_slots (presence required — absence fails closed)
    requireEq(seoBlueprint.unknown_content_slots, 0, "SEO_BLUEPRINT_UNKNOWN_CONTENT_SLOT", "SEOContentBlueprint unknown content slots must be zero");
    // ORACLE-035 invalid_internal_link_targets (presence required)
    requireEq(seoBlueprint.invalid_internal_link_targets, 0, "SEO_BLUEPRINT_INVALID_INTERNAL_LINK_TARGET", "SEOContentBlueprint internal link targets must all be authorized");

    /* ---------------- PAGE CONTENT CONTRACT (ORACLE-036..040) ---------------- */
    const pcc = receipt.page_content_contract ?? {};
    requireExactSet(pcc.routes, expectedRoutes, "ROUTE_SET_MISMATCH", "PageContentContract must contain the exact frozen Safe Haven route set");
    requireEq(pcc.llm_calls, 0, "PCC_LLM_USED", "PageContentContract must use zero LLM calls");
    requireEq(pcc.unplaced_requirements, 0, "CONTENT_REQUIREMENT_UNPLACED", "All required SEO content requirements must be placed");
    // ORACLE-039 invalid_business_facts (presence required)
    requireEq(pcc.invalid_business_facts, 0, "PCC_INVALID_BUSINESS_FACT", "PageContentContract invalid business facts must be zero");
    // ORACLE-040 determinism.same_semantic_input_same_digest
    const determinism = pcc.determinism;
    if (determinism === undefined || determinism === null) {
      fail("PCC_NONDETERMINISTIC", "page_content_contract.determinism evidence missing");
    } else {
      const digestRun1 = determinism.digest_run_1;
      const digestRun2 = determinism.digest_run_2;
      if (typeof digestRun1 !== "string" || digestRun1.trim() === "" || typeof digestRun2 !== "string" || digestRun2.trim() === "") {
        fail("PCC_NONDETERMINISTIC", "PCC determinism digest evidence missing", { digest_run_1: digestRun1, digest_run_2: digestRun2 });
      } else if (digestRun1 !== digestRun2) {
        fail("PCC_NONDETERMINISTIC", "PCC digest differs between identical semantic inputs", { digest_run_1: digestRun1, digest_run_2: digestRun2 });
      }
    }
    requireEq(pcc.llm_calls, 0, "PCC_LLM_USED", "PageContentContract must use zero LLM calls"); // ORACLE-052 shares this gate

    /* ---------------- STRUCTURED CONTENT (ORACLE-041..049) ---------------- */
    const structuredContent = receipt.structured_content ?? {};
    requireExactSet(structuredContent.routes, expectedRoutes, "ROUTE_SET_MISMATCH", "StructuredContentPackage must contain the exact frozen Safe Haven route set");
    requireEq(structuredContent.page_content_contract_ref, pcc.artifact_ref, "STRUCTURED_CONTENT_LINEAGE_MISMATCH", "StructuredContentPackage must reference exact PCC");

    const routeResults = structuredContent.route_results;
    const forbiddenSectionAliases = oracleNonEmptyArray(oracle.structured_content ?? {}, "section_alias_fields_forbidden", "STRUCTURED_CONTENT_FORBIDDEN_SECTION_ALIAS", "structured_content.section_alias_fields_forbidden");
    const maxRepairs = oracleNumber(oracle.structured_content ?? {}, "maximum_repairs_per_route", "CONTENT_REPAIR_BUDGET_EXCEEDED", "structured_content.maximum_repairs_per_route");
    const maxGenerationCalls = oracleNumber(oracle.structured_content ?? {}, "maximum_generation_calls_per_route", "CONTENT_GENERATION_BUDGET_EXCEEDED", "structured_content.maximum_generation_calls_per_route");
    if (!Array.isArray(routeResults)) {
      // missing required evidence: every per-route property fails closed
      fail("STRUCTURED_CONTENT_SCHEMA_INVALID", "structured_content.route_results evidence missing");
      fail("UNSUPPORTED_CONTENT_CLAIM", "structured_content.route_results evidence missing");
      fail("CONTENT_REQUIREMENT_UNSATISFIED", "structured_content.route_results evidence missing");
      fail("CONTENT_REPAIR_BUDGET_EXCEEDED", "structured_content.route_results evidence missing");
      fail("CONTENT_GENERATION_BUDGET_EXCEEDED", "structured_content.route_results evidence missing");
      fail("STRUCTURED_CONTENT_FORBIDDEN_SECTION_ALIAS", "structured_content.route_results evidence missing");
      fail("STRUCTURED_CONTENT_BLOCKS_REQUIRED", "structured_content.route_results evidence missing");
    } else {
      for (const route of routeResults) {
        if (typeof route.schema_errors !== "number" || route.schema_errors !== 0) fail("STRUCTURED_CONTENT_SCHEMA_INVALID", `Schema-invalid structured content: ${route.route_id}`, route.schema_errors);
        if (typeof route.unsupported_claims !== "number" || route.unsupported_claims !== 0) fail("UNSUPPORTED_CONTENT_CLAIM", `Unsupported content claim: ${route.route_id}`, route.unsupported_claims);
        if (typeof route.failed_requirements !== "number" || route.failed_requirements !== 0) fail("CONTENT_REQUIREMENT_UNSATISFIED", `Unsatisfied content requirements: ${route.route_id}`, route.failed_requirements);
        if (typeof route.repair_attempts !== "number" || route.repair_attempts > (maxRepairs ?? 1)) fail("CONTENT_REPAIR_BUDGET_EXCEEDED", `${route.route_id} used more than one repair`, route.repair_attempts);
        if (typeof route.generation_calls !== "number" || route.generation_calls > (maxGenerationCalls ?? 2)) fail("CONTENT_GENERATION_BUDGET_EXCEEDED", `${route.route_id} used more than two generation calls`, route.generation_calls);
        if (typeof route.prose_without_blocks !== "number" || route.prose_without_blocks !== 0) fail("STRUCTURED_CONTENT_BLOCKS_REQUIRED", `Prose outside blocks: ${route.route_id}`, route.prose_without_blocks);
        // ORACLE-048 section_alias_fields_forbidden
        const aliasFields = [];
        for (const section of route.sections ?? []) {
          if (section !== null && typeof section === "object") {
            for (const key of Object.keys(section)) if (forbiddenSectionAliases?.includes(key)) aliasFields.push(key);
          }
        }
        for (const alias of Array.isArray(route.section_alias_fields) ? route.section_alias_fields : []) {
          if (forbiddenSectionAliases?.includes(alias)) aliasFields.push(alias);
        }
        if (aliasFields.length) fail("STRUCTURED_CONTENT_FORBIDDEN_SECTION_ALIAS", `Forbidden section alias field(s): ${[...new Set(aliasFields)].join(", ")} on ${route.route_id}`, [...new Set(aliasFields)]);
      }
    }

    /* ---------------- LEGACY AUTHORITY (ORACLE-050..053) ---------------- */
    const legacy = receipt.legacy ?? {};
    requireEq(legacy.content_generation_calls, 0, "LEGACY_CONTENT_AUTHORITY_USED", "Legacy Website-Bot content generation is forbidden");
    requireEq(legacy.schema_llm_calls, 0, "LEGACY_SCHEMA_AUTHORITY_USED", "LLM schema generation is forbidden on redesign");
    // ORACLE-053 redesign_schema_llm_calls (presence required)
    requireEq(legacy.redesign_schema_llm_calls, 0, "REDESIGN_SCHEMA_LLM_AUTHORITY_VIOLATION", "Redesign schema authority must be deterministic (zero LLM calls)");

    /* ---------------- BUSINESS TRUTH (ORACLE-069..072) ---------------- */
    const businessTruth = receipt.business_truth ?? {};
    requireEq(businessTruth.unsupported_claim_count, 0, "UNSUPPORTED_BUSINESS_CLAIM", "Candidate contains unsupported business claims");
    requireEq(businessTruth.phone_mismatch_count, 0, "PHONE_TRUTH_MISMATCH", "Phone truth mismatch");
    requireEq(businessTruth.email_mismatch_count, 0, "EMAIL_TRUTH_MISMATCH", "Email truth mismatch");
    // ORACLE-072 prohibition_violations (presence required)
    requireEq(businessTruth.prohibition_violations, 0, "BUSINESS_PROHIBITION_VIOLATION", "Candidate violates a frozen business prohibition");

    /* ---------------- SOURCE ASSETS (ORACLE-054..061) ---------------- */
    const assets = receipt.assets ?? {};
    if ((assets.raw_source_images ?? 0) < 1) fail("SOURCE_ASSET_CORPUS_EMPTY", "Source asset harvesting found no images");
    if ((assets.authorized_reusable_images ?? 0) < 1) fail("AUTHORIZED_SOURCE_ASSETS_MISSING", "Safe Haven authorization produced no reusable images");
    if ((assets.selected_source_images ?? 0) < 1) fail("SOURCE_IMAGE_REUSE_MISSING", "No authorized Safe Haven source image was selected");
    requireEq(assets.unexplained_reusable_asset_loss, 0, "SOURCE_ASSET_REUSE_UNEXPLAINED", "Reusable source assets disappeared without disposition");
    requireEq(assets.required_visual_slots_filled_fraction, 1, "VISUAL_ASSET_REQUIREMENT_UNSATISFIED", "Every required blueprint visual slot must resolve");
    requireEq(assets.donor_asset_hash_matches, 0, "DONOR_ASSET_REUSED", "Candidate contains donor/competitor asset bytes");
    // ORACLE-059 source_corpus_completed (presence required)
    requireTrue(assets.source_corpus_completed, "SOURCE_ASSET_CORPUS_INCOMPLETE", "Source asset corpus must complete");
    // ORACLE-060 forbidden_candidate_dispositions (presence required)
    const forbiddenDispositions = oracleNonEmptyArray(oracle.source_assets ?? {}, "forbidden_candidate_dispositions", "FORBIDDEN_CANDIDATE_ASSET_DISPOSITION", "source_assets.forbidden_candidate_dispositions");
    const candidateDispositions = assets.candidate_dispositions;
    if (!Array.isArray(candidateDispositions)) {
      fail("FORBIDDEN_CANDIDATE_ASSET_DISPOSITION", "assets.candidate_dispositions evidence missing");
    } else {
      for (const disposition of candidateDispositions) {
        if (forbiddenDispositions?.includes(disposition)) fail("FORBIDDEN_CANDIDATE_ASSET_DISPOSITION", `Forbidden candidate asset disposition: ${disposition}`, disposition);
      }
    }
    // ORACLE-061 conditional_rules (eligible required source photography cannot silently disappear)
    const eligibleProof = assets.eligible_source_project_proof_count;
    const selectedProof = assets.selected_source_project_proof_count;
    const projectProofRequired = receipt.website_build_blueprint?.project_proof_required;
    if (typeof eligibleProof !== "number" || typeof selectedProof !== "number" || typeof projectProofRequired !== "boolean") {
      fail("REQUIRED_SOURCE_PROJECT_PROOF_NOT_SELECTED", "project-proof source asset counts evidence missing", { eligible_source_project_proof_count: eligibleProof, selected_source_project_proof_count: selectedProof, project_proof_required: projectProofRequired });
    } else if (eligibleProof > 0 && projectProofRequired === true && !(selectedProof > 0)) {
      fail("REQUIRED_SOURCE_PROJECT_PROOF_NOT_SELECTED", "eligible required source project-proof photography disappeared", { eligible_source_project_proof_count: eligibleProof, selected_source_project_proof_count: selectedProof });
    }
    const eligibleGallery = assets.eligible_source_gallery_count;
    const selectedGallery = assets.selected_source_gallery_count;
    const galleryRequired = receipt.website_build_blueprint?.gallery_required;
    if (typeof eligibleGallery !== "number" || typeof selectedGallery !== "number" || typeof galleryRequired !== "boolean") {
      fail("REQUIRED_SOURCE_GALLERY_NOT_SELECTED", "gallery source asset counts evidence missing", { eligible_source_gallery_count: eligibleGallery, selected_source_gallery_count: selectedGallery, gallery_required: galleryRequired });
    } else if (eligibleGallery > 0 && galleryRequired === true && !(selectedGallery > 0)) {
      fail("REQUIRED_SOURCE_GALLERY_NOT_SELECTED", "eligible required source gallery photography disappeared", { eligible_source_gallery_count: eligibleGallery, selected_source_gallery_count: selectedGallery });
    }

    /* ---------------- SITE INTEGRITY (ORACLE-062..068) ---------------- */
    requireEq(receipt.site?.routes?.length, 29, "SITE_ROUTE_COUNT_MISMATCH", "Candidate must build all 29 routes");
    requireEq(receipt.site?.reachable_routes, 29, "SITE_REACHABILITY_INCOMPLETE", "All 29 routes must be reachable");
    requireEq(receipt.site?.broken_internal_links, 0, "BROKEN_INTERNAL_LINKS", "Candidate contains broken internal links");
    requireEq(receipt.site?.placeholder_count, 0, "PLACEHOLDER_FOUND", "Candidate contains placeholder content");
    requireExactSet(receipt.site?.routes, expectedRoutes, "ROUTE_SET_MISMATCH", "BuiltSite must contain the exact frozen Safe Haven route set");

    // ORACLE-066/067/068 per-route integrity, unique titles, unique canonical URLs
    const perRoute = receipt.site?.per_route;
    const perRouteReqs = oracle.site_integrity?.per_route;
    if (perRouteReqs === undefined || typeof perRouteReqs !== "object") {
      fail("ROUTE_HTTP_STATUS_INVALID", "oracle site_integrity.per_route configuration missing");
    }
    const reqHttp200 = perRouteReqs?.http_200 !== false;
    const reqSingleH1 = perRouteReqs?.single_h1 !== false;
    const reqTitle = perRouteReqs?.title_present !== false;
    const reqMeta = perRouteReqs?.meta_description_present !== false;
    const reqCanonical = perRouteReqs?.canonical_present !== false;
    const reqLang = perRouteReqs?.lang_present !== false;
    if (perRoute === undefined || perRoute === null || typeof perRoute !== "object") {
      fail("ROUTE_HTTP_STATUS_INVALID", "site.per_route evidence missing");
      fail("ROUTE_H1_COUNT_INVALID", "site.per_route evidence missing");
      fail("ROUTE_TITLE_MISSING", "site.per_route evidence missing");
      fail("ROUTE_META_DESCRIPTION_MISSING", "site.per_route evidence missing");
      fail("ROUTE_CANONICAL_MISSING", "site.per_route evidence missing");
      fail("ROUTE_LANG_MISSING", "site.per_route evidence missing");
      fail("DUPLICATE_PAGE_TITLE", "site.per_route evidence missing");
      fail("DUPLICATE_CANONICAL_URL", "site.per_route evidence missing");
    } else {
      const entryFor = (route) =>
        Array.isArray(perRoute)
          ? perRoute.find((entry) => entry !== null && normalizedRoute(entry.route) === normalizedRoute(route))
          : perRoute[normalizedRoute(route)];
      const titles = new Set();
      const canonicals = new Set();
      let nonEmptyTitles = 0;
      let nonEmptyCanonicals = 0;
      for (const route of expectedRoutes) {
        const entry = entryFor(route);
        if (entry === undefined) {
          fail("ROUTE_HTTP_STATUS_INVALID", `per-route evidence missing for ${route}`, route);
          fail("ROUTE_H1_COUNT_INVALID", `per-route evidence missing for ${route}`, route);
          fail("ROUTE_TITLE_MISSING", `per-route evidence missing for ${route}`, route);
          fail("ROUTE_META_DESCRIPTION_MISSING", `per-route evidence missing for ${route}`, route);
          fail("ROUTE_CANONICAL_MISSING", `per-route evidence missing for ${route}`, route);
          fail("ROUTE_LANG_MISSING", `per-route evidence missing for ${route}`, route);
          continue;
        }
        if (reqHttp200 && entry.http_status !== 200) fail("ROUTE_HTTP_STATUS_INVALID", `${route} returned ${entry.http_status}`, entry.http_status);
        if (reqSingleH1 && entry.h1_count !== 1) fail("ROUTE_H1_COUNT_INVALID", `${route} has ${entry.h1_count} h1 elements`, entry.h1_count);
        if (reqTitle && entry.title_present !== true) fail("ROUTE_TITLE_MISSING", `${route} has no title`, entry.title_present);
        if (reqMeta && entry.meta_description_present !== true) fail("ROUTE_META_DESCRIPTION_MISSING", `${route} has no meta description`, entry.meta_description_present);
        if (reqCanonical && entry.canonical_present !== true) fail("ROUTE_CANONICAL_MISSING", `${route} has no canonical`, entry.canonical_present);
        if (reqLang && entry.lang_present !== true) fail("ROUTE_LANG_MISSING", `${route} has no lang attribute`, entry.lang_present);
        if (typeof entry.title === "string" && entry.title.trim() !== "") { titles.add(entry.title.trim()); nonEmptyTitles++; }
        if (typeof entry.canonical === "string" && entry.canonical.trim() !== "") { canonicals.add(entry.canonical.trim()); nonEmptyCanonicals++; }
      }
      if (nonEmptyTitles !== expectedRoutes.length || titles.size !== expectedRoutes.length) {
        fail("DUPLICATE_PAGE_TITLE", `expected ${expectedRoutes.length} unique non-empty page titles, got ${titles.size} unique / ${nonEmptyTitles} non-empty`, { unique: titles.size, nonEmpty: nonEmptyTitles });
      }
      if (nonEmptyCanonicals !== expectedRoutes.length || canonicals.size !== expectedRoutes.length) {
        fail("DUPLICATE_CANONICAL_URL", `expected ${expectedRoutes.length} unique non-empty canonical URLs, got ${canonicals.size} unique / ${nonEmptyCanonicals} non-empty`, { unique: canonicals.size, nonEmpty: nonEmptyCanonicals });
      }
    }

    /* ---------------- LLM AUDIT (ORACLE-073..078) ---------------- */
    const llmAudit = receipt.llm_audit ?? {};
    requireEq(llmAudit.direct_provider_bypass_count, 0, "PROVIDER_BYPASS_DETECTED", "All governed LLM operations must use LLM-Router");
    // ORACLE-078 unsupported_capability_combination_count (presence required)
    requireEq(llmAudit.unsupported_capability_combination_count, 0, "UNSUPPORTED_LLM_CAPABILITY_COMBINATION", "Unsupported LLM capability combinations are forbidden");
    const operations = llmAudit.operations;
    if (operations === undefined || operations === null || typeof operations !== "object") {
      // missing required evidence: every operation-policy property fails closed
      fail("UNEXPECTED_SEARCH_ROUTING", "llm_audit.operations evidence missing");
      fail("SEARCH_POLICY_NOT_EXPLICIT", "llm_audit.operations evidence missing");
      fail("VISUAL_QA_ROUTER_AUDIT_MISSING", "llm_audit.operations.VISUAL_QA evidence missing");
    } else {
      for (const operation of ["SEO_CONTENT_BLUEPRINT", "STRUCTURED_CONTENT_GENERATION", "CONTENT_VALIDATION"]) {
        const calls = operations[operation];
        if (!Array.isArray(calls)) {
          fail("SEARCH_POLICY_NOT_EXPLICIT", `${operation} router audit missing`, operation);
        } else {
          for (const call of calls) {
            requireFalse(call.searchRequired, "UNEXPECTED_SEARCH_ROUTING", `${operation} unexpectedly required search`);
            requireEq(call.searchPolicySource, "EXPLICIT", "SEARCH_POLICY_NOT_EXPLICIT", `${operation} must explicitly suppress search`);
          }
        }
      }
      // ORACLE-077 required_policy.VISUAL_QA
      const visualQACalls = operations.VISUAL_QA;
      if (!Array.isArray(visualQACalls)) {
        fail("VISUAL_QA_ROUTER_AUDIT_MISSING", "VISUAL_QA router audit missing");
      } else {
        for (const call of visualQACalls) requireFalse(call.searchRequired, "VISUAL_QA_ROUTING_POLICY_VIOLATION", "VISUAL_QA must explicitly suppress search");
      }
    }

    /* ---------------- VISUAL CAPTURE + VISUAL ORACLE (ORACLE-079..097) ---------------- */
    const visual = receipt.visual;
    const pairs = Array.isArray(visual?.pairs) ? visual.pairs : null;
    const requiredPairs = oracleNumber(oracle.visual_capture ?? {}, "required_pairs", "VISUAL_CAPTURE_INCOMPLETE", "visual_capture.required_pairs");
    const metrics = {
      candidate_visual_votes: 0,
      total_visual_votes: 0,
      visual_majority_wins: 0,
      visual_majority_losses: 0,
      visual_wilson_lower_bound: 0,
      visual_weighted_mean_delta: null,
      blocking_inconclusive_count: 0,
    };

    if (pairs === null || (requiredPairs !== undefined && pairs.length !== requiredPairs)) {
      fail("VISUAL_CAPTURE_INCOMPLETE", `Five routes × two viewports = ${requiredPairs} visual pairs`, { actual: pairs?.length, required: requiredPairs });
      // capture-integrity properties fail closed on missing evidence
      fail("VISUAL_TRIAL_INCOMPLETE", "visual.pairs evidence missing");
      fail("CANDIDATE_BLANK_CAPTURE", "visual.pairs evidence missing");
      fail("BASELINE_BLANK_CAPTURE", "visual.pairs evidence missing");
      fail("VISUAL_ROUTE_MISMATCH", "visual.pairs evidence missing");
      fail("VISUAL_VIEWPORT_MISMATCH", "visual.pairs evidence missing");
      fail("STALE_VISUAL_CAPTURE", "visual.pairs evidence missing");
      // INCONCLUSIVE-class properties (ORACLE-092/093/095/096/097): absent visual
      // evidence produces blocking-inconclusive states, never a hard FAIL.
      inconclusive("VISUAL_ORACLE_MISSING_TRIAL", "trial evidence missing; visual verdict inconclusive", { pairs: pairs?.length ?? 0 }, ["ORACLE-095"]);
      inconclusive("VISUAL_PAIR_NO_MAJORITY", "pair evidence missing; visual verdict inconclusive", { pairs: pairs?.length ?? 0 }, ["ORACLE-096"]);
      inconclusive("VISUAL_WILSON_INTERVAL_INCONCLUSIVE", "vote evidence missing; visual verdict inconclusive", { pairs: pairs?.length ?? 0 }, ["ORACLE-097"]);
      inconclusive("VISUAL_WEIGHTED_MEAN_DELTA_INSUFFICIENT", "candidate delta evidence missing; visual verdict inconclusive", { pairs: pairs?.length ?? 0 }, ["ORACLE-092"]);
      inconclusive("VISUAL_DIMENSION_MISSING", "dimension evidence missing; visual verdict inconclusive", { pairs: pairs?.length ?? 0 }, ["ORACLE-093"]);
    } else {
      const criticalPairs = oracle.visual_oracle?.pass?.critical_pairs_may_not_lose;
      if (!Array.isArray(criticalPairs) || criticalPairs.length === 0) fail("VISUAL_ORACLE_CONFIG_INVALID", "oracle critical_pairs_may_not_lose configuration missing");
      const criticalDimensions = oracle.visual_oracle?.pass?.critical_dimensions_may_not_regress;
      if (!Array.isArray(criticalDimensions) || criticalDimensions.length === 0) fail("VISUAL_ORACLE_CONFIG_INVALID", "oracle critical_dimensions_may_not_regress configuration missing");
      const weights = oracle.visual_oracle?.dimensions;
      const oracleVisualPass = oracle.visual_oracle?.pass ?? {};
      const minWins = oracleNumber(oracleVisualPass, "minimum_pair_majority_wins", "VISUAL_IMPROVEMENT_INSUFFICIENT", "visual_oracle.pass.minimum_pair_majority_wins");
      const maxLosses = oracleNumber(oracleVisualPass, "maximum_pair_majority_losses", "VISUAL_REGRESSION_TOO_BROAD", "visual_oracle.pass.maximum_pair_majority_losses");
      const minVotes = oracleNumber(oracleVisualPass, "minimum_candidate_votes", "VISUAL_VOTE_CONFIDENCE_INSUFFICIENT", "visual_oracle.pass.minimum_candidate_votes");
      const wilsonMinimum = oracleNumber(oracleVisualPass, "wilson_lower_bound_must_exceed", "VISUAL_WILSON_INTERVAL_INCONCLUSIVE", "visual_oracle.pass.wilson_lower_bound_must_exceed");
      const weightedMeanThreshold = oracleNumber(oracleVisualPass, "minimum_weighted_mean_delta", "VISUAL_WEIGHTED_MEAN_DELTA_INSUFFICIENT", "visual_oracle.pass.minimum_weighted_mean_delta");

      let candidateVotes = 0;
      let totalVotes = 0;
      let majorityWins = 0;
      let majorityLosses = 0;
      const dimensionTotals = new Map();
      let dimensionTrials = 0;
      const blindingTokens = ["safehavenrr", "candidate", "baseline", "qualitydelta", "engineering expectation", "repository", "golden_e2e", "prior verdict", "expected verdict"];

      for (const pair of pairs) {
        const key = criticalPairKey(pair.route, pair.viewport);
        // ORACLE-080/081/082/083/084 capture integrity
        if (pair.candidate_blank !== false) fail("CANDIDATE_BLANK_CAPTURE", `Blank candidate capture: ${key}`, pair.candidate_blank);
        if (pair.baseline_blank !== false) fail("BASELINE_BLANK_CAPTURE", `Blank baseline capture: ${key}`, pair.baseline_blank);
        if (pair.route_match !== true) fail("VISUAL_ROUTE_MISMATCH", `Cross-route visual pair: ${key}`, pair.route_match);
        if (pair.viewport_match !== true) fail("VISUAL_VIEWPORT_MISMATCH", `Mismatched viewport visual pair: ${key}`, pair.viewport_match);
        const runId = receipt.run?.run_id;
        if (typeof runId !== "string" || runId.trim() === "") fail("STALE_VISUAL_CAPTURE", "run.run_id evidence missing", runId);
        else if (pair.captured_run_id !== runId) fail("STALE_VISUAL_CAPTURE", `Stale capture: ${key}`, { captured_run_id: pair.captured_run_id, current_run_id: runId });

        const trials = pair.trials;
        if (!Array.isArray(trials) || trials.length !== 3) {
          fail("VISUAL_TRIAL_INCOMPLETE", `${key} requires three blind trials`, trials);
          inconclusive("VISUAL_ORACLE_MISSING_TRIAL", `${key} missing a blind trial; visual verdict inconclusive`, { pair: key, trials: trials?.length }, ["ORACLE-095"]);
          continue;
        }
        let pairCandidateVotes = 0;
        let pairBaselineVotes = 0;
        for (const trial of trials) {
          // ORACLE-094 reveal_candidate_identity_to_judge must be false
          if (trial.blind !== true && trial.blind !== false) fail("VISUAL_BLINDING_EVIDENCE_MISSING", `${key} trial lacks blind flag`, trial.blind);
          else if (trial.blind !== true) fail("VISUAL_JUDGE_NOT_BLIND", `${key} trial judge was not blind`, trial.blind);
          const manifest = trial.judge_input_manifest;
          if (manifest === undefined || manifest === null || (typeof manifest === "string" && manifest.trim() === "") || (typeof manifest === "object" && !Array.isArray(manifest) && Object.keys(manifest).length === 0)) {
            fail("VISUAL_BLINDING_EVIDENCE_MISSING", `${key} trial lacks judge_input_manifest`, manifest);
          } else {
            const context = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
            const leaks = blindingTokens.filter((token) => context.toLowerCase().includes(token));
            if (leaks.length > 0) fail("VISUAL_JUDGE_NOT_BLIND", `${key} judge input leaks candidate/baseline identity`, leaks);
          }
          const preference = trial.normalized_preference;
          if (preference === "CANDIDATE") { pairCandidateVotes++; candidateVotes++; }
          else if (preference === "BASELINE") { pairBaselineVotes++; }
          totalVotes++;
          const delta = trial.normalized_candidate_delta;
          if (delta !== undefined && delta !== null && typeof delta === "object" && !Array.isArray(delta)) {
            dimensionTrials++;
            for (const [dimension, value] of Object.entries(delta)) {
              const numeric = Number(value);
              if (!Number.isFinite(numeric)) fail("VISUAL_DIMENSION_MISSING", `non-finite ${dimension} delta in ${key}`, value);
              else dimensionTotals.set(dimension, (dimensionTotals.get(dimension) ?? 0) + numeric);
            }
          }
        }
        if (pairCandidateVotes >= 2) majorityWins++;
        else if (pairBaselineVotes >= 2) majorityLosses++;
        // ORACLE-096 judge_disagreement_without_majority — blocking inconclusive
        else inconclusive("VISUAL_PAIR_NO_MAJORITY", `${key} blind trials did not resolve to a majority; visual verdict inconclusive`, { pair: key, candidate: pairCandidateVotes, baseline: pairBaselineVotes }, ["ORACLE-096"]);

        // ORACLE-090 critical_pairs_may_not_lose (dynamic oracle list)
        if (criticalPairs?.includes(key) && pairBaselineVotes >= 2) fail("CRITICAL_VISUAL_PAIR_REGRESSED", `${key} lost the blind pairwise comparison`);
      }

      metrics.candidate_visual_votes = candidateVotes;
      metrics.total_visual_votes = totalVotes;
      metrics.visual_majority_wins = majorityWins;
      metrics.visual_majority_losses = majorityLosses;

      // ORACLE-086/087/088 hard gates
      if (minWins !== undefined && majorityWins < minWins) fail("VISUAL_IMPROVEMENT_INSUFFICIENT", `Candidate must win at least ${minWins}/10 pair majorities`, { majorityWins });
      if (maxLosses !== undefined && majorityLosses > maxLosses) fail("VISUAL_REGRESSION_TOO_BROAD", `Candidate may lose at most ${maxLosses}/10 visual pairs`, { majorityLosses });
      if (minVotes !== undefined && candidateVotes < minVotes) fail("VISUAL_VOTE_CONFIDENCE_INSUFFICIENT", `Candidate must receive at least ${minVotes}/30 blind votes`, { candidateVotes, totalVotes });

      const lowerBound = wilsonLowerBound(candidateVotes, totalVotes);
      metrics.visual_wilson_lower_bound = lowerBound;
      // ORACLE-089 pass.wilson_lower_bound_must_exceed + ORACLE-097
      // inconclusive.wilson_interval_crosses_required_boundary: the boundary
      // crossing is a blocking inconclusive state — never a hard FAIL.
      if (wilsonMinimum !== undefined && !(lowerBound > wilsonMinimum)) {
        inconclusive("VISUAL_WILSON_INTERVAL_INCONCLUSIVE", `95% Wilson lower bound ${lowerBound.toFixed(4)} does not strictly exceed ${wilsonMinimum}; visual improvement unproven`, { candidateVotes, totalVotes, lowerBound, required: wilsonMinimum, pass_gate: "VISUAL_CONFIDENCE_INTERVAL_INCONCLUSIVE" }, ["ORACLE-089", "ORACLE-097"]);
      }

      // ORACLE-093 dimensions — read the weight map dynamically, validate sum == 1.0
      if (weights === undefined || weights === null || typeof weights !== "object" || Array.isArray(weights) || Object.keys(weights).length === 0) {
        inconclusive("VISUAL_DIMENSION_MISSING", "oracle visual_oracle.dimensions configuration missing; visual verdict inconclusive", undefined, ["ORACLE-093"]);
        inconclusive("VISUAL_WEIGHTED_MEAN_DELTA_INSUFFICIENT", "dimension weight evidence missing; weighted mean delta unproven", undefined, ["ORACLE-092"]);
      } else {
        const weightSum = Object.values(weights).reduce((acc, weight) => acc + weight, 0);
        if (Math.abs(weightSum - 1.0) > 1e-9) fail("VISUAL_DIMENSION_WEIGHT_INVALID", `visual dimension weights must sum to 1.0, got ${weightSum}`, { weight_sum: weightSum });
        // every configured dimension must be present in every valid trial
        for (const pair of pairs) {
          for (const trial of Array.isArray(pair.trials) ? pair.trials : []) {
            const delta = trial.normalized_candidate_delta;
            if (delta === undefined || delta === null || typeof delta !== "object" || Array.isArray(delta)) {
              fail("VISUAL_DIMENSION_MISSING", `${criticalPairKey(pair.route, pair.viewport)} trial lacks normalized_candidate_delta`, delta);
              continue;
            }
            for (const dimension of Object.keys(weights)) {
              if (!(dimension in delta)) fail("VISUAL_DIMENSION_MISSING", `trial delta missing configured dimension ${dimension}`, { pair: criticalPairKey(pair.route, pair.viewport), dimension });
            }
          }
        }
        // ORACLE-092 minimum_weighted_mean_delta (threshold read dynamically)
        const weightedMean = weightedMeanDelta(dimensionTotals, dimensionTrials, weights);
        metrics.visual_weighted_mean_delta = weightedMean;
        if (weightedMean === null) {
          inconclusive("VISUAL_WEIGHTED_MEAN_DELTA_INSUFFICIENT", "candidate delta evidence missing; weighted mean delta unproven", undefined, ["ORACLE-092"]);
        } else if (weightedMeanThreshold === undefined) {
          inconclusive("VISUAL_WEIGHTED_MEAN_DELTA_INSUFFICIENT", "oracle minimum_weighted_mean_delta configuration missing; weighted mean delta unproven", undefined, ["ORACLE-092"]);
        } else if (weightedMean < weightedMeanThreshold) {
          fail("VISUAL_WEIGHTED_MEAN_DELTA_INSUFFICIENT", `weighted mean delta ${weightedMean.toFixed(4)} below required ${weightedMeanThreshold}`, { weighted_mean_delta: weightedMean, threshold: weightedMeanThreshold });
        }
        // ORACLE-091 critical_dimensions_may_not_regress (dynamic oracle list)
        for (const dimension of criticalDimensions ?? []) {
          const total = dimensionTotals.get(dimension) ?? 0;
          const mean = dimensionTrials ? total / dimensionTrials : 0;
          if (mean < 0) fail("CRITICAL_VISUAL_DIMENSION_REGRESSED", `${dimension} regressed`, { mean });
        }
      }
    }

    /* ---------------- FINAL VERDICT (ORACLE-098..101) ---------------- */
    metrics.blocking_inconclusive_count = blockingInconclusive.length;
    // ORACLE-101 no_inconclusive_blocking_dimension: GOLDEN_E2E_PASS_IMPROVED
    // requires hard_gate_failures == 0 AND blocking_inconclusive_states == 0.
    if (blockingInconclusive.length > 0) {
      inconclusive("GOLDEN_ORACLE_BLOCKING_INCONCLUSIVE", `${blockingInconclusive.length} blocking inconclusive state(s) prevent GOLDEN_E2E_PASS_IMPROVED`, blockingInconclusive.map((state) => state.code), ["ORACLE-101"]);
    }
    const verdict = classifyVerdict(failures, blockingInconclusive);
    metrics.blocking_inconclusive_count = blockingInconclusive.length;
    return {
      schema: "l9.golden-oracle-result/v1",
      case_id: sanitizeIdentifier(testCase.case_id),
      evaluated_at: new Date().toISOString(),
      hard_gate_failures: failures,
      blocking_inconclusive_states: blockingInconclusive,
      metrics,
      verdict,
    };
  }

  return { verify, fail, inconclusive };
}

/** Deterministic end-to-end run. Returns { result, exitCode }. */
export function runVerifier(casePath, receiptPath, oraclePath = process.env.SAFEHAVEN_ORACLE_PATH ?? "tests/golden/safehaven/oracle.json") {
  // runVerifier is exported and all three parameters are caller-supplied, so
  // each read proves containment inside the checkout before it opens anything.
  const oracle = readJson(oraclePath, "oracle path");
  const testCase = readJson(casePath, "case path");
  const receipt = readJson(receiptPath, "receipt path");
  const verifier = createVerifier(oracle);
  const result = verifier.verify(receipt, testCase);
  return { result, exitCode: result.verdict === "GOLDEN_E2E_PASS_IMPROVED" ? 0 : 1 };
}

function main() {
  const casePath = process.argv[2] ?? "tests/golden/safehaven/case.json";
  const receiptPath = process.argv[3] ?? process.env.GOLDEN_RECEIPT;
  if (!receiptPath) {
    console.error("usage: node scripts/verify-safehaven-golden.mjs <case.json> <receipt.json>");
    process.exit(2);
  }
  const { result, exitCode } = runVerifier(casePath, receiptPath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(exitCode);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
