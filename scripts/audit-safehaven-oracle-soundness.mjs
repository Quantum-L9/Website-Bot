#!/usr/bin/env node
import { execFileSync } from "node:child_process";
/**
 * ORACLE SOUNDNESS AUDIT — absence mutation testing.
 *
 * Implements, as an executable check, the closure contract rule:
 *   failure_behavior.missing_required_evidence.rule =
 *     do_not_default_missing_numeric_values_to_zero
 * and the oracle philosophy `missing_evidence_is_failure: true`.
 *
 * Coverage auditing asks "does the verifier contain this assertion?".
 * That is necessary but NOT sufficient: an assertion that reads
 * `(x ?? 0) > 1` or iterates `(container ?? [])` silently PASSES when the
 * evidence is absent. A producer that omits a field is then treated more
 * favourably than one that honestly reports a bad value.
 *
 * For each blocking property this probe runs the real production verifier
 * twice:
 *   PRESENT  - evidence set to a value that must trip the gate
 *   ABSENT   - the evidence path (and/or its container) deleted
 *
 * Classification:
 *   SOUND    - fires in both  (absence is treated as failure)
 *   VACUOUS  - fires with a bad value, silent when absent  <-- defect
 *   INERT    - never fires    (probe mis-wired, or gate not implemented)
 *
 * Exit 0 => no vacuous gates. Exit 1 => ORACLE_SOUNDNESS_INCOMPLETE.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
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
const casePath = resolveUnder(ROOT, process.argv[2] ?? "tests/golden/safehaven/case.json");
const verifier = resolveUnder(ROOT, process.argv[3] ?? "scripts/verify-safehaven-golden.mjs");
const outPath = resolveUnder(
  ROOT,
  process.argv[4] ?? "tests/golden/safehaven/oracle-soundness.json",
);

/** Minimal skeleton. Unrelated gates fail loudly; we only read per-probe codes. */
function skeleton() {
  return {
    identity: {
      website_bot: { sha: "a".repeat(40), llm_router_version: "1.1.3" },
      seo_bot: { sha: "b".repeat(40), llm_router_version: "1.1.3" },
      llm_router: { sha: "c".repeat(40), package_version: "1.1.3" },
    },
    run: {
      build_intent: "REDESIGN_IMPROVE",
      copy_fallback_used: false,
      generic_fallback_used: false,
    },
    events: [
      { name: "seo-build-intelligence-preflight:PASS" },
      { name: "seo:createCompetitiveLandscape" },
    ],
    competitive_landscape: {
      selected_donors: [],
      evidence_complete: true,
      ranking_llm_calls: 0,
      artifact_ref: "ref",
    },
    donor_evidence: Array.from({ length: 10 }, (_, i) => ({
      domain: `d${i}.com`,
      successful_pages: 1,
      screenshots: 1,
      evidence_digest: "dig",
    })),
    website_build_blueprint: { competitive_landscape_ref: "ref" },
    seo_content_blueprint: {
      routes: [],
      competitive_landscape_ref: "ref",
      batch_size: 4,
      batch_count: 8,
    },
    page_content_contract: {
      routes: [],
      artifact_ref: "pcc",
      llm_calls: 0,
      unplaced_requirements: 0,
    },
    structured_content: {
      routes: [],
      page_content_contract_ref: "pcc",
      route_results: [{ route_id: "/" }],
    },
    legacy: { content_generation_calls: 0, schema_llm_calls: 0 },
    assets: {
      raw_source_images: 5,
      authorized_reusable_images: 3,
      selected_source_images: 2,
      unexplained_reusable_asset_loss: 0,
      required_visual_slots_filled_fraction: 1,
      donor_asset_hash_matches: 0,
    },
    site: { routes: [], reachable_routes: 29, broken_internal_links: 0, placeholder_count: 0 },
    business_truth: {
      unsupported_claim_count: 0,
      phone_mismatch_count: 0,
      email_mismatch_count: 0,
    },
    llm_audit: {
      direct_provider_bypass_count: 0,
      operations: {
        SEO_CONTENT_BLUEPRINT: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
        STRUCTURED_CONTENT_GENERATION: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
        CONTENT_VALIDATION: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
      },
    },
    visual: {
      pairs: Array.from({ length: 10 }, () => ({
        route: "/",
        viewport: "desktop",
        trials: [{}, {}, {}],
      })),
    },
  };
}

const seg = (p) => p.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));
function setPath(obj, p, v) {
  const s = seg(p);
  let cur = obj;
  for (let i = 0; i < s.length - 1; i++) {
    if (cur[s[i]] === undefined) cur[s[i]] = typeof s[i + 1] === "number" ? [] : {};
    cur = cur[s[i]];
  }
  cur[s.at(-1)] = v;
}
function delPath(obj, p) {
  const s = seg(p);
  let cur = obj;
  for (let i = 0; i < s.length - 1; i++) {
    if (cur?.[s[i]] === undefined) return;
    cur = cur[s[i]];
  }
  if (Array.isArray(cur)) cur.splice(s.at(-1), 1);
  else delete cur[s.at(-1)];
}

