// L9_META: layer=recursive, role=pe_pack_compiler, status=active, version=1.0.0
// PE Pack compiler. One pack per wave, one root-cause cluster, one primary
// repository, one subsystem. The acceptance contract is frozen (digest-bound)
// before any code mutation begins; a frozen contract that changes after
// mutation is impossible because the verifier compares digests, not fields.
import type {
  PEPack,
  RecursiveArtifactRef,
  RegressionCaseRef,
  WaveNumber,
} from '../contracts/types.js';
import { refForArtifact } from '../contracts/digest.js';
import { CONTROL_PLANE_PATHS } from '../state/constants.js';
import type { EngineeringHarvest } from '../harvest/compiler.js';
import type { SignalCluster } from '../signals/registry.js';

export interface FrozenAcceptanceContract {
  schema: 'l9.recursive.frozen-acceptance-contract/v1';
  testContractDigest: string;
  originatingCaseIds: string[];
  controlCaseIds: string[];
  disconfirmCaseIds: string[];
  holdoutManifestDigest: string;
  targetProperties: Array<{ property: string; expected: string }>;
  guardrailProperties: Array<{ property: string; expected: string }>;
  forbiddenChanges: Array<{ property: string; expected: string }>;
}

export const FROZEN_ACCEPTANCE_CONTRACT_SCHEMA = 'l9.recursive.frozen-acceptance-contract/v1';

export interface PEPackCompileInput {
  recursiveRunId: string;
  wave: WaveNumber;
  harvest: EngineeringHarvest;
  cluster: SignalCluster;
  sourceCodeFullSha: string;
  artifactManifestDigest: string;
  controlPlaneCommit: string;
  planDigest: string;
  peSchemaDigest: string;
  holdoutManifestDigest: string;
  regressionSets: {
    originating: RegressionCaseRef[];
    controls: RegressionCaseRef[];
    disconfirm: RegressionCaseRef[];
  };
  testContractDigest: string;
  requiredVerifier: string;
  environment: string;
  maxChangedFiles: number;
  maxDiffLines: number;
  maxDeploymentAttempts: number;
}

export interface CompiledPEPack {
  pack: PEPack;
  frozenContract: FrozenAcceptanceContract;
  ref: RecursiveArtifactRef;
}

function resolveRepositoryFor(cluster: SignalCluster): string {
  const repositories = [...new Set(cluster.signals.map(signal => signal.sourceCode.repository))];
  return repositories.length === 1 ? repositories[0] : 'Quantum-L9/Website-Bot';
}

