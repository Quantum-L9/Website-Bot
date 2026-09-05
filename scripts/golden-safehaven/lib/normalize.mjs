#!/usr/bin/env node
/**
 * Pure, deterministic normalization helpers shared by the golden evidence
 * adapter (build-receipt.mjs) and its unit tests.
 *
 * Every function here is a pure function of its inputs: identical inputs
 * always produce identical output. No clocks, no RNG, no global state.
 * Where a helper may only partially derive a field it returns the field
 * absent rather than fabricating a value (fail closed).
 */
import { createHash } from "node:crypto";
import { stripTrailingSlashes, trimEndWhere } from "../../../src/lib/text-trim.mjs";

/**
 * Deterministic code-unit comparator. Explicitly locale-independent so
 * canonical orderings (and the digests derived from them) are identical
 * on every machine.
 */
export function compareCodeUnits(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Canonical route: leading slash, no trailing slash; root stays "/". */
export function normalizeRoute(value) {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  if (!trimmed) return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const stripped = stripTrailingSlashes(withLeading);
  return stripped || "/";
}

/** Sorted, deduplicated canonical route set (deterministic order). */
export function normalizeRouteSet(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeRoute))].sort(compareCodeUnits);
}

/**
 * Canonical domain: lowercase hostname without scheme, credentials,
 * "www." prefix, port, path, or trailing dot/slash.
 *   "HTTPS://WWW.Example.com./about" -> "example.com"
 */
