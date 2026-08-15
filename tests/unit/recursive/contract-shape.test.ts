// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
// Conformance pin: the six bound pack contracts must stay field-for-field
// identical to the pack schemas hashed at program admission. The pinned field
// sets below were transcribed from the bound pack files (digests in the
// program runtime admission receipt); any drift fails this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assertSchemaConformance } from '../../../src/recursive/contracts/validate.js';
import { refForArtifact } from '../../../src/recursive/contracts/digest.js';
import { sha256Text } from '../../../src/services/hashing.js';
import type {
  CodeChangeOutcome,
  EngineeringSignal,
  PEPack,
  RecursiveEngineeringEvent,
  RecursiveEngineeringRunReceipt,
  WaveReceipt,
} from '../../../src/recursive/contracts/types.js';

const ARTIFACT = { refKind: 'e2e', refId: 'e2e:1', digest: 'd'.repeat(64) };
const CASE_REF = { caseId: 'REG-1', ref: ARTIFACT };

function pinnedFieldSets() {
  return {
    'l9.engineering-signal/v1': {
      required: ['schema', 'signalId', 'recursiveRunId', 'wave', 'sourceCode', 'origin', 'classification', 'severity', 'reach', 'confidence', 'observation', 'causalTrace', 'primaryDiagnosis', 'recurrence', 'engineeringImplication', 'regressionCaseCandidate', 'leverage'],
      optional: ['failureFingerprint', 'strongestAlternative'],
    },
    'l9.pe-pack/v1': {
      required: ['schema', 'packId', 'recursiveRunId', 'wave', 'source', 'selectedRootCause', 'hypothesis', 'mutationEnvelope', 'immutableAuthorities', 'regressionSets', 'expectedProperties', 'validation', 'budgets', 'mergePolicy', 'deploymentPolicy', 'nextTransition'],
      optional: [],
    },
    'l9.code-change-outcome/v1': {
      required: ['schema', 'outcomeId', 'pePackRef', 'code', 'diff', 'validation', 'causalResult', 'verdict'],
      optional: ['merge', 'deployment'],
    },
    'l9.recursive-engineering-event/v1': {
      required: ['schema', 'eventId', 'eventType', 'recursiveRunId', 'wave', 'correlationId', 'causationId', 'source', 'occurredAt', 'evidenceRefs'],
      optional: ['subject'],
    },
    'l9.recursive-engineering-wave/v1': {
      required: ['schema', 'recursiveRunId', 'wave', 'inputCode', 'e2e', 'engineeringHarvest', 'reviewability', 'status', 'next'],
      optional: ['pePack', 'codeChange', 'promotion'],
    },
    'l9.recursive-engineering-run/v1': {
      required: ['schema', 'recursiveRunId', 'sourceUrl', 'mode', 'policy', 'initialCode', 'waves', 'executionCounts', 'trajectory', 'finalVersion', 'terminalState', 'nextAction', 'invariants'],
      optional: [],
    },
  } as const;
}

test('emitted schemas validate against the repo schema compiler with zero drift', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-recursive-schemas.mjs'], { encoding: 'utf-8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.validated.length, 6);
});

function sampleSignal(): EngineeringSignal {
  return {
    schema: 'l9.engineering-signal/v1',
    signalId: 'ES-1',
    recursiveRunId: 'run-1',
    wave: 1,
    sourceCode: { repository: 'Quantum-L9/Website-Bot', fullCommitSha: 'a'.repeat(40) },
    origin: { e2eReceiptRef: ARTIFACT, qualityResultRefs: [], evidenceRefs: [ARTIFACT] },
    classification: 'QUALITY_MODEL_DEFECT',
    severity: 'HIGH',
    reach: 'SITE',
    confidence: 'HIGH',
    observation: 'observation',
    causalTrace: {
      upstreamArtifactsInspected: [ARTIFACT],
      unchangedControls: [],
      suspectedOwner: { repository: 'Quantum-L9/Website-Bot', subsystem: 'VisualQA' },
    },
    primaryDiagnosis: { statement: 'diagnosis', confidence: 'HIGH' },
    recurrence: { currentRunOccurrences: 1, historicalSignalRefs: [] },
    engineeringImplication: 'implication',
    regressionCaseCandidate: true,
    leverage: { humanReviewImpact: 'HIGH', downstreamCostImpact: 'HIGH', recurrence: 'HIGH', implementationRisk: 'LOW' },
  };
}

