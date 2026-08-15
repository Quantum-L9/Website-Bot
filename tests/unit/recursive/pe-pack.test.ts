// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePEPack } from '../../../src/recursive/pepack/compiler.js';
import { compileEngineeringHarvest } from '../../../src/recursive/harvest/compiler.js';
import { clusterSignals, selectEligibleCluster } from '../../../src/recursive/signals/registry.js';
import { assertSchemaConformance } from '../../../src/recursive/contracts/validate.js';
import { sha256Text } from '../../../src/services/hashing.js';
import type { ReleaseReceipt } from '../../../src/pipeline/evidence/ReleaseReceipt.js';

function harvestForWave1() {
  const receipt: ReleaseReceipt = {
    schema: 'website-bot.release-receipt/v2',
    receipt_id: 'rr-pe',
    build_id: 'build-pe',
    client_id: 'pe-client',
    mode: 'end-to-end',
    status: 'failed',
    missing_gates: ['visual_qa'],
    evidence: {
      assembly: {
        kind: 'assembly',
        schema: 'website-bot.assembly-manifest/v2',
        logical_id: 'assembly:pe',
        relative_path: 'pe/assembly.json',
        sha256: sha256Text('pe-assembly'),
      },
    },
    correlation: { source_digest: sha256Text('pe-source'), all_required_identities_match: true },
    qa: { seo_baseline: 'passed', visual_qa: 'failed' },
    created_at: '2026-08-15T00:00:00.000Z',
  };
  return compileEngineeringHarvest({
    recursiveRunId: 'pe-run',
    wave: 1,
    repository: 'Quantum-L9/Website-Bot',
    fullCommitSha: 'a'.repeat(40),
    sourceUrl: 'https://pe.example.com',
    releaseReceipt: receipt,
    chainStatus: 'released',
    stageFailures: [],
    checkpointDigests: [],
    previousWaveOutcomes: [],
  });
}

function compileInput() {
  const harvest = harvestForWave1();
  const clusters = clusterSignals(harvest.signals);
  const cluster = selectEligibleCluster(clusters);
  assert.ok(cluster);
  return { harvest, cluster };
}

test('compiled pack conforms to the bound pe-pack schema exactly as emitted', () => {
  const { harvest, cluster } = compileInput();
  const compiled = compilePEPack({
    recursiveRunId: 'pe-run',
    wave: 1,
    harvest,
    cluster,
    sourceCodeFullSha: 'a'.repeat(40),
    artifactManifestDigest: sha256Text('manifest'),
    controlPlaneCommit: 'c'.repeat(40),
    planDigest: sha256Text('plan'),
    peSchemaDigest: sha256Text('pe-schema'),
    holdoutManifestDigest: sha256Text('holdout'),
    regressionSets: {
      originating: [{ caseId: 'REG-1', ref: { refKind: 'regression', refId: 'REG-1', digest: sha256Text('REG-1') } }],
      controls: [],
      disconfirm: [],
    },
    testContractDigest: sha256Text('test-contract'),
    requiredVerifier: 'independent-verifier',
    environment: 'preview',
    maxChangedFiles: 2,
    maxDiffLines: 20,
    maxDeploymentAttempts: 1,
  });
  assertSchemaConformance('pe-pack', compiled.pack);
  assert.equal(compiled.pack.selectedRootCause.subsystem, cluster.subsystem);
  assert.equal(compiled.pack.mutationEnvelope.architectureExpansionAllowed, false);
  assert.equal(compiled.pack.budgets.maxPatchAttempts, 1);
  assert.equal(compiled.pack.mergePolicy.verifiedPatchShaMustEqualMergedSha, true);
  assert.equal(compiled.pack.regressionSets.protectedHoldout.casesHiddenFromCodingAgent, true);
});

test('one pack per wave carries exactly one root-cause cluster and one repository', () => {
  const { harvest, cluster } = compileInput();
  const compiled = compilePEPack({
    recursiveRunId: 'pe-run',
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
    maxChangedFiles: 2,
    maxDiffLines: 20,
    maxDeploymentAttempts: 1,
  });
  assert.equal(compiled.pack.selectedRootCause.clusterId, cluster.clusterId);
  assert.equal(compiled.pack.selectedRootCause.repository, 'Quantum-L9/Website-Bot');
  assert.equal(compiled.pack.wave, 1);
});

test('low-confidence and control-plane clusters are rejected by the compiler', () => {
  const { harvest, cluster } = compileInput();
  const base = {
    recursiveRunId: 'pe-run',
    wave: 1 as const,
    harvest,
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
    maxChangedFiles: 2,
    maxDiffLines: 20,
    maxDeploymentAttempts: 1,
  };
  assert.throws(() => compilePEPack({ ...base, cluster: { ...cluster, confidence: 'LOW' } }), /low-confidence/);
  assert.throws(
    () => compilePEPack({ ...base, cluster: { ...cluster, signalClass: 'CONTROL_PLANE_CHANGE_REQUIRED' } }),
    /control-plane/,
  );
});

test('wave mismatch between harvest and pack is rejected', () => {
  const { harvest, cluster } = compileInput();
  assert.throws(
    () =>
      compilePEPack({
        recursiveRunId: 'pe-run',
        wave: 2,
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
        maxChangedFiles: 2,
        maxDiffLines: 20,
        maxDeploymentAttempts: 1,
      }),
    /wave/,
  );
});

test('the frozen acceptance contract is digest-bound before mutation', () => {
  const { harvest, cluster } = compileInput();
  const compiled = compilePEPack({
    recursiveRunId: 'pe-run',
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
    maxChangedFiles: 2,
    maxDiffLines: 20,
    maxDeploymentAttempts: 1,
  });
  assert.equal(compiled.pack.immutableAuthorities.testContractDigest, sha256Text('test-contract'));
  assert.equal(compiled.pack.immutableAuthorities.holdoutManifestDigest, sha256Text('holdout'));
  assert.equal(compiled.frozenContract.targetProperties.length, 2);
  assert.equal(compiled.frozenContract.forbiddenChanges.some(change => change.property === 'control plane'), true);
});
