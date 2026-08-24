#!/usr/bin/env node
/**
 * Fixture builder for the golden adapter's end-to-end test.
 *
 * Generates a complete, internally consistent run evidence tree under
 * build/golden-fixtures/ that simulates a GREEN REDESIGN_IMPROVE run:
 * evidence index, checkpoints, SQLite DB, per-build assets, donor evidence,
 * collector-persisted SEO-Bot evidence, a 29-route built site, and the
 * visual-oracle harness outputs. The generated receipt must satisfy the
 * verifier's field contract (this builder is the reference for the adapter's
 * end-to-end proof, not a mock of any product code).
 *
 * Also prints the empty-fixture directory it created (no evidence at all)
 * so the adapter's fail-closed behavior can be exercised.
 *
 *   node scripts/golden-safehaven/fixtures/build-fixtures.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

const ROOT = process.cwd();
const CASE = JSON.parse(fs.readFileSync(path.resolve("tests/golden/safehaven/case.json"), "utf8"));
const ROUTES = CASE.routes;
const BUILD_ID = "golden-fixture-001";
const CLIENT_ID = "safehaven";
const OUT = path.resolve("build", "golden-fixtures", BUILD_ID);
const EVIDENCE = path.join(OUT, "evidence");
const ASSETS = path.join(OUT, "assets");
const SITE = path.join(OUT, "site");
const DB_FILE = path.join(OUT, "website-bot.db");

function sha256Of(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}
function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}
function donorToken(domain) {
  return sha256Of(domain).slice(0, 12);
}

fs.rmSync(OUT, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// site dist (29 routes)
// ---------------------------------------------------------------------------
const ROUTE_TITLES = {
  "/": "Roofing & Renovation Experts in Charlotte, NC",
  "/services/": "Roofing & Renovation Services | Charlotte NC",
  "/services/roof-replacement/": "Roof Replacement in Charlotte NC",
  "/services/roof-repair/": "Roof Repair in Charlotte NC",
  "/services/roof-installation/": "Roof Installation in Charlotte NC",
  "/services/roof-inspection/": "Roof Inspection in Charlotte NC",
  "/services/storm-damage/": "Storm Damage Roof Repair | Charlotte NC",
  "/services/asphalt-shingles/": "Asphalt Shingle Roofing | Charlotte NC",
  "/services/metal-roofing/": "Metal Roofing in Charlotte NC",
  "/services/flat-roofing/": "Flat Roofing in Charlotte NC",
  "/services/gutters/": "Gutters & Gutter Guards | Charlotte NC",
  "/services/siding-fascia-soffit/": "Siding, Fascia & Soffit | Charlotte NC",
  "/services/interior-renovations/": "Interior Renovations | Charlotte NC",
  "/services/outdoor-living/": "Outdoor Living Spaces | Charlotte NC",
  "/service-areas/": "Service Areas | Charlotte NC",
  "/service-areas/charlotte/": "Roofing in Charlotte NC | Service Area",
  "/insurance-claims/": "Insurance Claims Roofing Help | Charlotte NC",
  "/guides/": "Roofing Guides | Charlotte NC",
  "/guides/repair-or-replace-roof-charlotte/": "Repair or Replace Your Roof? | Guide",
  "/guides/how-long-roof-replacement-takes-charlotte/": "How Long Roof Replacement Takes | Guide",
  "/guides/how-to-choose-roofing-contractor-charlotte/": "How to Choose a Roofing Contractor | Guide",
  "/guides/metal-roof-vs-shingles-charlotte/": "Metal Roof vs Shingles | Guide",
  "/guides/roof-replacement-cost-charlotte/": "Roof Replacement Cost | Guide",
  "/guides/storm-damage-roof-repair-charlotte/": "Storm Damage Roof Repair | Guide",
  "/about/": "About Safe Haven Roofing & Renovations",
  "/gallery/": "Roofing Project Gallery | Charlotte NC",
  "/faq/": "Roofing FAQ | Charlotte NC",
  "/contact/": "Contact Safe Haven Roofing & Renovations",
  "/privacy/": "Privacy Policy | Safe Haven Roofing & Renovations",
};
function titleFor(route) {
  return ROUTE_TITLES[route] ?? `Roofing in Charlotte NC | ${route}`;
}
function routeFile(route) {
  if (route === "/") return path.join(SITE, "index.html");
  return path.join(SITE, `${route.slice(1)}/index.html`);
}
const navLinks = ROUTES.map((r) => `<a href="${r}">link</a>`).join("");
for (const route of ROUTES) {
  const title = titleFor(route);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${title} — Safe Haven Roofing & Renovations serves Charlotte, NC.">
<link rel="canonical" href="https://candidate.example.com${route}">
</head>
<body>
<h1>${title}</h1>
<nav>${navLinks}</nav>
<p>Safe Haven Roofing &amp; Renovations — (704) 648-7252 — info@safehavenrr.com</p>
<p>Serving Charlotte, NC for 6 years with GAF, CertainTeed, and Atlas roofing systems.</p>
</body>
</html>
`;
  fs.mkdirSync(path.dirname(routeFile(route)), { recursive: true });
  fs.writeFileSync(routeFile(route), html);
}

// ---------------------------------------------------------------------------
// redesign-integrity-receipt (assets root)
// ---------------------------------------------------------------------------
const LANDSCAPE_ARTIFACT_ID = `competitive_landscape:${sha256Of("landscape-payload").slice(0, 32)}`;
const LANDSCAPE_PAYLOAD_DIGEST = sha256Of("landscape-payload");
const BLUEPRINT_ARTIFACT_ID = `seo_content_blueprint:${sha256Of("blueprint-payload").slice(0, 32)}`;
const BLUEPRINT_PAYLOAD_DIGEST = sha256Of("blueprint-payload");
const PCC_ARTIFACT_ID = `page_content_contract:${sha256Of("pcc-payload").slice(0, 32)}`;
const PCC_PAYLOAD_DIGEST = sha256Of("pcc-payload");
const STRUCTURED_ARTIFACT_ID = `structured_content_package:${sha256Of("structured-payload").slice(0, 32)}`;
const STRUCTURED_PAYLOAD_DIGEST = sha256Of("structured-payload");

writeJson(path.join(ASSETS, "redesign-integrity-receipt.json"), {
  schema: "website-bot.redesign-execution-integrity-receipt/v1",
  build_id: BUILD_ID,
  client_id: CLIENT_ID,
  mode: "end-to-end",
  build_intent: "REDESIGN_IMPROVE",
  executed_stages: [
    "domain-spec-loader",
    "unknown-resolver",
    "seo-build-intelligence-preflight",
    "competitive-intelligence",
    "source-site-ingestion",
    "design-intelligence",
    "redesign-content-authority",
    "structured-content-projection",
    "redesign-schema-serializer",
    "image-asset-planning",
    "image-generation",
    "placeholder-scan",
    "site-assembler",
    "image-validation",
    "posthog-snippet",
    "site-build",
    "client-source-publish",
    "vercel-deploy",
    "release-receipt",
    "seo-baseline",
    "visual-qa",
    "release-receipt-finalizer",
    "handoff-emitter",
    "redesign-integrity-receipt",
    "terminal-convergence",
  ],
  competitive_landscape: { artifact_id: LANDSCAPE_ARTIFACT_ID, payload_digest: LANDSCAPE_PAYLOAD_DIGEST },
  qualified_donor_count: 10,
  donors: [
    "charlotte-roofmasters.com",
    "carolinaexteriorsnc.com",
    "queencityroofing.com",
    "piedmontroofpros.com",
    "metrolinaroofing.com",
    "lakewylieroofing.com",
    "concordroofco.com",
    "ballantynebuilders.com",
    "gastoniaroofing.com",
    "southparkroofs.com",
  ],
  seo_content_blueprint: { artifact_id: BLUEPRINT_ARTIFACT_ID, payload_digest: BLUEPRINT_PAYLOAD_DIGEST },
  page_content_contract: { artifact_id: PCC_ARTIFACT_ID, payload_digest: PCC_PAYLOAD_DIGEST },
  structured_content_package: { artifact_id: STRUCTURED_ARTIFACT_ID, payload_digest: STRUCTURED_PAYLOAD_DIGEST },
  counters: {
    page_content_contract_llm_calls: 0,
    legacy_content_generation_calls: 0,
    redesign_schema_llm_calls: 0,
  },
  visual: {
    required_slots: 4,
    required_slots_filled: 4,
    required_visual_slots_filled_pct: 100,
    source_assets_discovered: 12,
    source_assets_selected: 3,
    source_assets_rejected: 9,
    unexplained_asset_loss: 0,
  },
  visual_qa: { status: "passed" },
  seo_bot_ordering: {
    preflight_produced_at: "2026-08-24T10:00:00.000Z",
    landscape_produced_at: "2026-08-24T10:05:00.000Z",
  },
  emitted_at: "2026-08-24T12:00:00.000Z",
});

// ---------------------------------------------------------------------------
// website-build-blueprint + page-content-contract (wrapper-persisted artifacts)
// ---------------------------------------------------------------------------
writeJson(path.join(ASSETS, "intelligence", "website-build-blueprint.json"), {
  protocol: "l9.website-intelligence",
  protocol_version: "1.0",
  artifact_type: "website_build_blueprint",
  artifact_id: `website_build_blueprint:${sha256Of("wbb").slice(0, 32)}`,
  client_id: CLIENT_ID,
  build_id: BUILD_ID,
  producer: { repo: "Website-Bot", version: "3.1.0" },
  produced_at: "2026-08-24T12:00:00.000Z",
  input_refs: [{ artifact_type: "competitive_landscape", artifact_id: LANDSCAPE_ARTIFACT_ID, payload_digest: LANDSCAPE_PAYLOAD_DIGEST }],
  payload: {
    schema: "l9://website-intelligence/website-build-blueprint/v1",
    build_intent: "REDESIGN_IMPROVE",
    competitive_landscape_ref: {
      artifact_type: "competitive_landscape",
      artifact_id: LANDSCAPE_ARTIFACT_ID,
      payload_digest: LANDSCAPE_PAYLOAD_DIGEST,
    },
    baseline_digest: sha256Of("baseline").slice(0, 32),
    pattern_portfolio_digest: sha256Of("patterns").slice(0, 32),
    strategy: { experience_attributes: [], differentiation: [], preserve: [], evolve: [], forbid: [] },
    content_guardrails: { forbidden_claims: [] },
    conversion: { primary_action: "Call (704) 648-7252", secondary_actions: [], persistent_mobile_action: true },
    routes: ROUTES.map((r) => ({ route_id: r, path: r, purpose: "frozen case route", sections: [] })),
    visual_requirements: [
      { requirement_id: "vr-hero", route_id: "/", section_id: "hero", slot_id: "hero-1", role: "hero", required: true, min_count: 1, preferred_provenance: ["source", "generated"], device_suitability: ["desktop", "mobile"] },
      { requirement_id: "vr-gallery", route_id: "/gallery/", section_id: "gallery", slot_id: "gallery-1", role: "gallery", required: true, min_count: 4, preferred_provenance: ["source", "generated"], device_suitability: ["desktop", "mobile"] },
    ],
    acceptance_tests: [],
  },
  integrity: { algorithm: "sha256", payload_digest: sha256Of("wbb-payload") },
});

writeJson(path.join(ASSETS, "intelligence", "page-content-contract.json"), {
  protocol: "l9.website-intelligence",
  protocol_version: "1.0",
  artifact_type: "page_content_contract",
  artifact_id: PCC_ARTIFACT_ID,
  client_id: CLIENT_ID,
  build_id: BUILD_ID,
  producer: { repo: "Website-Bot", version: "3.1.0" },
  produced_at: "2026-08-24T12:00:00.000Z",
  input_refs: [{ artifact_type: "seo_content_blueprint", artifact_id: BLUEPRINT_ARTIFACT_ID, payload_digest: BLUEPRINT_PAYLOAD_DIGEST }],
  payload: {
    schema: "l9://website-intelligence/page-content-contract/v1",
    compiler: { name: "website-content-contract-compiler", version: "1.0.0", warnings: [] },
    inputs: {
      website_build_blueprint: { artifact_type: "website_build_blueprint", artifact_id: "x", payload_digest: "y" },
      seo_content_blueprint: { artifact_type: "seo_content_blueprint", artifact_id: BLUEPRINT_ARTIFACT_ID, payload_digest: BLUEPRINT_PAYLOAD_DIGEST },
      business_facts_digest: sha256Of("facts"),
    },
    routes: ROUTES.map((r) => ({ route_id: r, path: r, purpose: "frozen case route", sections: [] })),
    unplaced_requirements: 0,
    invalid_business_facts: 0,
    // ORACLE determinism: the sealed PCC persists both semantic digests so the
    // verifier can compare run-to-run determinism.
    determinism: {
      digest_run_1: sha256Of("pcc-semantic-v1").slice(0, 32),
      digest_run_2: sha256Of("pcc-semantic-v1").slice(0, 32),
    },
  },
  integrity: { algorithm: "sha256", payload_digest: PCC_PAYLOAD_DIGEST },
});

// ---------------------------------------------------------------------------
// donor evidence (10 donors, 1 page + 1 screenshot each)
// ---------------------------------------------------------------------------
const DONOR_DOMAINS = [
  "charlotte-roofmasters.com",
  "carolinaexteriorsnc.com",
  "queencityroofing.com",
  "piedmontroofpros.com",
  "metrolinaroofing.com",
  "lakewylieroofing.com",
  "concordroofco.com",
  "ballantynebuilders.com",
  "gastoniaroofing.com",
  "southparkroofs.com",
];
const donorScreenshotHashes = [];
for (let i = 0; i < DONOR_DOMAINS.length; i++) {
  const domain = DONOR_DOMAINS[i];
  const dir = path.join(ASSETS, "donor-evidence", donorToken(domain));
  const screenshot = path.join(dir, "screenshots", `${sha256Of(`shot-${domain}`).slice(0, 12)}.png`);
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.writeFileSync(screenshot, Buffer.from(`donor screenshot fixture ${domain}`, "utf8"));
  donorScreenshotHashes.push(sha256File(screenshot));
  const pages = [
    { url: `https://${domain}/`, status: 200, content_digest: sha256Of(`page-${domain}`), content_bytes: 2048, fetched_at: "2026-08-20T10:00:00.000Z" },
  ];
  writeJson(path.join(dir, "crawl-manifest.json"), {
    schema: "website-bot.donor-evidence/v1",
    domain,
    serp_observation_ids: [`obs-${i + 1}`],
    pages,
    screenshot_paths: [`screenshots/${path.basename(screenshot)}`],
    crawl_manifest_path: path.join(dir, "crawl-manifest.json"),
    evidence_digest: sha256Of(JSON.stringify({ pages, screenshot_paths: [screenshot] })),
    crawled_at: "2026-08-20T10:05:00.000Z",
    disposition: "DONOR_REFERENCE_ONLY",
  });
}

// ---------------------------------------------------------------------------
// collector-persisted SEO-Bot evidence
// ---------------------------------------------------------------------------
const SEO_DIR = path.join(EVIDENCE, "seo-bot");
const observations = [];
const selectedDonors = [];
for (let i = 0; i < 10; i++) {
  const domain = DONOR_DOMAINS[i];
  observations.push({
    observation_id: `obs-${i + 1}`,
    query_id: `q-${(i % 4) + 1}`,
    rank: i + 1,
    url: `https://${domain}/`,
    domain,
    observed_at: "2026-08-20T09:00:00.000Z",
    source: "dataforseo",
  });
  selectedDonors.push({ domain, aggregate_visibility: 10 + i, observation_ids: [`obs-${i + 1}`] });
}
const landscapeArtifact = {
  protocol: "l9.website-intelligence",
  protocol_version: "1.0",
  artifact_type: "competitive_landscape",
  artifact_id: LANDSCAPE_ARTIFACT_ID,
  client_id: CLIENT_ID,
  build_id: BUILD_ID,
  producer: { repo: "SEO-Bot", version: "2.4.0" },
  produced_at: "2026-08-24T11:30:00.000Z",
  input_refs: [],
  payload: {
    schema: "l9://website-intelligence/competitive-landscape/v1",
    market: { niche: "roofing", country: "US", language: "en", device: "desktop", location_name: "Charlotte, NC" },
    query_portfolio: [
      { query_id: "q-1", query: "roofing companies charlotte nc", intent: "local", weight: 1 },
      { query_id: "q-2", query: "roof repair charlotte", intent: "commercial", weight: 1 },
      { query_id: "q-3", query: "roof replacement charlotte nc", intent: "commercial", weight: 1 },
      { query_id: "q-4", query: "storm damage roof repair charlotte", intent: "transactional", weight: 1 },
    ],
    observations,
    domains: selectedDonors.map((d) => ({ ...d, qualifying_query_ids: ["q-1"] })),
    selected_donors: selectedDonors,
    exclusions: [],
    evidence_complete: true,
    ranking_llm_calls: 0,
  },
  integrity: { algorithm: "sha256", payload_digest: LANDSCAPE_PAYLOAD_DIGEST },
};
writeJson(path.join(SEO_DIR, "competitive-landscape.json"), landscapeArtifact);

const blueprintArtifact = {
  protocol: "l9.website-intelligence",
  protocol_version: "1.0",
  artifact_type: "seo_content_blueprint",
  artifact_id: BLUEPRINT_ARTIFACT_ID,
  client_id: CLIENT_ID,
  build_id: BUILD_ID,
  producer: { repo: "SEO-Bot", version: "2.4.0" },
  produced_at: "2026-08-24T11:31:00.000Z",
  input_refs: [{ artifact_type: "competitive_landscape", artifact_id: LANDSCAPE_ARTIFACT_ID, payload_digest: LANDSCAPE_PAYLOAD_DIGEST }],
  payload: {
    schema: "l9://website-intelligence/seo-content-blueprint/v1",
    competitive_landscape_ref: {
      artifact_type: "competitive_landscape",
      artifact_id: LANDSCAPE_ARTIFACT_ID,
      payload_digest: LANDSCAPE_PAYLOAD_DIGEST,
    },
    routes: ROUTES.map((r) => ({
      route_id: r,
      path: r,
      search_intent: { primary: "commercial", secondary: [], journey_stage: "commercial" },
      targets: { primary_query: titleFor(r), supporting_queries: [], topics: [], entities: [] },
      requirements: [],
      competitive_gaps: [],
      internal_links: [],
      aeo_geo: { answer_targets: [], schema_requirements: [] },
      metadata: { title_requirements: [], description_requirements: [] },
      forbidden_claims: [],
      acceptance_tests: [],
    })),
    batch_size: 4,
    batch_count: 8,
    unknown_content_slots: 0,
    invalid_internal_link_targets: 0,
  },
  integrity: { algorithm: "sha256", payload_digest: BLUEPRINT_PAYLOAD_DIGEST },
};
writeJson(path.join(SEO_DIR, "seo-content-blueprint.json"), blueprintArtifact);

const structuredArtifact = {
  protocol: "l9.website-intelligence",
  protocol_version: "1.0",
  artifact_type: "structured_content_package",
  artifact_id: STRUCTURED_ARTIFACT_ID,
  client_id: CLIENT_ID,
  build_id: BUILD_ID,
  producer: { repo: "SEO-Bot", version: "2.4.0" },
  produced_at: "2026-08-24T11:40:00.000Z",
  input_refs: [{ artifact_type: "page_content_contract", artifact_id: PCC_ARTIFACT_ID, payload_digest: PCC_PAYLOAD_DIGEST }],
  payload: {
    schema: "l9://website-intelligence/structured-content-package/v1",
    page_content_contract_ref: {
      artifact_type: "page_content_contract",
      artifact_id: PCC_ARTIFACT_ID,
      payload_digest: PCC_PAYLOAD_DIGEST,
    },
    routes: ROUTES.map((r) => ({
      route_id: r,
      path: r,
      metadata: { title: titleFor(r), description: `${titleFor(r)} — Charlotte NC roofing.` },
      sections: [
        { section_id: "s1", heading: titleFor(r), blocks: [{ kind: "paragraph", text: `Safe Haven Roofing & Renovations serves ${r}` }] },
      ],
      faqs: [],
      internal_links: [],
      schema_content_inputs: { service: true, local_business: true },
      route_evidence: {
        repair_attempts: 0,
        generation_calls: 1,
        schema_errors: 0,
        unsupported_claims: 0,
        failed_requirements: 0,
        prose_without_blocks: 0,
        section_alias_fields: [],
      },
    })),
    validation: {
      seo_blueprint_passed: true,
      contract_passed: true,
      unsupported_claims: [],
      failed_requirements: [],
    },
  },
  integrity: { algorithm: "sha256", payload_digest: STRUCTURED_PAYLOAD_DIGEST },
};
writeJson(path.join(SEO_DIR, "structured-content.json"), structuredArtifact);

writeJson(path.join(SEO_DIR, "preflight.json"), {
  status: "ready",
  service: "seo-bot",
  version: "2.4.0",
  bot_interop_version: "1.2.0",
  llm_router_version: "1.3.0",
  capabilities: { competitive_landscape: true, seo_content_blueprint: true, structured_content: true },
  configuration: { dataforseo_configured: true, llm_provider_configured: true },
  sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  direct_provider_bypass_count: 0,
  unsupported_capability_combination_count: 0,
  operations: {
    SEO_CONTENT_BLUEPRINT: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
    STRUCTURED_CONTENT_GENERATION: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
    CONTENT_VALIDATION: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
    VISUAL_QA: [{ searchRequired: false, searchPolicySource: "EXPLICIT" }],
  },
});
writeJson(path.join(SEO_DIR, "identity-snapshot.json"), {
  schema: "website-bot.golden-identity-snapshot/v1",
  captured_at: "2026-08-24T12:01:00.000Z",
  website_bot: { sha: "0123456789abcdef0123456789abcdef01234567", worktree_state: "CLEAN", package_version: "3.1.0" },
  llm_router: { package_version: "1.3.0", sha: "f0e1d2c3b4a5968778695a4b3c2d1e0f12345678", worktree_state: "CLEAN" },
  bot_interop: { website_bot_version: "1.2.0" },
  seo_bot: { sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", checkout_dir: null, worktree_state: "CLEAN" },
});
writeJson(path.join(SEO_DIR, "fetch-meta.json"), {
  health: { endpoint: "/health", http_status: 200, ok: true, reached: true },
  preflight: { endpoint: "/api/build-intelligence/preflight", http_status: 200, ok: true, reached: true },
  "competitive-landscape": { endpoint: "/api/build-intelligence/competitive-landscape", http_status: 200, ok: true, reached: true },
  "seo-content-blueprint": { endpoint: "/api/build-intelligence/seo-content-blueprint", http_status: 200, ok: true, reached: true },
  "structured-content": { endpoint: "/api/build-intelligence/structured-content", http_status: 200, ok: true, reached: true },
});
writeJson(path.join(SEO_DIR, "sequence.json"), {
  schema: "website-bot.golden-seo-bot-collection/v1",
  client_id: CLIENT_ID,
  build_id: BUILD_ID,
  collected_at: "2026-08-24T12:01:00.000Z",
  entries: [
    { endpoint: "identity-snapshot", file: "identity-snapshot.json", status: "PASS" },
    { endpoint: "health", file: "health.json", status: "PASS", http_status: 200 },
    { endpoint: "preflight", file: "preflight.json", status: "PASS", http_status: 200 },
    { endpoint: "competitive-landscape", file: "competitive-landscape.json", status: "PASS", http_status: 200 },
    { endpoint: "seo-content-blueprint", file: "seo-content-blueprint.json", status: "PASS", http_status: 200 },
    { endpoint: "structured-content", file: "structured-content.json", status: "PASS", http_status: 200 },
  ],
  missing_producers: [],
});

// ---------------------------------------------------------------------------
// evidence store root files + index
// ---------------------------------------------------------------------------
writeJson(path.join(EVIDENCE, "source-site-manifest.json"), {
  schema: "website-bot.source-site-manifest/v1",
  build_id: BUILD_ID,
  client_id: CLIENT_ID,
  source_url: CASE.source_url,
  images: Array.from({ length: 12 }, (_, i) => ({
    url: `${CASE.source_url}/images/project-${i + 1}.jpg`,
    path: `images/project-${i + 1}.jpg`,
    width: 1200,
    height: 800,
    format: "jpeg",
    byte_length: 100000 + i,
    sha256: sha256Of(`source-img-${i + 1}`),
    discovered_at: "2026-08-24T10:00:00.000Z",
  })),
  title: "Safe Haven Roofing & Renovations",
  captured_at: "2026-08-24T10:00:00.000Z",
});
writeJson(path.join(EVIDENCE, "image-asset-manifest.json"), {
  schema: "website-bot.image-asset-manifest/v1",
  buildId: BUILD_ID,
  clientId: CLIENT_ID,
  generatedAt: "2026-08-24T11:50:00.000Z",
  assets: [
    { slotId: "hero-1", placement: "/", role: "hero", source: "source-site", sourceUrl: `${CASE.source_url}/images/project-1.jpg`, originalPath: "images/project-1.jpg", outputPath: "images/hero-1.jpg", mimeType: "image/jpeg", width: 1200, height: 800, byteLength: 100001, sha256: sha256Of("selected-hero"), disposition: "approved-client-owned", provenanceWarnings: [] },
    { slotId: "gallery-1", placement: "/gallery/", role: "gallery", source: "source-site", sourceUrl: `${CASE.source_url}/images/project-2.jpg`, originalPath: "images/project-2.jpg", outputPath: "images/gallery-1.jpg", mimeType: "image/jpeg", width: 1200, height: 800, byteLength: 100002, sha256: sha256Of("selected-gallery"), disposition: "approved-client-owned", provenanceWarnings: [] },
    { slotId: "proof-1", placement: "/services/", role: "project-proof", source: "generated", outputPath: "images/proof-1.jpg", mimeType: "image/jpeg", width: 1200, height: 800, byteLength: 100004, sha256: sha256Of("generated-proof"), promptHash: sha256Of("proof-prompt").slice(0, 16), model: "fixture", estimatedCostUsd: 0.01, disposition: "reference-only", provenanceWarnings: [] },
    { slotId: "about-1", placement: "/about/", role: "about", source: "generated", outputPath: "images/about-1.jpg", mimeType: "image/jpeg", width: 1200, height: 800, byteLength: 100003, sha256: sha256Of("generated-about"), promptHash: sha256Of("prompt").slice(0, 16), model: "fixture", estimatedCostUsd: 0.01, disposition: "reference-only", provenanceWarnings: [] },
  ],
  digest: sha256Of("image-manifest"),
});

// evidence index (digests computed from the written files)
const indexArtifacts = [];
for (const rel of ["source-site-manifest.json", "image-asset-manifest.json"]) {
  const abs = path.join(EVIDENCE, rel);
  indexArtifacts.push({
    kind: "evidence",
    schema: "website-bot.evidence-file/v1",
    logical_id: `${BUILD_ID}:${rel}`,
    relative_path: rel,
    sha256: sha256File(abs),
    written_at: "2026-08-24T12:00:00.000Z",
  });
}
writeJson(path.join(EVIDENCE, "evidence-index.json"), {
  schema: "website-bot.evidence-index/v2",
  build_id: BUILD_ID,
  client_id: CLIENT_ID,
  artifacts: indexArtifacts,
  index_revision: 1,
  updated_at: "2026-08-24T12:00:00.000Z",
});

// checkpoints (executed stage records)
const STAGES = [
  "domain-spec-loader",
  "unknown-resolver",
  "seo-build-intelligence-preflight",
  "competitive-intelligence",
  "source-site-ingestion",
  "design-intelligence",
  "redesign-content-authority",
  "structured-content-projection",
  "redesign-schema-serializer",
  "image-asset-planning",
  "image-generation",
  "placeholder-scan",
  "site-assembler",
  "image-validation",
  "posthog-snippet",
  "site-build",
  "client-source-publish",
  "vercel-deploy",
  "release-receipt",
  "seo-baseline",
  "visual-qa",
  "release-receipt-finalizer",
  "handoff-emitter",
  "redesign-integrity-receipt",
  "terminal-convergence",
];
for (let i = 0; i < STAGES.length; i++) {
  const stage = STAGES[i];
  writeJson(path.join(EVIDENCE, "checkpoints", `${stage}.json`), {
    schema: "website-bot.stage-checkpoint/v2",
    build_id: BUILD_ID,
    client_id: CLIENT_ID,
    stage,
    status: "passed",
    attempt: 1,
    started_at: `2026-08-24T10:${String(i).padStart(2, "0")}:00.000Z`,
    completed_at: `2026-08-24T10:${String(i).padStart(2, "0")}:30.000Z`,
    input_evidence: [],
    output_evidence: [],
  });
}

// ---------------------------------------------------------------------------
// SQLite DB
// ---------------------------------------------------------------------------
if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
const db = new Database(DB_FILE);
db.exec(`
  CREATE TABLE builds (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL, completed_at TEXT, deploy_url TEXT, dry_run INTEGER NOT NULL DEFAULT 0,
    error_code TEXT, error_msg TEXT
  );
  CREATE TABLE stage_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, build_id TEXT NOT NULL REFERENCES builds(id),
    stage_name TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER, error_msg TEXT, ran_at TEXT NOT NULL
  );
  CREATE TABLE llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, build_id TEXT NOT NULL REFERENCES builds(id),
    stage TEXT NOT NULL, task_type TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, recorded_at TEXT NOT NULL
  );
  CREATE TABLE evidence_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, build_id TEXT NOT NULL REFERENCES builds(id), client_id TEXT NOT NULL,
    kind TEXT NOT NULL, schema_id TEXT NOT NULL, logical_id TEXT NOT NULL, relative_path TEXT NOT NULL,
    sha256 TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(build_id, kind), UNIQUE(logical_id)
  );
  CREATE TABLE evidence_chain_status (
    build_id TEXT PRIMARY KEY REFERENCES builds(id), client_id TEXT NOT NULL, mode TEXT NOT NULL,
    status TEXT NOT NULL, last_successful_stage TEXT, failed_stage TEXT, evidence_index_path TEXT NOT NULL,
    index_revision INTEGER NOT NULL, updated_at TEXT NOT NULL
  );
`);
db.prepare("INSERT INTO builds (id, client_id, status, started_at, completed_at, deploy_url, dry_run) VALUES (?,?,?,?,?,?,0)").run(
  BUILD_ID,
  CLIENT_ID,
  "completed",
  "2026-08-24T10:00:00.000Z",
  "2026-08-24T12:00:00.000Z",
  "https://candidate.example.com",
);
const insertStage = db.prepare("INSERT INTO stage_runs (build_id, stage_name, status, duration_ms, error_msg, ran_at) VALUES (?,?,?,?,?,?)");
STAGES.forEach((stage, i) => {
  insertStage.run(BUILD_ID, stage, "ok", 1000 + i, null, `2026-08-24T10:${String(i).padStart(2, "0")}:00.000Z`);
});
const insertUsage = db.prepare("INSERT INTO llm_usage (build_id, stage, task_type, model, input_tokens, output_tokens, cost_usd, recorded_at) VALUES (?,?,?,?,?,?,?,?)");
insertUsage.run(BUILD_ID, "redesign-content-authority", "WEBSITE_BLUEPRINT", "fixture-router/1.3.0", 1000, 2000, 0.01, "2026-08-24T10:05:00.000Z");
insertUsage.run(BUILD_ID, "redesign-schema-serializer", "STRUCTURED_CONTENT_GENERATION", "fixture-router/1.3.0", 500, 1000, 0.005, "2026-08-24T10:07:00.000Z");
db.close();

// ---------------------------------------------------------------------------
// visual-oracle harness outputs (10 pairs x 3 trials, all candidate wins)
// ---------------------------------------------------------------------------
const VISUAL_DIR = path.join(ASSETS, "visual-qa");
const sentinels = CASE.visual_sentinels.map((s) => s.route);
const pairs = [];
for (const route of sentinels) {
  for (const vp of CASE.viewports) {
    pairs.push({
      pair_id: `${route.replaceAll("/", "_").replace(/^_/, "") || "root"}__${vp.id}`,
      route,
      viewport: vp.id,
      critical: CASE.visual_sentinels.find((s) => s.route === route)?.critical ?? false,
      run_id: `fixture-run-${BUILD_ID}`,
      baseline: { file: "baseline/b.png", hash: sha256Of(`base-${route}-${vp.id}`), status: 200, final_route: route, blank: false },
      candidate: { file: "candidate/c.png", hash: sha256Of(`cand-${route}-${vp.id}`), status: 200, final_route: route, blank: false },
      route_match: true,
      viewport_match: true,
    });
  }
}
writeJson(path.join(VISUAL_DIR, "manifest.json"), {
  schema: "website-bot.golden-visual-capture/v1",
  run_id: `fixture-run-${BUILD_ID}`,
  pairs,
});
const trials = [];
// The oracle's ten configured dimensions (weights sum to 1.0) — every trial
// must carry a normalized_candidate_delta for ALL of them.
const DIMS = [
  "visual_hierarchy",
  "brand_coherence",
  "conversion_clarity",
  "trust_and_credibility",
  "authentic_imagery",
  "content_readability",
  "information_density",
  "spacing_and_rhythm",
  "mobile_usability",
  "professional_polish",
];
const JUDGE_INPUT_MANIFEST =
  "Two rendered pages are shown side by side; the judge selects the stronger page. Left-right order is randomized per trial.";
for (let p = 0; p < pairs.length; p++) {
  const pair = pairs[p];
  for (let t = 1; t <= 3; t++) {
    const orientation = t === 2 ? (p % 2 ? "A" : "B") : "A";
    const delta = {};
    for (const dim of DIMS) delta[dim] = 1;
    trials.push({
      trial_id: `${pair.pair_id}__trial${t}`,
      pair_id: pair.pair_id,
      route: pair.route,
      viewport: pair.viewport,
      run_id: pair.run_id,
      orientation,
      orientation_map: { A: "CANDIDATE", B: "BASELINE" },
      blind: true,
      judge_input_manifest: JUDGE_INPUT_MANIFEST,
      judge_json: { preference: "A", confidence: 0.95, dimensions: delta, critical_defects_a: [], critical_defects_b: [] },
      normalized_preference: "CANDIDATE",
      normalized_candidate_delta: delta,
      confidence: 0.95,
      defects: { a: [], b: [] },
    });
  }
}
writeJson(path.join(VISUAL_DIR, "normalized-results.json"), {
  schema: "l9.golden-visual-normalized/v1",
  run_id: `fixture-run-${BUILD_ID}`,
  trials,
});

// ---------------------------------------------------------------------------
// empty fixture (fail-closed test)
// ---------------------------------------------------------------------------
const EMPTY = path.resolve("build", "golden-fixtures", "empty");
fs.rmSync(EMPTY, { recursive: true, force: true });
fs.mkdirSync(path.join(EMPTY, "evidence"), { recursive: true });
fs.mkdirSync(path.join(EMPTY, "assets"), { recursive: true });
fs.mkdirSync(path.join(EMPTY, "site"), { recursive: true });

console.log(`fixtures -> ${OUT}`);
console.log(`empty fixture -> ${EMPTY}`);
console.log(`donor screenshot hashes: ${donorScreenshotHashes.length}`);
