import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  canonicalStringify,
  distPathForRoute,
  firstDefined,
} from "./normalize.mjs";

test("normalizeRoute produces verifier-compatible canonical routes", () => {
  assert.equal(normalizeRoute("/"), "/");
  assert.equal(normalizeRoute("/services/"), "/services");
  assert.equal(normalizeRoute("/services/roof-repair/"), "/services/roof-repair");
  assert.equal(normalizeRoute("services/roof-repair"), "/services/roof-repair");
  assert.equal(normalizeRoute("  /about/  "), "/about");
  assert.equal(normalizeRoute(""), "/");
  assert.equal(normalizeRoute(null), "/");
  // trailing multi-slash collapses
  assert.equal(normalizeRoute("/gallery//"), "/gallery");
});

test("normalizeRouteSet is sorted and deduplicated", () => {
  assert.deepEqual(
    normalizeRouteSet(["/services/", "/", "/services/", "about", "/faq/"]),
    ["/", "/about", "/faq", "/services"],
  );
  assert.deepEqual(normalizeRouteSet(undefined), []);
  assert.deepEqual(normalizeRouteSet(null), []);
});

test("normalizeDomain strips scheme, www, credentials, port, path, trailing dot", () => {
  assert.equal(normalizeDomain("https://www.example.com"), "example.com");
  assert.equal(normalizeDomain("HTTPS://WWW.Example.COM./about?q=1"), "example.com");
  assert.equal(normalizeDomain("example.com/"), "example.com");
  assert.equal(normalizeDomain("www.example.com."), "example.com");
  assert.equal(normalizeDomain("user:pass@example.com:8443"), "example.com");
  assert.equal(normalizeDomain("http://EXAMPLE.com/path#frag"), "example.com");
  assert.equal(normalizeDomain(""), "");
  assert.equal(normalizeDomain(null), "");
});

test("donorDirToken matches the runtime ingestor's sha12 convention", () => {
  // sha256("example.com").slice(0,12) — deterministic reference value
  const expected = createSha12("example.com");
  assert.equal(donorDirToken("https://www.example.com"), expected);
  assert.equal(donorDirToken("example.com"), expected);
  assert.equal(donorDirToken("EXAMPLE.COM"), expected);
  assert.match(donorDirToken("example.com"), /^[0-9a-f]{12}$/);
});

test("joinSelectedDonors joins observations, picks lowest rank, derives qualification", () => {
  const landscape = {
    observations: [
      { observation_id: "o1", query_id: "q1", rank: 2, url: "https://rival-a.example.com/2", domain: "rival-a.example.com", observed_at: "2026-08-01T00:00:00Z", source: "dataforseo" },
      { observation_id: "o2", query_id: "q1", rank: 1, url: "https://rival-a.example.com/", domain: "rival-a.example.com", observed_at: "2026-08-01T00:00:00Z", source: "dataforseo" },
      { observation_id: "o3", query_id: "q2", rank: 1, url: "https://rival-b.example.com/", domain: "rival-b.example.com", observed_at: "2026-08-01T00:00:00Z", source: "dataforseo" },
    ],
    domains: [
      { domain: "rival-a.example.com", aggregate_visibility: 42, observation_ids: ["o1", "o2"] },
      { domain: "rival-b.example.com", aggregate_visibility: 17, observation_ids: ["o3"] },
    ],
    selected_donors: [
      { domain: "rival-a.example.com", aggregate_visibility: 42, observation_ids: ["o1", "o2"] },
      { domain: "rival-b.example.com", aggregate_visibility: 17, observation_ids: ["o3"] },
    ],
    exclusions: [{ domain: "directory.example.com", reason: "directory" }],
    evidence_complete: true,
  };
  const rows = joinSelectedDonors(landscape);
  assert.equal(rows.length, 2);
  const [a, b] = rows;
  assert.equal(a.normalized_domain, "rival-a.example.com");
  assert.equal(a.rank, 1); // lowest-rank observation wins
  assert.equal(a.url, "https://rival-a.example.com/");
  assert.equal(a.query_id, "q1");
  assert.equal(a.observed_at, "2026-08-01T00:00:00Z");
  assert.equal(a.qualified_operating_company, true);
  assert.equal(a.visibility_contribution, 42); // aggregate fallback (no per-observation contributions)
  assert.equal(a.real_dataforseo_observation, true); // observation source is dataforseo
  assert.equal(a.class, "operating-company"); // derived from exclusion taxonomy complement
  assert.equal(b.normalized_domain, "rival-b.example.com");
  assert.equal(b.qualified_operating_company, true);
  assert.equal(b.class, "operating-company");
});

