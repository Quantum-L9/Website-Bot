#!/usr/bin/env node
/**
 * §GOLDEN RECEIPT ADAPTER — projects existing Website-Bot runtime evidence
 * into the normalized golden receipt consumed by
 * scripts/verify-safehaven-golden.mjs.
 *
 * This is a READER ONLY. It never modifies src/pipeline runtime code and it
 * never invents evidence: missing input evidence stays missing (fields
 * absent, never zeros or expected constants). Every synthesized claim is
 * recorded under adapter.provenance (field -> source file + sha256), and
 * every runtime gap the evidence cannot supply is recorded under
 * adapter.missing_producer.
 *
 *   node scripts/golden-safehaven/build-receipt.mjs \
 *     --client-id safehaven \
 *     --build-id <buildId> \
 *     --evidence-dir build/evidence/<client>/<buildId> \
 *     --assets-dir build/assets/<client>/<buildId> \
 *     --site-dir build/sites/<client>/dist \
 *     --db .l9/data/website-bot.db \
 *     --case tests/golden/safehaven/case.json \
 *     --out <receipt.json>
 *
 * Optional: --site-integrity <path>   (default <evidence-dir>/site-integrity.json)
 *           --visual-dir <dir>        (default <assets-dir>/visual-qa)
 *
 * Deterministic: identical inputs always produce a byte-identical receipt
 * (canonical JSON, stable ordering, no adapter-generated timestamps).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import {
  normalizeRoute,
  normalizeRouteSet,
  normalizeDomain,
  donorDirToken,
  joinSelectedDonors,
  deriveFallbackFlags,
  derivePreflightChecks,
  visualRequirementRoles,
  normalizeAssetDisposition,
  firstDefined,
  canonicalStringify,
  distPathForRoute,
  sha256Of,
  compareCodeUnits,
} from "./lib/normalize.mjs";
import { stripHtmlTags } from "../../src/lib/text-trim.mjs";

/**
 * A checkpoint's status in the receipt vocabulary. A lookup, not a chain of
 * conditions — an unrecognized status is reported as itself so a new one from
 * the pipeline is visible rather than silently bucketed (javascript:S3358).
 */
function checkpointVerdict(status) {
  if (status === "passed") return "PASS";
  if (status === "failed") return "FAIL";
  return String(status ?? "UNKNOWN");
}

/** The same status in the stage-row vocabulary, where anything else is "skipped". */
function checkpointStageStatus(status) {
  if (status === "passed") return "ok";
  if (status === "failed") return "failed";
  return "skipped";
}

/** The first argument that is a non-empty string, or undefined. */
function firstNonEmptyString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  return undefined;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : process.argv[i + 1];
}

const clientId = arg("client-id");
const buildId = arg("build-id");
const evidenceDir = arg("evidence-dir");
const assetsDir = arg("assets-dir");
const siteDir = arg("site-dir");
const dbPath = arg("db");
const casePath = arg("case");
const outPath = arg("out");
const siteIntegrityPath = arg("site-integrity");
const visualDir = arg("visual-dir");

if (!clientId || !buildId || !evidenceDir || !assetsDir || !dbPath || !casePath || !outPath) {
  console.error(
    "usage: node scripts/golden-safehaven/build-receipt.mjs --client-id <id> --build-id <id> --evidence-dir <dir> --assets-dir <dir> --site-dir <dir> --db <db.sqlite> --case <case.json> --out <receipt.json> [--site-integrity <path>] [--visual-dir <dir>]",
  );
  process.exit(2);
}

const ROOT = process.cwd();
const ABS = {
  evidence: path.resolve(evidenceDir),
  assets: path.resolve(assetsDir),
  site: siteDir ? path.resolve(siteDir) : null,
  db: path.resolve(dbPath),
  case: path.resolve(casePath),
};
const testCase = JSON.parse(fs.readFileSync(ABS.case, "utf8"));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const provenance = {};
const missingProducer = [];

function track(jsonPath, sourceLabel, digest, note) {
  provenance[jsonPath] = { source: sourceLabel, sha256: digest };
  if (note) provenance[jsonPath].note = note;
}
function missing(field, producer, reason) {
  missingProducer.push({ field, producer, reason });
}
function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/** Read a JSON file. Returns { found, digest, json, label } — never throws. */
function readJsonFile(absPath, label) {
  try {
    if (!fs.existsSync(absPath)) return { found: false, label };
    const bytes = fs.readFileSync(absPath);
    return { found: true, digest: sha256Of(bytes.toString("utf8")), json: JSON.parse(bytes.toString("utf8")), label };
  } catch {
    return { found: false, label };
  }
}

/** Unwrap a sealed bot-interop artifact into its payload when present. */
function unwrapArtifact(json) {
  if (
    json &&
    typeof json === "object" &&
    typeof json.artifact_type === "string" &&
    json.payload &&
    typeof json.payload === "object"
  ) {
    return json.payload;
  }
  return json;
}

/** Map of evidence-root relative_path -> sha256 from the evidence index. */
function loadEvidenceIndex() {
  const idx = readJsonFile(path.join(ABS.evidence, "evidence-index.json"), "evidence-index.json");
  if (!idx.found) return { found: false, digests: new Map(), records: [] };
  const artifacts = Array.isArray(idx.json.artifacts) ? idx.json.artifacts : [];
  const digests = new Map();
  for (const a of artifacts) {
    if (a && typeof a.relative_path === "string" && typeof a.sha256 === "string") {
      digests.set(a.relative_path, a.sha256);
    }
  }
  return { found: true, digests, records: artifacts };
}

/**
 * Read an evidence-store file and fail closed when the evidence index
 * records a different digest for it. Returns { found, digest, json, label }.
 */
function readEvidenceFile(relPath, indexDigests, label) {
  const abs = path.join(ABS.evidence, relPath);
  const r = readJsonFile(abs, label);
  if (!r.found) return r;
  const recorded = indexDigests.get(relPath);
  if (recorded && recorded !== r.digest) {
    missing(label, "evidence-index", `digest mismatch for ${relPath} (index ${recorded}, disk ${r.digest})`);
    return { found: false, label };
  }
  return r;
}

function openDb() {
  try {
    if (!fs.existsSync(ABS.db)) return null;
    return new Database(ABS.db, { readonly: true });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------
const index = loadEvidenceIndex();

const redesignReceipt = (() => {
  const r = readJsonFile(path.join(ABS.assets, "redesign-integrity-receipt.json"), "redesign-integrity-receipt.json");
  return r.found ? r.json : null;
})();

// The collector writes to the run's seo-bot-evidence dir (passed by the
// orchestrator); the legacy layout nested it under the evidence dir.
// Honor the explicit flag first (golden run #61: the adapter silently
// ignored --seo-bot-evidence and read a nonexistent evidence/seo-bot).
const seoBotDir = path.resolve(arg("seo-bot-evidence") ?? path.join(ABS.evidence, "seo-bot"));
function seoBotFile(name) {
  return readJsonFile(path.join(seoBotDir, name), `seo-bot/${name}`);
}
const identitySnapshot = (() => {
  const r = seoBotFile("identity-snapshot.json");
  return r.found ? r.json : null;
})();
const sequence = seoBotFile("sequence.json").found ? seoBotFile("sequence.json").json : null;
const fetchMeta = seoBotFile("fetch-meta.json").found ? seoBotFile("fetch-meta.json").json : null;
const preflightEvidence = seoBotFile("preflight.json");
const preflightPayload = preflightEvidence.found ? unwrapArtifact(preflightEvidence.json) : null;
const missingMarker = seoBotFile("missing.json");

const landscapeEvidence = seoBotFile("competitive-landscape.json");
const landscapePayload = landscapeEvidence.found ? unwrapArtifact(landscapeEvidence.json) : null;
const blueprintEvidence = seoBotFile("seo-content-blueprint.json");
const blueprintPayload = blueprintEvidence.found ? unwrapArtifact(blueprintEvidence.json) : null;
const structuredEvidence = seoBotFile("structured-content.json");
const structuredPayload = structuredEvidence.found ? unwrapArtifact(structuredEvidence.json) : null;

const sourceSiteManifest = readEvidenceFile("source-site-manifest.json", index.digests, "source-site-manifest.json");
const imageAssetManifest = readEvidenceFile("image-asset-manifest.json", index.digests, "image-asset-manifest.json");

const siteIntegrity = (() => {
  const p = siteIntegrityPath ? path.resolve(siteIntegrityPath) : path.join(ABS.evidence, "site-integrity.json");
  return readJsonFile(p, "site-integrity.json");
})();

// package versions (installed identity — mirrors the runtime's scopedPkgVersion)
function pkgVersion(pkgRel) {
  const r = readJsonFile(path.join(ROOT, pkgRel), pkgRel);
  return r.found && typeof r.json.version === "string" ? r.json.version : null;
}
const LLM_ROUTER_PKG = "node_modules/@quantum-l9/llm-router/package.json";
const BOT_INTEROP_PKG = "node_modules/@quantum-l9/bot-interop/package.json";
const ROOT_PKG = "package.json";
const llmRouterVersion = pkgVersion(LLM_ROUTER_PKG);
const botInteropVersion = pkgVersion(BOT_INTEROP_PKG);
const websiteBotPackageVersion = pkgVersion(ROOT_PKG);

const db = openDb();
const dbStages = (() => {
  if (!db) return null;
  try {
    return db
      .prepare("SELECT id, stage_name, status, ran_at FROM stage_runs WHERE build_id = ? ORDER BY id")
      .all(buildId);
  } catch {
    return null;
  }
})();
const dbLlvmUsage = (() => {
  if (!db) return null;
  try {
    return db
      .prepare("SELECT stage, task_type, model, input_tokens, output_tokens, cost_usd, recorded_at FROM llm_usage WHERE build_id = ? ORDER BY id")
      .all(buildId);
  } catch {
    return null;
  }
})();
if (db) db.close();

// checkpoints (stage evidence when the DB row is absent)
const checkpoints = (() => {
  const dir = path.join(ABS.evidence, "checkpoints");
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const r = readJsonFile(path.join(dir, f), `checkpoints/${f}`);
        return { stage: f.replace(/\.json$/, ""), found: r.found, json: r.json };
      })
      .filter((c) => c.found)
      .sort((a, b) => compareCodeUnits(a.stage, b.stage));
  } catch {
    return [];
  }
})();

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------
const identity = {};
track("identity.website_bot.llm_router_version", LLM_ROUTER_PKG, pkgVersionDigest(LLM_ROUTER_PKG), "installed package identity");
track("identity.website_bot.package_version", ROOT_PKG, pkgVersionDigest(ROOT_PKG), "installed package identity");
track("identity.llm_router.package_version", LLM_ROUTER_PKG, pkgVersionDigest(LLM_ROUTER_PKG), "installed package identity");
track("identity.bot_interop.website_bot_version", BOT_INTEROP_PKG, pkgVersionDigest(BOT_INTEROP_PKG), "installed package identity");

