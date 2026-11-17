// L9_META: layer=test_support, role=e2e_replay_fixture_sealer, status=active, version=1.0.0
//
// Regenerates the sealed SEO-Bot build-intelligence responses under
// fixtures/replay/seo-bot/ from the inputs written out below. The replay test
// serves those files byte-for-byte; this script exists so a reviewer can see
// exactly how each sealed artifact was derived, and so a contract change in
// @quantum-l9/bot-interop can be re-sealed instead of hand-edited.
//
//   npx tsx tests/e2e-replay/seal-seo-bot-fixtures.ts && npx @biomejs/biome format --write fixtures/replay
//
// Every value is invented for the fixture business in
// fixtures/replay/replay-spec.yaml; none is a recorded production payload.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CompetitiveLandscapeArtifact,
  refForArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
} from "@quantum-l9/bot-interop";

export const REPLAY_CLIENT_ID = "replay-plumbing";
export const REPLAY_BUILD_ID = "replay-build";
const PRODUCED_AT = "2026-11-17T00:00:00.000Z";
const PRODUCER = { repo: "SEO-Bot", version: "2.1.0" } as const;
const OUT = join("fixtures", "replay", "seo-bot");

const QUERIES = [
  { query_id: "q-1", query: "plumber raleigh nc", intent: "commercial" as const, weight: 1 },
  { query_id: "q-2", query: "drain cleaning raleigh", intent: "commercial" as const, weight: 1 },
];
/** Reserved `.example` domains: the replay preload serves them from a fixture page. */
const DONORS = Array.from({ length: 10 }, (_, index) => `donor-${index}.plumbing.example`);

function landscape(): CompetitiveLandscapeArtifact {
  const observations = DONORS.flatMap((domain, index) =>
    QUERIES.map((query) => ({
      observation_id: `obs-${query.query_id}-${domain}`,
      query_id: query.query_id,
      rank: index + 1,
      url: `https://${domain}/services`,
      domain,
      observed_at: PRODUCED_AT,
      source: "dataforseo" as const,
    })),
  );
  return sealIntelligenceArtifact({
    artifact_type: "competitive_landscape",
    client_id: REPLAY_CLIENT_ID,
    build_id: REPLAY_BUILD_ID,
    producer: PRODUCER,
    produced_at: PRODUCED_AT,
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.competitiveLandscape,
      market: {
        niche: "plumbing",
        country: "US",
        language: "English",
        device: "desktop" as const,
        location_name: "North Carolina,United States",
      },
      query_portfolio: QUERIES,
      observations,
      domains: DONORS.map((domain, index) => ({
        domain,
        aggregate_visibility: DONORS.length - index,
        qualifying_query_ids: QUERIES.map((query) => query.query_id),
        observation_ids: QUERIES.map((query) => `obs-${query.query_id}-${domain}`),
      })),
      selected_donors: DONORS.map((domain, index) => ({
        domain,
        aggregate_visibility: DONORS.length - index,
        observation_ids: QUERIES.map((query) => `obs-${query.query_id}-${domain}`),
      })),
      exclusions: [],
      evidence_complete: true,
      ranking_llm_calls: 0,
    },
  });
}

function write(name: string, method: string, path: string, body: unknown): void {
  writeFileSync(
    join(OUT, name),
    `${JSON.stringify({ method, path, status: 200, body }, null, 2)}\n`,
    "utf-8",
  );
}

function seoRoute(routeId: string, primaryQuery: string, slot: "primary_offer" | "conversion") {
  return {
    route_id: routeId,
    path: routeId,
    search_intent: {
      primary: "hire a local plumber",
      secondary: [],
      journey_stage: "transactional" as const,
    },
    targets: {
      primary_query: primaryQuery,
      supporting_queries: [],
      topics: ["same-day service"],
      entities: ["Replay Plumbing Co"],
    },
    requirements: [
      {
        requirement_id: `req-${routeId}-${slot}`,
        target_slots: [slot],
        placement: "FIRST_MATCH" as const,
        required_topics: ["same-day service"],
        required_entities: [],
        questions: [],
        proof_needed: [],
        required: true,
      },
    ],
    competitive_gaps: [],
    internal_links: [],
    aeo_geo: { answer_targets: [], schema_requirements: [] },
    metadata: { title_requirements: ["mention plumbing"], description_requirements: [] },
    forbidden_claims: [],
    acceptance_tests: [],
  };
}

