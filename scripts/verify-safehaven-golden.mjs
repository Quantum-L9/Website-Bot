#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
function readJson(p) { return JSON.parse(fs.readFileSync(path.resolve(ROOT, p), "utf8")); }
const casePath = process.argv[2] ?? "tests/golden/safehaven/case.json";
const receiptPath = process.argv[3] ?? process.env.GOLDEN_RECEIPT;
if (!receiptPath) { console.error("usage: node scripts/verify-safehaven-golden.mjs <case.json> <receipt.json>"); process.exit(2); }
const testCase = readJson(casePath);
const receipt = readJson(receiptPath);
const failures = [];
function fail(code, message, evidence = undefined) { failures.push({ code, message, evidence }); }
function requireTrue(value, code, message, evidence) { if (value !== true) fail(code, message, evidence ?? value); }
function requireFalse(value, code, message, evidence) { if (value !== false) fail(code, message, evidence ?? value); }
function requireEq(actual, expected, code, message) { if (actual !== expected) fail(code, message, { expected, actual }); }
function requireNonEmpty(value, code, message) { if (typeof value !== "string" || value.trim() === "") fail(code, message, value); }
function normalizedSet(values) { return new Set((values ?? []).map((v) => typeof v === "string" ? v.trim().replace(/\/+$/, "") || "/" : String(v))); }
function requireExactSet(actual, expected, code, message) { const a = normalizedSet(actual); const e = normalizedSet(expected); const missing = [...e].filter((x) => !a.has(x)); const extra = [...a].filter((x) => !e.has(x)); if (missing.length || extra.length) fail(code, message, { missing, extra, actualCount: a.size, expectedCount: e.size }); }
function requireBefore(events, firstName, secondName, code) { const first = events.findIndex((e) => e.name === firstName); const second = events.findIndex((e) => e.name === secondName); if (first < 0 || second < 0 || first >= second) fail(code, `${firstName} must occur before ${secondName}`, { firstIndex: first, secondIndex: second }); }
function wilsonLowerBound(successes, n, z = 1.96) { if (!n) return 0; const p = successes / n; const z2 = z * z; const numerator = p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n); const denominator = 1 + z2 / n; return numerator / denominator; }
for (const repo of ["website_bot", "seo_bot", "llm_router"]) requireNonEmpty(receipt.identity?.[repo]?.sha, "IDENTITY_SHA_MISSING", `${repo} full SHA missing`);
const websiteRouter = receipt.identity?.website_bot?.llm_router_version;
const seoRouter = receipt.identity?.seo_bot?.llm_router_version;
const routerIdentity = receipt.identity?.llm_router?.package_version;
requireEq(websiteRouter, seoRouter, "ROUTER_VERSION_MISMATCH", "Website-Bot and SEO-Bot must load the same Router version");
requireEq(websiteRouter, routerIdentity, "ROUTER_IDENTITY_MISMATCH", "Consumer Router version must equal tested Router package identity");
requireEq(receipt.run?.build_intent, "REDESIGN_IMPROVE", "WRONG_BUILD_INTENT", "Golden run must execute REDESIGN_IMPROVE");
requireFalse(receipt.run?.copy_fallback_used, "COPY_FALLBACK_USED", "COPY fallback is forbidden");
requireFalse(receipt.run?.generic_fallback_used, "GENERIC_FALLBACK_USED", "Generic fallback is forbidden");
const events = receipt.events ?? [];
requireBefore(events, "seo-build-intelligence-preflight:PASS", "seo:createCompetitiveLandscape", "SEO_PREFLIGHT_TOO_LATE");
const competitive = receipt.competitive_landscape ?? {};
requireEq(competitive.selected_donors?.length, 10, "COMPETITIVE_EVIDENCE_INCOMPLETE", "Exactly ten selected donors required");
const domains = (competitive.selected_donors ?? []).map((d) => d.normalized_domain);
requireEq(new Set(domains).size, 10, "DUPLICATE_DONOR_DOMAIN", "Selected donors must be ten unique normalized companies");
requireTrue(competitive.evidence_complete, "COMPETITIVE_EVIDENCE_NOT_COMPLETE", "CompetitiveLandscape must be complete");
requireEq(competitive.ranking_llm_calls, 0, "COMPETITIVE_RANKING_LLM_USED", "Competitive rank authority must be deterministic");
for (const donor of competitive.selected_donors ?? []) { requireTrue(donor.qualified_operating_company, "DONOR_NOT_QUALIFIED", `Unqualified donor selected: ${donor.normalized_domain}`); requireNonEmpty(donor.query_id, "DONOR_QUERY_MISSING", `Donor query lineage missing: ${donor.normalized_domain}`); requireNonEmpty(donor.url, "DONOR_URL_MISSING", `Donor URL missing: ${donor.normalized_domain}`); if (!(Number(donor.rank) >= 1)) fail("DONOR_RANK_INVALID", `Invalid donor rank: ${donor.normalized_domain}`, donor.rank); if (!(Number(donor.visibility_contribution) >= 0)) fail("DONOR_VISIBILITY_INVALID", `Visibility evidence missing: ${donor.normalized_domain}`); }
const donorEvidence = receipt.donor_evidence ?? [];
requireEq(donorEvidence.length, 10, "DONOR_EVIDENCE_INCOMPLETE", "Ten donor evidence sets required");
for (const donor of donorEvidence) { if ((donor.successful_pages ?? 0) < 1) fail("DONOR_CRAWL_INCOMPLETE", `No successful page for ${donor.domain}`); if ((donor.screenshots ?? 0) < 1) fail("DONOR_SCREENSHOT_INCOMPLETE", `No screenshot evidence for ${donor.domain}`); requireNonEmpty(donor.evidence_digest, "DONOR_DIGEST_MISSING", `Evidence digest missing for ${donor.domain}`); }
const expectedRoutes = testCase.routes;
for (const [name, routes] of [["SEOContentBlueprint", receipt.seo_content_blueprint?.routes], ["PageContentContract", receipt.page_content_contract?.routes], ["StructuredContentPackage", receipt.structured_content?.routes], ["BuiltSite", receipt.site?.routes]]) requireExactSet(routes, expectedRoutes, "ROUTE_SET_MISMATCH", `${name} must contain the exact frozen Safe Haven route set`);
requireEq(receipt.seo_content_blueprint?.batch_size, 4, "SEO_BATCH_SIZE_DRIFT", "SEOContentBlueprint batch size must remain deterministic");
requireEq(receipt.seo_content_blueprint?.batch_count, 8, "SEO_BATCH_COUNT_INVALID", "29 routes at batch size four must use eight batches");
const landscapeRef = receipt.competitive_landscape?.artifact_ref;
requireEq(receipt.website_build_blueprint?.competitive_landscape_ref, landscapeRef, "WEBSITE_BLUEPRINT_LANDSCAPE_MISMATCH", "WebsiteBuildBlueprint must reference exact landscape");
requireEq(receipt.seo_content_blueprint?.competitive_landscape_ref, landscapeRef, "SEO_BLUEPRINT_LANDSCAPE_MISMATCH", "SEOContentBlueprint must reference exact landscape");
requireEq(receipt.structured_content?.page_content_contract_ref, receipt.page_content_contract?.artifact_ref, "STRUCTURED_CONTENT_LINEAGE_MISMATCH", "StructuredContentPackage must reference exact PCC");
requireEq(receipt.page_content_contract?.llm_calls, 0, "PCC_LLM_USED", "PageContentContract must use zero LLM calls");
requireEq(receipt.legacy?.content_generation_calls, 0, "LEGACY_CONTENT_AUTHORITY_USED", "Legacy Website-Bot content generation is forbidden");
requireEq(receipt.legacy?.schema_llm_calls, 0, "LEGACY_SCHEMA_AUTHORITY_USED", "LLM schema generation is forbidden on redesign");
requireEq(receipt.page_content_contract?.unplaced_requirements, 0, "CONTENT_REQUIREMENT_UNPLACED", "All required SEO content requirements must be placed");
for (const route of receipt.structured_content?.route_results ?? []) { if ((route.repair_attempts ?? 0) > 1) fail("CONTENT_REPAIR_BUDGET_EXCEEDED", `${route.route_id} used more than one repair`, route.repair_attempts); if ((route.generation_calls ?? 0) > 2) fail("CONTENT_GENERATION_BUDGET_EXCEEDED", `${route.route_id} used more than two generation calls`, route.generation_calls); requireEq(route.schema_errors ?? 0, 0, "STRUCTURED_CONTENT_SCHEMA_INVALID", `Schema-invalid structured content: ${route.route_id}`); requireEq(route.unsupported_claims ?? 0, 0, "UNSUPPORTED_CONTENT_CLAIM", `Unsupported content claim: ${route.route_id}`); requireEq(route.failed_requirements ?? 0, 0, "CONTENT_REQUIREMENT_UNSATISFIED", `Unsatisfied content requirements: ${route.route_id}`); }
requireEq(receipt.business_truth?.unsupported_claim_count, 0, "UNSUPPORTED_BUSINESS_CLAIM", "Candidate contains unsupported business claims");
requireEq(receipt.business_truth?.phone_mismatch_count, 0, "PHONE_TRUTH_MISMATCH", "Phone truth mismatch");
requireEq(receipt.business_truth?.email_mismatch_count, 0, "EMAIL_TRUTH_MISMATCH", "Email truth mismatch");
const assets = receipt.assets ?? {};
if ((assets.raw_source_images ?? 0) < 1) fail("SOURCE_ASSET_CORPUS_EMPTY", "Source asset harvesting found no images");
if ((assets.authorized_reusable_images ?? 0) < 1) fail("AUTHORIZED_SOURCE_ASSETS_MISSING", "Safe Haven authorization produced no reusable images");
if ((assets.selected_source_images ?? 0) < 1) fail("SOURCE_IMAGE_REUSE_MISSING", "No authorized Safe Haven source image was selected");
requireEq(assets.unexplained_reusable_asset_loss, 0, "SOURCE_ASSET_REUSE_UNEXPLAINED", "Reusable source assets disappeared without disposition");
requireEq(assets.required_visual_slots_filled_fraction, 1, "VISUAL_ASSET_REQUIREMENT_UNSATISFIED", "Every required blueprint visual slot must resolve");
requireEq(assets.donor_asset_hash_matches, 0, "DONOR_ASSET_REUSED", "Candidate contains donor/competitor asset bytes");
requireEq(receipt.site?.routes?.length, 29, "SITE_ROUTE_COUNT_MISMATCH", "Candidate must build all 29 routes");
requireEq(receipt.site?.reachable_routes, 29, "SITE_REACHABILITY_INCOMPLETE", "All 29 routes must be reachable");
requireEq(receipt.site?.broken_internal_links, 0, "BROKEN_INTERNAL_LINKS", "Candidate contains broken internal links");
requireEq(receipt.site?.placeholder_count, 0, "PLACEHOLDER_FOUND", "Candidate contains placeholder content");
requireEq(receipt.llm_audit?.direct_provider_bypass_count, 0, "PROVIDER_BYPASS_DETECTED", "All governed LLM operations must use LLM-Router");
for (const operation of ["SEO_CONTENT_BLUEPRINT", "STRUCTURED_CONTENT_GENERATION", "CONTENT_VALIDATION"]) { const calls = receipt.llm_audit?.operations?.[operation] ?? []; for (const call of calls) { requireFalse(call.searchRequired, "UNEXPECTED_SEARCH_ROUTING", `${operation} unexpectedly required search`); requireEq(call.searchPolicySource, "EXPLICIT", "SEARCH_POLICY_NOT_EXPLICIT", `${operation} must explicitly suppress search`); } }
const pairs = receipt.visual?.pairs ?? [];
requireEq(pairs.length, 10, "VISUAL_CAPTURE_INCOMPLETE", "Five routes × two viewports = ten visual pairs");
let candidateVotes = 0; let totalVotes = 0; let majorityWins = 0; let majorityLosses = 0; const dimensionTotals = new Map(); let dimensionTrials = 0;
for (const pair of pairs) { requireEq(pair.trials?.length, 3, "VISUAL_TRIAL_INCOMPLETE", `${pair.route} ${pair.viewport} requires three blind trials`); let pairCandidateVotes = 0; let pairBaselineVotes = 0; for (const trial of pair.trials ?? []) { if (trial.normalized_preference === "CANDIDATE") { pairCandidateVotes++; candidateVotes++; } else if (trial.normalized_preference === "BASELINE") pairBaselineVotes++; totalVotes++; for (const [dimension, delta] of Object.entries(trial.normalized_candidate_delta ?? {})) dimensionTotals.set(dimension, (dimensionTotals.get(dimension) ?? 0) + Number(delta)); dimensionTrials++; } if (pairCandidateVotes >= 2) majorityWins++; if (pairBaselineVotes >= 2) majorityLosses++; const key = `${pair.route}::${pair.viewport}`; const criticalPairs = new Set(["/::desktop", "/::mobile", "/gallery/::desktop", "/contact/::mobile"]); if (criticalPairs.has(key) && pairBaselineVotes >= 2) fail("CRITICAL_VISUAL_PAIR_REGRESSED", `${key} lost the blind pairwise comparison`); }
if (majorityWins < 7) fail("VISUAL_IMPROVEMENT_INSUFFICIENT", "Candidate must win at least 7/10 pair majorities", { majorityWins });
if (majorityLosses > 2) fail("VISUAL_REGRESSION_TOO_BROAD", "Candidate may lose at most 2/10 visual pairs", { majorityLosses });
if (candidateVotes < 21) fail("VISUAL_VOTE_CONFIDENCE_INSUFFICIENT", "Candidate must receive at least 21/30 blind votes", { candidateVotes, totalVotes });
const lowerBound = wilsonLowerBound(candidateVotes, totalVotes);
if (!(lowerBound > 0.5)) fail("VISUAL_CONFIDENCE_INTERVAL_INCONCLUSIVE", "95% Wilson lower bound must exceed 0.5", { candidateVotes, totalVotes, lowerBound });
const criticalDimensions = ["visual_hierarchy", "conversion_clarity", "trust_and_credibility", "authentic_imagery", "mobile_usability"];
for (const dimension of criticalDimensions) { const total = dimensionTotals.get(dimension) ?? 0; const mean = dimensionTrials ? total / dimensionTrials : 0; if (mean < 0) fail("CRITICAL_VISUAL_DIMENSION_REGRESSED", `${dimension} regressed`, { mean }); }
const result = { schema: "l9.golden-oracle-result/v1", case_id: testCase.case_id, evaluated_at: new Date().toISOString(), hard_gate_failures: failures, metrics: { candidate_visual_votes: candidateVotes, total_visual_votes: totalVotes, visual_majority_wins: majorityWins, visual_majority_losses: majorityLosses, visual_wilson_lower_bound: lowerBound }, verdict: failures.length === 0 ? "GOLDEN_E2E_PASS_IMPROVED" : "GOLDEN_E2E_FAIL" };
console.log(JSON.stringify(result, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
