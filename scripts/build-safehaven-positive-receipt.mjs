#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  SYNTHETIC_NAMESPACE,
  provenanceSeal
} from "./lib/safehaven-synthetic-provenance.mjs";
import {
  readJsonWithinRoot,
  relativeToRoot,
  resolveWithinRoot
} from "./lib/repo-path.mjs";
const ROOT = process.cwd();
const casePath =
  process.argv[2] ??
  "tests/golden/safehaven/case.json";
const oraclePath =
  process.argv[3] ??
  "tests/golden/safehaven/oracle.json";
const outputPath =
  process.argv[4] ??
  "tests/golden/safehaven/fixtures/positive-receipt.json";
const CALIBRATION_TIMESTAMP =
  "2026-08-19T00:00:00.000Z";
const RUN_ID =
  `${SYNTHETIC_NAMESPACE}/safehaven-positive-control-v1`;
const ROUTER_VERSION =
  process.env.GOLDEN_CALIBRATION_ROUTER_VERSION ??
  "1.3.0";
const BOT_INTEROP_VERSION =
  process.env.GOLDEN_CALIBRATION_BOT_INTEROP_VERSION ??
  "1.1.0";
/* =========================================================
 * IO
 * ======================================================= */
function readJson(filePath) {
  return readJsonWithinRoot(ROOT, filePath, "input path");
}
function fail(message, evidence) {
  const detail =
    evidence === undefined
      ? ""
      : `\n${JSON.stringify(evidence, null, 2)}`;
  throw new Error(
    `SAFEHAVEN_POSITIVE_CONTROL_BUILD_FAILED: ${message}${detail}`
  );
}
function requireTrue(value, message, evidence) {
  if (value !== true) {
    fail(message, evidence ?? value);
  }
}
function requireEq(actual, expected, message) {
  if (actual !== expected) {
    fail(message, {
      expected,
      actual
    });
  }
}
function requireNonEmpty(value, message) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    fail(message, value);
  }
}
function normalizeRoute(value) {
  if (typeof value !== "string") {
    return String(value);
  }
  const trimmed = value.trim();
  if (trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "") || "/";
}
function duplicates(values) {
  const counts = new Map();
  for (const raw of values) {
    const value = normalizeRoute(raw);
    counts.set(
      value,
      (counts.get(value) ?? 0) + 1
    );
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({
      value,
      count
    }));
}
function assertExactRouteSet(
  actual,
  expected,
  label
) {
  if (!Array.isArray(actual)) {
    fail(`${label} must be an array`);
  }
  const duplicateRoutes =
    duplicates(actual);
  if (duplicateRoutes.length > 0) {
    fail(
      `${label} contains duplicate routes`,
      duplicateRoutes
    );
  }
  if (actual.length !== expected.length) {
    fail(
      `${label} route count mismatch`,
      {
        expected: expected.length,
        actual: actual.length
      }
    );
  }
  const actualSet =
    new Set(actual.map(normalizeRoute));
  const expectedSet =
    new Set(expected.map(normalizeRoute));
  const missing =
    [...expectedSet].filter(
      (route) => !actualSet.has(route)
    );
  const extra =
    [...actualSet].filter(
      (route) => !expectedSet.has(route)
    );
  if (missing.length || extra.length) {
    fail(
      `${label} route set mismatch`,
      {
        missing,
        extra
      }
    );
  }
}
/* =========================================================
 * AUTHORITY INPUTS
 * ======================================================= */
const testCase =
  readJson(casePath);
const oracle =
  readJson(oraclePath);
requireEq(
  testCase.schema,
  "l9.golden-site-case/v1",
  "Unexpected Safe Haven case schema"
);
requireEq(
  oracle.schema,
  "l9.golden-oracle/v1",
  "Unexpected Golden oracle schema"
);
requireEq(
  oracle.oracle_id,
  "safehaven-redesign-oracle-v1",
  "Unexpected Golden oracle identity"
);
requireNonEmpty(
  testCase.case_id,
  "case_id is required"
);
const routes =
  testCase.routes;
