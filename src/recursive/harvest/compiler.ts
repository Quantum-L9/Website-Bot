// L9_META: layer=recursive, role=engineering_harvest_compiler, status=active, version=1.0.0
// Engineering Harvest: converts a real E2E's durable evidence (release
// receipt, evidence index, stage checkpoints, stage failures, QA evidence)
// into compact causal EngineeringSignals plus regression-case candidates.
// Raw evidence remains immutable backing evidence; the coding agent receives
// the derived working set, never an unbounded request to inspect the repo.

import type { ReleaseReceipt } from "../../pipeline/evidence/ReleaseReceipt.js";
import { refForArtifact } from "../contracts/digest.js";
import type {
  EngineeringSignal,
  EngineeringSignalClass,
  RecursiveArtifactRef,
  WaveNumber,
} from "../contracts/types.js";

export interface E2EQualitySummary {
  schema: "l9.recursive.e2e-quality-summary/v1";
  reviewable: boolean;
  releaseReceiptStatus: string;
  missingGates: string[];
  visualQa: string;
  seoBaseline: string;
  chainStatus: string;
}

export interface StageFailureRecord {
  stage: string;
  errorCode?: string;
  message?: string;
}

export interface HarvestInput {
  recursiveRunId: string;
  wave: WaveNumber;
  repository: string;
  fullCommitSha: string;
  sourceUrl: string;
  releaseReceipt: ReleaseReceipt;
  chainStatus: string;
  stageFailures: StageFailureRecord[];
  checkpointDigests: Array<{ stage: string; inputDigest: string; outputDigest: string }>;
  previousWaveOutcomes?: Array<{ verdict: string; pePackRefId: string }>;
}

export interface EngineeringHarvest {
  schema: "l9.recursive.engineering-harvest/v1";
  harvestId: string;
  recursiveRunId: string;
  wave: WaveNumber;
  sourceE2E: RecursiveArtifactRef;
  qualitySummary: E2EQualitySummary;
  signals: EngineeringSignal[];
  regressionCaseCandidates: Array<{
    caseId: string;
    originRunId: string;
    property: string;
    sourceRef: RecursiveArtifactRef;
  }>;
  recommendedNextAction:
    | "MODIFY_CODE"
    | "NO_MATERIAL_ENGINEERING_SIGNAL"
    | "CONTROL_PLANE_CHANGE_REQUIRED";
}

export const ENGINEERING_HARVEST_SCHEMA = "l9.recursive.engineering-harvest/v1";

// Stage -> earliest responsible subsystem. A signal's suspected owner is the
// first stage in the pipeline whose output evidence carried the defect, so
// attribution stays causal instead of blaming the final symptom location.
const STAGE_OWNER_MAP: Record<string, string> = {
  "source-site-ingestion": "SourceSiteIngestion",
  "design-intelligence": "DesignIntelligence",
  "content-generation": "ContentGeneration",
  "schema-generator": "SchemaGenerator",
  "image-planning": "ImageAssetPlanning",
  "image-generation": "ImageGeneration",
  "placeholder-scan": "PlaceholderScan",
  "site-assembler": "SiteAssembler",
  "image-validation": "ImageValidation",
  "posthog-snippet": "PostHogSnippet",
  "site-build": "SiteBuild",
  "client-source-publish": "ClientSourcePublish",
  "vercel-deploy": "VercelDeploy",
  "release-receipt": "ReleaseReceipt",
  "seo-baseline": "SEOBaseline",
  "visual-qa": "VisualQA",
  "release-receipt-finalizer": "ReleaseReceiptFinalizer",
  "handoff-emitter": "HandoffEmitter",
  "terminal-convergence": "TerminalConvergence",
};

const GATE_CLASS: Record<string, EngineeringSignalClass> = {
  assembly: "CORRECTNESS_DEFECT",
  local_build: "CORRECTNESS_DEFECT",
  github_publication: "CORRECTNESS_DEFECT",
  vercel_deployment: "CORRECTNESS_DEFECT",
  visual_qa: "QUALITY_MODEL_DEFECT",
};

