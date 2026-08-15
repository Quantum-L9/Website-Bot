// L9_META: layer=recursive, role=bound_l9_recursive_contracts, status=active, version=1.0.0
// Bound SSOT: the six operator-pack schema files hashed at program admission
// (see program runtime admission/source-integrity-receipt.json). These interfaces
// must stay field-for-field identical to the bound pack types; a contract-shape
// conformance test pins the field sets (tests/unit/recursive/contract-shape.test.ts).

export type EngineeringSignalClass =
  | 'CORRECTNESS_DEFECT'
  | 'QUALITY_MODEL_DEFECT'
  | 'GENERATION_CAPABILITY_DEFECT'
  | 'ATTRIBUTION_DEFECT'
  | 'EFFICIENCY_DEFECT'
  | 'CONTROL_PLANE_CHANGE_REQUIRED';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type Reach = 'SITE' | 'VERTICAL' | 'CROSS_VERTICAL' | 'GLOBAL';
export type Severity = 'BLOCKING' | 'HIGH' | 'MEDIUM' | 'LOW';
export type WaveNumber = 1 | 2 | 3;

/**
 * Content-addressed, byte-verifiable reference used by the recursive contracts.
 * The bot-interop ArtifactRef remains untouched (its artifact_type enum is scoped
 * to the five intelligence artifacts); this vocabulary carries recursive evidence
 * refs while real intelligence lineage still flows through bot-interop refs.
 */
export interface RecursiveArtifactRef {
  refKind: string;
  refId: string;
  digest: string;
}

export interface RegressionCaseRef {
  caseId: string;
  originRunId?: string;
  ref: RecursiveArtifactRef;
}

export interface ValidationSetResult {
  verdict: 'PASS' | 'FAIL';
  caseRefs: RecursiveArtifactRef[];
  summary: string;
}

export interface PropertyExpectation {
  property: string;
  expected: string;
}

export interface EngineeringSignal {
  schema: 'l9.engineering-signal/v1';
  signalId: string;
  recursiveRunId: string;
  wave: WaveNumber;
  sourceCode: {
    repository: string;
    fullCommitSha: string;
  };
  origin: {
    e2eReceiptRef: RecursiveArtifactRef;
    candidateRef?: RecursiveArtifactRef;
    qualityResultRefs: RecursiveArtifactRef[];
    evidenceRefs: RecursiveArtifactRef[];
  };
  classification: EngineeringSignalClass;
  severity: Severity;
  reach: Reach;
  confidence: Confidence;
  failureFingerprint?: {
    qualityDimensions: string[];
    pageArchetypes?: string[];
    components?: string[];
    viewports?: string[];
    invariantViolations?: string[];
  };
  observation: string;
  causalTrace: {
    earliestObservedBadArtifact?: RecursiveArtifactRef;
    upstreamArtifactsInspected: RecursiveArtifactRef[];
    unchangedControls: RecursiveArtifactRef[];
    suspectedOwner: {
      repository: string;
      subsystem: string;
    };
  };
  primaryDiagnosis: {
    statement: string;
    confidence: Confidence;
  };
  strongestAlternative?: {
    statement: string;
    confidence: Confidence;
    disconfirmingTest: string;
    result?: 'CONFIRMED' | 'DISCONFIRMED' | 'INCONCLUSIVE';
  };
  recurrence: {
    currentRunOccurrences: number;
    historicalSignalRefs: RecursiveArtifactRef[];
  };
  engineeringImplication: string;
  regressionCaseCandidate: boolean;
  leverage: {
    humanReviewImpact: 'HIGH' | 'MEDIUM' | 'LOW';
    downstreamCostImpact: 'HIGH' | 'MEDIUM' | 'LOW';
    recurrence: 'HIGH' | 'MEDIUM' | 'LOW';
    implementationRisk: 'HIGH' | 'MEDIUM' | 'LOW';
  };
}