if (!Array.isArray(routes)) {
  fail("case.routes must be an array");
}
requireEq(
  routes.length,
  testCase.baseline?.expected_route_count,
  "Case route count must match frozen baseline authority"
);
requireEq(
  routes.length,
  oracle.seo_content_blueprint
    ?.requested_routes,
  "Case route count must match SEO oracle"
);
requireEq(
  routes.length,
  oracle.page_content_contract
    ?.requested_routes,
  "Case route count must match PCC oracle"
);
requireEq(
  routes.length,
  oracle.structured_content
    ?.requested_routes,
  "Case route count must match StructuredContent oracle"
);
requireEq(
  routes.length,
  oracle.site_integrity?.built_routes,
  "Case route count must match site-integrity oracle"
);
assertExactRouteSet(
  routes,
  routes,
  "case.routes"
);
requireTrue(
  testCase.source_assets?.harvest,
  "Safe Haven source harvesting must remain enabled"
);
requireEq(
  testCase.source_assets?.reuse_policy,
  "client_owned_authorized",
  "Safe Haven source reuse policy changed"
);
requireEq(
  testCase.source_assets?.donor_asset_policy,
  "DONOR_REFERENCE_ONLY",
  "Donor asset policy changed"
);
/* =========================================================
 * VISUAL CONFIG VALIDATION
 * ======================================================= */
const sentinels =
  testCase.visual_sentinels;
const viewports =
  testCase.viewports;
if (!Array.isArray(sentinels)) {
  fail(
    "case.visual_sentinels must be an array"
  );
}
if (!Array.isArray(viewports)) {
  fail(
    "case.viewports must be an array"
  );
}
requireEq(
  sentinels.length,
  oracle.visual_capture.routes,
  "Visual sentinel count must match oracle"
);
requireEq(
  viewports.length,
  oracle.visual_capture.viewports,
  "Viewport count must match oracle"
);
requireEq(
  sentinels.length * viewports.length,
  oracle.visual_capture.required_pairs,
  "Sentinel × viewport pair count must match oracle"
);
const routeSet =
  new Set(routes.map(normalizeRoute));
for (const sentinel of sentinels) {
  requireNonEmpty(
    sentinel?.route,
    "Visual sentinel route missing"
  );
  if (
    !routeSet.has(
      normalizeRoute(sentinel.route)
    )
  ) {
    fail(
      "Visual sentinel is outside frozen route set",
      sentinel
    );
  }
}
const viewportIds =
  viewports.map((viewport) => viewport?.id);
if (
  viewportIds.some(
    (id) =>
      typeof id !== "string" ||
      id.trim() === ""
  )
) {
  fail("Viewport id missing");
}
if (
  new Set(viewportIds).size !==
  viewportIds.length
) {
  fail(
    "Viewport ids must be unique",
    viewportIds
  );
}
const dimensions =
  oracle.visual_oracle?.dimensions;
if (
  !dimensions ||
  typeof dimensions !== "object" ||
  Array.isArray(dimensions)
) {
  fail(
    "oracle.visual_oracle.dimensions missing"
  );
}
const dimensionNames =
  Object.keys(dimensions);
requireEq(
  dimensionNames.length,
  10,
  "Golden visual oracle must define ten dimensions"
);
const weightSum =
  Object.values(dimensions)
    .reduce(
      (sum, value) =>
        sum + Number(value),
      0
    );
if (
  !Number.isFinite(weightSum) ||
  Math.abs(weightSum - 1) > 1e-9
) {
  fail(
    "Visual dimension weights must sum to 1",
    weightSum
  );
}
const generatedPairKeys =
  new Set(
    sentinels.flatMap((sentinel) =>
      viewports.map(
        (viewport) =>
          `${sentinel.route}::${viewport.id}`
      )
    )
  );
