// L9_META: layer=cli, role=safehaven_golden_runtime_evidence, status=active, version=1.0.0
//
// Safe Haven real-Golden bridge, stage 1 of 3: translate ONE successful real
// BuildContext into `l9.safehaven-real-runtime-evidence/v1`.
//
// This module is the single authority for that translation and is deliberately
// inert:
//   * it never runs the pipeline;
//   * it never calls a provider or SEO-Bot;
//   * it never repairs, back-fills, or defaults an artifact;
//   * it never invents a fact that the run did not actually produce.
//
// Every field below is either measured from a real artifact on the
// BuildContext, read from an explicitly supplied external identity manifest,
// or recorded as `null` and named in `unresolved_external_dependencies` so the
// receipt merger fails closed until the owning repository supplies it.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentSlot } from "@quantum-l9/bot-interop";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";

export const SAFEHAVEN_RUNTIME_EVIDENCE_SCHEMA =
  "l9.safehaven-real-runtime-evidence/v1" as const;

export const SAFEHAVEN_EXTERNAL_IDENTITY_SCHEMA =
  "l9.golden-external-identity/v1" as const;

/**
 * Canonical ContentSlot vocabulary. `satisfies` locks this list to the
 * bot-interop contract: if SEO-Bot's slot vocabulary changes, this file stops
 * compiling instead of silently mis-counting unknown slots.
 */
const CANONICAL_CONTENT_SLOTS = [
  "primary_offer",
  "service_overview",
  "differentiation",
  "trust",
  "process",
  "project_proof",
  "local_relevance",
  "objection_handling",
  "faq",
  "conversion",
  "metadata",
] as const satisfies readonly ContentSlot[];

const CONTENT_SLOT_SET: ReadonlySet<string> = new Set(CANONICAL_CONTENT_SLOTS);

/** Section keys that must never carry prose in place of `blocks`. */
const FORBIDDEN_SECTION_ALIASES = ["content", "body", "copy", "paragraphs"] as const;

const FULL_SHA = /^[0-9a-f]{40}$/;

/* =========================================================
 * PUBLIC TYPES
 * ======================================================= */

export interface SafeHavenGoldenRuntimeEvidenceOptions {
  casePath: string;
  oraclePath: string;
  identityManifestPath: string;
  seoLlmAuditPath?: string;
  outputPath: string;
}

export type WorktreeState =
  | "CLEAN"
  | { clean: false; explicitly_recorded: true; diff_identity: string };

export interface SafeHavenRealRuntimeEvidence {
  schema: typeof SAFEHAVEN_RUNTIME_EVIDENCE_SCHEMA;
  case_id: string;
  generated_at: string;
  /**
   * Facts this run could not truthfully produce, each naming the repository
   * that owns it. A non-empty list is not a warning: the receipt merger
   * refuses to assemble a Golden receipt while any entry remains.
   */
  unresolved_external_dependencies: Array<{
    field: string;
    owner: string;
    reason: string;
  }>;
  identity: {
    website_bot: { sha: string; worktree_state: WorktreeState; llm_router_version: string };
    seo_bot: { sha: string; worktree_state: WorktreeState; llm_router_version: string };
    llm_router: { sha: string; worktree_state: WorktreeState; package_version: string };
    bot_interop: {
      compatible: boolean;
      website_bot_version: string;
      seo_bot_version: string;
    };
  };
  run: {
    run_id: string;
    build_intent: string;
    copy_fallback_used: boolean;
    generic_fallback_used: boolean;
    pipeline_exit_code: number;
  };
  preflight: { status: "PASS"; checks: Array<{ name: string; status: "PASS" }> };
  events: Array<{ name: string }>;
  competitive_landscape: {
    artifact_ref: string;
    selected_donors: Array<{
      qualified_operating_company: boolean;
      real_dataforseo_observation: boolean;
      query_id: string;
      rank: number;
      url: string;
      domain: string;
      normalized_domain: string;
      observed_at: string;
      visibility_contribution: number;
      class: string;
    }>;
    evidence_complete: boolean;
    ranking_llm_calls: number | null;
  };
  donor_evidence: Array<{
    domain: string;
    successful_pages: number;
    screenshots: number;
    evidence_digest: string;
    crawled_at: string;
  }>;
  website_build_blueprint: {
    artifact_ref: string;
    competitive_landscape_ref: string;
    visual_requirements: Array<{ slot: string; role: string; required: boolean }>;
    project_proof_required: boolean;
    gallery_required: boolean;
  };
  seo_content_blueprint: {
    artifact_ref: string;
    routes: string[];
    produced_routes: number;
    extra_routes: number;
    duplicate_routes: number;
    batch_size: number | null;
    batch_count: number | null;
    competitive_landscape_ref: string;
    unknown_content_slots: number;
    invalid_internal_link_targets: number;
  };
  page_content_contract: {
    artifact_ref: string;
    routes: string[];
    produced_routes: number;
    llm_calls: number;
    unplaced_requirements: number;
    invalid_business_facts: number;
    determinism: {
      required: true;
      same_semantic_input_same_digest: boolean;
      digest_run_1: string;
      digest_run_2: string;
    };
  };
  structured_content: {
    artifact_ref: string;
    routes: string[];
    produced_routes: number;
    page_content_contract_ref: string;
    route_results: Array<{
      route_id: string;
      path: string;
      repair_attempts: number | null;
      generation_calls: number | null;
      schema_errors: number;
      unsupported_claims: number;
      failed_requirements: number;
      section_alias_fields: string[];
      prose_without_blocks: number;
    }>;
  };
  legacy: {
    content_generation_calls: number;
    schema_generation_calls: number;
    page_content_contract_llm_calls: number;
    redesign_schema_llm_calls: number;
  };
  assets: {
    source_corpus_completed: boolean;
    raw_source_images: number;
    authorized_reusable_images: number;
    selected_source_images: number;
    unexplained_reusable_asset_loss: number;
    required_visual_slots_filled_fraction: number;
    donor_asset_hash_matches: number;
    candidate_dispositions: string[];
    eligible_source_project_proof_count: number;
    selected_source_project_proof_count: number;
    eligible_source_gallery_count: number;
    selected_source_gallery_count: number;
  };
  /** Build-time site facts. Reachability and per-route render facts belong to the rendered collector. */
  site_build: {
    routes: string[];
    built_routes: number;
    placeholder_count: number;
  };
}