export interface PEPack {
  schema: 'l9.pe-pack/v1';
  packId: string;
  recursiveRunId: string;
  wave: WaveNumber;
  source: {
    e2eReceiptRef: RecursiveArtifactRef;
    engineeringHarvestRef: RecursiveArtifactRef;
    engineeringSignalRefs: RecursiveArtifactRef[];
    sourceCodeFullSha: string;
    artifactManifestDigest: string;
  };
  selectedRootCause: {
    signalClass: EngineeringSignalClass;
    clusterId: string;
    repository: string;
    subsystem: string;
    diagnosis: string;
    confidence: 'HIGH' | 'MEDIUM';
  };
  hypothesis: {
    proposedSystemChange: string;
    expectedSystemEffect: string;
    expectedE2EEffect: string;
  };
  mutationEnvelope: {
    repository: string;
    allowedPaths: string[];
    allowedSymbols?: string[];
    forbiddenPaths: string[];
    forbiddenSubsystems: string[];
    architectureExpansionAllowed: false;
    maxChangedFiles: number;
    maxDiffLines: number;
  };
  immutableAuthorities: {
    controlPlaneCommit: string;
    planDigest: string;
    peSchemaDigest: string;
    testContractDigest: string;
    holdoutManifestDigest: string;
  };
  regressionSets: {
    originating: RegressionCaseRef[];
    controls: RegressionCaseRef[];
    disconfirm: RegressionCaseRef[];
    protectedHoldout: {
      selectorVersion: string;
      manifestDigest: string;
      casesHiddenFromCodingAgent: true;
    };
  };
  expectedProperties: {
    target: PropertyExpectation[];
    guardrails: PropertyExpectation[];
    forbiddenChanges: PropertyExpectation[];
  };
  validation: {
    targetedReplayRequired: true;
    differentialReplayRequired: true;
    controlsRequired: true;
    disconfirmRequired: true;
    protectedHoldoutRequired: true;
    semanticArtifactDiffRequired: true;
    repositoryChecks: string[];
  };
  budgets: {
    maxPatchAttempts: 1;
    maxValidationRepairAttempts: 1;
    maxDeploymentAttempts: number;
    maxWallClockSeconds?: number;
    maxLLMTokens?: number;
    maxLLMCost?: number;
  };
  mergePolicy: {
    autonomousMergeAllowed: boolean;
    requiredVerifier: string;
    verifiedPatchShaMustEqualMergedSha: true;
  };
  deploymentPolicy: {
    autonomousDeployAllowed: boolean;
    environment: string;
    rollbackRequiredOnFailure: true;
  };
  nextTransition: {
    success: 'DEPLOY_AND_RECONCILE';
    validationFailure: 'PATCH_VALIDATION_FAILED';
    scopeInsufficient: 'PE_PACK_INSUFFICIENT_SCOPE';
  };
}

export type CodeChangeVerdict =
  | 'PASS'
  | 'FAIL_TARGET'
  | 'FAIL_CONTROL'
  | 'FAIL_DISCONFIRM'
  | 'FAIL_HOLDOUT'
  | 'FAIL_BLAST_RADIUS'
  | 'FAIL_CI'
  | 'FAIL_SCOPE';

export type CausalVerdict = 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'DISCONFIRMED' | 'INCONCLUSIVE';

export interface CodeChangeOutcome {
  schema: 'l9.code-change-outcome/v1';
  outcomeId: string;
  pePackRef: RecursiveArtifactRef;
  code: {
    repository: string;
    beforeFullSha: string;
    patchedFullSha: string;
    mergedFullSha?: string;
  };
  diff: {
    changedFiles: string[];
    changedSymbols?: string[];
    diffDigest: string;
  };
  validation: {
    originating: ValidationSetResult;
    controls: ValidationSetResult;
    disconfirm: ValidationSetResult;
    protectedHoldout: ValidationSetResult;
    repositoryCI: ValidationSetResult;
    semanticArtifactDiff: {
      expectedChangedArtifacts: string[];
      observedChangedArtifacts: string[];
      expectedUnchangedArtifacts: string[];
      unexpectedlyChangedArtifacts: string[];
      verdict: 'PASS' | 'FAIL';
    };
  };
  causalResult: {
    expectedSystemEffect: string;
    observedSystemEffect: string;
    verdict: CausalVerdict;
  };
  merge?: {
    prId: string;
    mergeReceiptRef: RecursiveArtifactRef;
  };
  deployment?: {
    deploymentReceiptRef: RecursiveArtifactRef;
    deployedFullSha: string;
    healthVerdict: 'PASS' | 'FAIL';
    rollbackReceiptRef?: RecursiveArtifactRef;
  };
  verdict: CodeChangeVerdict;
}

export type RecursiveEventType =
  | 'e2e.completed'
  | 'engineering_harvest.completed'
  | 'pe_pack.ready'
  | 'verification.completed'
  | 'pr.merged'
  | 'deployment.succeeded'
  | 'deployment.failed'
  | 'rollback.completed'
  | 'wave.completed';

export interface RecursiveEngineeringEvent {
  schema: 'l9.recursive-engineering-event/v1';
  eventId: string;
  eventType: RecursiveEventType;
  recursiveRunId: string;
  wave: WaveNumber;
  correlationId: string;
  causationId: string;
  source: string;
  occurredAt: string;
  evidenceRefs: RecursiveArtifactRef[];
  subject?: {
    repository?: string;
    fullSha?: string;
    deploymentId?: string;
  };
}