function codesFor(receipt, tag) {
  const p = path.resolve(ROOT, `.l9-soundness-${tag}.json`);
  fs.writeFileSync(p, JSON.stringify(receipt));
  let stdout = "";
  try {
    // process.execPath pins the interpreter to the running Node binary
    // instead of resolving "node" through a potentially writable PATH.
    stdout = execFileSync(process.execPath, [verifier, casePath, p], { encoding: "utf8" });
  } catch (e) {
    stdout = e.stdout ?? "";
  } finally {
    fs.rmSync(p, { force: true });
  }
  try {
    return new Set((JSON.parse(stdout).hard_gate_failures ?? []).map((f) => f.code));
  } catch {
    return new Set();
  }
}

/**
 * A container may have a sibling "guard" gate that fires on its absence
 * (e.g. a count assertion). A vacuous property behind a live guard still
 * cannot produce a false ACCEPT; one with no guard can.
 * `null` means: no count/presence gate exists on that field at all.
 */
const CONTAINER_GUARDS = {
  donor_evidence: "DONOR_EVIDENCE_INCOMPLETE",
  "visual.pairs": "VISUAL_CAPTURE_INCOMPLETE",
  "structured_content.route_results": null,
  "llm_audit.operations": null,
};

/**
 * probe: { id, code, path, bad, container? }
 *   path      - evidence location set to `bad` (must trip `code`)
 *   container - optional enclosing array/object whose absence is also tested
 */