for (
  const criticalPair of
  oracle.visual_oracle?.pass
    ?.critical_pairs_may_not_lose ?? []
) {
  if (!generatedPairKeys.has(criticalPair)) {
    fail(
      "Oracle critical visual pair cannot be generated from case",
      criticalPair
    );
  }
}
/* =========================================================
 * PREFLIGHT / EXECUTION CONFIG VALIDATION
 * ======================================================= */
const requiredPreflightChecks =
  oracle.preflight?.required_checks;
if (
  !Array.isArray(requiredPreflightChecks) ||
  requiredPreflightChecks.length === 0
) {
  fail(
    "Oracle preflight required_checks missing"
  );
}
const requiredStages =
  oracle.execution_graph
    ?.required_ordered_subsequence;
if (
  !Array.isArray(requiredStages) ||
  requiredStages.length === 0
) {
  fail(
    "Oracle execution ordered subsequence missing"
  );
}
if (
  !requiredStages.includes(
    "seo-build-intelligence-preflight"
  )
) {
  fail(
    "Oracle execution graph lacks SEO preflight stage"
  );
}
if (
  !requiredStages.includes(
    "competitive-intelligence"
  )
) {
  fail(
    "Oracle execution graph lacks competitive intelligence stage"
  );
}
const preflightStageIndex =
  requiredStages.indexOf(
    "seo-build-intelligence-preflight"
  );
const competitiveStageIndex =
  requiredStages.indexOf(
    "competitive-intelligence"
  );
if (
  preflightStageIndex < 0 ||
  competitiveStageIndex < 0 ||
  preflightStageIndex >= competitiveStageIndex
) {
  fail(
    "Oracle requires preflight before competitive intelligence"
  );
}
/* =========================================================
 * DETERMINISTIC SYNTHETIC IDENTITIES
 * ======================================================= */
const identity = {
  website_bot: {
    sha: "1".repeat(40),
    worktree_state: "CLEAN",
    llm_router_version: ROUTER_VERSION
  },
  seo_bot: {
    sha: "2".repeat(40),
    worktree_state: "CLEAN",
    llm_router_version: ROUTER_VERSION
  },
  llm_router: {
    sha: "3".repeat(40),
    worktree_state: "CLEAN",
    package_version: ROUTER_VERSION
  },
  bot_interop: {
    compatible: true,
    website_bot_version:
      BOT_INTEROP_VERSION,
    seo_bot_version:
      BOT_INTEROP_VERSION
  }
};
/* =========================================================
 * PREFLIGHT
 * ======================================================= */
const preflight = {
  status: "PASS",
  checks:
    requiredPreflightChecks.map(
      (name) => ({
        name,
        status: "PASS"
      })
    )
};
/* =========================================================
 * EXECUTION EVENTS
 * ======================================================= */
const events = [];
for (const stage of requiredStages) {
  events.push({
    name: stage
  });
  if (
    stage ===
    "seo-build-intelligence-preflight"
  ) {
    events.push({
      name:
        "seo-build-intelligence-preflight:PASS"
    });
  }
  if (
    stage ===
    "competitive-intelligence"
  ) {
    events.push({
      name:
        "seo:createCompetitiveLandscape"
    });
  }
}
/* =========================================================
 * COMPETITIVE LANDSCAPE
 * ======================================================= */
const LANDSCAPE_REF =
  "artifact:competitive-landscape:positive-control-v1";
const PCC_REF =
  "artifact:page-content-contract:positive-control-v1";
const WBB_REF =
  "artifact:website-build-blueprint:positive-control-v1";