function observedGates(receipt: ReleaseReceipt): string[] {
  const failing: string[] = [];
  if (receipt.status === "failed" || receipt.missing_gates.length > 0) {
    for (const gate of receipt.missing_gates) failing.push(gate);
  }
  if (receipt.qa.visual_qa === "failed") failing.push("visual_qa");
  return [...new Set(failing)];
}

function recommendedActionFor(
  controlPlaneSignal: boolean,
  materialSignals: EngineeringSignal[],
): EngineeringHarvest["recommendedNextAction"] {
  if (controlPlaneSignal) return "CONTROL_PLANE_CHANGE_REQUIRED";
  if (materialSignals.length > 0) return "MODIFY_CODE";
  return "NO_MATERIAL_ENGINEERING_SIGNAL";
}

function stageFailureObservation(failure: { stage: string; errorCode?: string }): string {
  const errorSuffix = failure.errorCode ? ` (${failure.errorCode})` : "";
  return `stage ${failure.stage} failed${errorSuffix} in the source E2E`;
}

export function compileEngineeringHarvest(input: HarvestInput): EngineeringHarvest {
  const signals: EngineeringSignal[] = [];
  const candidates: EngineeringHarvest["regressionCaseCandidates"] = [];
  const e2eRef = refForArtifact("e2e-receipt", {
    schema: input.releaseReceipt.schema,
    receipt_id: input.releaseReceipt.receipt_id,
  });

  const reviewable =
    input.releaseReceipt.status === "succeeded" &&
    input.releaseReceipt.missing_gates.length === 0 &&
    input.chainStatus === "released";

  const failingGates = observedGates(input.releaseReceipt);

  // Gate failures become signals whose owner is the earliest responsible stage.
  for (const gate of failingGates) {
    signals.push(
      makeSignal({
        input,
        signalId: `ES-${input.recursiveRunId}-${input.wave}-${gate}`,
        classification: GATE_CLASS[gate] ?? "CORRECTNESS_DEFECT",
        observation: `release gate ${gate} failed in the source E2E`,
        suspectedSubsystem: STAGE_OWNER_MAP[gate] ?? "ReleaseReceipt",
        e2eRef,
        dimension: gate,
        confidence: "HIGH",
      }),
    );
  }

  // Stage failure evidence: earliest responsible owner is the failed stage.
  for (const failure of input.stageFailures) {
    signals.push(
      makeSignal({
        input,
        signalId: `ES-${input.recursiveRunId}-${input.wave}-${failure.stage}`,
        classification: "CORRECTNESS_DEFECT",
        observation: stageFailureObservation(failure),
        suspectedSubsystem: STAGE_OWNER_MAP[failure.stage] ?? failure.stage,
        e2eRef,
        dimension: failure.stage,
        confidence: "HIGH",
      }),
    );
    candidates.push({
      caseId: `REG-${input.recursiveRunId}-${input.wave}-${failure.stage}`,
      originRunId: input.recursiveRunId,
      property: `stage ${failure.stage} must converge on a real E2E`,
      sourceRef: e2eRef,
    });
  }

  // Human-machine gap: reviewable-by-gates while evidence chain still open.
  if (reviewable && input.chainStatus !== "released") {
    signals.push(
      makeSignal({
        input,
        signalId: `ES-${input.recursiveRunId}-${input.wave}-chain`,
        classification: "CORRECTNESS_DEFECT",
        observation: `release receipt succeeded while the evidence chain is ${input.chainStatus}`,
        suspectedSubsystem: "ReleaseReceiptFinalizer",
        e2eRef,
        dimension: "evidence-chain",
        confidence: "HIGH",
      }),
    );
  }

  // Efficiency: a stage checkpoint whose output changed while the input did
  // not means redundant recomputation happened downstream.
  for (const checkpoint of input.checkpointDigests) {
    if (checkpoint.inputDigest === checkpoint.outputDigest) continue;
    signals.push(
      makeSignal({
        input,
        signalId: `ES-${input.recursiveRunId}-${input.wave}-eff-${checkpoint.stage}`,
        classification: "EFFICIENCY_DEFECT",
        observation: `stage ${checkpoint.stage} recomputed downstream work without a material input change`,
        suspectedSubsystem: STAGE_OWNER_MAP[checkpoint.stage] ?? checkpoint.stage,
        e2eRef,
        dimension: "recomputation",
        confidence: "MEDIUM",
      }),
    );
  }

  // Prior-wave correlation: previous CodeChangeOutcomes feed recurrence.
  for (const prior of input.previousWaveOutcomes ?? []) {
    signals.push(
      makeSignal({
        input,
        signalId: `ES-${input.recursiveRunId}-${input.wave}-prior-${prior.pePackRefId}`,
        classification: "EFFICIENCY_DEFECT",
        observation: `prior wave outcome ${prior.verdict} recorded against ${prior.pePackRefId}`,
        suspectedSubsystem: "EngineeringHarvestCompiler",
        e2eRef,
        dimension: "prior-wave-correlation",
        confidence: "MEDIUM",
      }),
    );
  }

  const controlPlaneSignal = signals.some(
    (signal) => signal.classification === "CONTROL_PLANE_CHANGE_REQUIRED",
  );
  const materialSignals = signals.filter((signal) => signal.confidence !== "LOW");
  const recommended = recommendedActionFor(controlPlaneSignal, materialSignals);

  const harvest: EngineeringHarvest = {
    schema: ENGINEERING_HARVEST_SCHEMA,
    harvestId: `EH-${input.recursiveRunId}-${input.wave}`,
    recursiveRunId: input.recursiveRunId,
    wave: input.wave,
    sourceE2E: e2eRef,
    qualitySummary: {
      schema: "l9.recursive.e2e-quality-summary/v1",
      reviewable,
      releaseReceiptStatus: input.releaseReceipt.status,
      missingGates: input.releaseReceipt.missing_gates,
      visualQa: input.releaseReceipt.qa.visual_qa,
      seoBaseline: input.releaseReceipt.qa.seo_baseline,
      chainStatus: input.chainStatus,
    },
    signals,
    regressionCaseCandidates: candidates,
    recommendedNextAction: recommended,
  };
  return harvest;
}