const PROBES = [
  { id: "ORACLE-001", code: "IDENTITY_SHA_MISSING", path: "identity.website_bot.sha", bad: "" },
  {
    id: "ORACLE-002",
    code: "ROUTER_VERSION_MISMATCH",
    path: "identity.seo_bot.llm_router_version",
    bad: "9.9.9",
  },
  { id: "ORACLE-008", code: "WRONG_BUILD_INTENT", path: "run.build_intent", bad: "COPY" },
  { id: "ORACLE-009", code: "COPY_FALLBACK_USED", path: "run.copy_fallback_used", bad: true },
  { id: "ORACLE-010", code: "GENERIC_FALLBACK_USED", path: "run.generic_fallback_used", bad: true },
  {
    id: "ORACLE-015",
    code: "COMPETITIVE_EVIDENCE_NOT_COMPLETE",
    path: "competitive_landscape.evidence_complete",
    bad: false,
  },
  {
    id: "ORACLE-016",
    code: "COMPETITIVE_RANKING_LLM_USED",
    path: "competitive_landscape.ranking_llm_calls",
    bad: 1,
  },
  {
    id: "ORACLE-020",
    code: "DONOR_CRAWL_INCOMPLETE",
    path: "donor_evidence.0.successful_pages",
    bad: 0,
    container: "donor_evidence",
  },
  {
    id: "ORACLE-021",
    code: "DONOR_SCREENSHOT_INCOMPLETE",
    path: "donor_evidence.0.screenshots",
    bad: 0,
    container: "donor_evidence",
  },
  {
    id: "ORACLE-022",
    code: "DONOR_DIGEST_MISSING",
    path: "donor_evidence.0.evidence_digest",
    bad: "",
    container: "donor_evidence",
  },
  {
    id: "ORACLE-025",
    code: "WEBSITE_BLUEPRINT_LANDSCAPE_MISMATCH",
    path: "website_build_blueprint.competitive_landscape_ref",
    bad: "other",
  },
  {
    id: "ORACLE-030",
    code: "SEO_BATCH_SIZE_DRIFT",
    path: "seo_content_blueprint.batch_size",
    bad: 5,
  },
  {
    id: "ORACLE-031",
    code: "SEO_BATCH_COUNT_INVALID",
    path: "seo_content_blueprint.batch_count",
    bad: 7,
  },
  {
    id: "ORACLE-032",
    code: "SEO_BLUEPRINT_LANDSCAPE_MISMATCH",
    path: "seo_content_blueprint.competitive_landscape_ref",
    bad: "other",
  },
  { id: "ORACLE-037", code: "PCC_LLM_USED", path: "page_content_contract.llm_calls", bad: 1 },
  {
    id: "ORACLE-038",
    code: "CONTENT_REQUIREMENT_UNPLACED",
    path: "page_content_contract.unplaced_requirements",
    bad: 1,
  },
  {
    id: "ORACLE-042",
    code: "STRUCTURED_CONTENT_LINEAGE_MISMATCH",
    path: "structured_content.page_content_contract_ref",
    bad: "other",
  },
  {
    id: "ORACLE-043",
    code: "STRUCTURED_CONTENT_SCHEMA_INVALID",
    path: "structured_content.route_results.0.schema_errors",
    bad: 1,
    container: "structured_content.route_results",
  },
  {
    id: "ORACLE-044",
    code: "UNSUPPORTED_CONTENT_CLAIM",
    path: "structured_content.route_results.0.unsupported_claims",
    bad: 1,
    container: "structured_content.route_results",
  },
  {
    id: "ORACLE-045",
    code: "CONTENT_REQUIREMENT_UNSATISFIED",
    path: "structured_content.route_results.0.failed_requirements",
    bad: 1,
    container: "structured_content.route_results",
  },
  {
    id: "ORACLE-046",
    code: "CONTENT_REPAIR_BUDGET_EXCEEDED",
    path: "structured_content.route_results.0.repair_attempts",
    bad: 2,
    container: "structured_content.route_results",
  },
  {
    id: "ORACLE-047",
    code: "CONTENT_GENERATION_BUDGET_EXCEEDED",
    path: "structured_content.route_results.0.generation_calls",
    bad: 3,
    container: "structured_content.route_results",
  },
  {
    id: "ORACLE-050",
    code: "LEGACY_CONTENT_AUTHORITY_USED",
    path: "legacy.content_generation_calls",
    bad: 1,
    container: "legacy",
  },
  {
    id: "ORACLE-051",
    code: "LEGACY_SCHEMA_AUTHORITY_USED",
    path: "legacy.schema_llm_calls",
    bad: 1,
    container: "legacy",
  },
  {
    id: "ORACLE-054",
    code: "SOURCE_ASSET_CORPUS_EMPTY",
    path: "assets.raw_source_images",
    bad: 0,
    container: "assets",
  },
  {
    id: "ORACLE-055",
    code: "AUTHORIZED_SOURCE_ASSETS_MISSING",
    path: "assets.authorized_reusable_images",
    bad: 0,
    container: "assets",
  },
  {
    id: "ORACLE-056",
    code: "SOURCE_IMAGE_REUSE_MISSING",
    path: "assets.selected_source_images",
    bad: 0,
    container: "assets",
  },
  {
    id: "ORACLE-057",
    code: "SOURCE_ASSET_REUSE_UNEXPLAINED",
    path: "assets.unexplained_reusable_asset_loss",
    bad: 1,
    container: "assets",
  },
  {
    id: "ORACLE-058",
    code: "VISUAL_ASSET_REQUIREMENT_UNSATISFIED",
    path: "assets.required_visual_slots_filled_fraction",
    bad: 0.5,
    container: "assets",
  },
  {
    id: "ORACLE-024",
    code: "DONOR_ASSET_REUSED",
    path: "assets.donor_asset_hash_matches",
    bad: 1,
    container: "assets",
  },
  {
    id: "ORACLE-063",
    code: "SITE_REACHABILITY_INCOMPLETE",
    path: "site.reachable_routes",
    bad: 28,
    container: "site",
  },
  {
    id: "ORACLE-064",
    code: "BROKEN_INTERNAL_LINKS",
    path: "site.broken_internal_links",
    bad: 1,
    container: "site",
  },
  {
    id: "ORACLE-065",
    code: "PLACEHOLDER_FOUND",
    path: "site.placeholder_count",
    bad: 1,
    container: "site",
  },
  {
    id: "ORACLE-069",
    code: "UNSUPPORTED_BUSINESS_CLAIM",
    path: "business_truth.unsupported_claim_count",
    bad: 1,
    container: "business_truth",
  },
  {
    id: "ORACLE-070",
    code: "PHONE_TRUTH_MISMATCH",
    path: "business_truth.phone_mismatch_count",
    bad: 1,
    container: "business_truth",
  },
  {
    id: "ORACLE-071",
    code: "EMAIL_TRUTH_MISMATCH",
    path: "business_truth.email_mismatch_count",
    bad: 1,
    container: "business_truth",
  },
  {
    id: "ORACLE-073",
    code: "PROVIDER_BYPASS_DETECTED",
    path: "llm_audit.direct_provider_bypass_count",
    bad: 1,
    container: "llm_audit",
  },
  {
    id: "ORACLE-074",
    code: "UNEXPECTED_SEARCH_ROUTING",
    path: "llm_audit.operations.SEO_CONTENT_BLUEPRINT.0.searchRequired",
    bad: true,
    container: "llm_audit.operations",
  },
  {
    id: "ORACLE-075",
    code: "SEARCH_POLICY_NOT_EXPLICIT",
    path: "llm_audit.operations.STRUCTURED_CONTENT_GENERATION.0.searchPolicySource",
    bad: "TASK_DEFAULT",
    container: "llm_audit.operations",
  },
  {
    id: "ORACLE-076",
    code: "UNEXPECTED_SEARCH_ROUTING",
    path: "llm_audit.operations.CONTENT_VALIDATION.0.searchRequired",
    bad: true,
    container: "llm_audit.operations",
  },
  {
    id: "ORACLE-085",
    code: "VISUAL_TRIAL_INCOMPLETE",
    path: "visual.pairs.0.trials",
    bad: [1, 2],
    container: "visual.pairs",
  },
];