const donors =
  Array.from(
    {
      length:
        oracle.competitive_landscape
          .selected_donor_count
    },
    (_, index) => {
      const n = index + 1;
      const domain =
        `donor${String(n).padStart(
          2,
          "0"
        )}.golden.invalid`;
      return {
        qualified_operating_company: true,
        real_dataforseo_observation: true,
        query_id:
          `golden-query-${String(n).padStart(
            2,
            "0"
          )}`,
        rank: n,
        url: `https://${domain}/landing/`,
        domain,
        normalized_domain: domain,
        observed_at:
          CALIBRATION_TIMESTAMP,
        visibility_contribution:
          Number(
            (1 / n).toFixed(6)
          ),
        class: "operating_company"
      };
    }
  );
const competitiveLandscape = {
  artifact_ref: LANDSCAPE_REF,
  selected_donors: donors,
  evidence_complete:
    oracle.competitive_landscape
      .evidence_complete,
  ranking_llm_calls:
    oracle.competitive_landscape
      .ranking_llm_calls
};
/* =========================================================
 * DONOR EVIDENCE
 * ======================================================= */
const donorEvidence =
  donors.map((donor, index) => ({
    domain:
      donor.normalized_domain,
    successful_pages:
      oracle.donor_evidence.per_donor
        .minimum_successful_pages,
    screenshots:
      oracle.donor_evidence.per_donor
        .minimum_screenshots,
    evidence_digest:
      `calibration-digest-${String(
        index + 1
      ).padStart(2, "0")}`,
    crawled_at:
      CALIBRATION_TIMESTAMP
  }));
requireEq(
  donorEvidence.length,
  oracle.donor_evidence.accepted_donors,
  "Synthetic donor evidence count mismatch"
);
/* =========================================================
 * WEBSITE BLUEPRINT
 * ======================================================= */
const websiteBuildBlueprint = {
  artifact_ref: WBB_REF,
  competitive_landscape_ref:
    LANDSCAPE_REF,
  visual_requirements: [
    {
      slot: "hero",
      required: true
    },
    {
      slot: "project_proof",
      required: true
    },
    {
      slot: "gallery",
      required: true
    }
  ],
  project_proof_required: true,
  gallery_required: true
};
/* =========================================================
 * SEO CONTENT BLUEPRINT
 * ======================================================= */
const seoContentBlueprint = {
  artifact_ref:
    "artifact:seo-content-blueprint:positive-control-v1",
  routes: [...routes],
  produced_routes:
    routes.length,
  missing_routes:
    oracle.seo_content_blueprint
      .missing_routes,
  extra_routes:
    oracle.seo_content_blueprint
      .extra_routes,
  duplicate_routes:
    oracle.seo_content_blueprint
      .duplicate_routes,
  batch_size:
    oracle.seo_content_blueprint
      .batch_size,
  batch_count:
    oracle.seo_content_blueprint
      .expected_batch_count,
  competitive_landscape_ref:
    LANDSCAPE_REF,
  unknown_content_slots:
    oracle.seo_content_blueprint
      .unknown_content_slots,
  invalid_internal_link_targets:
    oracle.seo_content_blueprint
      .invalid_internal_link_targets
};
/* =========================================================
 * PAGE CONTENT CONTRACT
 * ======================================================= */
const PCC_DIGEST =
  "sha256:positive-control-pcc-deterministic-v1";
const pageContentContract = {
  artifact_ref: PCC_REF,
  routes: [...routes],
  produced_routes:
    routes.length,
  llm_calls:
    oracle.page_content_contract
      .llm_calls,
  unplaced_requirements:
    oracle.page_content_contract
      .unplaced_content_requirements,
  invalid_business_facts:
    oracle.page_content_contract
      .invalid_business_facts,
  determinism: {
    required: true,
    same_semantic_input_same_digest:
      oracle.page_content_contract
        .determinism
        .same_semantic_input_same_digest,
    digest_run_1: PCC_DIGEST,
    digest_run_2: PCC_DIGEST
  }
};
/* =========================================================
 * STRUCTURED CONTENT
 * ======================================================= */