interface SignalInput {
  recursiveRunId: string;
  wave: WaveNumber;
  repository: string;
  fullCommitSha: string;
  sourceUrl: string;
}

function makeSignal(options: {
  input: SignalInput;
  signalId: string;
  classification: EngineeringSignalClass;
  observation: string;
  suspectedSubsystem: string;
  e2eRef: RecursiveArtifactRef;
  dimension: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}): EngineeringSignal {
  const { input } = options;
  const fingerprint = {
    qualityDimensions: [options.dimension],
    invariantViolations: [],
  };
  return {
    schema: "l9.engineering-signal/v1",
    signalId: options.signalId,
    recursiveRunId: input.recursiveRunId,
    wave: input.wave,
    sourceCode: { repository: input.repository, fullCommitSha: input.fullCommitSha },
    origin: {
      e2eReceiptRef: options.e2eRef,
      qualityResultRefs: [],
      evidenceRefs: [options.e2eRef],
    },
    classification: options.classification,
    severity: options.classification === "CORRECTNESS_DEFECT" ? "BLOCKING" : "HIGH",
    reach: "SITE",
    confidence: options.confidence,
    failureFingerprint: fingerprint,
    observation: options.observation,
    causalTrace: {
      upstreamArtifactsInspected: [options.e2eRef],
      unchangedControls: [],
      suspectedOwner: { repository: input.repository, subsystem: options.suspectedSubsystem },
    },
    primaryDiagnosis: {
      statement: `${options.suspectedSubsystem} produced evidence of ${options.dimension} failure during the source E2E`,
      confidence: options.confidence,
    },
    strongestAlternative: {
      statement: "downstream assembly or verification misclassified upstream evidence",
      confidence: "LOW",
      disconfirmingTest: `inspect ${options.suspectedSubsystem} checkpoint output digest against its input digest`,
      result: "INCONCLUSIVE",
    },
    recurrence: { currentRunOccurrences: 1, historicalSignalRefs: [] },
    engineeringImplication: `investigate ${options.suspectedSubsystem} for the root cause of ${options.dimension}`,
    regressionCaseCandidate: true,
    leverage: {
      humanReviewImpact: "MEDIUM",
      downstreamCostImpact: "HIGH",
      recurrence: "MEDIUM",
      implementationRisk: "MEDIUM",
    },
  };
}

export { STAGE_OWNER_MAP };