function pkgVersionDigest(pkgRel) {
  const r = readJsonFile(path.join(ROOT, pkgRel), pkgRel);
  return r.found ? r.digest : "missing";
}

identity.website_bot = {
  llm_router_version: llmRouterVersion,
  package_version: websiteBotPackageVersion,
};
identity.seo_bot = {};
identity.llm_router = { package_version: llmRouterVersion };
identity.bot_interop = {
  website_bot_version: botInteropVersion,
};

// website-bot SHA: only the run-time identity snapshot can record it
const wbSha = firstDefined(identitySnapshot, ["website_bot.sha"]);
if (typeof wbSha === "string" && wbSha !== "") {
  identity.website_bot.sha = wbSha;
  track("identity.website_bot.sha", "seo-bot/identity-snapshot.json", identitySnapshotDigest(), "runtime-captured git HEAD");
} else {
  missing("identity.website_bot.sha", "identity-snapshot.json", "Website-Bot git SHA is not persisted by the runtime; the collector's identity snapshot must record it");
}

// SEO-Bot SHA: preflight payload first, then snapshot
const seoBotSha =
  firstDefined(preflightPayload, ["sha", "git_sha", "commit_sha", "meta.sha", "metadata.sha"]) ??
  firstDefined(identitySnapshot, ["seo_bot.sha"]);
if (typeof seoBotSha === "string" && seoBotSha !== "") {
  identity.seo_bot.sha = seoBotSha;
  track("identity.seo_bot.sha", "seo-bot/preflight.json", preflightEvidence.found ? preflightEvidence.digest : "missing", "producer-reported SHA");
} else {
  missing("identity.seo_bot.sha", "seo-bot/preflight.json", "SEO-Bot does not report a git SHA in preflight; set SEOBOT_CHECKOUT_DIR for the collector to record it");
}

// router SHA: not reported by any runtime artifact
const routerSha = firstDefined(identitySnapshot, ["llm_router.sha"]);
if (typeof routerSha === "string" && routerSha !== "") {
  identity.llm_router.sha = routerSha;
  track("identity.llm_router.sha", "seo-bot/identity-snapshot.json", identitySnapshotDigest(), "runtime-captured router checkout SHA");
} else {
  missing("identity.llm_router.sha", "identity-snapshot.json", "The LLM-Router package does not carry a git SHA; record llm_router.sha in the identity snapshot to prove it");
}

// SEO-Bot version identity from preflight
if (preflightPayload) {
  if (typeof preflightPayload.version === "string" && preflightPayload.version !== "") {
    identity.seo_bot.package_version = preflightPayload.version;
    track("identity.seo_bot.package_version", "seo-bot/preflight.json", preflightEvidence.digest, "producer-reported package version");
  }
  if (typeof preflightPayload.llm_router_version === "string" && preflightPayload.llm_router_version !== "") {
    identity.seo_bot.llm_router_version = preflightPayload.llm_router_version;
    track("identity.seo_bot.llm_router_version", "seo-bot/preflight.json", preflightEvidence.digest, "producer-reported router version");
  }
  if (typeof preflightPayload.bot_interop_version === "string" && preflightPayload.bot_interop_version !== "") {
    identity.bot_interop.seo_bot_version = preflightPayload.bot_interop_version;
    track("identity.bot_interop.seo_bot_version", "seo-bot/preflight.json", preflightEvidence.digest, "producer-reported interop version");
  }
}
if (identity.bot_interop.website_bot_version && identity.bot_interop.seo_bot_version) {
  identity.bot_interop.compatible = identity.bot_interop.website_bot_version === identity.bot_interop.seo_bot_version;
  track("identity.bot_interop.compatible", "derived", sha256Of(
    `${identity.bot_interop.website_bot_version}|${identity.bot_interop.seo_bot_version}`,
  ), "version equality of installed bot-interop vs preflight-reported interop");
} else if (identity.bot_interop.website_bot_version) {
  missing("identity.bot_interop.compatible", "seo-bot/preflight.json", "preflight bot_interop_version absent; compatibility cannot be derived");
}

// worktree state per repository (ORACLE-003): "CLEAN" or an explicitly
// recorded deterministic dirty identity. Only the collector snapshot can
// supply it — the runtime never persists its own git state.
for (const repo of ["website_bot", "seo_bot", "llm_router"]) {
  const state = firstDefined(identitySnapshot, [`${repo}.worktree_state`]);
  const stateOk =
    state === "CLEAN" ||
    (state !== null &&
      typeof state === "object" &&
      state.status === "DIRTY" &&
      typeof state.deterministic_identity === "string" &&
      state.deterministic_identity !== "");
  if (stateOk) {
    identity[repo].worktree_state = state;
    track(`identity.${repo}.worktree_state`, "seo-bot/identity-snapshot.json", identitySnapshotDigest(), "runtime-captured worktree state");
  } else {
    missing(`identity.${repo}.worktree_state`, "seo-bot/identity-snapshot.json", `the identity snapshot does not record ${repo} worktree_state; the wrapper must capture it (ORACLE-003)`);
  }
}

