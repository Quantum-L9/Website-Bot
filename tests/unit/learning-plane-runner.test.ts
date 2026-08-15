// L9_META: layer=test, role=campaign_runner, status=active, version=1.0.0
// Runner state machine: budgets, no-progress, terminal states, champion
// promotion, and resumability after process death.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteManifest, buildCampaignManifest, loadCampaignManifest } from '../../src/campaigns/campaign-manifest.js';
import { buildQualityDeltaIndex } from '../../src/campaigns/quality-delta-index.js';
import { buildQualityDimensionResult } from '../../src/campaigns/quality-dimension-result.js';
import { runCampaign } from '../../src/campaigns/runner.js';
import type { CampaignDeps } from '../../src/campaigns/types.js';
import { buildCandidateMutationPlan } from '../../src/campaigns/mutation-plan.js';
import type { CandidateMutationPlan, FailureFingerprint, QualityDeltaIndex } from '../../src/campaigns/types.js';

const CONTEXT = {
  vertical: 'roofing',
  market_model: 'local_service',
  conversion_model: 'lead_generation',
  consideration_level: 'high',
  service_complexity: 'medium',
  location_strategy: 'multi_location',
  trust_dependency: 'high',
  page_archetypes: ['homepage'],
  brand_maturity: 'medium',
  baseline_quality: 'low',
};

function dimension(candidate: string, dimensionName: string, verdict: 'IMPROVED' | 'REGRESSED' | 'NON_REGRESSED' | null, status: 'PASS' | 'FAIL' = 'PASS') {
  return buildQualityDimensionResult({
    dimension: dimensionName,
    candidate_id: candidate,
    campaign_id: 'fixture-001',
    verdict_vs_baseline: verdict,
    verdict_vs_champion: verdict,
    hard_gate: true,
    status,
  });
}

function indexFor(candidate: string, entries: Array<[string, 'IMPROVED' | 'REGRESSED' | 'NON_REGRESSED' | null, ('PASS' | 'FAIL')?]>): QualityDeltaIndex {
  return buildQualityDeltaIndex({
    campaign_id: 'fixture-001',
    candidate_id: candidate,
    results: entries.map(([dimensionName, verdict, status]) => dimension(candidate, dimensionName, verdict, status ?? 'PASS')),
  });
}

function plan(candidateId: string, primary: string): CandidateMutationPlan {
  return buildCandidateMutationPlan({
    candidate_id: candidateId,
    parent_candidate_id: 'C0',
    layer: 'DESIGN',
    target_paths: ['tokens.cta.primary.background'],
    forbidden_paths: ['WebsiteBuildBlueprint.routes'],
    unchanged_contract: ['PageContentContract'],
    primary_dimension: primary,
    guardrail_dimensions: ['visual.hierarchy'],
    expected_causal_path: ['stronger CTA distinction'],
    expected_effects: { [primary]: 'IMPROVED' },
    confidence_before: 0.63,
    inherited_artifacts: {},
    experimental_control: {
      inherited_exact: [{ artifact_type: 'WebsiteBuildBlueprint', artifact_id: 'WebsiteBuildBlueprint:wb1', payload_digest: 'wb1' }],
      changed: ['DesignArtifact'],
    },
    mutation_signature: {
      layer: 'DESIGN',
      archetype: 'homepage',
      component: 'hero',
      operation_class: 'INCREASE_PRIMARY_ACTION_SALIENCE',
      dimensions: { target: ['conversion.primary_cta'], guardrails: ['visual.hierarchy'] },
      context: { vertical: 'roofing', conversion_model: 'lead_generation', mobile_priority: 'high' },
    },
  });
}

const GOOD_C0: Array<[string, 'IMPROVED' | 'REGRESSED' | 'NON_REGRESSED' | null, ('PASS' | 'FAIL')?]> = [
  ['conversion.primary_cta', 'IMPROVED'],
  ['conversion.mobile_cta', 'IMPROVED'],
  ['conversion.trust_visibility', 'NON_REGRESSED'],
  ['visual.hierarchy', 'NON_REGRESSED'],
];

const NON_REVIEWABLE_C0: typeof GOOD_C0 = [
  ['conversion.primary_cta', 'REGRESSED'],
  ['visual.hierarchy', 'NON_REGRESSED'],
];

interface DepsBuilder {
  deps(records: Record<string, QualityDeltaIndex>): CampaignDeps;
}

/** In-memory deterministic deps: each candidate id maps to a QualityDeltaIndex. */
function memoryDeps(records: Record<string, QualityDeltaIndex>): CampaignDeps {
  return {
    async evaluateCandidate(candidateId) {
      const index = records[candidateId];
      if (!index) throw new Error(`no record for ${candidateId}`);
      return index;
    },
    async retrieveLearnings() {
      return [];
    },
    async proposeMutation({ failure }: { campaign: unknown; failure: FailureFingerprint; learnings: unknown[] }) {
      return plan('C1', failure.primary_dimension);
    },
    async buildIncrementally() {
      return { buildRef: null };
    },
    async runCheapestAdequateTests() {
      return { viable: true };
    },
  };
}