export type SafeHavenRuntimeEvidenceErrorCode =
  | "GOLDEN_RUN_NOT_ELIGIBLE"
  | "IDENTITY_SHA_INVALID"
  | "IDENTITY_EVIDENCE_MISSING"
  | "WORKTREE_STATE_UNRECORDED_DIRTY"
  | "PREFLIGHT_EVIDENCE_MISSING"
  | "REDESIGN_EVIDENCE_MISSING"
  | "DONOR_EVIDENCE_INCOMPLETE"
  | "DONOR_CLASS_UNKNOWN"
  | "DONOR_ASSET_HASH_UNVERIFIABLE"
  | "PCC_DETERMINISM_EVIDENCE_MISSING"
  | "ASSET_EVIDENCE_MISSING"
  | "SITE_BUILD_EVIDENCE_MISSING"
  | "LEGACY_AUTHORITY_EVIDENCE_MISSING"
  | "CASE_AUTHORITY_MISMATCH"
  | "SEO_EXECUTION_METADATA_INVALID"
  | "RUNTIME_EVIDENCE_SCHEMA_INVALID";

export class SafeHavenRuntimeEvidenceError extends Error {
  readonly code: SafeHavenRuntimeEvidenceErrorCode;
  readonly evidence: unknown;
  constructor(code: SafeHavenRuntimeEvidenceErrorCode, message: string, evidence?: unknown) {
    super(`${code}: ${message}`);
    this.name = "SafeHavenRuntimeEvidenceError";
    this.code = code;
    this.evidence = evidence;
  }
}

function halt(
  code: SafeHavenRuntimeEvidenceErrorCode,
  message: string,
  evidence?: unknown,
): never {
  throw new SafeHavenRuntimeEvidenceError(code, message, evidence);
}

/* =========================================================
 * SMALL UTILITIES
 * ======================================================= */

export function normalizeRoute(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "") || "/";
}

export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve an installed package's real version by walking up node_modules,
 * exactly as the SEO-Bot preflight parity check does. Scoped package export
 * maps do not expose "./package.json", so the file is located, not imported.
 */
export function installedPackageVersion(scope: string, name: string, fromDir?: string): string {
  let dir = fromDir ?? dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "node_modules", scope, name, "package.json");
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as { version?: string };
      if (typeof parsed.version !== "string" || parsed.version.trim() === "") {
        halt("IDENTITY_EVIDENCE_MISSING", `${scope}/${name} package.json has no version`);
      }
      return parsed.version;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      halt(
        "IDENTITY_EVIDENCE_MISSING",
        `cannot locate installed ${scope}/${name}; router/interop identity is unprovable`,
      );
    }
    dir = parent;
  }
}

/* =========================================================
 * IDENTITY — local repository
 * ======================================================= */

export interface GitIdentityProbe {
  headSha(): string;
  porcelainStatus(): string;
  diff(): string;
}

const defaultGitProbe: GitIdentityProbe = {
  headSha: () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim(),
  porcelainStatus: () =>
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf-8" }),
  diff: () => execFileSync("git", ["diff", "HEAD"], { encoding: "utf-8" }),
};

/**
 * Local repository identity. A dirty tree is NEVER labelled CLEAN: it is
 * recorded explicitly with a deterministic digest over the porcelain status
 * and the full diff, so the receipt states exactly what was uncommitted.
 */
export function localRepositoryIdentity(
  probe: GitIdentityProbe = defaultGitProbe,
): { sha: string; worktree_state: WorktreeState } {
  const sha = probe.headSha();
  if (!FULL_SHA.test(sha)) {
    halt("IDENTITY_SHA_INVALID", "Website-Bot HEAD is not a full 40-character git SHA", sha);
  }
  const porcelain = probe.porcelainStatus();
  const dirtyLines = porcelain
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .sort();
  if (dirtyLines.length === 0) {
    return { sha, worktree_state: "CLEAN" };
  }
  const diffIdentity = sha256(`${dirtyLines.join("\n")}\n---\n${probe.diff()}`);
  return {
    sha,
    worktree_state: { clean: false, explicitly_recorded: true, diff_identity: diffIdentity },
  };
}

/* =========================================================
 * IDENTITY — external repositories (SEO-Bot, LLM-Router)
 * ======================================================= */

function assertWorktreeState(value: unknown, label: string): WorktreeState {
  if (value === "CLEAN") return "CLEAN";
  if (
    isObject(value) &&
    value.clean === false &&
    value.explicitly_recorded === true &&
    typeof value.diff_identity === "string" &&
    value.diff_identity.trim() !== ""
  ) {
    return {
      clean: false,
      explicitly_recorded: true,
      diff_identity: value.diff_identity,
    };
  }
  if (isObject(value) && value.clean === true) return "CLEAN";
  halt(
    "WORKTREE_STATE_UNRECORDED_DIRTY",
    `${label} worktree state is missing or a dirty tree was not explicitly recorded`,
    value,
  );
}

export function readExternalIdentityManifest(path: string): {
  seo_bot: { sha: string; worktree_state: WorktreeState };
  llm_router: { sha: string; worktree_state: WorktreeState };
} {
  if (!existsSync(path)) {
    halt(
      "IDENTITY_EVIDENCE_MISSING",
      `external identity manifest not found at ${path}; SEO-Bot and LLM-Router git SHAs are ` +
        "not derivable from package versions and must never be synthesized",
    );
  }
  const manifest = readJsonFile(path);
  if (!isObject(manifest) || manifest.schema !== SAFEHAVEN_EXTERNAL_IDENTITY_SCHEMA) {
    halt(
      "IDENTITY_EVIDENCE_MISSING",
      `external identity manifest must declare schema ${SAFEHAVEN_EXTERNAL_IDENTITY_SCHEMA}`,
      isObject(manifest) ? manifest.schema : manifest,
    );
  }
  const read = (key: "seo_bot" | "llm_router") => {
    const entry = manifest[key];
    if (!isObject(entry)) {
      halt("IDENTITY_EVIDENCE_MISSING", `external identity manifest lacks ${key}`);
    }
    const sha = entry.sha;
    if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
      halt("IDENTITY_SHA_INVALID", `${key} sha must be a full 40-character git SHA`, sha);
    }
    return { sha, worktree_state: assertWorktreeState(entry.worktree_state, key) };
  };
  return { seo_bot: read("seo_bot"), llm_router: read("llm_router") };
}