function seoContentBlueprint() {
  const competitiveLandscape = landscape();
  return sealIntelligenceArtifact({
    artifact_type: "seo_content_blueprint",
    client_id: REPLAY_CLIENT_ID,
    build_id: REPLAY_BUILD_ID,
    producer: PRODUCER,
    produced_at: PRODUCED_AT,
    input_refs: [refForArtifact(competitiveLandscape)],
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.seoContentBlueprint,
      competitive_landscape_ref: refForArtifact(competitiveLandscape),
      batch_size: 4,
      batch_count: 1,
      routes: [
        seoRoute("/", "plumber raleigh nc", "primary_offer"),
        seoRoute("/contact", "drain cleaning raleigh", "conversion"),
      ],
    },
  });
}

/**
 * The structured-content response is the one SEO-Bot artifact whose input is
 * computed by Website-Bot in-run (the sealed PageContentContract). Like the
 * real producer, the replay server binds `page_content_contract_ref` from the
 * request and seals at serve time, so this fixture carries the unsealed
 * payload and the seal header separately.
 */
function structuredContentTemplate() {
  return {
    method: "POST",
    path: "/api/build-intelligence/structured-content",
    status: 200,
    bind: "page_content_contract",
    seal: {
      artifact_type: "structured_content_package",
      client_id: REPLAY_CLIENT_ID,
      build_id: REPLAY_BUILD_ID,
      producer: PRODUCER,
      produced_at: PRODUCED_AT,
    },
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.structuredContentPackage,
      routes: [
        {
          route_id: "/",
          path: "/",
          metadata: {
            title: "Replay Plumbing Co | Same-Day Plumbing in Raleigh, NC",
            description:
              "Same-day plumbing repairs, drain cleaning and water heater service across Raleigh, NC. Request service online.",
          },
          sections: [
            {
              section_id: "hero",
              heading: "Same-Day Plumbing in Raleigh",
              subheading: "Licensed plumbers who show up when they say they will.",
              blocks: [
                {
                  kind: "paragraph",
                  text: "Replay Plumbing Co handles leaks, clogs and water heaters across Raleigh with same-day service.",
                },
              ],
              cta: { label: "Request service", action: "request_service" },
            },
            {
              section_id: "services",
              heading: "What we fix",
              blocks: [
                { kind: "bullets", items: ["Drain cleaning", "Leak repair", "Water heaters"] },
              ],
            },
            {
              section_id: "questions",
              heading: "Common questions",
              blocks: [
                {
                  kind: "paragraph",
                  text: "Answers to the questions Raleigh homeowners ask before booking a plumber.",
                },
              ],
            },
          ],
          faqs: [
            {
              question: "Do you offer same-day service?",
              answer: "Yes. Most Raleigh calls received before noon are scheduled the same day.",
            },
          ],
          internal_links: [
            { target_route_id: "/contact", anchor_text: "Request plumbing service" },
          ],
          schema_content_inputs: { faq: true, service: true, local_business: true },
        },
        {
          route_id: "/contact",
          path: "/contact",
          metadata: {
            title: "Contact Replay Plumbing Co | Raleigh, NC Plumbers",
            description:
              "Tell us what needs fixing and a Raleigh plumber will follow up with a same-day appointment window.",
          },
          sections: [
            {
              section_id: "form",
              heading: "Request plumbing service",
              blocks: [
                {
                  kind: "paragraph",
                  text: "Tell us what needs fixing and we will follow up the same day.",
                },
              ],
            },
          ],
          faqs: [],
          internal_links: [{ target_route_id: "/", anchor_text: "Back to Replay Plumbing Co" }],
          schema_content_inputs: { local_business: true },
        },
      ],
      validation: {
        seo_blueprint_passed: true,
        contract_passed: true,
        unsupported_claims: [],
        failed_requirements: [],
      },
      route_evidence: ["/", "/contact"].map((route_id) => ({
        route_id,
        repair_attempts: 0,
        generation_calls: 1,
        validation_calls: 1,
        schema_errors: 0,
      })),
    },
  };
}

write(
  "03-competitive-landscape.json",
  "POST",
  "/api/build-intelligence/competitive-landscape",
  landscape(),
);
write(
  "04-seo-content-blueprint.json",
  "POST",
  "/api/build-intelligence/seo-content-blueprint",
  seoContentBlueprint(),
);
writeFileSync(
  join(OUT, "05-structured-content.json"),
  `${JSON.stringify(structuredContentTemplate(), null, 2)}\n`,
  "utf-8",
);