test("joinSelectedDonors records a non-dataforseo observation source honestly", () => {
  const landscape = {
    observations: [
      { observation_id: "o1", query_id: "q1", rank: 1, url: "https://x.example.com/", domain: "x.example.com", observed_at: "t", source: "manual" },
    ],
    selected_donors: [{ domain: "x.example.com", observation_ids: ["o1"] }],
    exclusions: [],
  };
  const [row] = joinSelectedDonors(landscape);
  assert.equal(row.real_dataforseo_observation, false);
  assert.equal(row.class, "operating-company");
});

test("joinSelectedDonors marks excluded donors unqualified and leaves missing fields absent", () => {
  const landscape = {
    observations: [],
    selected_donors: [{ domain: "directory.example.com", observation_ids: [] }],
    exclusions: [{ domain: "directory.example.com", reason: "directory" }],
  };
  const [row] = joinSelectedDonors(landscape);
  assert.equal(row.qualified_operating_company, false);
  assert.equal("rank" in row, false);
  assert.equal("url" in row, false);
  assert.equal("query_id" in row, false);
  assert.equal("observed_at" in row, false);
  assert.equal("visibility_contribution" in row, false);
  // unqualified donors never get the synthesized class
  assert.equal("class" in row, false);
  assert.equal("real_dataforseo_observation" in row, false);
});

test("joinSelectedDonors sums observation visibility contributions when present", () => {
  const landscape = {
    observations: [
      { observation_id: "o1", query_id: "q1", rank: 1, url: "https://x.example.com/", domain: "x.example.com", observed_at: "t", source: "dataforseo", visibility_contribution: 10 },
      { observation_id: "o2", query_id: "q1", rank: 2, url: "https://x.example.com/p2", domain: "x.example.com", observed_at: "t", source: "dataforseo", visibility_contribution: 5 },
    ],
    selected_donors: [{ domain: "x.example.com", aggregate_visibility: 99, observation_ids: ["o1", "o2"] }],
  };
  const [row] = joinSelectedDonors(landscape);
  assert.equal(row.visibility_contribution, 15);
});

test("deriveFallbackFlags is fail-closed and legacy-stage-aware", () => {
  // No intent evidence -> both flags absent
  assert.deepEqual(deriveFallbackFlags({ intentEvidence: null, stageRuns: [] }), {});
  assert.deepEqual(deriveFallbackFlags({ intentEvidence: "  ", stageRuns: [] }), {});
  assert.deepEqual(deriveFallbackFlags({ intentEvidence: undefined, stageRuns: [] }), {});

  // REDESIGN_IMPROVE proven, no legacy stages -> false/false
  assert.deepEqual(
    deriveFallbackFlags({ intentEvidence: "REDESIGN_IMPROVE", stageRuns: [] }),
    { copy_fallback_used: false, generic_fallback_used: false },
  );

  // content-generation ran ok -> copy fallback used
  assert.deepEqual(
    deriveFallbackFlags({
      intentEvidence: "REDESIGN_IMPROVE",
      stageRuns: [{ stage_name: "content-generation", status: "ok" }],
    }),
    { copy_fallback_used: true, generic_fallback_used: false },
  );

  // schema-generator failed -> generic fallback still counts as used
  assert.deepEqual(
    deriveFallbackFlags({
      intentEvidence: "REDESIGN_IMPROVE",
      stageRuns: [{ stage_name: "schema-generator", status: "failed" }],
    }),
    { copy_fallback_used: false, generic_fallback_used: true },
  );

  // skipped legacy stages never ran -> not a fallback
  assert.deepEqual(
    deriveFallbackFlags({
      intentEvidence: "REDESIGN_IMPROVE",
      stageRuns: [{ stage_name: "content-generation", status: "skipped" }],
    }),
    { copy_fallback_used: false, generic_fallback_used: false },
  );
});