const routeResults =
  routes.map((route, index) => ({
    route_id:
      `route-${String(index + 1).padStart(
        3,
        "0"
      )}`,
    path: route,
    repair_attempts: 0,
    generation_calls: 1,
    schema_errors:
      oracle.structured_content
        .schema_invalid_routes,
    unsupported_claims:
      oracle.structured_content
        .unsupported_claims,
    failed_requirements:
      oracle.structured_content
        .failed_requirements,
    section_alias_fields: [],
    prose_without_blocks: 0
  }));
const structuredContent = {
  artifact_ref:
    "artifact:structured-content-package:positive-control-v1",
  routes: [...routes],
  produced_routes:
    routes.length,
  page_content_contract_ref:
    PCC_REF,
  route_results:
    routeResults
};
/* =========================================================
 * LEGACY AUTHORITY
 * ======================================================= */
const legacy = {
  content_generation_calls:
    oracle.legacy_authority
      .legacy_content_generation_calls,
  schema_llm_calls:
    oracle.legacy_authority
      .legacy_schema_generation_calls,
  schema_generation_calls:
    oracle.legacy_authority
      .legacy_schema_generation_calls,
  page_content_contract_llm_calls:
    oracle.legacy_authority
      .page_content_contract_llm_calls,
  redesign_schema_llm_calls:
    oracle.legacy_authority
      .redesign_schema_llm_calls
};
/* =========================================================
 * SOURCE ASSETS
 * ======================================================= */
const assets = {
  source_corpus_completed:
    oracle.source_assets
      .source_corpus_completed,
  raw_source_images:
    oracle.source_assets
      .minimum_raw_source_images,
  authorized_reusable_images:
    oracle.source_assets
      .minimum_authorized_reusable_images,
  selected_source_images:
    oracle.source_assets
      .minimum_selected_source_images,
  unexplained_reusable_asset_loss:
    oracle.source_assets
      .unexplained_reusable_asset_loss,
  required_visual_slots_filled_fraction:
    oracle.source_assets
      .required_visual_slots_filled_fraction,
  donor_asset_hash_matches:
    oracle.donor_evidence
      .candidate_donor_asset_hash_matches,
  candidate_dispositions: [
    "SOURCE_CLIENT_OWNED"
  ],
  eligible_source_project_proof_count: 1,
  selected_source_project_proof_count: 1,
  eligible_source_gallery_count: 1,
  selected_source_gallery_count: 1
};
/* =========================================================
 * SITE INTEGRITY
 * ======================================================= */
function canonicalFor(route) {
  return (
    `https://candidate.golden.invalid` +
    route
  );
}
const siteRows =
  routes.map((route, index) => {
    const number =
      String(index + 1).padStart(
        2,
        "0"
      );
    return {
      route,
      http_status: 200,
      h1_count: 1,
      title:
        `Safe Haven Golden Route ${number}`,
      meta_description:
        `Synthetic positive-control metadata for frozen Safe Haven route ${number}.`,
      canonical:
        canonicalFor(route),
      lang: "en"
    };
  });
requireEq(
  new Set(
    siteRows.map((row) => row.title)
  ).size,
  oracle.site_integrity.unique_titles,
  "Synthetic site titles are not unique"
);
requireEq(
  new Set(
    siteRows.map((row) => row.canonical)
  ).size,
  oracle.site_integrity
    .unique_canonical_urls,
  "Synthetic site canonicals are not unique"
);
const site = {
  routes: [...routes],
  built_routes:
    oracle.site_integrity
      .built_routes,
  reachable_routes:
    oracle.site_integrity
      .reachable_routes,
  broken_internal_links:
    oracle.site_integrity
      .broken_internal_links,
  placeholder_count:
    oracle.site_integrity
      .placeholder_count,
  per_route:
    siteRows
};
/* =========================================================
 * BUSINESS TRUTH
 * ======================================================= */