const results = [];
for (const p of PROBES) {
  const present = structuredClone(skeleton());
  setPath(present, p.path, p.bad);
  const firesPresent = codesFor(present, `${p.id}-present`).has(p.code);

  const absent = structuredClone(skeleton());
  delPath(absent, p.path);
  const firesAbsent = codesFor(absent, `${p.id}-absent`).has(p.code);

  let firesNoContainer = null;
  let guardCode = null;
  let guardFires = null;
  if (p.container) {
    const noC = structuredClone(skeleton());
    delPath(noC, p.container);
    const codes = codesFor(noC, `${p.id}-nocontainer`);
    firesNoContainer = codes.has(p.code);
    guardCode = Object.hasOwn(CONTAINER_GUARDS, p.container)
      ? CONTAINER_GUARDS[p.container]
      : undefined;
    if (guardCode) guardFires = codes.has(guardCode);
  }

  const vacuous = firesPresent && (!firesAbsent || firesNoContainer === false);
  let verdict;
  if (!firesPresent) verdict = "INERT";
  else if (!vacuous) verdict = "SOUND";
  else verdict = guardFires === true ? "VACUOUS_GUARDED" : "VACUOUS_UNGUARDED";

  results.push({
    oracle_id: p.id,
    failure_code: p.code,
    evidence_path: p.path,
    container_path: p.container ?? null,
    fires_when_value_bad: firesPresent,
    fires_when_field_absent: firesAbsent,
    fires_when_container_absent: firesNoContainer,
    container_guard_code: guardCode ?? null,
    container_guard_fires: guardFires,
    verdict,
  });
}

const unguarded = results.filter((r) => r.verdict === "VACUOUS_UNGUARDED");
const guarded = results.filter((r) => r.verdict === "VACUOUS_GUARDED");
const vac = [...unguarded, ...guarded];
const inert = results.filter((r) => r.verdict === "INERT");
const sound = results.filter((r) => r.verdict === "SOUND");

const report = {
  schema: "l9.golden-oracle-soundness/v1",
  rule: "failure_behavior.missing_required_evidence.do_not_default_missing_numeric_values_to_zero",
  probes_total: results.length,
  sound: sound.length,
  vacuous_unguarded: unguarded.length,
  vacuous_guarded: guarded.length,
  inert: inert.length,
  false_accept_paths: unguarded.map((r) => r.oracle_id),
  vacuous_but_backstopped: guarded.map((r) => r.oracle_id),
  inert_properties: inert.map((r) => r.oracle_id),
  probes: results,
  verdict:
    vac.length === 0 && inert.length === 0
      ? "ORACLE_SOUNDNESS_COMPLETE"
      : "ORACLE_SOUNDNESS_INCOMPLETE",
};
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`probes            : ${results.length}`);
console.log(`sound             : ${sound.length}`);
console.log(`VACUOUS unguarded : ${unguarded.length}   <- false-ACCEPT paths`);
console.log(`vacuous guarded   : ${guarded.length}   <- backstopped by a count gate`);
console.log(`inert             : ${inert.length}`);
console.log(`verdict           : ${report.verdict}`);
if (unguarded.length) {
  console.log("\nUNGUARDED (absent evidence passes and NOTHING else catches it):");
  for (const r of unguarded) {
    const via = r.fires_when_field_absent === false ? "field absent" : "container absent";
    console.log(
      `  ${r.oracle_id}  ${r.failure_code}  <- ${via}: ${r.container_path ?? r.evidence_path}`,
    );
  }
}
if (guarded.length) {
  console.log(
    "\nGUARDED (property not independently enforced, but a count gate rejects the receipt):",
  );
  for (const r of guarded) {
    console.log(`  ${r.oracle_id}  ${r.failure_code}  <- guard ${r.container_guard_code}`);
  }
}
if (inert.length) {
  console.log("\nINERT (probe never fired - re-check wiring):");
  for (const r of inert) console.log(`  ${r.oracle_id}  ${r.failure_code}`);
}
process.exit(report.verdict === "ORACLE_SOUNDNESS_COMPLETE" ? 0 : 1);