function samplePack(): PEPack {
  return {
    schema: 'l9.pe-pack/v1',
    packId: 'PE-1',
    recursiveRunId: 'run-1',
    wave: 1,
    source: {
      e2eReceiptRef: ARTIFACT,
      engineeringHarvestRef: ARTIFACT,
      engineeringSignalRefs: [ARTIFACT],
      sourceCodeFullSha: 'a'.repeat(40),
      artifactManifestDigest: 'd'.repeat(64),
    },
    selectedRootCause: {
      signalClass: 'QUALITY_MODEL_DEFECT',
      clusterId: 'EC-1',
      repository: 'Quantum-L9/Website-Bot',
      subsystem: 'VisualQA',
      diagnosis: 'diagnosis',
      confidence: 'HIGH',
    },
    hypothesis: { proposedSystemChange: 'change', expectedSystemEffect: 'effect', expectedE2EEffect: 'e2e effect' },
    mutationEnvelope: {
      repository: 'Quantum-L9/Website-Bot',
      allowedPaths: [],
      forbiddenPaths: [],
      forbiddenSubsystems: [],
      architectureExpansionAllowed: false,
      maxChangedFiles: 2,
      maxDiffLines: 20,
    },
    immutableAuthorities: {
      controlPlaneCommit: 'c'.repeat(40),
      planDigest: 'd'.repeat(64),
      peSchemaDigest: 'd'.repeat(64),
      testContractDigest: 'd'.repeat(64),
      holdoutManifestDigest: 'd'.repeat(64),
    },
    regressionSets: {
      originating: [CASE_REF],
      controls: [],
      disconfirm: [],
      protectedHoldout: { selectorVersion: 'v1', manifestDigest: 'd'.repeat(64), casesHiddenFromCodingAgent: true },
    },
    expectedProperties: { target: [{ property: 'p', expected: 'e' }], guardrails: [], forbiddenChanges: [] },
    validation: {
      targetedReplayRequired: true,
      differentialReplayRequired: true,
      controlsRequired: true,
      disconfirmRequired: true,
      protectedHoldoutRequired: true,
      semanticArtifactDiffRequired: true,
      repositoryChecks: ['typecheck'],
    },
    budgets: { maxPatchAttempts: 1, maxValidationRepairAttempts: 1, maxDeploymentAttempts: 1 },
    mergePolicy: { autonomousMergeAllowed: true, requiredVerifier: 'independent-verifier', verifiedPatchShaMustEqualMergedSha: true },
    deploymentPolicy: { autonomousDeployAllowed: true, environment: 'preview', rollbackRequiredOnFailure: true },
    nextTransition: { success: 'DEPLOY_AND_RECONCILE', validationFailure: 'PATCH_VALIDATION_FAILED', scopeInsufficient: 'PE_PACK_INSUFFICIENT_SCOPE' },
  };
}

function sampleOutcome(): CodeChangeOutcome {
  const setResult = { verdict: 'PASS' as const, caseRefs: [], summary: 'ok' };
  return {
    schema: 'l9.code-change-outcome/v1',
    outcomeId: 'OC-1',
    pePackRef: ARTIFACT,
    code: { repository: 'Quantum-L9/Website-Bot', beforeFullSha: 'a'.repeat(40), patchedFullSha: 'b'.repeat(40) },
    diff: { changedFiles: ['src/x.ts'], diffDigest: 'd'.repeat(64) },
    validation: {
      originating: setResult,
      controls: setResult,
      disconfirm: setResult,
      protectedHoldout: setResult,
      repositoryCI: setResult,
      semanticArtifactDiff: {
        expectedChangedArtifacts: ['src/x.ts'],
        observedChangedArtifacts: ['src/x.ts'],
        expectedUnchangedArtifacts: [],
        unexpectedlyChangedArtifacts: [],
        verdict: 'PASS',
      },
    },
    causalResult: { expectedSystemEffect: 'e', observedSystemEffect: 'o', verdict: 'CONFIRMED' },
    verdict: 'PASS',
  };
}

function sampleEvent(): RecursiveEngineeringEvent {
  return {
    schema: 'l9.recursive-engineering-event/v1',
    eventId: 'evt_1',
    eventType: 'e2e.completed',
    recursiveRunId: 'run-1',
    wave: 1,
    correlationId: 'run-1',
    causationId: 'e2e:1',
    source: 'github',
    occurredAt: '2026-08-15T00:00:00.000Z',
    evidenceRefs: [ARTIFACT],
  };
}