export function compilePEPack(input: PEPackCompileInput): CompiledPEPack {
  const { harvest, cluster } = input;
  if (harvest.wave !== input.wave) throw new Error('PE pack wave must match the harvest wave');
  if (cluster.confidence === 'LOW') throw new Error('low-confidence cluster cannot compile a PE pack');
  if (cluster.signalClass === 'CONTROL_PLANE_CHANGE_REQUIRED') {
    throw new Error('control-plane changes cannot be compiled into an autonomous PE pack');
  }
  const repository = resolveRepositoryFor(cluster);
  const targetProperties = [
    {
      property: `${cluster.subsystem} no longer emits ${cluster.dimensions.join(', ')} failures`,
      expected: 'originating regression cases pass',
    },
    {
      property: 'unrelated subsystems keep their behavior',
      expected: 'control cases remain non-regressed',
    },
  ];
  const forbiddenChanges = [
    { property: 'control plane', expected: 'no diff touches any control-plane path' },
    { property: 'architecture', expected: 'no architecture expansion' },
  ];
  const frozenContract: FrozenAcceptanceContract = {
    schema: FROZEN_ACCEPTANCE_CONTRACT_SCHEMA,
    testContractDigest: input.testContractDigest,
    originatingCaseIds: input.regressionSets.originating.map(caseRef => caseRef.caseId),
    controlCaseIds: input.regressionSets.controls.map(caseRef => caseRef.caseId),
    disconfirmCaseIds: input.regressionSets.disconfirm.map(caseRef => caseRef.caseId),
    holdoutManifestDigest: input.holdoutManifestDigest,
    targetProperties,
    guardrailProperties: [
      { property: 'controls', expected: 'control cases remain non-regressed' },
      { property: 'disconfirm', expected: 'disconfirm cases remain correct' },
    ],
    forbiddenChanges,
  };
  const frozenRef = refForArtifact('frozen-acceptance-contract', frozenContract);

  const pack: PEPack = {
    schema: 'l9.pe-pack/v1',
    packId: `PE-${input.recursiveRunId}-${input.wave}`,
    recursiveRunId: input.recursiveRunId,
    wave: input.wave,
    source: {
      e2eReceiptRef: harvest.sourceE2E,
      engineeringHarvestRef: refForArtifact('engineering-harvest', harvest),
      engineeringSignalRefs: cluster.signals.map(signal => refForArtifact('engineering-signal', signal)),
      sourceCodeFullSha: input.sourceCodeFullSha,
      artifactManifestDigest: input.artifactManifestDigest,
    },
    selectedRootCause: {
      signalClass: cluster.signalClass,
      clusterId: cluster.clusterId,
      repository,
      subsystem: cluster.subsystem,
      diagnosis: cluster.signals[0]?.primaryDiagnosis.statement ?? 'root cause derived from the selected signal cluster',
      confidence: cluster.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM',
    },
    hypothesis: {
      proposedSystemChange: `fix the ${cluster.subsystem} root cause producing ${cluster.dimensions.join(', ')} failures`,
      expectedSystemEffect: 'originating failure dimensions improve while controls stay non-regressed',
      expectedE2EEffect: 'the next real E2E shows material improvement on the targeted dimensions',
    },
    mutationEnvelope: {
      repository,
      allowedPaths: [],
      forbiddenPaths: [...CONTROL_PLANE_PATHS],
      forbiddenSubsystems: ['RecursiveEngineeringController', 'IndependentReplayVerifier', 'PromotionOrchestrator'],
      architectureExpansionAllowed: false,
      maxChangedFiles: input.maxChangedFiles,
      maxDiffLines: input.maxDiffLines,
    },
    immutableAuthorities: {
      controlPlaneCommit: input.controlPlaneCommit,
      planDigest: input.planDigest,
      peSchemaDigest: input.peSchemaDigest,
      testContractDigest: input.testContractDigest,
      holdoutManifestDigest: input.holdoutManifestDigest,
    },
    regressionSets: {
      originating: input.regressionSets.originating,
      controls: input.regressionSets.controls,
      disconfirm: input.regressionSets.disconfirm,
      protectedHoldout: {
        selectorVersion: 'v1',
        manifestDigest: input.holdoutManifestDigest,
        casesHiddenFromCodingAgent: true,
      },
    },
    expectedProperties: {
      target: targetProperties,
      guardrails: frozenContract.guardrailProperties,
      forbiddenChanges,
    },
    validation: {
      targetedReplayRequired: true,
      differentialReplayRequired: true,
      controlsRequired: true,
      disconfirmRequired: true,
      protectedHoldoutRequired: true,
      semanticArtifactDiffRequired: true,
      repositoryChecks: ['typecheck', 'unit'],
    },
    budgets: {
      maxPatchAttempts: 1,
      maxValidationRepairAttempts: 1,
      maxDeploymentAttempts: input.maxDeploymentAttempts,
    },
    mergePolicy: {
      autonomousMergeAllowed: true,
      requiredVerifier: input.requiredVerifier,
      verifiedPatchShaMustEqualMergedSha: true,
    },
    deploymentPolicy: {
      autonomousDeployAllowed: true,
      environment: input.environment,
      rollbackRequiredOnFailure: true,
    },
    nextTransition: {
      success: 'DEPLOY_AND_RECONCILE',
      validationFailure: 'PATCH_VALIDATION_FAILED',
      scopeInsufficient: 'PE_PACK_INSUFFICIENT_SCOPE',
    },
  };
  return { pack, frozenContract, ref: refForArtifact('pe-pack', { ...pack, frozenContractRef: frozenRef }) };
}