const businessTruth = {
  unsupported_claim_count:
    oracle.business_truth
      .unsupported_claim_count,
  phone_mismatch_count:
    oracle.business_truth
      .phone_mismatch_count,
  email_mismatch_count:
    oracle.business_truth
      .email_mismatch_count,
  prohibition_violations:
    oracle.business_truth
      .prohibition_violations
};
/* =========================================================
 * LLM AUDIT
 * ======================================================= */
const llmOperations =
  Object.fromEntries(
    Object.entries(
      oracle.llm_audit
        .required_policy ?? {}
    ).map(
      ([operation, policy], index) => [
        operation,
        [
          {
            audit_id:
              `calibration-llm-${String(
                index + 1
              ).padStart(2, "0")}`,
            ...policy
          }
        ]
      ]
    )
  );
const llmAudit = {
  direct_provider_bypass_count:
    oracle.llm_audit
      .direct_provider_bypass_count,
  unsupported_capability_combination_count:
    oracle.llm_audit
      .unsupported_capability_combination_count,
  operations:
    llmOperations
};
/* =========================================================
 * VISUAL POSITIVE CONTROL
 * ======================================================= */
function positiveDimensionDeltas() {
  return Object.fromEntries(
    dimensionNames.map(
      (dimension) => [
        dimension,
        1
      ]
    )
  );
}
/*
 * Orientation selection must be reproducible so the fixture is byte-stable,
 * but it must still exercise BOTH A/B assignments across the trial set so the
 * verifier's raw-orientation normalization is genuinely exercised in both
 * directions. A deterministic digest over the trial identity stands in for the
 * live randomizer; the receipt is explicitly synthetic and records the
 * anti-bias protocol flags demanded by the judge protocol.
 */
function orientationCoin(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    /*
     * charCodeAt, not codePointAt: this is an FNV-1a mix over UTF-16 code
     * units, and the index advances one unit at a time. Seeds are ASCII route
     * and viewport identifiers, so the two agree here anyway - but switching
     * the primitive without also changing the stride would silently alter
     * every orientation and rewrite the committed fixture.
     */
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash & 1) === 1;
}
function orientationFor(seed, flags) {
  const candidateIsB = orientationCoin(seed);
  return {
    A: candidateIsB ? "BASELINE" : "CANDIDATE",
    B: candidateIsB ? "CANDIDATE" : "BASELINE",
    ...flags
  };
}
function invertOrientation(orientation, flags) {
  return {
    A: orientation.B,
    B: orientation.A,
    ...flags
  };
}
/*
 * The verifier recomputes normalized evidence from raw judge output using the
 * same helpers a real receipt traverses:
 *   preference: orientation[raw_preference]
 *   delta:      orientation.B === "CANDIDATE" ? raw : -raw
 * The raw side is therefore authored to reduce to the intended positive
 * result (CANDIDATE preference, +1 normalized delta per dimension) under that
 * recomputation rather than being asserted independently.
 */