function sampleWave(): WaveReceipt {
  return {
    schema: 'l9.recursive-engineering-wave/v1',
    recursiveRunId: 'run-1',
    wave: 1,
    inputCode: { repository: 'Quantum-L9/Website-Bot', fullSha: 'a'.repeat(40), deploymentReceiptRef: ARTIFACT },
    e2e: {
      receiptRef: ARTIFACT,
      artifactManifestRef: ARTIFACT,
      sourceUrl: 'https://x.example.com',
      candidateReviewable: false,
      qualitySummaryRef: ARTIFACT,
    },
    engineeringHarvest: { harvestRef: ARTIFACT, signalRefs: [], materialActionableSignal: true },
    reviewability: { beforePatch: false },
    status: 'WAVE_COMPLETE',
    next: 'NEXT_WAVE',
  };
}

function sampleRunReceipt(): RecursiveEngineeringRunReceipt {
  return {
    schema: 'l9.recursive-engineering-run/v1',
    recursiveRunId: 'run-1',
    sourceUrl: 'https://x.example.com',
    mode: 'DEVELOPMENT_RECURSIVE',
    policy: { targetWaves: 3, hardMaxWaves: 3 },
    initialCode: {
      websiteBotFullSha: 'a'.repeat(40),
      seoBotFullSha: 'b'.repeat(40),
      llmRouterVersion: '1.1.2',
      botInteropVersion: '1.1.0',
      controlPlaneFullSha: 'c'.repeat(40),
    },
    waves: [sampleWave()],
    executionCounts: { fullE2Es: 1, codeImprovementLoops: 0, autonomousMerges: 0, deployments: 0, rollbacks: 0 },
    trajectory: {
      testedVersions: ['a'.repeat(40)],
      producedVersions: [],
      reviewabilityByE2E: [{ wave: 1, testedSha: 'a'.repeat(40), reviewable: false }],
      codeChangeOutcomes: [],
      unresolvedEngineeringSignals: [],
    },
    finalVersion: { fullSha: 'a'.repeat(40), engineeringValidated: false, deploymentValidated: false, fullE2EValidated: false },
    terminalState: 'NO_ACTIONABLE_SIGNAL',
    nextAction: 'HUMAN_REVIEW',
    invariants: {
      waveFourExecuted: false,
      controlPlaneMutated: false,
      acceptanceContractMutatedAfterFreeze: false,
      coderSelfCertified: false,
      unverifiedCodeMerged: false,
      wrongShaTested: false,
    },
  };
}

test('bound contract field sets are pinned exactly as the pack requires', () => {
  const pinned = pinnedFieldSets();
  const samples: Record<string, unknown> = {
    'l9.engineering-signal/v1': sampleSignal(),
    'l9.pe-pack/v1': samplePack(),
    'l9.code-change-outcome/v1': sampleOutcome(),
    'l9.recursive-engineering-event/v1': sampleEvent(),
    'l9.recursive-engineering-wave/v1': sampleWave(),
    'l9.recursive-engineering-run/v1': sampleRunReceipt(),
  };
  for (const [schemaId, sample] of Object.entries(samples) as Array<[keyof typeof pinned, unknown]>) {
    const keys = Object.keys(sample as Record<string, unknown>);
    const pin = pinned[schemaId];
    const required = pin.required as readonly string[];
    const optional = pin.optional as readonly string[];
    // Every bound required field must be present...
    for (const field of required) {
      assert.ok(keys.includes(field), `${schemaId} drifted: missing bound required field ${field}`);
    }
    // ...and any extra field must be a bound optional field, never invented.
    for (const key of keys) {
      assert.ok(required.includes(key) || optional.includes(key), `${schemaId} drifted: unbound field ${key}`);
    }
  }
});

test('every sample artifact passes its bound schema exactly as emitted', () => {
  assertSchemaConformance('engineering-signal', sampleSignal());
  assertSchemaConformance('pe-pack', samplePack());
  assertSchemaConformance('code-change-outcome', sampleOutcome());
  assertSchemaConformance('recursive-engineering-event', sampleEvent());
  assertSchemaConformance('recursive-engineering-wave', sampleWave());
  assertSchemaConformance('recursive-engineering-run', sampleRunReceipt());
});

test('refs are content-addressed and byte-verifiable', () => {
  const ref = refForArtifact('sample', { value: 1 });
  assert.equal(ref.refId, `sample:${ref.digest}`);
  assert.match(ref.digest, /^[a-f0-9]{64}$/);
  const again = refForArtifact('sample', { value: 1 });
  assert.deepEqual(ref, again);
});
