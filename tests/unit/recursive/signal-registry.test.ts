// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import type { EngineeringSignal } from '../../../src/recursive/contracts/types.js';
import { clusterSignals, hasControlPlaneSignal, selectEligibleCluster } from '../../../src/recursive/signals/registry.js';

function signal(overrides: Partial<EngineeringSignal>): EngineeringSignal {
  return {
    schema: 'l9.engineering-signal/v1',
    signalId: 'ES-1',
    recursiveRunId: 'run-1',
    wave: 1,
    sourceCode: { repository: 'Quantum-L9/Website-Bot', fullCommitSha: 'a'.repeat(40) },
    origin: { e2eReceiptRef: { refKind: 'e2e', refId: 'e2e:1', digest: 'd'.repeat(64) }, qualityResultRefs: [], evidenceRefs: [] },
    classification: 'QUALITY_MODEL_DEFECT',
    severity: 'HIGH',
    reach: 'SITE',
    confidence: 'HIGH',
    observation: 'generic output passes',
    causalTrace: {
      upstreamArtifactsInspected: [],
      unchangedControls: [],
      suspectedOwner: { repository: 'Quantum-L9/Website-Bot', subsystem: 'VisualQA' },
    },
    primaryDiagnosis: { statement: 'evaluator misses generic output', confidence: 'HIGH' },
    recurrence: { currentRunOccurrences: 1, historicalSignalRefs: [] },
    engineeringImplication: 'strengthen the evaluator',
    regressionCaseCandidate: true,
    leverage: {
      humanReviewImpact: 'HIGH',
      downstreamCostImpact: 'HIGH',
      recurrence: 'HIGH',
      implementationRisk: 'LOW',
    },
    ...overrides,
  };
}

test('equivalent signals deduplicate into one cluster', () => {
  const clusters = clusterSignals([
    signal({ signalId: 'ES-1' }),
    signal({ signalId: 'ES-2', observation: 'same root cause observed again' }),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].signals.length, 2);
  assert.equal(clusters[0].subsystem, 'VisualQA');
});

test('different subsystems or dimensions form separate clusters', () => {
  const clusters = clusterSignals([
    signal({ signalId: 'ES-1' }),
    signal({ signalId: 'ES-2', causalTrace: { upstreamArtifactsInspected: [], unchangedControls: [], suspectedOwner: { repository: 'Quantum-L9/Website-Bot', subsystem: 'DesignIntelligence' } } }),
  ]);
  assert.equal(clusters.length, 2);
});

test('leverage ranking orders P0 clusters before P3', () => {
  const clusters = clusterSignals([
    signal({ signalId: 'ES-1', severity: 'BLOCKING', reach: 'GLOBAL', leverage: { humanReviewImpact: 'HIGH', downstreamCostImpact: 'HIGH', recurrence: 'HIGH', implementationRisk: 'LOW' } }),
    signal({
      signalId: 'ES-2',
      severity: 'LOW',
      reach: 'SITE',
      confidence: 'LOW',
      causalTrace: { upstreamArtifactsInspected: [], unchangedControls: [], suspectedOwner: { repository: 'Quantum-L9/Website-Bot', subsystem: 'Other' } },
      leverage: { humanReviewImpact: 'LOW', downstreamCostImpact: 'LOW', recurrence: 'LOW', implementationRisk: 'HIGH' },
    }),
  ]);
  assert.equal(clusters[0].leverage.priority, 'P0');
  assert.equal(clusters[1].leverage.priority, 'P3');
});

test('low-confidence clusters are never eligible for a PE pack', () => {
  const clusters = clusterSignals([
    signal({ signalId: 'ES-1', confidence: 'LOW' }),
  ]);
  assert.equal(selectEligibleCluster(clusters), null);
});

test('a material un-disconfirmed alternative blocks PE pack eligibility', () => {
  const clusters = clusterSignals([
    signal({
      signalId: 'ES-1',
      strongestAlternative: { statement: 'blueprint defect', confidence: 'MEDIUM', disconfirmingTest: 'inspect blueprint', result: 'INCONCLUSIVE' },
    }),
  ]);
  assert.equal(selectEligibleCluster(clusters), null);
});

test('a disconfirmed alternative does not block eligibility', () => {
  const clusters = clusterSignals([
    signal({
      signalId: 'ES-1',
      strongestAlternative: { statement: 'blueprint defect', confidence: 'MEDIUM', disconfirmingTest: 'inspect blueprint', result: 'DISCONFIRMED' },
    }),
  ]);
  assert.equal(selectEligibleCluster(clusters)?.clusterId, clusters[0].clusterId);
});

test('control-plane signals are detected and never selected for autonomous packs', () => {
  const clusters = clusterSignals([
    signal({ signalId: 'ES-1', classification: 'CONTROL_PLANE_CHANGE_REQUIRED' }),
  ]);
  assert.equal(hasControlPlaneSignal(clusters), true);
  assert.equal(selectEligibleCluster(clusters), null);
});