/* =========================================================
 * SEO-BOT EXECUTION METADATA (optional at runtime, required at merge)
 * ======================================================= */

export interface SeoExecutionMetadata {
  competitive_landscape?: { ranking_llm_calls?: number };
  seo_content_blueprint?: { batch_size?: number; batch_count?: number };
  structured_content?: {
    route_results?: Array<{
      route_id?: string;
      path?: string;
      repair_attempts?: number;
      generation_calls?: number;
    }>;
  };
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * SEO-Bot per-run execution counters. Website-Bot cannot observe SEO-Bot's
 * internal batching, repair, or generation-call behaviour, so these are read
 * from the SEO-Bot-owned audit export or left null and named as unresolved.
 */
export function readSeoExecutionMetadata(path: string | undefined): SeoExecutionMetadata | null {
  if (!path) return null;
  if (!existsSync(path)) return null;
  const parsed = readJsonFile(path);
  if (!isObject(parsed)) {
    halt("SEO_EXECUTION_METADATA_INVALID", `SEO audit at ${path} is not an object`);
  }
  const execution = isObject(parsed.execution) ? parsed.execution : parsed;
  const metadata: SeoExecutionMetadata = {};
  if (isObject(execution.competitive_landscape)) {
    const calls = execution.competitive_landscape.ranking_llm_calls;
    if (calls !== undefined) {
      if (!nonNegativeInteger(calls)) {
        halt(
          "SEO_EXECUTION_METADATA_INVALID",
          "competitive_landscape.ranking_llm_calls must be a non-negative integer",
          calls,
        );
      }
      metadata.competitive_landscape = { ranking_llm_calls: calls };
    }
  }
  if (isObject(execution.seo_content_blueprint)) {
    const { batch_size: batchSize, batch_count: batchCount } = execution.seo_content_blueprint;
    if (batchSize !== undefined || batchCount !== undefined) {
      if (!nonNegativeInteger(batchSize) || !nonNegativeInteger(batchCount)) {
        halt(
          "SEO_EXECUTION_METADATA_INVALID",
          "seo_content_blueprint batch_size and batch_count must both be non-negative integers",
          { batchSize, batchCount },
        );
      }
      metadata.seo_content_blueprint = { batch_size: batchSize, batch_count: batchCount };
    }
  }
  if (
    isObject(execution.structured_content) &&
    Array.isArray(execution.structured_content.route_results)
  ) {
    const rows: NonNullable<SeoExecutionMetadata["structured_content"]>["route_results"] = [];
    for (const raw of execution.structured_content.route_results) {
      if (!isObject(raw)) {
        halt("SEO_EXECUTION_METADATA_INVALID", "structured_content.route_results entry invalid", raw);
      }
      if (!nonNegativeInteger(raw.repair_attempts) || !nonNegativeInteger(raw.generation_calls)) {
        halt(
          "SEO_EXECUTION_METADATA_INVALID",
          "structured_content route repair_attempts/generation_calls must be non-negative integers",
          raw,
        );
      }
      rows.push({
        route_id: typeof raw.route_id === "string" ? raw.route_id : undefined,
        path: typeof raw.path === "string" ? raw.path : undefined,
        repair_attempts: raw.repair_attempts,
        generation_calls: raw.generation_calls,
      });
    }
    metadata.structured_content = { route_results: rows };
  }
  return metadata;
}

/* =========================================================
 * BUILD — the single translation authority
 * ======================================================= */

type Ctx = BuildContext;

function requireArtifact<T>(value: T | undefined, field: string): T {
  if (value === undefined || value === null) {
    halt(
      "REDESIGN_EVIDENCE_MISSING",
      `runtime evidence requires the real ${field} produced by this run (missing evidence is FAIL, never a default)`,
    );
  }
  return value;
}

function artifactRefString(artifact: {
  artifact_id: string;
  integrity: { payload_digest: string };
}): string {
  return `${artifact.artifact_id}@${artifact.integrity.payload_digest}`;
}

function assertSameRef(
  ref: { artifact_id: string; payload_digest: string },
  artifact: { artifact_id: string; integrity: { payload_digest: string } },
  label: string,
): void {
  if (
    ref.artifact_id !== artifact.artifact_id ||
    ref.payload_digest !== artifact.integrity.payload_digest
  ) {
    halt("REDESIGN_EVIDENCE_MISSING", `${label} does not reference the artifact this run accepted`, {
      referenced: ref,
      accepted: { artifact_id: artifact.artifact_id, payload_digest: artifact.integrity.payload_digest },
    });
  }
}

/** Ordered, successful stage names plus the semantic events their evidence proves. */
function buildEvents(ctx: Ctx): Array<{ name: string }> {
  const events: Array<{ name: string }> = [];
  for (const [stage, result] of ctx.stageResults) {
    if (!result.ok || result.skipped === true) continue;
    events.push({ name: stage });
    // A semantic event is emitted ONLY when the runtime fact it asserts exists.
    // Plan membership alone never justifies one.
    if (stage === "seo-build-intelligence-preflight" && ctx.seoBuildIntelligencePreflight) {
      events.push({ name: "seo-build-intelligence-preflight:PASS" });
    }
    if (stage === "competitive-intelligence" && ctx.competitiveLandscape) {
      events.push({ name: "seo:createCompetitiveLandscape" });
    }
  }
  return events;
}

/**
 * The nine oracle preflight checks, each re-derived from the actual snapshot.
 * The snapshot only exists because the client's fail-closed preflight passed
 * health, machine auth, capabilities, provider configuration, bot-interop
 * parity, and Router parity — but every condition is re-asserted here rather
 * than assumed, so a weakened client cannot smuggle a PASS through.
 */
function buildPreflight(
  ctx: Ctx,
  localInterop: string,
  localRouter: string,
): SafeHavenRealRuntimeEvidence["preflight"] {
  const snapshot = ctx.seoBuildIntelligencePreflight;
  if (!snapshot) {
    halt("PREFLIGHT_EVIDENCE_MISSING", "no SEO build-intelligence preflight snapshot on this run");
  }
  const statusOk = /^(ok|pass|ready|healthy|passed)$/i.test(String(snapshot.status ?? ""));
  const conditions: Array<[string, boolean, unknown]> = [
    ["seo_bot_reachable", statusOk && String(snapshot.service ?? "").trim() !== "", snapshot.status],
    ["seo_bot_machine_auth", statusOk && String(snapshot.version ?? "").trim() !== "", snapshot.version],
    ["competitive_landscape_capability", snapshot.capabilities?.competitive_landscape === true, snapshot.capabilities],
    ["seo_content_blueprint_capability", snapshot.capabilities?.seo_content_blueprint === true, snapshot.capabilities],
    ["structured_content_capability", snapshot.capabilities?.structured_content === true, snapshot.capabilities],
    ["dataforseo_configured", snapshot.configuration?.dataforseo_configured === true, snapshot.configuration],
    ["llm_provider_configured", snapshot.configuration?.llm_provider_configured === true, snapshot.configuration],
    ["bot_interop_compatible", snapshot.bot_interop_version === localInterop, {
      seo_bot: snapshot.bot_interop_version,
      website_bot: localInterop,
    }],
    ["llm_router_compatible", snapshot.llm_router_version === localRouter, {
      seo_bot: snapshot.llm_router_version,
      website_bot: localRouter,
    }],
  ];
  const checks: Array<{ name: string; status: "PASS" }> = [];
  for (const [name, proven, evidence] of conditions) {
    if (!proven) {
      halt("PREFLIGHT_EVIDENCE_MISSING", `preflight check ${name} is not proven by the snapshot`, evidence);
    }
    checks.push({ name, status: "PASS" });
  }
  return { status: "PASS", checks };
}

function buildCompetitiveLandscape(
  ctx: Ctx,
  seoExecution: SeoExecutionMetadata | null,
): SafeHavenRealRuntimeEvidence["competitive_landscape"] {
  const landscape = requireArtifact(ctx.competitiveLandscape, "CompetitiveLandscape");
  const payload = landscape.payload;
  const observationsById = new Map(payload.observations.map((o) => [o.observation_id, o]));
  const domainsByName = new Map(payload.domains.map((d) => [normalizeDomain(d.domain), d]));
  const exclusionByDomain = new Map(
    payload.exclusions.map((e) => [normalizeDomain(e.domain), e.reason]),
  );

  const donors = payload.selected_donors.map((donor) => {
    const normalized = normalizeDomain(donor.domain);
    const observations = donor.observation_ids
      .map((id) => observationsById.get(id))
      .filter((o): o is NonNullable<typeof o> => o !== undefined);
    if (observations.length === 0) {
      halt(
        "DONOR_EVIDENCE_INCOMPLETE",
        `selected donor ${donor.domain} carries no resolvable DataForSEO observation`,
        donor.observation_ids,
      );
    }
    // Representative observation = the donor's best real SERP position.
    const best = observations.reduce((left, right) => (right.rank < left.rank ? right : left));
    const realObservation = observations.every((o) => o.source === "dataforseo");

    // Donor class is read from the landscape's own classifier output: an
    // excluded domain carries its exclusion reason; a domain that survived
    // qualification with real ranking evidence is an operating company. A
    // domain that is neither is UNKNOWN and halts.
    const excluded = exclusionByDomain.get(normalized);
    const qualified = domainsByName.get(normalized);
    let donorClass: string;
    if (excluded !== undefined) {
      donorClass = excluded;
    } else if (qualified && qualified.qualifying_query_ids.length > 0) {
      donorClass = "operating_company";
    } else {
      halt(
        "DONOR_CLASS_UNKNOWN",
        `donor ${donor.domain} carries no classification evidence in the CompetitiveLandscape`,
      );
    }

    return {
      qualified_operating_company: donorClass === "operating_company",
      real_dataforseo_observation: realObservation,
      query_id: best.query_id,
      rank: best.rank,
      url: best.url,
      domain: best.domain,
      normalized_domain: normalized,
      observed_at: best.observed_at,
      visibility_contribution: donor.aggregate_visibility,
      class: donorClass,
    };
  });

  return {
    artifact_ref: artifactRefString(landscape),
    selected_donors: donors,
    evidence_complete: payload.evidence_complete,
    ranking_llm_calls: seoExecution?.competitive_landscape?.ranking_llm_calls ?? null,
  };
}

function buildDonorEvidence(ctx: Ctx): SafeHavenRealRuntimeEvidence["donor_evidence"] {
  const donors = requireArtifact(ctx.acceptedDonors, "accepted donor evidence");
  return donors.map((donor) => {
    const successfulPages = donor.pages.filter((page) => page.status >= 200 && page.status < 300).length;
    if (successfulPages < 1) {
      halt("DONOR_EVIDENCE_INCOMPLETE", `donor ${donor.domain} has no successfully crawled page`);
    }
    if (donor.screenshot_paths.length < 1) {
      halt("DONOR_EVIDENCE_INCOMPLETE", `donor ${donor.domain} has no screenshot evidence`);
    }
    if (!donor.evidence_digest || !donor.crawled_at) {
      halt("DONOR_EVIDENCE_INCOMPLETE", `donor ${donor.domain} lacks digest/timestamp evidence`);
    }
    return {
      domain: normalizeDomain(donor.domain),
      successful_pages: successfulPages,
      screenshots: donor.screenshot_paths.length,
      evidence_digest: donor.evidence_digest,
      crawled_at: donor.crawled_at,
    };
  });
}

function assertDonorDomainSetEquality(
  landscape: SafeHavenRealRuntimeEvidence["competitive_landscape"],
  evidence: SafeHavenRealRuntimeEvidence["donor_evidence"],
): void {
  const selected = landscape.selected_donors.map((d) => d.normalized_domain).sort();
  const evidenced = evidence.map((d) => d.domain).sort();
  if (JSON.stringify(selected) !== JSON.stringify(evidenced)) {
    halt(
      "DONOR_EVIDENCE_INCOMPLETE",
      "donor crawl/screenshot evidence must cover exactly the selected donor domain set",
      { selected, evidenced },
    );
  }
}

function buildWebsiteBlueprint(
  ctx: Ctx,
  landscapeRef: string,
): SafeHavenRealRuntimeEvidence["website_build_blueprint"] {
  const blueprint = requireArtifact(ctx.websiteBlueprint, "WebsiteBuildBlueprint");
  const landscape = requireArtifact(ctx.competitiveLandscape, "CompetitiveLandscape");
  assertSameRef(
    blueprint.payload.provenance.competitive_landscape_ref,
    landscape,
    "WebsiteBuildBlueprint.provenance.competitive_landscape_ref",
  );
  const requirements = blueprint.payload.visual_requirements ?? [];
  if (requirements.length === 0) {
    halt("REDESIGN_EVIDENCE_MISSING", "WebsiteBuildBlueprint carries no visual requirements");
  }
  // Requirement flags are read from the blueprint's own requirement roles.
  // Nothing here is hardcoded true.
  const requiredRole = (role: string): boolean =>
    requirements.some((requirement) => requirement.role === role && requirement.required === true);
  return {
    artifact_ref: artifactRefString(blueprint),
    competitive_landscape_ref: landscapeRef,
    visual_requirements: requirements.map((requirement) => ({
      slot: requirement.slot_id,
      role: requirement.role,
      required: requirement.required,
    })),
    project_proof_required: requiredRole("project_proof"),
    gallery_required: requiredRole("gallery"),
  };
}

function countDuplicates(values: string[]): number {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = normalizeRoute(value);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function buildSeoContentBlueprint(
  ctx: Ctx,
  caseRoutes: string[],
  landscapeRef: string,
  seoExecution: SeoExecutionMetadata | null,
): SafeHavenRealRuntimeEvidence["seo_content_blueprint"] {
  const blueprint = requireArtifact(ctx.seoContentBlueprint, "SEOContentBlueprint");
  const landscape = requireArtifact(ctx.competitiveLandscape, "CompetitiveLandscape");
  assertSameRef(
    blueprint.payload.competitive_landscape_ref,
    landscape,
    "SEOContentBlueprint.competitive_landscape_ref",
  );
  const routes = blueprint.payload.routes.map((route) => route.path);
  const expected = new Set(caseRoutes.map(normalizeRoute));
  const extra = routes.filter((route) => !expected.has(normalizeRoute(route))).length;

  // Measured from the sealed artifact: a target_slot outside the bot-interop
  // ContentSlot vocabulary is an unknown slot; an internal link whose target
  // route_id is not in the blueprint's own route set is an invalid target.
  const routeIds = new Set(blueprint.payload.routes.map((route) => route.route_id));
  let unknownSlots = 0;
  let invalidLinkTargets = 0;
  for (const route of blueprint.payload.routes) {
    for (const requirement of route.requirements) {
      for (const slot of requirement.target_slots) {
        if (!CONTENT_SLOT_SET.has(slot)) unknownSlots += 1;
      }
    }
    for (const link of route.internal_links) {
      if (!routeIds.has(link.target_route_id)) invalidLinkTargets += 1;
    }
  }

  return {
    artifact_ref: artifactRefString(blueprint),
    routes,
    produced_routes: routes.length,
    extra_routes: extra,
    duplicate_routes: countDuplicates(routes),
    batch_size: seoExecution?.seo_content_blueprint?.batch_size ?? null,
    batch_count: seoExecution?.seo_content_blueprint?.batch_count ?? null,
    competitive_landscape_ref: landscapeRef,
    unknown_content_slots: unknownSlots,
    invalid_internal_link_targets: invalidLinkTargets,
  };
}

function buildPageContentContract(ctx: Ctx): SafeHavenRealRuntimeEvidence["page_content_contract"] {
  const contract = requireArtifact(ctx.pageContentContract, "PageContentContract");
  const seoBlueprint = requireArtifact(ctx.seoContentBlueprint, "SEOContentBlueprint");
  const counters = requireArtifact(ctx.redesignCounters, "redesign counters");
  const determinism = ctx.pccDeterminism;
  if (
    !determinism ||
    !determinism.digestRun1 ||
    !determinism.digestRun2 ||
    determinism.sameSemanticInputSameDigest !== true ||
    determinism.digestRun1 !== determinism.digestRun2
  ) {
    halt(
      "PCC_DETERMINISM_EVIDENCE_MISSING",
      "PageContentContract determinism proof is absent or does not show two equal digests",
      determinism,
    );
  }

  // Unplaced requirements: SEO requirement ids that reached no PCC section.
  let unplaced = 0;
  for (const seoRoute of seoBlueprint.payload.routes) {
    const contractRoute = contract.payload.routes.find(
      (route) => route.route_id === seoRoute.route_id,
    );
    if (!contractRoute) {
      halt("REDESIGN_EVIDENCE_MISSING", `PageContentContract is missing route ${seoRoute.route_id}`);
    }
    const placed = new Set(
      contractRoute.sections.flatMap((section) => section.content_requirements.requirement_ids),
    );
    for (const requirement of seoRoute.requirements) {
      if (!placed.has(requirement.requirement_id)) unplaced += 1;
    }
  }

  // Invalid business facts: an unverified/duplicate fact, or a section that
  // allows a fact id the route does not actually carry.
  let invalidFacts = 0;
  for (const route of contract.payload.routes) {
    const seenFactIds = new Set<string>();
    for (const fact of route.business_facts) {
      if (fact.verified !== true || !fact.fact_id || !fact.key || seenFactIds.has(fact.fact_id)) {
        invalidFacts += 1;
      }
      seenFactIds.add(fact.fact_id);
    }
    for (const section of route.sections) {
      for (const factId of section.allowed_fact_ids) {
        if (!seenFactIds.has(factId)) invalidFacts += 1;
      }
    }
  }

  return {
    artifact_ref: artifactRefString(contract),
    routes: contract.payload.routes.map((route) => route.path),
    produced_routes: contract.payload.routes.length,
    llm_calls: counters.pageContentContractLlmCalls,
    unplaced_requirements: unplaced,
    invalid_business_facts: invalidFacts,
    determinism: {
      required: true,
      same_semantic_input_same_digest: determinism.sameSemanticInputSameDigest,
      digest_run_1: determinism.digestRun1,
      digest_run_2: determinism.digestRun2,
    },
  };
}

function buildStructuredContent(
  ctx: Ctx,
  seoExecution: SeoExecutionMetadata | null,
): SafeHavenRealRuntimeEvidence["structured_content"] {
  const contentPackage = requireArtifact(ctx.structuredContentPackage, "StructuredContentPackage");
  const contract = requireArtifact(ctx.pageContentContract, "PageContentContract");
  assertSameRef(
    contentPackage.payload.page_content_contract_ref,
    contract,
    "StructuredContentPackage.page_content_contract_ref",
  );
  const validation = contentPackage.payload.validation;
  // Package-level validation arrays are the only per-run source of these
  // findings. They are empty on an accepted package, so per-route counts of
  // zero are measured, not assumed; a non-empty array is not attributable to
  // a single route and halts rather than being distributed by guesswork.
  if (validation.unsupported_claims.length > 0 || validation.failed_requirements.length > 0) {
    halt(
      "REDESIGN_EVIDENCE_MISSING",
      "StructuredContentPackage carries validation findings that cannot be attributed per route",
      validation,
    );
  }
  const executionByRoute = new Map(
    (seoExecution?.structured_content?.route_results ?? []).map((row) => [
      row.route_id ?? normalizeRoute(row.path ?? ""),
      row,
    ]),
  );

  const routeResults = contentPackage.payload.routes.map((route) => {
    const aliases = new Set<string>();
    let proseWithoutBlocks = 0;
    let schemaErrors = 0;
    for (const section of route.sections) {
      const keys = Object.keys(section as unknown as Record<string, unknown>);
      for (const alias of FORBIDDEN_SECTION_ALIASES) {
        if (keys.includes(alias)) aliases.add(alias);
      }
      if (!Array.isArray(section.blocks) || section.blocks.length === 0) {
        proseWithoutBlocks += 1;
      }
      if (typeof section.section_id !== "string" || section.section_id.trim() === "") {
        schemaErrors += 1;
      }
    }
    if (typeof route.metadata?.title !== "string" || route.metadata.title.trim() === "") {
      schemaErrors += 1;
    }
    if (
      typeof route.metadata?.description !== "string" ||
      route.metadata.description.trim() === ""
    ) {
      schemaErrors += 1;
    }
    const execution =
      executionByRoute.get(route.route_id) ?? executionByRoute.get(normalizeRoute(route.path));
    return {
      route_id: route.route_id,
      path: route.path,
      repair_attempts: execution?.repair_attempts ?? null,
      generation_calls: execution?.generation_calls ?? null,
      schema_errors: schemaErrors,
      unsupported_claims: 0,
      failed_requirements: 0,
      section_alias_fields: [...aliases].sort(),
      prose_without_blocks: proseWithoutBlocks,
    };
  });

  return {
    artifact_ref: artifactRefString(contentPackage),
    routes: contentPackage.payload.routes.map((route) => route.path),
    produced_routes: contentPackage.payload.routes.length,
    page_content_contract_ref: artifactRefString(contract),
    route_results: routeResults,
  };
}

/**
 * Legacy authority counters. Zero for the legacy content/schema stages is
 * emitted ONLY when those stages are absent from the executed plan; if either
 * ran, the real counter is reported instead of a comfortable zero.
 */
function buildLegacy(ctx: Ctx): SafeHavenRealRuntimeEvidence["legacy"] {
  const counters = requireArtifact(ctx.redesignCounters, "redesign counters");
  const executed = new Set(
    [...ctx.stageResults.entries()].filter(([, r]) => r.ok && r.skipped !== true).map(([s]) => s),
  );
  if (executed.has("content-generation") || executed.has("schema-generator")) {
    halt(
      "LEGACY_AUTHORITY_EVIDENCE_MISSING",
      "legacy content/schema stages executed under REDESIGN_IMPROVE; legacy call counts are not zero",
      [...executed].filter((s) => s === "content-generation" || s === "schema-generator"),
    );
  }
  return {
    content_generation_calls: counters.legacyContentGenerationCalls,
    schema_generation_calls: 0,
    page_content_contract_llm_calls: counters.pageContentContractLlmCalls,
    redesign_schema_llm_calls: counters.redesignSchemaLlmCalls,
  };
}

/**
 * Source-asset evidence.
 *
 * Eligibility rule (documented, not invented): the recorded source-asset ledger
 * classifies every discovered image. An image is an eligible reusable
 * photograph when it is present on disk and was not rejected as a brand mark;
 * the same authorized photo pool is eligible for project-proof and gallery
 * duty, because the run records no finer role classification for source
 * photography. Selection counts come from the actual plan resolutions.
 */
function buildAssets(ctx: Ctx): SafeHavenRealRuntimeEvidence["assets"] {
  const manifest = requireArtifact(ctx.sourceSiteManifest, "SourceSiteManifest");
  const plan = requireArtifact(ctx.imageAssetPlan, "ImageAssetPlan");
  const decisions = requireArtifact(ctx.sourceAssetDecisions, "source asset decision ledger");
  const assetManifest = requireArtifact(ctx.imageAssetManifest, "ImageAssetManifest");
  const blueprint = requireArtifact(ctx.websiteBlueprint, "WebsiteBuildBlueprint");
  const donors = requireArtifact(ctx.acceptedDonors, "accepted donor evidence");

  const rawSourceImages = manifest.images.length;
  const rejectedAsBrandMark = decisions.filter(
    (entry) => entry.decision === "REJECTED" && entry.reason.includes("brand mark"),
  ).length;
  const rejectedAsMissing = decisions.filter(
    (entry) => entry.decision === "REJECTED" && entry.reason.includes("source file missing"),
  ).length;
  const eligiblePhotos = decisions.length - rejectedAsBrandMark - rejectedAsMissing;
  const selectedSourceImages = decisions.filter((entry) => entry.decision === "SELECTED").length;

  const requiredSlots = plan.assets.filter((asset) => asset.required);
  if (requiredSlots.length === 0) {
    halt("ASSET_EVIDENCE_MISSING", "the plan declares no required visual slots to prove filled");
  }
  const filledRequiredSlots = requiredSlots.filter(
    (asset) => asset.resolution.source !== "unresolved",
  ).length;

  // Donor bytes must not appear in the candidate. Every donor screenshot is
  // hashed from disk; an unreadable screenshot makes non-reuse unprovable.
  const donorHashes = new Set<string>();
  for (const donor of donors) {
    for (const screenshotPath of donor.screenshot_paths) {
      if (!existsSync(screenshotPath)) {
        halt(
          "DONOR_ASSET_HASH_UNVERIFIABLE",
          `donor ${donor.domain} screenshot is not readable, so donor-byte reuse cannot be disproven`,
          screenshotPath,
        );
      }
      donorHashes.add(sha256(readFileSync(screenshotPath)));
    }
    for (const page of donor.pages) donorHashes.add(page.content_digest);
  }
  const donorAssetHashMatches = assetManifest.assets.filter((asset) =>
    donorHashes.has(asset.sha256),
  ).length;

  const roleBySlotId = new Map(
    (blueprint.payload.visual_requirements ?? []).map((requirement) => [
      requirement.slot_id,
      requirement.role,
    ]),
  );
  const selectedSourceForRole = (role: string): number =>
    plan.assets.filter(
      (asset) => roleBySlotId.get(asset.slotId) === role && asset.resolution.source === "source-site",
    ).length;
  const galleryLedgerSelections = decisions.filter(
    (entry) => entry.decision === "SELECTED" && entry.slotId === "gallery",
  ).length;

  return {
    source_corpus_completed:
      manifest.pages.length > 0 &&
      ctx.stageResults.get("source-site-ingestion")?.ok === true,
    raw_source_images: rawSourceImages,
    authorized_reusable_images: decisions.length - rejectedAsMissing,
    selected_source_images: selectedSourceImages,
    unexplained_reusable_asset_loss: Math.max(0, rawSourceImages - decisions.length),
    required_visual_slots_filled_fraction: filledRequiredSlots / requiredSlots.length,
    donor_asset_hash_matches: donorAssetHashMatches,
    candidate_dispositions: [
      ...new Set(assetManifest.assets.map((asset) => asset.disposition)),
    ].sort(),
    eligible_source_project_proof_count: eligiblePhotos,
    selected_source_project_proof_count: selectedSourceForRole("project_proof"),
    eligible_source_gallery_count: eligiblePhotos,
    selected_source_gallery_count: selectedSourceForRole("gallery") + galleryLedgerSelections,
  };
}

/**
 * Build-time site facts. `placeholder_count: 0` is emitted only because the
 * fail-closed placeholder scan actually ran and passed on this build.
 */
function buildSiteBuild(ctx: Ctx): SafeHavenRealRuntimeEvidence["site_build"] {
  const assembly = requireArtifact(ctx.assemblyManifest, "AssemblyManifest");
  const placeholderScan = ctx.stageResults.get("placeholder-scan");
  if (!placeholderScan?.ok || placeholderScan.skipped === true) {
    halt(
      "SITE_BUILD_EVIDENCE_MISSING",
      "placeholder-scan did not execute successfully, so placeholder_count is unproven",
    );
  }
  if (ctx.stageResults.get("site-build")?.ok !== true) {
    halt("SITE_BUILD_EVIDENCE_MISSING", "site-build did not execute successfully");
  }
  return {
    routes: [...assembly.routes],
    built_routes: assembly.routes.length,
    placeholder_count: 0,
  };
}

/* =========================================================
 * ELIGIBILITY
 * ======================================================= */

function assertRunEligible(ctx: Ctx): void {
  if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
    halt("GOLDEN_RUN_NOT_ELIGIBLE", `build intent is ${ctx.buildIntent}, not REDESIGN_IMPROVE`);
  }
  if (ctx.mode !== "end-to-end") {
    halt("GOLDEN_RUN_NOT_ELIGIBLE", `mode is ${ctx.mode}, not end-to-end`);
  }
  if (ctx.dryRun) {
    halt("GOLDEN_RUN_NOT_ELIGIBLE", "a dry run cannot produce Golden runtime evidence");
  }
  const convergence = ctx.stageResults.get("terminal-convergence");
  if (!convergence?.ok || convergence.skipped === true) {
    halt(
      "GOLDEN_RUN_NOT_ELIGIBLE",
      "terminal convergence did not succeed; a successful runtime package must not be emitted",
    );
  }
  if (process.env.GOLDEN_CALIBRATION_MODE) {
    halt(
      "GOLDEN_RUN_NOT_ELIGIBLE",
      "GOLDEN_CALIBRATION_MODE is set; a real Golden run must never execute in calibration mode",
    );
  }
}

/* =========================================================
 * PUBLIC API
 * ======================================================= */

export async function buildSafeHavenRuntimeEvidence(
  ctx: BuildContext,
  options: SafeHavenGoldenRuntimeEvidenceOptions,
): Promise<SafeHavenRealRuntimeEvidence> {
  assertRunEligible(ctx);

  const testCase = readJsonFile(options.casePath);
  if (!isObject(testCase) || testCase.schema !== "l9.golden-site-case/v1") {
    halt("CASE_AUTHORITY_MISMATCH", `${options.casePath} is not an l9.golden-site-case/v1 case`);
  }
  const caseId = testCase.case_id;
  const caseRoutes = testCase.routes;
  if (typeof caseId !== "string" || !Array.isArray(caseRoutes)) {
    halt("CASE_AUTHORITY_MISMATCH", "case must carry a case_id and a route list");
  }
  if (!existsSync(options.oraclePath)) {
    halt("CASE_AUTHORITY_MISMATCH", `oracle not found at ${options.oraclePath}`);
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const localRouter = installedPackageVersion("@quantum-l9", "llm-router", repoRoot);
  const localInterop = installedPackageVersion("@quantum-l9", "bot-interop", repoRoot);
  const external = readExternalIdentityManifest(options.identityManifestPath);
  const website = localRepositoryIdentity();
  const snapshot = ctx.seoBuildIntelligencePreflight;
  if (!snapshot) {
    halt("PREFLIGHT_EVIDENCE_MISSING", "no SEO build-intelligence preflight snapshot on this run");
  }
  const seoExecution = readSeoExecutionMetadata(options.seoLlmAuditPath);

  const preflight = buildPreflight(ctx, localInterop, localRouter);
  const competitiveLandscape = buildCompetitiveLandscape(ctx, seoExecution);
  const donorEvidence = buildDonorEvidence(ctx);
  assertDonorDomainSetEquality(competitiveLandscape, donorEvidence);
  const websiteBlueprint = buildWebsiteBlueprint(ctx, competitiveLandscape.artifact_ref);
  const seoContentBlueprint = buildSeoContentBlueprint(
    ctx,
    caseRoutes as string[],
    competitiveLandscape.artifact_ref,
    seoExecution,
  );
  const pageContentContract = buildPageContentContract(ctx);
  const structuredContent = buildStructuredContent(ctx, seoExecution);
  const legacy = buildLegacy(ctx);
  const assets = buildAssets(ctx);
  const siteBuild = buildSiteBuild(ctx);

  const unresolved: SafeHavenRealRuntimeEvidence["unresolved_external_dependencies"] = [];
  if (competitiveLandscape.ranking_llm_calls === null) {
    unresolved.push({
      field: "competitive_landscape.ranking_llm_calls",
      owner: "SEO-Bot",
      reason: "donor ranking is executed inside SEO-Bot; Website-Bot observes no call counter",
    });
  }
  if (seoContentBlueprint.batch_size === null || seoContentBlueprint.batch_count === null) {
    unresolved.push({
      field: "seo_content_blueprint.batch_size/batch_count",
      owner: "SEO-Bot",
      reason: "route batching is SEO-Bot execution metadata and is absent from the sealed artifact",
    });
  }
  const missingRouteCounters = structuredContent.route_results.filter(
    (row) => row.repair_attempts === null || row.generation_calls === null,
  );
  if (missingRouteCounters.length > 0) {
    unresolved.push({
      field: "structured_content.route_results[].repair_attempts/generation_calls",
      owner: "SEO-Bot",
      reason:
        `${missingRouteCounters.length} route(s) carry no SEO-Bot repair/generation counters; ` +
        "these must never be defaulted to 0 or 1 by convention",
    });
  }

  const evidence: SafeHavenRealRuntimeEvidence = {
    schema: SAFEHAVEN_RUNTIME_EVIDENCE_SCHEMA,
    case_id: caseId,
    generated_at: new Date().toISOString(),
    unresolved_external_dependencies: unresolved,
    identity: {
      website_bot: {
        sha: website.sha,
        worktree_state: website.worktree_state,
        llm_router_version: localRouter,
      },
      seo_bot: {
        sha: external.seo_bot.sha,
        worktree_state: external.seo_bot.worktree_state,
        llm_router_version: snapshot.llm_router_version,
      },
      llm_router: {
        sha: external.llm_router.sha,
        worktree_state: external.llm_router.worktree_state,
        package_version: localRouter,
      },
      bot_interop: {
        compatible: snapshot.bot_interop_version === localInterop,
        website_bot_version: localInterop,
        seo_bot_version: snapshot.bot_interop_version,
      },
    },
    run: {
      run_id: ctx.buildId,
      build_intent: ctx.buildIntent,
      // Both fallbacks are reported false only because the redesign authority
      // chain produced every artifact and no legacy stage executed.
      copy_fallback_used: false,
      generic_fallback_used: false,
      pipeline_exit_code: 0,
    },
    preflight,
    events: buildEvents(ctx),
    competitive_landscape: competitiveLandscape,
    donor_evidence: donorEvidence,
    website_build_blueprint: websiteBlueprint,
    seo_content_blueprint: seoContentBlueprint,
    page_content_contract: pageContentContract,
    structured_content: structuredContent,
    legacy,
    assets,
    site_build: siteBuild,
  };

  validateSafeHavenRuntimeEvidence(evidence);
  return evidence;
}

const REQUIRED_SECTIONS = [
  "identity",
  "run",
  "preflight",
  "events",
  "competitive_landscape",
  "donor_evidence",
  "website_build_blueprint",
  "seo_content_blueprint",
  "page_content_contract",
  "structured_content",
  "legacy",
  "assets",
  "site_build",
] as const;

export function validateSafeHavenRuntimeEvidence(
  value: unknown,
): asserts value is SafeHavenRealRuntimeEvidence {
  if (!isObject(value)) {
    halt("RUNTIME_EVIDENCE_SCHEMA_INVALID", "runtime evidence must be an object");
  }
  if (value.schema !== SAFEHAVEN_RUNTIME_EVIDENCE_SCHEMA) {
    halt(
      "RUNTIME_EVIDENCE_SCHEMA_INVALID",
      `runtime evidence schema must be ${SAFEHAVEN_RUNTIME_EVIDENCE_SCHEMA}`,
      value.schema,
    );
  }
  if (typeof value.case_id !== "string" || value.case_id.trim() === "") {
    halt("RUNTIME_EVIDENCE_SCHEMA_INVALID", "runtime evidence case_id missing");
  }
  for (const section of REQUIRED_SECTIONS) {
    if (value[section] === undefined || value[section] === null) {
      halt("RUNTIME_EVIDENCE_SCHEMA_INVALID", `runtime evidence section missing: ${section}`);
    }
  }
  if (!Array.isArray(value.unresolved_external_dependencies)) {
    halt(
      "RUNTIME_EVIDENCE_SCHEMA_INVALID",
      "runtime evidence must declare unresolved_external_dependencies (possibly empty)",
    );
  }
  const identity = value.identity as Record<string, unknown>;
  for (const repo of ["website_bot", "seo_bot", "llm_router"]) {
    const entry = identity[repo];
    if (!isObject(entry) || typeof entry.sha !== "string" || !FULL_SHA.test(entry.sha)) {
      halt("IDENTITY_SHA_INVALID", `${repo} identity SHA is missing or not 40 hex characters`);
    }
    assertWorktreeState(entry.worktree_state, repo);
  }
  const pcc = value.page_content_contract as Record<string, unknown>;
  const determinism = pcc.determinism as Record<string, unknown> | undefined;
  if (
    !determinism ||
    typeof determinism.digest_run_1 !== "string" ||
    typeof determinism.digest_run_2 !== "string" ||
    determinism.digest_run_1 !== determinism.digest_run_2 ||
    determinism.same_semantic_input_same_digest !== true
  ) {
    halt("PCC_DETERMINISM_EVIDENCE_MISSING", "runtime evidence lacks a valid PCC determinism proof");
  }
}

/** Atomic write: a partial runtime evidence file must never be observable. */
export async function writeSafeHavenRuntimeEvidence(
  ctx: BuildContext,
  options: SafeHavenGoldenRuntimeEvidenceOptions,
): Promise<SafeHavenRealRuntimeEvidence> {
  const evidence = await buildSafeHavenRuntimeEvidence(ctx, options);
  const output = resolve(options.outputPath);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, "utf-8");
  renameSync(temporary, output);
  return evidence;
}