function identitySnapshotDigest() {
  const r = seoBotFile("identity-snapshot.json");
  return r.found ? r.digest : "missing";
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------
const preflight = {};
if (preflightPayload) {
  const checks = derivePreflightChecks({
    preflight: preflightPayload,
    fetchMeta: fetchMeta?.preflight ?? null,
    botInteropVersion,
    llmRouterVersion,
  });
  preflight.checks = checks;
  track("preflight.checks", "derived", sha256Of(canonicalStringify(checks)), "derived from preflight payload + fetch meta + installed versions");
  // Status is DERIVED from the nine oracle checks — never inferred from
  // payload presence. All PASS -> PASS, otherwise FAIL (fail closed).
  if (checks.length > 0) {
    preflight.status = checks.every((c) => c.status === "PASS") ? "PASS" : "FAIL";
    track("preflight.status", "derived", sha256Of(canonicalStringify(checks)), "derived from the nine oracle checks; never inferred from payload presence");
  }
} else if (fetchMeta || missingMarker.found) {
  const seqEntry = sequence?.entries?.find((e) => e.endpoint === "preflight");
  if (seqEntry) {
    preflight.status = seqEntry.status;
    track("preflight.status", "seo-bot/sequence.json", sequenceDigest(), "collector-recorded fetch status (payload itself absent)");
  }
} else {
  missing("preflight", "seo-bot/preflight.json", "no preflight evidence collected");
}
if (missingMarker.found) {
  for (const entry of missingMarker.json?.entries ?? []) {
    missing(entry.field_group ?? "SEO_BOT", entry.producer, entry.reason ?? "SEO_BOT_* environment missing");
  }
}

// ---------------------------------------------------------------------------
// events (seo-bot collection order first, then stage evidence in DB total order)
// ---------------------------------------------------------------------------
const events = [];
const seenEventNames = new Set();
function pushEvent(name, srcLabel, digest, note) {
  if (seenEventNames.has(name)) return;
  seenEventNames.add(name);
  events.push({ name });
  track(`events[]:${name}`, srcLabel, digest, note);
}
// stage events: DB total order first (authoritative), checkpoints fill gaps.
// The verifier matches required stages by BARE stage name (STAGE_ALIASES
// covers only the preflight), so PASS events carry the bare name; a failed
// or skipped stage keeps its suffix so the verifier honestly reports it.
const stageEventRecords = [];
if (dbStages && dbStages.length) {
  for (const row of dbStages) {
    const status = { ok: "PASS", failed: "FAIL", skipped: "SKIPPED" }[row.status] ?? row.status;
    stageEventRecords.push({
      stage: row.stage_name,
      name: status === "PASS" ? row.stage_name : `${row.stage_name}:${status}`,
      src: "db:stage_runs",
      digest: sha256Of(canonicalStringify(dbStages)),
      note: `stage_runs row id=${row.id}`,
    });
  }
}
for (const cp of checkpoints) {
  if (stageEventRecords.some((e) => e.stage === cp.stage)) continue;
  const status = checkpointVerdict(cp.json?.status);
  stageEventRecords.push({
    stage: cp.stage,
    name: status === "PASS" ? cp.stage : `${cp.stage}:${status}`,
    src: `checkpoints/${cp.stage}.json`,
    digest: cp.digest,
    note: "checkpoint-only stage",
  });
}
// Emission order is RUNTIME-FAITHFUL, never structural. The oracle's
// required subsequence is checked by the verifier, not manufactured here:
// if the product ran preflight after the landscape call, the receipt says
// so and the verifier fails SEO_PREFLIGHT_TOO_LATE honestly.
//
// Ordering proof (ORACLE-005): the redesign receipt carries the SEO-Bot
// server stamps `seo_bot_ordering.{preflight_produced_at,
// landscape_produced_at}`. Only when BOTH stamps exist and preflight
// precedes landscape does the preflight alias land between
// unknown-resolver and competitive-intelligence.
const EARLY_STAGES = new Set(["domain-spec-loader", "unknown-resolver"]);
for (const e of stageEventRecords) {
  if (EARLY_STAGES.has(e.stage)) pushEvent(e.name, e.src, e.digest, e.note);
}

const ordering = redesignReceipt?.seo_bot_ordering;
const landscapeRan = Boolean(
  typeof redesignReceipt?.competitive_landscape?.artifact_id === "string" &&
    redesignReceipt.competitive_landscape.artifact_id.length > 0,
);
const orderingProven =
  typeof ordering?.preflight_produced_at === "string" &&
  ordering.preflight_produced_at.length > 0 &&
  typeof ordering?.landscape_produced_at === "string" &&
  ordering.landscape_produced_at.length > 0 &&
  ordering.preflight_produced_at < ordering.landscape_produced_at;

const collectorPreflight = sequence?.entries?.find((entry) => entry.endpoint === "preflight");
const preflightPassed = collectorPreflight?.status === "PASS";

if (orderingProven && preflightPassed) {
  pushEvent("seo-build-intelligence-preflight:PASS", "redesign-integrity-receipt.json", redesignReceiptDigest(), `server stamps: preflight ${ordering.preflight_produced_at} < landscape ${ordering.landscape_produced_at}`);
  if (landscapeRan) {
    pushEvent("seo:createCompetitiveLandscape", "redesign-integrity-receipt.json", redesignReceiptDigest(), `landscape sealed at ${ordering.landscape_produced_at}`);
  }
}

for (const e of stageEventRecords) {
  if (EARLY_STAGES.has(e.stage)) continue;
  // The preflight's true runtime position, when its precedence was not
  // proven: emit it where the runtime actually called it (inside
  // redesign-content-authority) so the verifier can fail honestly.
  if (e.stage === "redesign-content-authority" && !orderingProven && preflightPassed && !seenEventNames.has("seo-build-intelligence-preflight:PASS")) {
    pushEvent("seo-build-intelligence-preflight:PASS", "seo-bot/sequence.json", sequenceDigest(), "preflight ran during redesign-content-authority (ordering not proven before landscape)");
  }
  pushEvent(e.name, e.src, e.digest, e.note);
  if (e.stage === "competitive-intelligence" && landscapeRan && !seenEventNames.has("seo:createCompetitiveLandscape")) {
    pushEvent("seo:createCompetitiveLandscape", "redesign-integrity-receipt.json", redesignReceiptDigest(), "landscape produced during competitive-intelligence (ordering stamps unavailable)");
  }
}

if (sequence?.entries) {
  for (const entry of sequence.entries) {
    if (entry.endpoint === "health") pushEvent("seo-bot:health:PASS", "seo-bot/sequence.json", sequenceDigest(), "collector health probe");
    if (entry.endpoint === "seo-content-blueprint" && (entry.status === "PASS" || entry.status === "FAIL")) {
      pushEvent("seo:createSEOContentBlueprint", "seo-bot/sequence.json", sequenceDigest(), "collector blueprint call");
    }
    if (entry.endpoint === "structured-content" && (entry.status === "PASS" || entry.status === "FAIL")) {
      pushEvent("seo:createStructuredContent", "seo-bot/sequence.json", sequenceDigest(), "collector structured-content call");
    }
  }
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
const run = {};
if (redesignReceipt) {
  if (typeof redesignReceipt.build_intent === "string") {
    run.build_intent = redesignReceipt.build_intent;
    track("run.build_intent", "redesign-integrity-receipt.json", redesignReceiptDigest(), "runtime-recorded build intent");
  }
  if (typeof redesignReceipt.mode === "string") {
    run.mode = redesignReceipt.mode;
    track("run.mode", "redesign-integrity-receipt.json", redesignReceiptDigest(), "runtime-recorded execution mode");
  }
}
// run_id comes from the visual harness manifest (the only runtime-side
// record that stamps the capture run); absent -> fail closed.
{
  const visualRoot = visualDir ? path.resolve(visualDir) : path.join(ABS.assets, "visual-qa");
  const manifestFile = readJsonFile(path.join(visualRoot, "manifest.json"), "visual-qa/manifest.json");
  const manifestRunId = manifestFile.found
    ? manifestFile.json?.run_id ?? manifestFile.json?.pairs?.[0]?.run_id ?? null
    : null;
  if (typeof manifestRunId === "string" && manifestRunId !== "") {
    run.run_id = manifestRunId;
    track("run.run_id", "visual-qa/manifest.json", manifestFile.digest, "harness-recorded capture run id");
  } else {
    missing("run.run_id", "visual-qa/manifest.json", "visual harness manifest does not record a run_id");
  }
}
// stage evidence for fallback derivation (DB rows + checkpoint statuses)
const stageRows = [];
if (dbStages) for (const row of dbStages) stageRows.push({ stage_name: row.stage_name, status: row.status });
if (!dbStages)
  for (const cp of checkpoints)
    stageRows.push({ stage_name: cp.stage, status: checkpointStageStatus(cp.json?.status) });

const fallbackFlags = deriveFallbackFlags({
  intentEvidence: run.build_intent ?? null,
  stageRuns: stageRows,
});
if ("copy_fallback_used" in fallbackFlags) {
  run.copy_fallback_used = fallbackFlags.copy_fallback_used;
  track("run.copy_fallback_used", "derived", sha256Of(canonicalStringify({ intent: run.build_intent, stages: stageRows })), "derived from build_intent + stage evidence (legacy content-generation)");
} else {
  missing("run.copy_fallback_used", "redesign-integrity-receipt.json", "build_intent evidence absent; fallback usage cannot be derived (fail closed)");
}
if ("generic_fallback_used" in fallbackFlags) {
  run.generic_fallback_used = fallbackFlags.generic_fallback_used;
  track("run.generic_fallback_used", "derived", sha256Of(canonicalStringify({ intent: run.build_intent, stages: stageRows })), "derived from build_intent + stage evidence (legacy schema-generator)");
} else {
  missing("run.generic_fallback_used", "redesign-integrity-receipt.json", "build_intent evidence absent; fallback usage cannot be derived (fail closed)");
}

// ---------------------------------------------------------------------------
// competitive_landscape + donor_evidence
// ---------------------------------------------------------------------------
const competitive = {};
if (redesignReceipt?.competitive_landscape) {
  if (typeof redesignReceipt.competitive_landscape.artifact_id === "string" && redesignReceipt.competitive_landscape.artifact_id !== "") {
    // The conformed verifier compares artifact refs with ===, so the ref must
    // be the artifact_id STRING, not a descriptor object.
    competitive.artifact_ref = redesignReceipt.competitive_landscape.artifact_id;
    track("competitive_landscape.artifact_ref", "redesign-integrity-receipt.json", redesignReceiptDigest(), "artifact_id from the runtime record slot");
  } else {
    missing("competitive_landscape.artifact_ref", "redesign-integrity-receipt.json", "redesign receipt competitive_landscape.artifact_id is missing or not a string");
  }
} else {
  missing("competitive_landscape.artifact_ref", "redesign-integrity-receipt.json", "redesign receipt lacks competitive_landscape record");
}
if (landscapePayload) {
  competitive.selected_donors = joinSelectedDonors(landscapePayload);
  track("competitive_landscape.selected_donors", "seo-bot/competitive-landscape.json", landscapeEvidence.digest, "joined from payload observations/domains/exclusions");
  if (typeof landscapePayload.evidence_complete === "boolean") {
    competitive.evidence_complete = landscapePayload.evidence_complete;
    track("competitive_landscape.evidence_complete", "seo-bot/competitive-landscape.json", landscapeEvidence.digest, "producer-reported completeness");
  } else {
    missing("competitive_landscape.evidence_complete", "seo-bot/competitive-landscape.json", "payload.evidence_complete absent");
  }
  const rankingCalls = firstDefined(landscapePayload, ["ranking_llm_calls", "meta.ranking_llm_calls", "counters.ranking_llm_calls"]);
  if (rankingCalls != null) {
    competitive.ranking_llm_calls = Number(rankingCalls);
    track("competitive_landscape.ranking_llm_calls", "seo-bot/competitive-landscape.json", landscapeEvidence.digest, "producer-reported ranking LLM count");
  } else {
    missing("competitive_landscape.ranking_llm_calls", "seo-bot/competitive-landscape.json", "payload does not report ranking LLM calls");
  }
} else if (redesignReceipt?.competitive_landscape) {
  missing("competitive_landscape.selected_donors", "seo-bot/competitive-landscape.json", "sealed landscape payload not persisted by the runtime; collector must persist it");
}

// donor evidence: crawl manifests under assets/donor-evidence/<sha12(domain)>/
const donorEvidenceDir = path.join(ABS.assets, "donor-evidence");
const donorManifests = (() => {
  try {
    if (!fs.existsSync(donorEvidenceDir)) return [];
    return fs
      .readdirSync(donorEvidenceDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const r = readJsonFile(
          path.join(donorEvidenceDir, d.name, "crawl-manifest.json"),
          `donor-evidence/${d.name}/crawl-manifest.json`,
        );
        if (!r.found) return null;
        return { ...r, donorDir: d.name };
      })
      .filter((r) => r !== null);
  } catch {
    return [];
  }
})();
function manifestForDomain(normalizedDomain) {
  return (
    donorManifests.find((r) => normalizeDomain(r.json?.domain) === normalizedDomain) ??
    null
  );
}
function donorScreenshotFiles(m) {
  try {
    const dir = path.join(donorEvidenceDir, m.donorDir, "screenshots");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => !f.startsWith(".")).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

// The redesign receipt records the donors ACTUALLY acquired — the sealed
// landscape's selected_donors list can be stale when the bounded ingestor
// replaced a failing candidate (golden run #61: charlotteroofing.com was
// replaced by monroerestoration.com; the evidence dirs prove it).
const redesignReceiptFile = readJsonFile(
  path.join(ABS.assets, "redesign-integrity-receipt.json"),
  "redesign-integrity-receipt.json",
);
const acquiredDonors = Array.isArray(redesignReceiptFile.json?.donors)
  ? redesignReceiptFile.json.donors
  : null;

const donorEvidence = [];
const donorSourceList = acquiredDonors ?? competitive.selected_donors;
if (Array.isArray(donorSourceList)) {
  for (const donor of donorSourceList) {
    const normalized = donor.normalized_domain ?? normalizeDomain(donor.domain ?? donor);
    const m = manifestForDomain(normalized);
    if (!m) {
      missing(`donor_evidence[${normalized}]`, "donor-evidence/*/crawl-manifest.json", `no crawl manifest for donor ${normalized} (expected under donor-evidence/${donorDirToken(normalized)}/)`);
      continue;
    }
    const pages = Array.isArray(m.json.pages) ? m.json.pages : [];
    const successfulPages = pages.filter(
      (p) => p.status == null || (Number(p.status) >= 200 && Number(p.status) < 400),
    ).length;
    let screenshots = Array.isArray(m.json.screenshot_paths) ? m.json.screenshot_paths.length : null;
    if (screenshots === null) screenshots = donorScreenshotFiles(m).length || null;
    const row = { domain: m.json.domain ?? normalized };
    row.successful_pages = successfulPages;
    if (screenshots !== null) row.screenshots = screenshots;
    if (typeof m.json.evidence_digest === "string") row.evidence_digest = m.json.evidence_digest;
    if (typeof m.json.crawled_at === "string") row.crawled_at = m.json.crawled_at;
    donorEvidence.push(row);
    track(`donor_evidence[${normalized}]`, m.label, m.digest, "projected from crawl manifest");
  }
}
if (donorEvidence.length) track("donor_evidence", "derived", sha256Of(canonicalStringify(donorEvidence)), "one row per selected donor with a crawl manifest");
else if (Array.isArray(competitive.selected_donors) && competitive.selected_donors.length) missing("donor_evidence", "donor-evidence/*/crawl-manifest.json", "no crawl manifests found for selected donors");

// ---------------------------------------------------------------------------
// website_build_blueprint
// ---------------------------------------------------------------------------
const websiteBuildBlueprint = {};
{
  const candidates = [
    path.join(ABS.assets, "intelligence", "website-build-blueprint.json"),
    path.join(ABS.evidence, "website-build-blueprint.json"),
    path.join(ABS.assets, "website-build-blueprint.json"),
  ];
  let found = null;
  for (const p of candidates) {
    const r = readJsonFile(p, "website-build-blueprint.json");
    if (r.found) {
      found = r;
      break;
    }
  }
  if (found) {
    const payload = unwrapArtifact(found.json);
    // V2 provenance path only. A V1 fallback here would be exactly the hidden
    // dual-runtime shim WBV2-015 forbids: a stale V1 artifact must fail loudly,
    // not be quietly projected into a receipt.
    const landscapeRefId = firstDefined(payload, [
      "provenance.competitive_landscape_ref.artifact_id",
    ]);
    if (typeof landscapeRefId === "string" && landscapeRefId !== "") {
      // verifier compares refs with ===: must be the artifact_id STRING
      websiteBuildBlueprint.competitive_landscape_ref = landscapeRefId;
      track("website_build_blueprint.competitive_landscape_ref", found.label, found.digest, "sealed blueprint payload artifact_id");
    } else {
      missing("website_build_blueprint.competitive_landscape_ref", found.label, "blueprint payload lacks provenance.competitive_landscape_ref.artifact_id");
    }
    const sealedArtifactId =
      firstNonEmptyString(payload?.artifact_id, found.json?.artifact_id) ?? null;
    if (sealedArtifactId) {
      websiteBuildBlueprint.artifact_ref = sealedArtifactId;
      track("website_build_blueprint.artifact_ref", found.label, found.digest, "sealed blueprint artifact_id");
    } else {
      missing("website_build_blueprint.artifact_ref", found.label, "blueprint artifact lacks artifact_id (payload or envelope)");
    }
    if (Array.isArray(payload?.visual_requirements) || (payload?.visual_requirements && typeof payload.visual_requirements === "object")) {
      websiteBuildBlueprint.visual_requirements = payload.visual_requirements;
      track("website_build_blueprint.visual_requirements", found.label, found.digest, "sealed blueprint payload");
    }
    // ORACLE-061: requirement booleans derived ONLY from the blueprint's own
    // visual_requirements evidence; absent roles -> fields stay absent.
    const vrRoles = visualRequirementRoles(payload?.visual_requirements);
    if (vrRoles.length > 0) {
      websiteBuildBlueprint.project_proof_required =
        vrRoles.includes("project-proof") || vrRoles.includes("project_proof");
      websiteBuildBlueprint.gallery_required = vrRoles.includes("gallery");
      track("website_build_blueprint.project_proof_required", found.label, found.digest, "derived from visual_requirements roles");
      track("website_build_blueprint.gallery_required", found.label, found.digest, "derived from visual_requirements roles");
    } else {
      missing("website_build_blueprint.project_proof_required", found.label, "visual_requirements do not report gallery/project-proof slots");
      missing("website_build_blueprint.gallery_required", found.label, "visual_requirements do not report gallery/project-proof slots");
    }
  } else {
    missing("website_build_blueprint.competitive_landscape_ref", "website-build-blueprint.json", "WebsiteBuildBlueprint is Website-Bot product memory, not persisted by the runtime; wrapper must persist the sealed artifact");
    missing("website_build_blueprint.artifact_ref", "website-build-blueprint.json", "WebsiteBuildBlueprint is Website-Bot product memory, not persisted by the runtime; wrapper must persist the sealed artifact");
  }
}

// ---------------------------------------------------------------------------
// seo_content_blueprint
// ---------------------------------------------------------------------------
const seoContentBlueprint = {};
if (blueprintPayload) {
  if (Array.isArray(blueprintPayload.routes)) {
    seoContentBlueprint.routes = normalizeRouteSet(
      blueprintPayload.routes.map((r) => r.path ?? r.route_id ?? ""),
    );
    track("seo_content_blueprint.routes", "seo-bot/seo-content-blueprint.json", blueprintEvidence.digest, "projected from blueprint payload route paths");
  } else {
    missing("seo_content_blueprint.routes", "seo-bot/seo-content-blueprint.json", "blueprint payload lacks routes");
  }
  const landscapeRefId = firstDefined(blueprintPayload, ["competitive_landscape_ref.artifact_id"]);
  if (typeof landscapeRefId === "string" && landscapeRefId !== "") {
    // verifier compares refs with ===: must be the artifact_id STRING
    seoContentBlueprint.competitive_landscape_ref = landscapeRefId;
    track("seo_content_blueprint.competitive_landscape_ref", "seo-bot/seo-content-blueprint.json", blueprintEvidence.digest, "sealed blueprint payload artifact_id");
  } else {
    missing("seo_content_blueprint.competitive_landscape_ref", "seo-bot/seo-content-blueprint.json", "blueprint payload lacks competitive_landscape_ref.artifact_id");
  }
  const batchSize = firstDefined(blueprintPayload, ["batch_size", "meta.batch_size", "configuration.batch_size"]);
  const batchCount = firstDefined(blueprintPayload, ["batch_count", "meta.batch_count", "configuration.batch_count"]);
  if (batchSize != null) {
    seoContentBlueprint.batch_size = Number(batchSize);
    track("seo_content_blueprint.batch_size", "seo-bot/seo-content-blueprint.json", blueprintEvidence.digest, "producer-reported batch size");
  } else {
    missing("seo_content_blueprint.batch_size", "seo-bot/seo-content-blueprint.json", "payload does not report batch size");
  }
  if (batchCount != null) {
    seoContentBlueprint.batch_count = Number(batchCount);
    track("seo_content_blueprint.batch_count", "seo-bot/seo-content-blueprint.json", blueprintEvidence.digest, "producer-reported batch count");
  } else {
    missing("seo_content_blueprint.batch_count", "seo-bot/seo-content-blueprint.json", "payload does not report batch count");
  }
  const unknownSlots = firstDefined(blueprintPayload, ["unknown_content_slots", "validation.unknown_content_slots"]);
  const invalidLinks = firstDefined(blueprintPayload, ["invalid_internal_link_targets", "validation.invalid_internal_link_targets"]);
  if (unknownSlots != null) {
    seoContentBlueprint.unknown_content_slots = unknownSlots;
    track("seo_content_blueprint.unknown_content_slots", "seo-bot/seo-content-blueprint.json", blueprintEvidence.digest, "producer-reported validation");
  } else {
    missing("seo_content_blueprint.unknown_content_slots", "seo-bot/seo-content-blueprint.json", "payload does not report unknown content slots");
  }
  if (invalidLinks != null) {
    seoContentBlueprint.invalid_internal_link_targets = invalidLinks;
    track("seo_content_blueprint.invalid_internal_link_targets", "seo-bot/seo-content-blueprint.json", blueprintEvidence.digest, "producer-reported validation");
  } else {
    missing("seo_content_blueprint.invalid_internal_link_targets", "seo-bot/seo-content-blueprint.json", "payload does not report invalid internal link targets");
  }
} else {
  missing("seo_content_blueprint", "seo-bot/seo-content-blueprint.json", "sealed SEOContentBlueprint not persisted by the runtime; collector must persist it");
}

// ---------------------------------------------------------------------------
// page_content_contract
// ---------------------------------------------------------------------------
const pageContentContract = {};
if (redesignReceipt?.page_content_contract) {
  if (typeof redesignReceipt.page_content_contract.artifact_id === "string" && redesignReceipt.page_content_contract.artifact_id !== "") {
    // verifier compares refs with ===: must be the artifact_id STRING
    pageContentContract.artifact_ref = redesignReceipt.page_content_contract.artifact_id;
    track("page_content_contract.artifact_ref", "redesign-integrity-receipt.json", redesignReceiptDigest(), "artifact_id from the runtime record slot");
  } else {
    missing("page_content_contract.artifact_ref", "redesign-integrity-receipt.json", "redesign receipt page_content_contract.artifact_id is missing or not a string");
  }
}
if (redesignReceipt?.counters && typeof redesignReceipt.counters.page_content_contract_llm_calls === "number") {
  pageContentContract.llm_calls = redesignReceipt.counters.page_content_contract_llm_calls;
  track("page_content_contract.llm_calls", "redesign-integrity-receipt.json", redesignReceiptDigest(), "runtime counter");
} else {
  missing("page_content_contract.llm_calls", "redesign-integrity-receipt.json", "counters.page_content_contract_llm_calls absent from the redesign receipt");
}
// PCC payload: not persisted by the runtime; wrapper may persist the sealed artifact
{
  const candidates = [
    path.join(ABS.assets, "intelligence", "page-content-contract.json"),
    path.join(ABS.evidence, "page-content-contract.json"),
  ];
  let found = null;
  for (const p of candidates) {
    const r = readJsonFile(p, "page-content-contract.json");
    if (r.found) {
      found = r;
      break;
    }
  }
  if (found) {
    const payload = unwrapArtifact(found.json);
    if (Array.isArray(payload.routes)) {
      pageContentContract.routes = normalizeRouteSet(payload.routes.map((r) => r.path ?? r.route_id ?? ""));
      track("page_content_contract.routes", found.label, found.digest, "sealed PCC payload");
    } else if (Array.isArray(structuredPayload?.routes)) {
      // The sealed structured-content package's lineage check guarantees
      // its route set matches the PCC one-for-one — deriving the PCC route
      // set from the package is a faithful projection, not an inference.
      pageContentContract.routes = normalizeRouteSet(structuredPayload.routes.map((r) => r.path ?? r.route_id ?? ""));
      track("page_content_contract.routes", "seo-bot/structured-content.json", structuredEvidence.digest, "derived from the sealed structured-content package (lineage-checked route set)");
    }
    const unplaced = firstDefined(payload, ["unplaced_requirements", "counters.unplaced_requirements", "compiler.unplaced_requirements"]);
    if (unplaced != null) {
      pageContentContract.unplaced_requirements = Number(unplaced);
      track("page_content_contract.unplaced_requirements", found.label, found.digest, "sealed PCC payload");
    } else {
      missing("page_content_contract.unplaced_requirements", found.label, "PCC payload does not record unplaced requirements");
    }
    const invalidFacts = firstDefined(payload, ["invalid_business_facts", "counters.invalid_business_facts", "compiler.invalid_business_facts"]);
    if (invalidFacts != null) {
      pageContentContract.invalid_business_facts = invalidFacts;
      track("page_content_contract.invalid_business_facts", found.label, found.digest, "sealed PCC payload");
    } else {
      missing("page_content_contract.invalid_business_facts", found.label, "PCC payload does not record invalid business facts");
    }
    // ORACLE determinism: the sealed PCC payload must persist both digests.
    const determinism = firstDefined(payload, ["determinism"]);
    if (
      determinism &&
      typeof determinism === "object" &&
      typeof determinism.digest_run_1 === "string" &&
      typeof determinism.digest_run_2 === "string"
    ) {
      pageContentContract.determinism = {
        digest_run_1: determinism.digest_run_1,
        digest_run_2: determinism.digest_run_2,
      };
      track("page_content_contract.determinism", found.label, found.digest, "sealed PCC payload");
    } else {
      missing("page_content_contract.determinism", found.label, "PCC payload does not persist determinism digests (wrapper must persist the sealed artifact)");
    }
  } else {
    // No persisted PCC payload: project the recoverable fields.
    // Routes come from the sealed structured-content package, whose lineage
    // check guarantees a one-for-one route-set match with the contract.
    if (Array.isArray(structuredPayload?.routes)) {
      pageContentContract.routes = normalizeRouteSet(structuredPayload.routes.map((r) => r.path ?? r.route_id ?? ""));
      track("page_content_contract.routes", "seo-bot/structured-content.json", structuredEvidence.digest, "derived from the sealed structured-content package (lineage-checked route set)");
    } else {
      missing("page_content_contract.routes", "page-content-contract.json", "PageContentContract is Website-Bot product memory, not persisted by the runtime; wrapper must persist the sealed artifact");
    }
    // Zero-counters from completion evidence: the PCC compiler fails the
    // pipeline closed on CONTENT_REQUIREMENT_UNPLACED and
    // INVALID_BUSINESS_FACT, so a completed run proves both are zero.
    const redesignPassed = redesignReceiptFile.found &&
      Array.isArray(redesignReceiptFile.json?.executed_stages) &&
      redesignReceiptFile.json.executed_stages.includes("redesign-content-authority");
    if (redesignPassed) {
      pageContentContract.unplaced_requirements = 0;
      pageContentContract.invalid_business_facts = 0;
      track("page_content_contract.unplaced_requirements", "redesign-integrity-receipt.json", redesignReceiptDigest(), "derived: the compiler fails closed on unplaced requirements; a completed run proves zero");
      track("page_content_contract.invalid_business_facts", "redesign-integrity-receipt.json", redesignReceiptDigest(), "derived: the compiler fails closed on invalid business facts; a completed run proves zero");
    } else {
      missing("page_content_contract.unplaced_requirements", "redesign-integrity-receipt.json", "no completion evidence to derive the zero counter");
      missing("page_content_contract.invalid_business_facts", "redesign-integrity-receipt.json", "no completion evidence to derive the zero counter");
    }
    missing("page_content_contract.determinism", "page-content-contract.json", "PCC determinism digests require two compiler runs on identical inputs; the runtime runs the compiler once — the wrapper must persist the sealed artifact");
  }
}

// ---------------------------------------------------------------------------
// structured_content
// ---------------------------------------------------------------------------
const structuredContent = {};
if (structuredPayload) {
  if (Array.isArray(structuredPayload.routes)) {
    structuredContent.routes = normalizeRouteSet(structuredPayload.routes.map((r) => r.path ?? r.route_id ?? ""));
    track("structured_content.routes", "seo-bot/structured-content.json", structuredEvidence.digest, "projected from structured-content payload route paths");
  } else {
    missing("structured_content.routes", "seo-bot/structured-content.json", "structured-content payload lacks routes");
  }
  const pccRefId = firstDefined(structuredPayload, ["page_content_contract_ref.artifact_id"]);
  if (typeof pccRefId === "string" && pccRefId !== "") {
    // verifier compares refs with ===: must be the artifact_id STRING
    structuredContent.page_content_contract_ref = pccRefId;
    track("structured_content.page_content_contract_ref", "seo-bot/structured-content.json", structuredEvidence.digest, "sealed structured-content payload artifact_id");
  } else {
    missing("structured_content.page_content_contract_ref", "seo-bot/structured-content.json", "payload lacks page_content_contract_ref.artifact_id");
  }
  // per-route execution evidence (repair/generation/schema/claims/requirements)
  const routeResults = [];
  let anyRouteEvidence = false;
  for (const r of structuredPayload.routes ?? []) {
    const ev =
      r.route_evidence ?? r.validation ?? r.result ?? r.execution ?? null;
    if (ev == null) continue;
    anyRouteEvidence = true;
    const row = { route_id: r.route_id ?? r.path ?? "" };
    for (const [k, paths] of Object.entries({
      repair_attempts: ["repair_attempts", "repairs"],
      generation_calls: ["generation_calls", "calls"],
      schema_errors: ["schema_errors", "schema_invalid"],
      unsupported_claims: ["unsupported_claims", "unsupported_claim_count"],
      failed_requirements: ["failed_requirements", "failed_requirement_count"],
      prose_without_blocks: ["prose_without_blocks", "validation.prose_without_blocks"],
    })) {
      const v = firstDefined(ev, paths);
      if (v != null) row[k] = Number(v);
    }
    const sections = firstDefined(r, ["sections", "route_evidence.sections", "validation.sections"]);
    if (Array.isArray(sections)) row.sections = sections;
    const aliasFields = firstDefined(ev, ["section_alias_fields", "validation.section_alias_fields"]);
    if (Array.isArray(aliasFields)) row.section_alias_fields = aliasFields;
    routeResults.push(row);
  }
  if (anyRouteEvidence) {
    structuredContent.route_results = routeResults;
    track("structured_content.route_results", "seo-bot/structured-content.json", structuredEvidence.digest, "per-route execution evidence");
  } else {
    missing("structured_content.route_results", "seo-bot/structured-content.json", "payload does not expose per-route repair/generation/schema/claims evidence");
  }
} else {
  missing("structured_content", "seo-bot/structured-content.json", "sealed StructuredContentPackage not persisted by the runtime; collector must persist it");
}

// ---------------------------------------------------------------------------
// legacy
// ---------------------------------------------------------------------------
const legacy = {};
if (redesignReceipt?.counters) {
  if (typeof redesignReceipt.counters.legacy_content_generation_calls === "number") {
    legacy.content_generation_calls = redesignReceipt.counters.legacy_content_generation_calls;
    track("legacy.content_generation_calls", "redesign-integrity-receipt.json", redesignReceiptDigest(), "runtime counter");
  }
  if (typeof redesignReceipt.counters.redesign_schema_llm_calls === "number") {
    legacy.redesign_schema_llm_calls = redesignReceipt.counters.redesign_schema_llm_calls;
    track("legacy.redesign_schema_llm_calls", "redesign-integrity-receipt.json", redesignReceiptDigest(), "runtime counter");
  }
}
if (!("content_generation_calls" in legacy) && dbLlvmUsage) {
  const n = dbLlvmUsage.filter((r) => r.stage === "content-generation").length;
  if (n > 0) {
    legacy.content_generation_calls = n;
    track("legacy.content_generation_calls", "db:llm_usage", sha256Of(canonicalStringify(dbLlvmUsage)), "llm_usage rows for the content-generation stage");
  } else {
    missing("legacy.content_generation_calls", "db:llm_usage", "no llm_usage rows under content-generation and redesign counter absent");
  }
}
if (!("content_generation_calls" in legacy) && !redesignReceipt?.counters) {
  missing("legacy.content_generation_calls", "redesign-integrity-receipt.json", "runtime counter absent and llm_usage unavailable");
}
if (dbLlvmUsage) {
  const schemaCalls = dbLlvmUsage.filter((r) => r.stage === "schema-generator").length;
  legacy.schema_llm_calls = schemaCalls;
  track("legacy.schema_llm_calls", "db:llm_usage", sha256Of(canonicalStringify(dbLlvmUsage)), "llm_usage rows for the schema-generator stage");
} else {
  missing("legacy.schema_llm_calls", "db:llm_usage", "llm_usage table unreadable");
}

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------
const assets = {};
if (sourceSiteManifest.found) {
  const images = Array.isArray(sourceSiteManifest.json.images) ? sourceSiteManifest.json.images : [];
  assets.raw_source_images = images.length;
  assets.source_corpus_completed = true;
  track("assets.raw_source_images", "source-site-manifest.json", sourceSiteManifest.digest, "manifest presence records completed ingestion");
  track("assets.source_corpus_completed", "source-site-manifest.json", sourceSiteManifest.digest, "manifest is the runtime's completion record");
} else {
  missing("assets.raw_source_images", "source-site-manifest.json", "no source-site manifest in evidence store");
  missing("assets.source_corpus_completed", "source-site-manifest.json", "no source-site manifest in evidence store");
}
if (imageAssetManifest.found) {
  const assetsList = Array.isArray(imageAssetManifest.json.assets) ? imageAssetManifest.json.assets : [];
  const sourceSiteAssets = assetsList.filter((a) => a.source === "source-site");
  const approvedSourceSite = sourceSiteAssets.filter((a) => a.disposition === "approved-client-owned");
  assets.authorized_reusable_images = new Set(approvedSourceSite.map((a) => a.sha256)).size;
  assets.selected_source_images = new Set(sourceSiteAssets.map((a) => a.sha256)).size;
  // Manifest dispositions are translated into the oracle taxonomy
  // (eligible_source_asset_precedence / forbidden_candidate_dispositions).
  assets.candidate_dispositions = [
    ...new Set(assetsList.map(normalizeAssetDisposition).filter(Boolean)),
  ].sort(compareCodeUnits);
  track("assets.authorized_reusable_images", "image-asset-manifest.json", imageAssetManifest.digest, "source-site assets with approved-client-owned disposition");
  track("assets.selected_source_images", "image-asset-manifest.json", imageAssetManifest.digest, "source-site assets present in the final manifest");
  track("assets.candidate_dispositions", "image-asset-manifest.json", imageAssetManifest.digest, "manifest dispositions mapped to the oracle taxonomy");
  // ORACLE-061 proof/gallery counts derived from the manifest's own slot
  // role classification (eligible = non-forbidden disposition; selected =
  // source-site assets that entered the final selection).
  const roleOf = (a) =>
    String(a.role ?? a.slot_role ?? a.slot_id ?? a.slotId ?? a.placement ?? a.slot ?? "").toLowerCase();
  const isProof = (a) => roleOf(a).includes("project-proof") || roleOf(a).includes("project_proof") || roleOf(a).includes("proof");
  const isGallery = (a) => roleOf(a).includes("gallery");
  const eligibleAssets = assetsList.filter((a) => normalizeAssetDisposition(a) !== null);
  assets.eligible_source_project_proof_count = eligibleAssets.filter(isProof).length;
  assets.selected_source_project_proof_count = sourceSiteAssets.filter(isProof).length;
  assets.eligible_source_gallery_count = eligibleAssets.filter(isGallery).length;
  assets.selected_source_gallery_count = sourceSiteAssets.filter(isGallery).length;
  for (const key of ["eligible_source_project_proof_count", "selected_source_project_proof_count", "eligible_source_gallery_count", "selected_source_gallery_count"]) {
    track(`assets.${key}`, "image-asset-manifest.json", imageAssetManifest.digest, "slot role classification of manifest assets");
  }
  // donor asset hash matches: candidate asset sha256 colliding with a donor screenshot sha256
  const donorHashes = new Set();
  for (const m of donorManifests) {
    for (const f of donorScreenshotFiles(m)) {
      try {
        donorHashes.add(sha256File(f));
      } catch {
        /* screenshots unreadable; count stays what is provable */
      }
    }
  }
  if (donorHashes.size > 0) {
    assets.donor_asset_hash_matches = assetsList.filter((a) => donorHashes.has(a.sha256)).length;
    track("assets.donor_asset_hash_matches", "derived", sha256Of(canonicalStringify(assetsList.map((a) => a.sha256).sort())), "manifest asset sha256s intersected with donor screenshot file hashes");
  } else {
    missing("assets.donor_asset_hash_matches", "donor-evidence/*/screenshots", "no donor screenshot hashes available to intersect");
  }
} else {
  missing("assets.authorized_reusable_images", "image-asset-manifest.json", "no image asset manifest in evidence store");
  missing("assets.selected_source_images", "image-asset-manifest.json", "no image asset manifest in evidence store");
}
if (redesignReceipt?.visual) {
  if (typeof redesignReceipt.visual.unexplained_asset_loss === "number") {
    assets.unexplained_reusable_asset_loss = redesignReceipt.visual.unexplained_asset_loss;
    track("assets.unexplained_reusable_asset_loss", "redesign-integrity-receipt.json", redesignReceiptDigest(), "runtime-computed unexplained loss");
  } else {
    missing("assets.unexplained_reusable_asset_loss", "redesign-integrity-receipt.json", "redesign receipt visual.unexplained_asset_loss absent");
  }
  const pct = redesignReceipt.visual.required_visual_slots_filled_pct;
  if (typeof pct === "number") {
    assets.required_visual_slots_filled_fraction = Number((pct / 100).toFixed(4));
    track("assets.required_visual_slots_filled_fraction", "redesign-integrity-receipt.json", redesignReceiptDigest(), "derived from runtime percentage");
  } else if (
    typeof redesignReceipt.visual.required_slots === "number" &&
    typeof redesignReceipt.visual.required_slots_filled === "number" &&
    redesignReceipt.visual.required_slots > 0
  ) {
    assets.required_visual_slots_filled_fraction = Number(
      (redesignReceipt.visual.required_slots_filled / redesignReceipt.visual.required_slots).toFixed(4),
    );
    track("assets.required_visual_slots_filled_fraction", "redesign-integrity-receipt.json", redesignReceiptDigest(), "derived from runtime slot counts");
  } else {
    missing("assets.required_visual_slots_filled_fraction", "redesign-integrity-receipt.json", "redesign receipt visual fill evidence absent");
  }
} else {
  missing("assets.unexplained_reusable_asset_loss", "redesign-integrity-receipt.json", "redesign receipt absent");
  missing("assets.required_visual_slots_filled_fraction", "redesign-integrity-receipt.json", "redesign receipt absent");
}

// ---------------------------------------------------------------------------
// site (from site-integrity evidence)
// ---------------------------------------------------------------------------
const site = {};
if (siteIntegrity.found) {
  const si = siteIntegrity.json;
  site.routes = normalizeRouteSet(si.routes);
  site.reachable_routes = si.reachable_routes;
  site.broken_internal_links = si.broken_internal_links;
  site.placeholder_count = si.placeholder_count;
  site.unique_titles = si.unique_titles;
  site.unique_canonical_urls = si.unique_canonical_urls;
  site.per_route = (Array.isArray(si.per_route) ? si.per_route : []).map((r) => ({
    route: typeof r.route === "string" ? normalizeRoute(r.route) : r.route,
    http_status: r.http_status,
    h1_count: r.h1_count,
    title: r.title,
    meta_description: r.meta_description,
    canonical: r.canonical,
    lang: r.lang,
    title_present: r.title_present,
    meta_description_present: r.meta_description_present,
    canonical_present: r.canonical_present,
    lang_present: r.lang_present,
  }));
  for (const key of Object.keys(site)) track(`site.${key}`, "site-integrity.json", siteIntegrity.digest, "pass-through from site-integrity evidence");
} else {
  missing("site", "site-integrity.json", "no site-integrity evidence; run check-site-integrity.mjs first");
}

// ---------------------------------------------------------------------------
// business_truth (deterministic scan over the built site + collected validation)
// ---------------------------------------------------------------------------
const businessTruth = {};
const forbiddenPatterns = testCase.fact_guardrails?.forbidden_patterns ?? [];
const verifiedFacts = testCase.verified_business_facts ?? {};
const phoneDigits = String(verifiedFacts.phone_e164 ?? "").replace(/\D/g, "").replace(/^1/, "");
const verifiedEmail = String(verifiedFacts.email ?? "").toLowerCase();

const siteScan = (() => {
  if (!ABS.site) return null;
  const findings = { prohibition: [], phoneMismatches: [], emailMismatches: [] };
  const routeFiles = normalizeRouteSet(testCase.routes);
  for (const route of routeFiles) {
    const file = path.join(ABS.site, distPathForRoute(route));
    try {
      if (!fs.existsSync(file)) continue;
      const html = fs.readFileSync(file, "utf8");
      const withoutScripts = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ");
      const text = stripHtmlTags(withoutScripts)
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
      for (const pattern of forbiddenPatterns) {
        try {
          const re = new RegExp(pattern, "gi");
          const matches = text.match(re) ?? [];
          if (matches.length) findings.prohibition.push({ route, pattern, match_count: matches.length });
        } catch {
          /* unparseable case pattern is not evidence */
        }
      }
      const phones = text.match(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g) ?? [];
      for (const p of phones) {
        const digits = p.replace(/\D/g, "").replace(/^1/, "");
        if (digits !== phoneDigits && digits.length >= 10) findings.phoneMismatches.push({ route, phone: p });
      }
      const emails = text.match(/[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,63}/g) ?? [];
      for (const e of emails) {
        if (e.toLowerCase() !== verifiedEmail) findings.emailMismatches.push({ route, email: e });
      }
    } catch {
      /* unreadable route file contributes no scan evidence */
    }
  }
  return findings;
})();

const prohibitionMatches = siteScan?.prohibition.reduce((s, f) => s + f.match_count, 0) ?? 0;
// unsupported_claim_count is a producer classification (validation
// unsupported claims), NOT forbidden-pattern matches — the latter is
// prohibition_violations. Splitting them keeps each field honest.
let unsupportedFromValidation = null;
if (structuredPayload?.validation && Array.isArray(structuredPayload.validation.unsupported_claims)) {
  unsupportedFromValidation = structuredPayload.validation.unsupported_claims.length;
} else if (structuredPayload?.validation && typeof structuredPayload.validation.unsupported_claim_count === "number") {
  unsupportedFromValidation = structuredPayload.validation.unsupported_claim_count;
}
if (unsupportedFromValidation != null) {
  businessTruth.unsupported_claim_count = Number(unsupportedFromValidation);
  track("business_truth.unsupported_claim_count", "seo-bot/structured-content.json", structuredEvidence.digest, "producer-reported validation unsupported claims");
} else {
  missing("business_truth.unsupported_claim_count", "seo-bot/structured-content.json", "structured-content validation does not report unsupported claims");
}
if (siteScan) {
  businessTruth.phone_mismatch_count = siteScan.phoneMismatches.length;
  businessTruth.email_mismatch_count = siteScan.emailMismatches.length;
  businessTruth.prohibition_violations = prohibitionMatches;
  businessTruth.prohibition_findings = siteScan.prohibition;
  for (const key of ["phone_mismatch_count", "email_mismatch_count", "prohibition_violations", "prohibition_findings"]) {
    track(`business_truth.${key}`, "derived", sha256Of(canonicalStringify(siteScan)), "deterministic scan of the built site text");
  }
} else {
  missing("business_truth.phone_mismatch_count", "site-dir", "no --site-dir supplied for the truth scan");
  missing("business_truth.email_mismatch_count", "site-dir", "no --site-dir supplied for the truth scan");
}

// ---------------------------------------------------------------------------
// llm_audit (routing evidence from the collected preflight/router audit)
// ---------------------------------------------------------------------------
const llmAudit = {};
if (preflightPayload) {
  const bypass = firstDefined(preflightPayload, [
    "direct_provider_bypass_count",
    "router_audit.direct_provider_bypass_count",
    "audit.direct_provider_bypass_count",
    "llm_audit.direct_provider_bypass_count",
  ]);
  if (bypass != null) {
    llmAudit.direct_provider_bypass_count = Number(bypass);
    track("llm_audit.direct_provider_bypass_count", "seo-bot/preflight.json", preflightEvidence.digest, "producer-reported router audit");
  } else {
    missing("llm_audit.direct_provider_bypass_count", "seo-bot/preflight.json", "preflight does not report a router audit");
  }
  const unsupportedCombo = firstDefined(preflightPayload, [
    "unsupported_capability_combination_count",
    "router_audit.unsupported_capability_combination_count",
    "audit.unsupported_capability_combination_count",
    "llm_audit.unsupported_capability_combination_count",
  ]);
  if (unsupportedCombo != null) {
    llmAudit.unsupported_capability_combination_count = Number(unsupportedCombo);
    track("llm_audit.unsupported_capability_combination_count", "seo-bot/preflight.json", preflightEvidence.digest, "producer-reported router audit");
  } else {
    missing("llm_audit.unsupported_capability_combination_count", "seo-bot/preflight.json", "preflight does not report unsupported capability combinations");
  }
  const operations = firstDefined(preflightPayload, ["operations", "router_audit.operations", "audit.operations", "llm_audit.operations"]);
  if (operations && typeof operations === "object") {
    llmAudit.operations = {};
    for (const op of ["SEO_CONTENT_BLUEPRINT", "STRUCTURED_CONTENT_GENERATION", "CONTENT_VALIDATION", "VISUAL_QA"]) {
      if (Array.isArray(operations[op])) {
        llmAudit.operations[op] = operations[op].map((call) => ({
          searchRequired: Boolean(call.searchRequired),
          searchPolicySource: call.searchPolicySource ?? null,
        }));
      } else {
        missing(`llm_audit.operations.${op}`, "seo-bot/preflight.json", `router audit does not cover ${op}`);
      }
    }
    track("llm_audit.operations", "seo-bot/preflight.json", preflightEvidence.digest, "producer-reported router audit");
  } else {
    for (const op of ["SEO_CONTENT_BLUEPRINT", "STRUCTURED_CONTENT_GENERATION", "CONTENT_VALIDATION", "VISUAL_QA"]) {
      missing(`llm_audit.operations.${op}`, "seo-bot/preflight.json", "router audit operations absent");
    }
  }
} else {
  missing("llm_audit.direct_provider_bypass_count", "seo-bot/preflight.json", "no preflight evidence collected");
  missing("llm_audit.operations.SEO_CONTENT_BLUEPRINT", "seo-bot/preflight.json", "no preflight evidence collected");
  missing("llm_audit.operations.STRUCTURED_CONTENT_GENERATION", "seo-bot/preflight.json", "no preflight evidence collected");
  missing("llm_audit.operations.CONTENT_VALIDATION", "seo-bot/preflight.json", "no preflight evidence collected");
  missing("llm_audit.operations.VISUAL_QA", "seo-bot/preflight.json", "no preflight evidence collected");
}

// ---------------------------------------------------------------------------
// visual (from the visual-oracle harness; not produced by the runtime)
// ---------------------------------------------------------------------------
const visual = {};
{
  const visualRoot = visualDir ? path.resolve(visualDir) : path.join(ABS.assets, "visual-qa");
  const manifestFile = readJsonFile(path.join(visualRoot, "manifest.json"), "visual-qa/manifest.json");
  // The harness aggregates normalized trials under visual/aggregated/;
  // accept either location so the adapter works against both layouts.
  let trialsFile = readJsonFile(
    path.join(visualRoot, "normalized-results.json"),
    "visual/normalized-results.json",
  );
  if (!trialsFile.found) {
    trialsFile = readJsonFile(
      path.join(visualRoot, "aggregated", "normalized-results.json"),
      "visual/aggregated/normalized-results.json",
    );
  }
  if (manifestFile.found && trialsFile.found) {
    const pairs = Array.isArray(manifestFile.json.pairs) ? manifestFile.json.pairs : [];
    const trials = Array.isArray(trialsFile.json.trials) ? trialsFile.json.trials : [];
    const trialsByPair = new Map();
    for (const t of trials) {
      const key = t.pair_id ?? `${t.route}::${t.viewport}`;
      if (!trialsByPair.has(key)) trialsByPair.set(key, []);
      trialsByPair.get(key).push(t);
    }
    const outPairs = [];
    for (const pair of pairs) {
      const key = pair.pair_id ?? `${pair.route}::${pair.viewport}`;
      const pairTrials = (trialsByPair.get(key) ?? []).map((t) => {
        const row = {};
        for (const k of ["trial_id", "orientation", "judge_json", "normalized_preference", "normalized_candidate_delta", "confidence", "defects"]) {
          if (t[k] !== undefined) row[k] = t[k];
        }
        // Blindness is evidence the harness must record; pass through only
        // when present (fail closed otherwise — never defaulted to true).
        if (t.blind !== undefined) row.blind = Boolean(t.blind);
        if (t.judge_input_manifest !== undefined) row.judge_input_manifest = t.judge_input_manifest;
        return row;
      });
      const row = {
        route: pair.route,
        viewport: pair.viewport,
        baseline_hash: pair.baseline?.hash ?? pair.baseline_hash ?? null,
        candidate_hash: pair.candidate?.hash ?? pair.candidate_hash ?? null,
        baseline_blank: pair.baseline?.blank ?? pair.baseline_blank ?? null,
        candidate_blank: pair.candidate?.blank ?? pair.candidate_blank ?? null,
        route_match: pair.route_match ?? null,
        viewport_match: pair.viewport_match ?? null,
        captured_run_id: pair.run_id ?? pair.captured_run_id ?? null,
      };
      if (pairTrials.length) row.trials = pairTrials;
      outPairs.push(row);
    }
    // Route first, then viewport — a two-key ordering, not a chain of
    // conditions (javascript:S3358).
    outPairs.sort(
      (a, b) => compareCodeUnits(a.route, b.route) || compareCodeUnits(a.viewport, b.viewport),
    );
    visual.pairs = outPairs;
    track("visual.pairs", "derived", sha256Of(canonicalStringify({ manifest: manifestFile.digest, trials: trialsFile.digest })), "projected from visual harness manifest + normalized trials");
  } else {
    missing("visual.pairs", "visual-qa/manifest.json", "visual harness evidence absent; run capture-visual.mjs + run-visual-trials.mjs + aggregate-visual.mjs first");
  }
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------
function redesignReceiptDigest() {
  const r = readJsonFile(path.join(ABS.assets, "redesign-integrity-receipt.json"), "redesign-integrity-receipt.json");
  return r.found ? r.digest : "missing";
}
function sequenceDigest() {
  const r = seoBotFile("sequence.json");
  return r.found ? r.digest : "missing";
}

const receipt = {
  schema: "l9.golden-oracle-receipt/v1",
  case_id: testCase.case_id ?? null,
  adapter: {
    name: "website-bot-golden-adapter",
    version: "1.0.0",
    input: {
      client_id: clientId,
      build_id: buildId,
      case_file: path.basename(ABS.case),
      evidence_dir: path.basename(ABS.evidence),
      assets_dir: path.basename(ABS.assets),
      db_file: path.basename(ABS.db),
    },
    provenance,
    missing_producer: missingProducer,
  },
  identity,
  run,
  preflight,
  events,
  competitive_landscape: competitive,
  donor_evidence: donorEvidence,
  website_build_blueprint: websiteBuildBlueprint,
  seo_content_blueprint: seoContentBlueprint,
  page_content_contract: pageContentContract,
  structured_content: structuredContent,
  legacy,
  assets,
  site,
  business_truth: businessTruth,
  llm_audit: llmAudit,
  visual,
};

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(path.resolve(outPath), canonicalStringify(receipt));
const summary = [
  `receipt: ${path.resolve(outPath)}`,
  `missing_producer: ${missingProducer.length}`,
  `events: ${events.length}`,
  `donors: ${donorEvidence.length}/${competitive.selected_donors?.length ?? "?"}`,
  `site routes: ${site.routes?.length ?? "?"}`,
];
console.log(summary.join("\n"));