export interface WaveReceipt {
  schema: 'l9.recursive-engineering-wave/v1';
  recursiveRunId: string;
  wave: WaveNumber;
  inputCode: {
    repository: string;
    fullSha: string;
    deploymentReceiptRef: RecursiveArtifactRef;
  };
  e2e: {
    receiptRef: RecursiveArtifactRef;
    artifactManifestRef: RecursiveArtifactRef;
    sourceUrl: string;
    candidateReviewable: boolean;
    qualitySummaryRef: RecursiveArtifactRef;
  };
  engineeringHarvest: {
    harvestRef: RecursiveArtifactRef;
    signalRefs: RecursiveArtifactRef[];
    selectedSignalCluster?: string;
    materialActionableSignal: boolean;
  };
  pePack?: {
    ref: RecursiveArtifactRef;
    digest: string;
  };
  codeChange?: {
    outcomeRef: RecursiveArtifactRef;
    beforeSha: string;
    afterSha: string;
    causalVerdict: CausalVerdict;
  };
  promotion?: {
    mergeReceiptRef: RecursiveArtifactRef;
    deploymentReceiptRef: RecursiveArtifactRef;
    deployedFullSha: string;
  };
  reviewability: {
    beforePatch: boolean;
  };
  status:
    | 'WAVE_COMPLETE'
    | 'NO_ACTIONABLE_SIGNAL'
    | 'PATCH_VALIDATION_FAILED'
    | 'DEPLOYMENT_FAILED'
    | 'CONTROL_PLANE_CHANGE_REQUIRED';
  next: 'NEXT_WAVE' | 'STOP';
}

export type RunTerminalState =
  | 'WAVE_LIMIT_REACHED'
  | 'REVIEWABLE_NO_MATERIAL_ENGINEERING_SIGNAL'
  | 'NO_ACTIONABLE_SIGNAL'
  | 'NO_MATERIAL_IMPROVEMENT'
  | 'CONTROL_PLANE_CHANGE_REQUIRED'
  | 'PATCH_VALIDATION_FAILED'
  | 'DEPLOYMENT_FAILED'
  | 'BLOCKED'
  | 'FATAL';

export type RunNextAction =
  | 'START_NEXT_RUN_WITH_FINAL_SHA'
  | 'HUMAN_REVIEW'
  | 'REMEDIATE_CONTROL_PLANE'
  | 'REMEDIATE_FAILED_PATCH'
  | 'REMEDIATE_DEPLOYMENT'
  | 'INVESTIGATE_BLOCKER';

export interface RecursiveEngineeringRunReceipt {
  schema: 'l9.recursive-engineering-run/v1';
  recursiveRunId: string;
  sourceUrl: string;
  mode: 'DEVELOPMENT_RECURSIVE';
  policy: {
    targetWaves: 3;
    hardMaxWaves: 3;
  };
  initialCode: {
    websiteBotFullSha: string;
    seoBotFullSha: string;
    llmRouterVersion: string;
    botInteropVersion: string;
    controlPlaneFullSha: string;
  };
  waves: WaveReceipt[];
  executionCounts: {
    fullE2Es: number;
    codeImprovementLoops: number;
    autonomousMerges: number;
    deployments: number;
    rollbacks: number;
  };
  trajectory: {
    testedVersions: string[];
    producedVersions: string[];
    reviewabilityByE2E: Array<{
      wave: number;
      testedSha: string;
      reviewable: boolean;
    }>;
    codeChangeOutcomes: Array<{
      wave: number;
      verdict: CausalVerdict;
    }>;
    unresolvedEngineeringSignals: RecursiveArtifactRef[];
  };
  finalVersion: {
    fullSha: string;
    engineeringValidated: boolean;
    deploymentValidated: boolean;
    fullE2EValidated: boolean;
  };
  terminalState: RunTerminalState;
  nextAction: RunNextAction;
  invariants: {
    waveFourExecuted: false;
    controlPlaneMutated: false;
    acceptanceContractMutatedAfterFreeze: false;
    coderSelfCertified: false;
    unverifiedCodeMerged: false;
    wrongShaTested: false;
  };
}

export const ENGINEERING_SIGNAL_SCHEMA = 'l9.engineering-signal/v1';
export const PE_PACK_SCHEMA = 'l9.pe-pack/v1';
export const CODE_CHANGE_OUTCOME_SCHEMA = 'l9.code-change-outcome/v1';
export const RECURSIVE_EVENT_SCHEMA = 'l9.recursive-engineering-event/v1';
export const WAVE_RECEIPT_SCHEMA = 'l9.recursive-engineering-wave/v1';
export const RUN_RECEIPT_SCHEMA = 'l9.recursive-engineering-run/v1';

export const SIGNAL_CLASSES: readonly EngineeringSignalClass[] = [
  'CORRECTNESS_DEFECT',
  'QUALITY_MODEL_DEFECT',
  'GENERATION_CAPABILITY_DEFECT',
  'ATTRIBUTION_DEFECT',
  'EFFICIENCY_DEFECT',
  'CONTROL_PLANE_CHANGE_REQUIRED',
];

export const EVENT_TYPES: readonly RecursiveEventType[] = [
  'e2e.completed',
  'engineering_harvest.completed',
  'pe_pack.ready',
  'verification.completed',
  'pr.merged',
  'deployment.succeeded',
  'deployment.failed',
  'rollback.completed',
  'wave.completed',
];