function rawPreferenceForCandidate(orientation) {
  return orientation.A === "CANDIDATE" ? "A" : "B";
}
function rawDeltaForNormalized(normalizedDelta, orientation) {
  return orientation.B === "CANDIDATE"
    ? normalizedDelta
    : -normalizedDelta;
}
function rawDimensionsFor(normalizedDeltas, orientation) {
  return Object.fromEntries(
    dimensionNames.map(
      (dimension) => [
        dimension,
        rawDeltaForNormalized(
          normalizedDeltas[dimension],
          orientation
        )
      ]
    )
  );
}
function buildTrial(trialId, orientation) {
  const normalizedDeltas =
    positiveDimensionDeltas();
  return {
    trial_id:
      trialId,
    blind: true,
    judge_input_manifest: {
      candidate_identity_exposed:
        false,
      baseline_identity_exposed:
        false,
      repository_identity_exposed:
        false,
      quality_delta_exposed:
        false,
      previous_verdict_exposed:
        false
    },
    orientation,
    raw_judge: {
      preference:
        rawPreferenceForCandidate(orientation),
      confidence:
        0.9,
      dimensions:
        rawDimensionsFor(
          normalizedDeltas,
          orientation
        ),
      critical_defects_a: [
        "NONE"
      ],
      critical_defects_b: [
        "NONE"
      ],
      short_reason:
        "Synthetic calibration trial: raw evidence authored to normalize to a candidate preference."
    },
    normalized_preference:
      "CANDIDATE",
    normalized_candidate_delta:
      normalizedDeltas
  };
}
const visualPairs = [];
for (const sentinel of sentinels) {
  for (const viewport of viewports) {
    const pairKey =
      `${normalizeRoute(
        sentinel.route
      )}::${viewport.id}`;
    const trialOneOrientation =
      orientationFor(
        `${pairKey}::trial-1`,
        {
          randomized: true,
          reversed_from_trial_1: false,
          independent: false
        }
      );
    const trialTwoOrientation =
      invertOrientation(
        trialOneOrientation,
        {
          randomized: false,
          reversed_from_trial_1: true,
          independent: false
        }
      );
    const trialThreeOrientation =
      orientationFor(
        `${pairKey}::trial-3`,
        {
          randomized: true,
          reversed_from_trial_1: false,
          independent: true
        }
      );
    const orientations = [
      trialOneOrientation,
      trialTwoOrientation,
      trialThreeOrientation
    ];
    requireEq(
      orientations.length,
      oracle.visual_oracle
        .trials_per_pair,
      "Synthetic orientation plan must cover every oracle trial"
    );
    const trials =
      orientations.map(
        (orientation, index) =>
          buildTrial(
            `${pairKey}::trial-${index + 1}`,
            orientation
          )
      );
    visualPairs.push({
      route:
        sentinel.route,
      viewport:
        viewport.id,
      candidate_blank:
        false,
      baseline_blank:
        false,
      route_match:
        true,
      viewport_match:
        true,
      candidate_run_id:
        RUN_ID,
      captured_run_id:
        RUN_ID,
      trials
    });
  }
}
/*
 * Self-check: the fixture must be internally coherent before it is written,
 * so a builder regression cannot silently ship raw evidence that contradicts
 * its own stored normalized evidence.
 */
for (const pair of visualPairs) {
  const pairKey =
    `${normalizeRoute(pair.route)}::${pair.viewport}`;
  pair.trials.forEach((trial, index) => {
    const orientation =
      trial.orientation;
    const valid =
      (orientation?.A === "CANDIDATE" &&
        orientation?.B === "BASELINE") ||
      (orientation?.A === "BASELINE" &&
        orientation?.B === "CANDIDATE");
    requireTrue(
      valid,
      "Synthetic orientation must map A/B to candidate/baseline exactly once",
      { pair: pairKey, trial: index + 1, orientation }
    );
    requireEq(
      orientation[trial.raw_judge.preference],
      trial.normalized_preference,
      `Synthetic raw preference must normalize to stored preference (${pairKey} trial-${index + 1})`
    );
    for (const dimension of dimensionNames) {
      const rawDelta =
        trial.raw_judge.dimensions[dimension];
      requireTrue(
        typeof rawDelta === "number" &&
          Number.isFinite(rawDelta) &&
          rawDelta >=
            oracle.visual_oracle.score_scale.minimum &&
          rawDelta <=
            oracle.visual_oracle.score_scale.maximum,
        `Synthetic raw dimension must sit inside the oracle score scale (${pairKey} trial-${index + 1} ${dimension})`,
        rawDelta
      );
      requireEq(
        rawDeltaForNormalized(
          trial.normalized_candidate_delta[dimension],
          orientation
        ),
        rawDelta,
        `Synthetic raw dimension must normalize to stored delta (${pairKey} trial-${index + 1} ${dimension})`
      );
    }
  });
  requireEq(
    pair.trials[1].orientation.A,
    pair.trials[0].orientation.B,
    `Trial 2 must invert trial 1 orientation (${pairKey})`
  );
  requireEq(
    pair.trials[1].orientation.B,
    pair.trials[0].orientation.A,
    `Trial 2 must invert trial 1 orientation (${pairKey})`
  );
}
requireEq(
  visualPairs.length,
  oracle.visual_capture
    .required_pairs,
  "Synthetic visual pair count mismatch"
);
const totalVisualTrials =
  visualPairs.reduce(
    (sum, pair) =>
      sum + pair.trials.length,
    0
  );