test('runner converges REVIEWABLE when the champion is reviewable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-runner-'));
  const manifest = buildCampaignManifest({
    campaign_id: 'fixture-001',
    source_url: 'https://www.safehavenrr.com',
    site_slug: 'safehavenrr',
    context_signature: CONTEXT,
  });
  atomicWriteManifest(root, manifest);
  const events: string[] = [];
  const outcome = await runCampaign({
    campaignRoot: root,
    until: 'reviewable',
    deps: {
      ...memoryDeps({ C0: indexFor('C0', GOOD_C0) }),
      watch: (event: string) => events.push(event),
    },
  });
  assert.equal(outcome.terminal, 'REVIEWABLE');
  assert.ok(events.includes('CONVERGED REVIEWABLE'));
});

test('runner exhausts when the budget is consumed without convergence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-runner-'));
  const manifest = buildCampaignManifest({
    campaign_id: 'fixture-001',
    source_url: 'https://www.safehavenrr.com',
    site_slug: 'safehavenrr',
    context_signature: CONTEXT,
    budget: { max_candidate_builds: 2, stop_after_no_improvement_rounds: 3 },
  });
  atomicWriteManifest(root, manifest);
  const outcome = await runCampaign({
    campaignRoot: root,
    until: 'reviewable',
    deps: memoryDeps({ C0: indexFor('C0', NON_REVIEWABLE_C0), C1: indexFor('C1', NON_REVIEWABLE_C0) }),
  });
  assert.equal(outcome.terminal, 'EXHAUSTED');
  assert.ok(outcome.escalation, 'exhaustion must produce an operator escalation');
  assert.equal(outcome.escalation.best_candidate, 'C0');
});

test('runner reaches NO_PROGRESS when repeated experiments yield no gain', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-runner-'));
  const manifest = buildCampaignManifest({
    campaign_id: 'fixture-001',
    source_url: 'https://www.safehavenrr.com',
    site_slug: 'safehavenrr',
    context_signature: CONTEXT,
    budget: { max_candidate_builds: 8, stop_after_no_improvement_rounds: 2 },
  });
  atomicWriteManifest(root, manifest);
  const outcome = await runCampaign({
    campaignRoot: root,
    until: 'reviewable',
    deps: memoryDeps({ C0: indexFor('C0', NON_REVIEWABLE_C0), C1: indexFor('C1', NON_REVIEWABLE_C0) }),
  });
  assert.equal(outcome.terminal, 'NO_PROGRESS');
});

test('runner promotes a challenger that beats the champion and converges', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-runner-'));
  const manifest = buildCampaignManifest({
    campaign_id: 'fixture-001',
    source_url: 'https://www.safehavenrr.com',
    site_slug: 'safehavenrr',
    context_signature: CONTEXT,
  });
  atomicWriteManifest(root, manifest);
  const records = {
    C0: indexFor('C0', NON_REVIEWABLE_C0),
    C1: indexFor('C1', GOOD_C0),
  };
  const events: string[] = [];
  const outcome = await runCampaign({
    campaignRoot: root,
    until: 'reviewable',
    deps: { ...memoryDeps(records), watch: (event: string) => events.push(event) },
  });
  assert.equal(outcome.terminal, 'REVIEWABLE');
  const resumed = loadCampaignManifest(root);
  assert.equal(resumed.champion?.candidate_id, 'C1');
  assert.ok(events.includes('PROMOTE C1'));
});

test('runner blocks when reviewability fails but there is no failure to attribute', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-runner-'));
  const manifest = buildCampaignManifest({
    campaign_id: 'fixture-001',
    source_url: 'https://www.safehavenrr.com',
    site_slug: 'safehavenrr',
    context_signature: CONTEXT,
  });
  atomicWriteManifest(root, manifest);
  // An INCONCLUSIVE hard-gate dimension fails REVIEWABLE but produces no
  // FAIL/REGRESSED result to attribute: the runner must stop as BLOCKED.
  const blockedIndex = buildQualityDeltaIndex({
    campaign_id: 'fixture-001',
    candidate_id: 'C0',
    results: [
      buildQualityDimensionResult({
        dimension: 'conversion.primary_cta',
        candidate_id: 'C0',
        campaign_id: 'fixture-001',
        hard_gate: true,
        status: 'INCONCLUSIVE',
      }),
    ],
  });
  const outcome = await runCampaign({
    campaignRoot: root,
    until: 'reviewable',
    deps: memoryDeps({ C0: blockedIndex }),
  });
  assert.equal(outcome.terminal, 'BLOCKED');
});

test('campaign resumes after process death: persisted champion survives a rerun', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-runner-'));
  const manifest = buildCampaignManifest({
    campaign_id: 'fixture-001',
    source_url: 'https://www.safehavenrr.com',
    site_slug: 'safehavenrr',
    context_signature: CONTEXT,
  });
  atomicWriteManifest(root, manifest);
  const records = {
    C0: indexFor('C0', NON_REVIEWABLE_C0),
    C1: indexFor('C1', GOOD_C0),
  };
  await runCampaign({ campaignRoot: root, until: 'reviewable', deps: memoryDeps(records) });
  // Simulated process death: fresh run with the same persisted state.
  const resumed = loadCampaignManifest(root);
  assert.equal(resumed.status, 'REVIEWABLE');
  assert.equal(resumed.champion?.candidate_id, 'C1');
  const again = await runCampaign({ campaignRoot: root, until: 'reviewable', deps: memoryDeps(records) });
  assert.equal(again.terminal, 'REVIEWABLE');
});