export function normalizeDomain(value) {
  if (typeof value !== "string") return "";
  let v = value.trim().toLowerCase();
  if (!v) return "";
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  if (v.includes("@")) v = v.slice(v.lastIndexOf("@") + 1);
  v = v.split(/[/?#]/)[0];
  v = v.replace(/^www\./, "");
  v = v.replace(/:\d+$/, "");
  v = trimEndWhere(v, (char) => /[.\s]/.test(char));
  return v;
}

/** sha256 hex digest of a string. */
export function sha256Of(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * Donor evidence directory token used by the runtime ingestor:
 * sha256(domain).slice(0, 12) over the normalized donor domain.
 */
export function donorDirToken(domain) {
  return sha256Of(normalizeDomain(domain)).slice(0, 12);
}

/**
 * Join a CompetitiveLandscape payload's selected_donors with its
 * observations/domains to project the verifier-consumed donor rows.
 *
 * Deterministic rules:
 *  - each selected donor maps to the observations listed in its
 *    observation_ids;
 *  - rank/url/query_id/observed_at come from the lowest-rank observation
 *    (ties resolved by observation order in the payload);
 *  - visibility_contribution is the sum of the donor's observation
 *    visibility contributions, falling back to the domain's
 *    aggregate_visibility when observations carry none;
 *  - qualified_operating_company is derived from the payload exclusions
 *    (a selected donor that also appears in exclusions is not qualified);
 *  - real_dataforseo_observation is true when the joined observation's
 *    source is "dataforseo" (the payload's only permitted ranking truth);
 *  - class is derived from the payload's own classification evidence: the
 *    exclusion reasons enumerate the non-operating-company classes
 *    (directory/social/marketplace/publisher/aggregator/...), so a
 *    qualified selected donor is synthesized as "operating-company".
 *    The field stays absent when qualification is absent — never defaulted.
 *  - any field the payload cannot supply is left absent (never defaulted).
 */
export function joinSelectedDonors(landscape) {
  if (!landscape || typeof landscape !== "object") return [];
  const observations = Array.isArray(landscape.observations) ? landscape.observations : [];
  const selected = Array.isArray(landscape.selected_donors) ? landscape.selected_donors : [];
  const exclusions = Array.isArray(landscape.exclusions) ? landscape.exclusions : [];
  const excluded = new Set(exclusions.map((e) => normalizeDomain(e?.domain)));
  return selected.map((donor) => {
    const normalized = normalizeDomain(donor?.domain);
    const ids = Array.isArray(donor.observation_ids) ? donor.observation_ids : [];
    const matched = ids
      .map((id) => observations.find((o) => String(o.observation_id ?? o.id) === String(id)))
      .filter((o) => o != null);
    const ranked = [...matched]
      .filter((o) => o.url && o.rank != null)
      .sort((a, b) => Number(a.rank) - Number(b.rank));
    const best = ranked[0] ?? null;
    const visibilitySum = matched.reduce(
      (sum, o) => sum + Number(o.visibility_contribution ?? o.visibility ?? 0),
      0,
    );
    const domainRow = Array.isArray(landscape.domains)
      ? (landscape.domains.find((d) => normalizeDomain(d?.domain) === normalized) ?? null)
      : null;
    const visibility =
      visibilitySum > 0
        ? visibilitySum
        : (domainRow?.aggregate_visibility ?? domainRow?.visibility);
    const row = { normalized_domain: normalized };
    if (typeof donor.domain === "string" && donor.domain !== "") row.domain = donor.domain;
    if (donor.qualified_operating_company != null) {
      row.qualified_operating_company = Boolean(donor.qualified_operating_company);
    } else if (Array.isArray(landscape.exclusions)) {
      // Derived: a selected donor excluded by the payload is unqualified.
      row.qualified_operating_company = !excluded.has(normalized);
    }
    if (donor.class != null) {
      // Payload-carried class wins when the producer reports one.
      row.class = String(donor.class);
    } else if (row.qualified_operating_company === true) {
      // Derived from payload classification evidence: the exclusion-reason
      // taxonomy enumerates the non-operating-company classes, so a qualified
      // selected donor is an operating company.
      row.class = "operating-company";
    }
    if (best) {
      if (best.query_id != null) row.query_id = String(best.query_id);
      if (best.url != null) row.url = String(best.url);
      row.rank = Number(best.rank);
      if (best.observed_at != null) row.observed_at = String(best.observed_at);
      row.real_dataforseo_observation = best.source === "dataforseo";
    }
    if (visibility != null && Number.isFinite(Number(visibility))) {
      row.visibility_contribution = Number(visibility);
    }
    return row;
  });
}

/**
 * Derive the verifier-consumed run fallback flags from runtime evidence.
 *
 * Fail-closed contract:
 *  - intent evidence must be a non-empty string (the redesign-integrity
 *    receipt's build_intent). Without it both flags stay ABSENT.
 *  - a legacy stage is "used" when stage evidence shows it ran
 *    (status ok or failed); a skipped stage never ran and is not a fallback.
 *  - under a proven REDESIGN_IMPROVE intent with no legacy stage rows,
 *    both flags are false (proven, not defaulted).
 *
 * @param {{ intentEvidence?: string | null, stageRuns?: Array<{stage_name: string, status: string}> }} input
 * @returns {{ copy_fallback_used?: boolean, generic_fallback_used?: boolean }}
 */
export function deriveFallbackFlags({ intentEvidence, stageRuns }) {
  const intent = typeof intentEvidence === "string" ? intentEvidence.trim() : "";
  if (!intent) return {};
  const runs = Array.isArray(stageRuns) ? stageRuns : [];
  const used = (stageName) =>
    runs.some(
      (r) =>
        r.stage_name === stageName &&
        (r.status === "ok" || r.status === "failed" || r.status === "passed"),
    );
  return {
    copy_fallback_used: used("content-generation"),
    generic_fallback_used: used("schema-generator"),
  };
}

/**
 * Normalize a WebsiteBuildBlueprint visual_requirements payload into the
 * ordered list of slot role names it evidences.
 *
 * Supports both the array shape ([{ role: "hero" }, ...]) and the
 * keyed-object shape ({ hero: [...], gallery: [...] }); the roles are the
 * payload's own vocabulary, not the adapter's. Empty result means no role
 * evidence — callers must leave requirement booleans absent (fail closed).
 */
export function visualRequirementRoles(visualRequirements) {
  if (Array.isArray(visualRequirements)) {
    return visualRequirements
      .map((r) => String(r?.role ?? r?.slot_role ?? "").toLowerCase())
      .filter(Boolean);
  }
  if (visualRequirements && typeof visualRequirements === "object") {
    // sorted for determinism regardless of producer key order
    return Object.keys(visualRequirements)
      .map((k) => k.toLowerCase())
      .filter(Boolean)
      .sort(compareCodeUnits);
  }
  return [];
}

/**
 * Translate an ImageAssetManifest entry (ImageSource + ReuseDisposition)
 * into the oracle candidate-disposition taxonomy
 * (eligible_source_asset_precedence / forbidden_candidate_dispositions).
 *
 *   source "generated"            -> "GENERATED"
 *   disposition "approved-client-owned" -> "SOURCE_CLIENT_OWNED"
 *   disposition "reference-only"  -> "SOURCE_REFERENCE_ONLY" | "DONOR_REFERENCE_ONLY"
 *   disposition "unknown-rights"  -> "UNKNOWN"
 *   rejected / unclassifiable     -> null (excluded from the taxonomy set)
 *
 * Returns null when the manifest evidence cannot classify the entry —
 * callers filter nulls, so unknown rights never become a PASS.
 */
export function normalizeAssetDisposition({ source, disposition } = {}) {
  if (source === "generated") return "GENERATED";
  if (disposition === "approved-client-owned") return "SOURCE_CLIENT_OWNED";
  if (disposition === "reference-only") {
    return source === "source-site" ? "SOURCE_REFERENCE_ONLY" : "DONOR_REFERENCE_ONLY";
  }
  if (disposition === "unknown-rights") return "UNKNOWN";
  return null;
}

/** Pick the first defined value among dotted paths in an object. */
export function firstDefined(obj, paths) {
  for (const p of paths) {
    const parts = String(p).split(".");
    let cur = obj;
    let ok = true;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object" || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

/**
 * Derive the nine preflight checks the oracle requires from the collected
 * preflight payload plus fetch metadata and the locally installed interop
 * versions. Each check is { name, status: "PASS" | "FAIL" }.
 */
export function derivePreflightChecks({
  preflight,
  fetchMeta,
  botInteropVersion,
  llmRouterVersion,
}) {
  const meta = fetchMeta ?? {};
  const reached = meta.reached === true;
  const httpOk = reached && typeof meta.http_status === "number" && meta.http_status < 500;
  const authOk = reached && meta.http_status !== 401 && meta.http_status !== 403;
  const caps = preflight?.capabilities ?? {};
  const conf = preflight?.configuration ?? {};
  const botInteropCompatible =
    typeof preflight?.bot_interop_version === "string" &&
    preflight.bot_interop_version !== "" &&
    preflight.bot_interop_version === botInteropVersion;
  const llmRouterCompatible =
    typeof preflight?.llm_router_version === "string" &&
    preflight.llm_router_version !== "" &&
    preflight.llm_router_version === llmRouterVersion;
  return [
    { name: "seo_bot_reachable", status: httpOk ? "PASS" : "FAIL" },
    { name: "seo_bot_machine_auth", status: authOk ? "PASS" : "FAIL" },
    {
      name: "competitive_landscape_capability",
      status: caps.competitive_landscape === true ? "PASS" : "FAIL",
    },
    {
      name: "seo_content_blueprint_capability",
      status: caps.seo_content_blueprint === true ? "PASS" : "FAIL",
    },
    {
      name: "structured_content_capability",
      status: caps.structured_content === true ? "PASS" : "FAIL",
    },
    {
      name: "dataforseo_configured",
      status: conf.dataforseo_configured === true ? "PASS" : "FAIL",
    },
    {
      name: "llm_provider_configured",
      status: conf.llm_provider_configured === true ? "PASS" : "FAIL",
    },
    { name: "bot_interop_compatible", status: botInteropCompatible ? "PASS" : "FAIL" },
    { name: "llm_router_compatible", status: llmRouterCompatible ? "PASS" : "FAIL" },
  ];
}

/** Recursive key-sorted deep copy (canonical JSON support). */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort(compareCodeUnits)) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

/** Deterministic canonical JSON (sorted keys, 2-space indent, trailing newline). */
export function canonicalStringify(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/** Route -> dist/ file path, mirroring src/validation/validate-generated-site.ts. */
export function distPathForRoute(route) {
  const r = normalizeRoute(route);
  if (r === "/") return "index.html";
  return `${r.slice(1)}/index.html`;
}