requireEq(
  totalVisualTrials,
  oracle.visual_oracle.pass
    .total_votes,
  "Synthetic visual trial count must equal oracle total_votes"
);
/* =========================================================
 * FINAL SYNTHETIC POSITIVE RECEIPT
 * ======================================================= */
const receipt = {
  schema:
    "l9.golden-run-receipt/v1",
  case_id:
    testCase.case_id,
  calibration: {
    synthetic: true,
    purpose:
      "verifier-positive-control-only",
    must_not_be_used_as_real_golden_evidence:
      true,
    source_case:
      casePath,
    source_oracle:
      oraclePath,
    /*
     * Declaration and seal are the deletable layers. They exist for honest
     * use and for precise diagnostics. What actually holds this fixture out
     * of a real Golden run is the evidence it is made of: reserved-TLD hosts
     * and placeholder identity SHAs sitting in fields the oracle requires.
     */
    provenance_namespace:
      SYNTHETIC_NAMESPACE,
    provenance_seal:
      null
  },
  identity,
  run: {
    run_id:
      RUN_ID,
    build_intent:
      oracle.execution_graph
        .build_intent,
    copy_fallback_used:
      oracle.execution_graph
        .copy_fallback_used,
    generic_fallback_used:
      oracle.execution_graph
        .generic_fallback_used,
    pipeline_exit_code:
      0
  },
  preflight,
  events,
  competitive_landscape:
    competitiveLandscape,
  donor_evidence:
    donorEvidence,
  website_build_blueprint:
    websiteBuildBlueprint,
  seo_content_blueprint:
    seoContentBlueprint,
  page_content_contract:
    pageContentContract,
  structured_content:
    structuredContent,
  legacy,
  assets,
  site,
  business_truth:
    businessTruth,
  llm_audit:
    llmAudit,
  visual: {
    rendered_visual_qa_executed: true,
    pairs:
      visualPairs
  }
};
/* =========================================================
 * WRITE
 * ======================================================= */
const absoluteOutput =
  resolveWithinRoot(
    ROOT,
    outputPath,
    "output path"
  );
fs.mkdirSync(
  path.dirname(absoluteOutput),
  {
    recursive: true
  }
);
/*
 * Seal last: it covers the finished body with the seal field excluded, so
 * stamping is idempotent and any later edit to the receipt invalidates it.
 */
receipt.calibration.provenance_seal =
  provenanceSeal(receipt);
requireEq(
  provenanceSeal(receipt),
  receipt.calibration.provenance_seal,
  "Provenance seal must be stable over the sealed body"
);
fs.writeFileSync(
  absoluteOutput,
  JSON.stringify(
    receipt,
    null,
    2
  ) + "\n"
);
console.log(
  JSON.stringify(
    {
      schema:
        "l9.golden-positive-control-build-result/v1",
      output:
        relativeToRoot(
          ROOT,
          absoluteOutput
        ),
      synthetic:
        true,
      case_id:
        testCase.case_id,
      route_count:
        routes.length,
      donor_count:
        donors.length,
      visual_pairs:
        visualPairs.length,
      visual_trials:
        totalVisualTrials,
      expected_verdict:
        oracle.final_verdict
          .pass_name
    },
    null,
    2
  )
);