test("derivePreflightChecks derives all nine oracle checks", () => {
  const preflight = {
    status: "ready",
    service: "seo-bot",
    version: "2.4.0",
    bot_interop_version: "1.1.0",
    llm_router_version: "1.3.0",
    capabilities: {
      competitive_landscape: true,
      seo_content_blueprint: true,
      structured_content: true,
    },
    configuration: { dataforseo_configured: true, llm_provider_configured: true },
  };
  const checks = derivePreflightChecks({
    preflight,
    fetchMeta: { reached: true, http_status: 200 },
    botInteropVersion: "1.1.0",
    llmRouterVersion: "1.3.0",
  });
  assert.equal(checks.length, 9);
  assert.ok(checks.every((c) => c.status === "PASS"));

  // auth failure
  const authFail = derivePreflightChecks({
    preflight,
    fetchMeta: { reached: true, http_status: 401 },
    botInteropVersion: "1.1.0",
    llmRouterVersion: "1.3.0",
  });
  assert.equal(authFail.find((c) => c.name === "seo_bot_machine_auth").status, "FAIL");
  assert.equal(authFail.find((c) => c.name === "seo_bot_reachable").status, "PASS");

  // version skew flips interop checks
  const skew = derivePreflightChecks({
    preflight,
    fetchMeta: { reached: true, http_status: 200 },
    botInteropVersion: "0.9.0",
    llmRouterVersion: "1.3.0",
  });
  assert.equal(skew.find((c) => c.name === "bot_interop_compatible").status, "FAIL");
  assert.equal(skew.find((c) => c.name === "llm_router_compatible").status, "PASS");

  // unreachable fails reachability
  const unreachable = derivePreflightChecks({
    preflight,
    fetchMeta: { reached: false },
    botInteropVersion: "1.1.0",
    llmRouterVersion: "1.3.0",
  });
  assert.equal(unreachable.find((c) => c.name === "seo_bot_reachable").status, "FAIL");
});

test("canonicalStringify is deterministic regardless of key order", () => {
  const a = { z: 1, a: { y: 2, x: [3, { b: 4, a: 5 }] }, m: null };
  const b = { a: { x: [3, { a: 5, b: 4 }], y: 2 }, m: null, z: 1 };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
  assert.ok(canonicalStringify(a).endsWith("\n"));
});

test("distPathForRoute mirrors the runtime validate-generated-site mapping", () => {
  assert.equal(distPathForRoute("/"), "index.html");
  assert.equal(distPathForRoute("/services/"), "services/index.html");
  assert.equal(distPathForRoute("/services/roof-repair/"), "services/roof-repair/index.html");
  assert.equal(distPathForRoute("/contact/"), "contact/index.html");
});

test("visualRequirementRoles handles array and keyed-object shapes", () => {
  assert.deepEqual(
    visualRequirementRoles([{ role: "hero" }, { role: "gallery" }, { role: "project-proof" }]),
    ["hero", "gallery", "project-proof"],
  );
  assert.deepEqual(
    visualRequirementRoles({ hero: [{ src: "a" }], gallery: [{ src: "b" }] }),
    ["gallery", "hero"],
  );
  assert.deepEqual(visualRequirementRoles([{ slot_role: "hero" }, { role: "" }]), ["hero"]);
  // no role evidence -> empty, never a defaulted value
  assert.deepEqual(visualRequirementRoles([]), []);
  assert.deepEqual(visualRequirementRoles(undefined), []);
  assert.deepEqual(visualRequirementRoles(null), []);
  assert.deepEqual(visualRequirementRoles("gallery"), []);
});

test("normalizeAssetDisposition maps manifest entries into the oracle taxonomy", () => {
  assert.equal(normalizeAssetDisposition({ source: "generated" }), "GENERATED");
  assert.equal(normalizeAssetDisposition({ source: "provided", disposition: "approved-client-owned" }), "SOURCE_CLIENT_OWNED");
  assert.equal(normalizeAssetDisposition({ source: "source-site", disposition: "reference-only" }), "SOURCE_REFERENCE_ONLY");
  assert.equal(normalizeAssetDisposition({ source: "provided", disposition: "reference-only" }), "DONOR_REFERENCE_ONLY");
  assert.equal(normalizeAssetDisposition({ source: "source-site", disposition: "unknown-rights" }), "UNKNOWN");
  // rejected and unclassifiable entries never become a PASS
  assert.equal(normalizeAssetDisposition({ source: "source-site", disposition: "rejected" }), null);
  assert.equal(normalizeAssetDisposition({}), null);
  assert.equal(normalizeAssetDisposition(undefined), null);
});

test("firstDefined picks the first present dotted path", () => {
  const obj = { meta: { batch_size: 4 }, payload: { ranking_llm_calls: 0 } };
  assert.equal(firstDefined(obj, ["batch_size", "meta.batch_size"]), 4);
  assert.equal(firstDefined(obj, ["ranking_llm_calls", "payload.ranking_llm_calls"]), 0);
  assert.equal(firstDefined(obj, ["nope", "also.missing"]), undefined);
  assert.equal(firstDefined(obj, []), undefined);
});

// --- helpers ---
function createSha12(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
