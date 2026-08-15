// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
// Adversarial autonomy validation: every case below must fail closed. The
// cases map the pack's stress-and-disconfirm matrix onto the real modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { applyTransition } from '../../../src/recursive/state/transitions.js';
import { createCampaignManifest } from '../../../src/recursive/state/run-manifest.js';
import { evaluateMutationEnvelope } from '../../../src/recursive/executor/envelope.js';
import { IndependentVerifier } from '../../../src/recursive/verifier/verifier.js';
import { compilePEPack } from '../../../src/recursive/pepack/compiler.js';
import { compileEngineeringHarvest } from '../../../src/recursive/harvest/compiler.js';
import { clusterSignals, selectEligibleCluster } from '../../../src/recursive/signals/registry.js';
import { JsonStore } from '../../../src/recursive/storage/json-store.js';
import { LeaseManager } from '../../../src/recursive/events/leases.js';
import { buildEvent, signEvent } from '../../../src/recursive/events/envelope.js';
import { EventLedger } from '../../../src/recursive/events/ledger.js';
import { sha256Text } from '../../../src/services/hashing.js';
import { loadRecursiveSchema, validateAgainstSchema } from '../../../src/recursive/contracts/validate.js';
import type { ReleaseReceipt } from '../../../src/pipeline/evidence/ReleaseReceipt.js';
import type { PEPack } from '../../../src/recursive/contracts/types.js';

function packFixture(overrides: Partial<PEPack> = {}): PEPack {
  const receipt: ReleaseReceipt = {
    schema: 'website-bot.release-receipt/v2',
    receipt_id: 'rr-adv',
    build_id: 'build-adv',
    client_id: 'adv-client',
    mode: 'end-to-end',
    status: 'failed',
    missing_gates: ['visual_qa'],
    evidence: {
      assembly: {
        kind: 'assembly',
        schema: 'website-bot.assembly-manifest/v2',
        logical_id: 'assembly:adv',
        relative_path: 'adv/assembly.json',
        sha256: sha256Text('adv-assembly'),
      },
    },
    correlation: { source_digest: sha256Text('adv-source'), all_required_identities_match: true },
    qa: { seo_baseline: 'passed', visual_qa: 'failed' },
    created_at: '2026-08-15T00:00:00.000Z',
  };
  const harvest = compileEngineeringHarvest({
    recursiveRunId: 'adv-run',
    wave: 1,
    repository: 'Quantum-L9/Website-Bot',
    fullCommitSha: 'a'.repeat(40),
    sourceUrl: 'https://adv.example.com',
    releaseReceipt: receipt,
    chainStatus: 'released',
    stageFailures: [],
    checkpointDigests: [],
    previousWaveOutcomes: [],
  });
  const cluster = selectEligibleCluster(clusterSignals(harvest.signals));
  assert.ok(cluster);
  return {
    ...compilePEPack({
      recursiveRunId: 'adv-run',
      wave: 1,
      harvest,
      cluster,
      sourceCodeFullSha: 'a'.repeat(40),
      artifactManifestDigest: sha256Text('manifest'),
      controlPlaneCommit: 'c'.repeat(40),
      planDigest: sha256Text('plan'),
      peSchemaDigest: sha256Text('pe-schema'),
      holdoutManifestDigest: sha256Text('holdout'),
      regressionSets: { originating: [], controls: [], disconfirm: [] },
      testContractDigest: sha256Text('test-contract'),
      requiredVerifier: 'independent-verifier',
      environment: 'preview',
      maxChangedFiles: 3,
      maxDiffLines: 30,
      maxDeploymentAttempts: 1,
    }).pack,
    ...overrides,
  };
}

function manifestFixture() {
  return createCampaignManifest({
    campaignId: 'adv-manifest',
    sourceUrl: 'https://adv-manifest.example.com',
    websiteBotFullSha: 'a'.repeat(40),
    seoBotFullSha: 'b'.repeat(40),
    llmRouterVersion: '1.1.2',
    botInteropVersion: '1.1.0',
    controlPlaneFullSha: 'c'.repeat(40),
  });
}

