// L9_META: layer=test, role=seo_build_intelligence_port, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  refForArtifact,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
  type ArtifactRef,
  type CompetitiveLandscapeV1,
  type WebsiteBuildBlueprintV1,
} from '@quantum-l9/bot-interop';
import { assertWebsiteBlueprintLandscape } from '../../src/intelligence/SeoBuildIntelligencePort.js';

function landscapeArtifact() {
  const payload: CompetitiveLandscapeV1 = {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.competitiveLandscape,
    market: { niche: 'scrap-metal', country: 'US', language: 'en', device: 'desktop' },
    query_portfolio: [],
    observations: [],
    domains: [],
    selected_donors: [],
    exclusions: [],
    evidence_complete: true,
  };
  return sealIntelligenceArtifact({
    artifact_type: 'competitive_landscape',
    client_id: 'client-1',
    build_id: 'build-1',
    producer: { repo: 'SEO-Bot', version: '2.1.0' },
    produced_at: '2026-08-14T00:00:00.000Z',
    input_refs: [],
    payload,
  });
}

function websiteBlueprint(landscapeRef: ArtifactRef) {
  const payload: WebsiteBuildBlueprintV1 = {
    schema: WEBSITE_INTELLIGENCE_SCHEMAS.websiteBuildBlueprint,
    build_intent: 'REDESIGN_IMPROVE',
    competitive_landscape_ref: landscapeRef,
    baseline_digest: 'b'.repeat(64),
    pattern_portfolio_digest: 'd'.repeat(64),
    strategy: { experience_attributes: [], differentiation: [], preserve: [], evolve: [], forbid: [] },
    content_guardrails: { forbidden_claims: [] },
    conversion: { primary_action: 'quote', secondary_actions: [], persistent_mobile_action: true },
    routes: [],
    acceptance_tests: [],
  };
  return sealIntelligenceArtifact({
    artifact_type: 'website_build_blueprint',
    client_id: 'client-1',
    build_id: 'build-1',
    producer: { repo: 'Website-Bot', version: '3.1.0' },
    produced_at: '2026-08-14T00:00:00.000Z',
    input_refs: [landscapeRef],
    payload,
  });
}

test('assertWebsiteBlueprintLandscape passes when the blueprint cites the same landscape', () => {
  const landscape = landscapeArtifact();
  const blueprint = websiteBlueprint(refForArtifact(landscape));
  assert.doesNotThrow(() => assertWebsiteBlueprintLandscape(blueprint, landscape));
});

test('assertWebsiteBlueprintLandscape fails closed on a different landscape', () => {
  const landscape = landscapeArtifact();
  const otherRef: ArtifactRef = {
    artifact_type: 'competitive_landscape',
    artifact_id: 'competitive_landscape:' + 'f'.repeat(64),
    payload_digest: 'f'.repeat(64),
  };
  const blueprint = websiteBlueprint(otherRef);
  assert.throws(
    () => assertWebsiteBlueprintLandscape(blueprint, landscape),
    /INTEL_INPUT_HASH_MISMATCH/,
  );
});
