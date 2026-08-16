// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalGitPromotionAdapter, PromotionOrchestrator } from '../../../src/recursive/promotion/orchestrator.js';
import { compilePEPack } from '../../../src/recursive/pepack/compiler.js';
import { compileEngineeringHarvest } from '../../../src/recursive/harvest/compiler.js';
import { clusterSignals, selectEligibleCluster } from '../../../src/recursive/signals/registry.js';
import { sha256Text } from '../../../src/services/hashing.js';
import type { ReleaseReceipt } from '../../../src/pipeline/evidence/ReleaseReceipt.js';
import type { VerifierReceipt } from '../../../src/recursive/verifier/verifier.js';
import type { PEPack } from '../../../src/recursive/contracts/types.js';

function packFixture(): PEPack {
  const receipt: ReleaseReceipt = {
    schema: 'website-bot.release-receipt/v2',
    receipt_id: 'rr-promo',
    build_id: 'build-promo',
    client_id: 'promo-client',
    mode: 'end-to-end',
    status: 'failed',
    missing_gates: ['visual_qa'],
    evidence: {
      assembly: {
        kind: 'assembly',
        schema: 'website-bot.assembly-manifest/v2',
        logical_id: 'assembly:promo',
        relative_path: 'promo/assembly.json',
        sha256: sha256Text('promo-assembly'),
      },
    },
    correlation: { source_digest: sha256Text('promo-source'), all_required_identities_match: true },
    qa: { seo_baseline: 'passed', visual_qa: 'failed' },
    created_at: '2026-08-15T00:00:00.000Z',
  };
  const harvest = compileEngineeringHarvest({
    recursiveRunId: 'promo-run',
    wave: 1,
    repository: 'Quantum-L9/Website-Bot',
    fullCommitSha: 'a'.repeat(40),
    sourceUrl: 'https://promo.example.com',
    releaseReceipt: receipt,
    chainStatus: 'released',
    stageFailures: [],
    checkpointDigests: [],
    previousWaveOutcomes: [],
  });
  const cluster = selectEligibleCluster(clusterSignals(harvest.signals));
  assert.ok(cluster);
  return compilePEPack({
    recursiveRunId: 'promo-run',
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
  }).pack;
}

function passingReceipt(patchedSha: string): VerifierReceipt {
  return {
    schema: 'l9.recursive.verifier-receipt/v1',
    verifierIdentity: 'independent-verifier',
    pePackId: 'PE-promo-run-1',
    verifiedPatchSha: patchedSha,
    verdict: 'PASS',
    validation: {
      originating: { verdict: 'PASS', caseRefs: [], summary: 'ok' },
      controls: { verdict: 'PASS', caseRefs: [], summary: 'ok' },
      disconfirm: { verdict: 'PASS', caseRefs: [], summary: 'ok' },
      protectedHoldout: { verdict: 'PASS', caseRefs: [], summary: 'ok' },
      repositoryCI: { verdict: 'PASS', caseRefs: [], summary: 'ok' },
      semanticArtifactDiff: {
        expectedChangedArtifacts: [],
        observedChangedArtifacts: [],
        expectedUnchangedArtifacts: [],
        unexpectedlyChangedArtifacts: [],
        verdict: 'PASS',
      },
    },
    causalResult: { expectedSystemEffect: 'x', observedSystemEffect: 'y', verdict: 'CONFIRMED' },
    producedAt: '2026-08-15T00:00:00.000Z',
  };
}

function remoteSetup(): { root: string; remote: string; work: string; v0: string } {
  const root = mkdtempSync(join(tmpdir(), 'promo-'));
  const work = join(root, 'work');
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '--quiet', '-b', 'main', work]);
  execFileSync('git', ['-C', work, '-c', 'user.email=p@local', '-c', 'user.name=p', 'commit', '--quiet', '--allow-empty', '-m', 'V0']);
  const v0 = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  execFileSync('git', ['init', '--quiet', '--bare', remote]);
  execFileSync('git', ['-C', work, 'remote', 'add', 'origin', remote]);
  execFileSync('git', ['-C', work, 'push', '--quiet', 'origin', 'main']);
  return { root, remote, work, v0 };
}

test('merge provenance mismatch fails closed (MERGE_PROVENANCE_MISMATCH)', () => {
  const setup = remoteSetup();
  try {
    const adapter = new LocalGitPromotionAdapter(setup.remote);
    const orchestrator = new PromotionOrchestrator(adapter);
    const pack = packFixture();
    // The branch does not exist: the verified SHA has no matching remote head.
    assert.throws(
      () =>
        orchestrator.mergeIfVerified({
          pack,
          verifierReceipt: passingReceipt(setup.v0),
          prId: 'pr:recursive/PE-promo-run-1',
        }),
      /MERGE_PROVENANCE_MISMATCH/,
    );
  } finally {
    rmSync(setup.root, { recursive: true, force: true });
  }
});

test('a non-passing verifier receipt refuses the merge gate', () => {
  const setup = remoteSetup();
  try {
    const orchestrator = new PromotionOrchestrator(new LocalGitPromotionAdapter(setup.remote));
    const receipt = passingReceipt(setup.v0);
    receipt.verdict = 'FAIL_CI';
    assert.throws(
      () => orchestrator.mergeIfVerified({ pack: packFixture(), verifierReceipt: receipt, prId: 'pr:x' }),
      /verifier verdict/,
    );
  } finally {
    rmSync(setup.root, { recursive: true, force: true });
  }
});

test('duplicate PR requests reconcile to the existing PR identity', () => {
  const setup = remoteSetup();
  try {
    const adapter = new LocalGitPromotionAdapter(setup.remote);
    const orchestrator = new PromotionOrchestrator(adapter);
    const pack = packFixture();
    // Publish the recursive branch first (as the executor's publish hook does).
    execFileSync('git', ['-C', setup.work, 'checkout', '--quiet', '-b', 'recursive/PE-promo-run-1']);
    execFileSync('git', ['-C', setup.work, '-c', 'user.email=p@local', '-c', 'user.name=p', 'commit', '--quiet', '--allow-empty', '-m', 'patch']);
    execFileSync('git', ['-C', setup.work, 'push', '--quiet', 'origin', 'HEAD']);
    const first = orchestrator.ensurePullRequest({
      pack,
      verifierReceipt: passingReceipt(setup.v0),
      title: 't',
      body: 'b',
      base: 'main',
    });
    const second = orchestrator.ensurePullRequest({
      pack,
      verifierReceipt: passingReceipt(setup.v0),
      title: 't',
      body: 'b',
      base: 'main',
    });
    assert.equal(first.prId, second.prId);
    assert.equal(second.created, false);
  } finally {
    rmSync(setup.root, { recursive: true, force: true });
  }
});