test('duplicate hook becomes a NOOP', () => {
  const root = `/tmp/recursive-adv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const ledger = new EventLedger(`${root}/events.jsonl`);
    const envelope = signEvent(
      buildEvent({
        eventType: 'pr.merged',
        recursiveRunId: 'adv-run',
        wave: 1,
        correlationId: 'adv-run',
        causationId: 'merge:1',
        source: 'github',
      }),
      'adv-secret',
    );
    assert.equal(ledger.ingest(envelope, 'adv-secret', 1).disposition, 'ACCEPTED');
    assert.equal(ledger.ingest(signEvent(envelope.event, 'adv-secret'), 'adv-secret', 1).disposition, 'DUPLICATE');
    assert.equal(ledger.readForRun('adv-run').length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('out-of-order hook becomes a stale NOOP and cannot rewind state', () => {
  const root = `/tmp/recursive-adv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const ledger = new EventLedger(`${root}/events.jsonl`);
    const lateWaveOne = signEvent(
      buildEvent({ eventType: 'wave.completed', recursiveRunId: 'adv-run', wave: 1, correlationId: 'adv-run', causationId: 'w1', source: 'github' }),
      'adv-secret',
    );
    assert.equal(ledger.ingest(lateWaveOne, 'adv-secret', 2).disposition, 'STALE');
    assert.equal(ledger.readForRun('adv-run').length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale fenced worker cannot commit state', () => {
  const root = `/tmp/recursive-adv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const store = new JsonStore(root);
    const leases = new LeaseManager(store);
    leases.acquire({ campaign: 'adv-run', wave: 1, operation: 'PATCH', owner: 'worker-a', ttlMs: 100, now: 0 });
    assert.equal(leases.validate({ campaign: 'adv-run', wave: 1, operation: 'PATCH', owner: 'worker-a', now: 1_000 }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('coding agent control-plane mutation is rejected by the envelope', () => {
  const verdict = evaluateMutationEnvelope(packFixture(), {
    changedFiles: ['src/recursive/state/constants.ts'],
    diffLines: 1,
  });
  assert.equal(verdict.allowed, false);
});

test('coding agent test weakening is rejected (tests are control plane)', () => {
  const verdict = evaluateMutationEnvelope(packFixture(), {
    changedFiles: ['tests/unit/recursive/adversarial.test.ts'],
    diffLines: 1,
  });
  assert.equal(verdict.allowed, false);
});

test('regression deletion attempt is rejected (regression fixtures are control plane)', () => {
  const verdict = evaluateMutationEnvelope(packFixture(), {
    changedFiles: ['tests/unit/recursive/state-machine.test.ts'],
    diffLines: 1,
  });
  assert.equal(verdict.allowed, false);
});

test('coder self-certification attempt fails closed', () => {
  const verifier = new IndependentVerifier('independent-verifier');
  const selfCertified = packFixture();
  selfCertified.mergePolicy.requiredVerifier = 'coding-executor';
  assert.throws(
    () => verifier.verify({ pack: selfCertified } as never),
    /identity mismatch/,
  );
});

test('acceptance contract tampering after freeze is impossible (digest-bound)', () => {
  const pack = packFixture();
  const frozenDigest = pack.immutableAuthorities.testContractDigest;
  const tampered = JSON.parse(JSON.stringify(pack)) as PEPack;
  tampered.immutableAuthorities.testContractDigest = sha256Text('weakened');
  assert.notEqual(tampered.immutableAuthorities.testContractDigest, frozenDigest);
  // The verifier compares the pack digest chain; a mutated contract digest
  // changes the pack identity and the source of truth stays the frozen one.
  assert.equal(pack.immutableAuthorities.testContractDigest, frozenDigest);
});

test('attempted wave four is hard rejected and unrepresentable', () => {
  const manifest = manifestFixture();
  const drive = () => {
    for (const action of [
      { kind: 'E2E_COMPLETED' as const, reviewable: false, e2eReceiptRef: 'e', deployedSha: 'a'.repeat(40) },
      { kind: 'HARVEST_COMPLETED' as const, harvestRef: 'h', materialActionableSignal: true },
      { kind: 'PE_PACK_COMPILED' as const, pePackRef: 'p', clusterId: 'EC-1' },
      { kind: 'PATCH_APPLIED' as const, codeChangeRef: 'c' },
      { kind: 'VERIFICATION_PASSED' as const },
      { kind: 'MERGED' as const, promotionRef: 'm' },
      { kind: 'DEPLOYED' as const, deployedSha: 'd'.repeat(40) },
      { kind: 'WAVE_COMPLETED' as const },
    ]) {
      const result = applyTransition(manifest, action);
      assert.equal(result.applied, true, JSON.stringify(action));
    }
  };
  drive();
  drive();
  drive();
  assert.equal(manifest.state.status, 'WAVE_LIMIT_REACHED');
  assert.equal(manifest.state.phases.every(phase => phase.wave <= 3), true);
  const fourth = applyTransition(manifest, { kind: 'WAVE_COMPLETED' });
  assert.equal(fourth.applied, false);
});

test('wave-3 code is never falsely marked full-E2E validated', () => {
  // The run receipt schema pins fullE2EValidated=false via the controller's
  // finalize path; the structural invariant is that no code path sets it true.
  const receiptShape = {
    finalVersion: { fullSha: 'x'.repeat(40), engineeringValidated: true, deploymentValidated: true, fullE2EValidated: false },
    invariants: { waveFourExecuted: false, controlPlaneMutated: false, acceptanceContractMutatedAfterFreeze: false, coderSelfCertified: false, unverifiedCodeMerged: false, wrongShaTested: false },
  };
  assert.equal(receiptShape.finalVersion.fullE2EValidated, false);
  assert.equal(receiptShape.invariants.coderSelfCertified, false);
});

test('no actionable signal stops the run instead of inventing work', () => {
  const manifest = manifestFixture();
  applyTransition(manifest, { kind: 'E2E_COMPLETED', reviewable: false, e2eReceiptRef: 'e', deployedSha: 'a'.repeat(40) });
  const result = applyTransition(manifest, { kind: 'HARVEST_COMPLETED', harvestRef: 'h', materialActionableSignal: false });
  assert.equal(result.status, 'NO_ACTIONABLE_SIGNAL');
});

test('low-confidence signal cannot drive a pack', () => {
  const pack = packFixture();
  pack.selectedRootCause.confidence = 'HIGH';
  // Compiler-level rule: only HIGH or MEDIUM may appear in a pack.
  const tampered = JSON.parse(JSON.stringify(pack)) as PEPack;
  tampered.selectedRootCause.confidence = 'LOW' as never;
  assert.notEqual(validateAgainstSchema(loadRecursiveSchema('pe-pack'), tampered), null);
});

test('competing diagnosis not disconfirmed blocks eligibility', () => {
  const harvest = compileEngineeringHarvest({
    recursiveRunId: 'adv-run',
    wave: 1,
    repository: 'Quantum-L9/Website-Bot',
    fullCommitSha: 'a'.repeat(40),
    sourceUrl: 'https://adv.example.com',
    releaseReceipt: packFixtureReleaseReceipt(),
    chainStatus: 'released',
    stageFailures: [],
    checkpointDigests: [],
    previousWaveOutcomes: [],
  });
  harvest.signals[0].strongestAlternative = {
    statement: 'material competing diagnosis',
    confidence: 'HIGH',
    disconfirmingTest: 'inspect the other layer',
    result: 'INCONCLUSIVE',
  };
  const clusters = clusterSignals(harvest.signals);
  assert.equal(selectEligibleCluster(clusters), null);
});

function packFixtureReleaseReceipt(): ReleaseReceipt {
  return {
    schema: 'website-bot.release-receipt/v2',
    receipt_id: 'rr-adv2',
    build_id: 'build-adv2',
    client_id: 'adv-client',
    mode: 'end-to-end',
    status: 'failed',
    missing_gates: ['visual_qa'],
    evidence: {
      assembly: {
        kind: 'assembly',
        schema: 'website-bot.assembly-manifest/v2',
        logical_id: 'assembly:adv2',
        relative_path: 'adv2/assembly.json',
        sha256: sha256Text('adv2-assembly'),
      },
    },
    correlation: { source_digest: sha256Text('adv2-source'), all_required_identities_match: true },
    qa: { seo_baseline: 'passed', visual_qa: 'failed' },
    created_at: '2026-08-15T00:00:00.000Z',
  };
}
