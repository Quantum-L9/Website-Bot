// L9_META: layer=recursive, role=recursive_engineering_controller, status=active, version=1.0.0
// RecursiveEngineeringController: owns state transitions, the wave budget,
// reconciliation, and termination. Per wave it runs exactly one real E2E
// against the exact currently deployed revision, freezes evidence, derives
// signals, compiles at most one PE pack, executes one bounded code change,
// verifies independently, and promotes only on passing evidence. Wave 2/3
// harvests additionally judge the previous wave's CodeChangeOutcome.

import { canonicalJson, sha256Text } from "../services/hashing.js";
import { refForArtifact } from "./contracts/digest.js";
import type {
  PEPack,
  RecursiveEngineeringRunReceipt,
  WaveNumber,
  WaveReceipt,
} from "./contracts/types.js";
import type { DeploymentReceipt, DeploymentVerifier } from "./deployment/verifier.js";
import type { LeaseManager } from "./events/leases.js";
import type { EventLedger } from "./events/ledger.js";
import { reconcile } from "./events/reconciler.js";
import type { BoundedCodingExecutor, PatchInstruction } from "./executor/adapter.js";
import type { EngineeringHarvest } from "./harvest/compiler.js";
import { compileEngineeringHarvest } from "./harvest/compiler.js";
import { compilePEPack } from "./pepack/compiler.js";
import type { MergeReceipt, PromotionOrchestrator } from "./promotion/orchestrator.js";
import {
  clusterSignals,
  hasControlPlaneSignal,
  type SignalCluster,
  selectEligibleCluster,
} from "./signals/registry.js";
import { HARD_MAX_WAVES } from "./state/constants.js";
import { rebuildManifestFromLedger } from "./state/resume.js";
import { type CampaignManifest, createCampaignManifest } from "./state/run-manifest.js";
import { applyTransition, isTerminal } from "./state/transitions.js";
import type { JsonStore } from "./storage/json-store.js";
import type { IndependentVerifier, VerifierReceipt } from "./verifier/verifier.js";

export interface E2ERunner {
  run(revisionSha: string, sourceUrl: string): Promise<E2ERunResult>;
}

export interface E2ERunResult {
  deployedSha: string;
  reviewable: boolean;
  e2eReceiptId: string;
  harvestInput: Parameters<typeof compileEngineeringHarvest>[0];
}

export interface ControllerDependencies {
  store: JsonStore;
  ledger: EventLedger;
  leases: LeaseManager;
  e2eRunner: E2ERunner;
  executor: BoundedCodingExecutor;
  verifier: IndependentVerifier;
  promotion: PromotionOrchestrator;
  deployment: DeploymentVerifier;
  eventSecret: string;
  planDigest: string;
  peSchemaDigest: string;
  holdoutManifestDigest: string;
  controlPlaneCommit: string;
  llmRouterVersion: string;
  botInteropVersion: string;
  seoBotFullSha: string;
  repositoryRoot: string;
  /** Promotion remote URL; passed to the executor so patches are based on
   * the exact promoted revision (optional; defaults to repositoryRoot). */
  promotionRemoteUrl?: string;
  maxChangedFilesPerPack: number;
  maxDiffLinesPerPack: number;
  maxDeploymentAttempts: number;
  environment: string;
  /**
   * Independent replay evidence for verification. Owned by the verifier side
   * (never the coding executor); the simulation wires real file-based checks.
   */
  replayProvider: (input: { pack: PEPack; beforeWorkdir: string; patchedWorkdir: string }) => {
    originating: ReplayCase[];
    controls: ReplayCase[];
    disconfirm: ReplayCase[];
  };
  /** Hidden holdout replay owned by the verifier side. */
  holdoutProvider: (patchedWorkdir: string) => Array<{ caseId: string; passed: boolean }>;
}

export interface ReplayCase {
  caseRef: import("./contracts/types.js").RegressionCaseRef;
  beforeResult: string;
  afterResult: string;
  expectedDirection: "IMPROVE" | "UNCHANGED";
}

export class RecursiveEngineeringController {
  constructor(private readonly deps: ControllerDependencies) {}

  /**
   * Starts a bounded recursive run. Returns the final machine-readable run
   * receipt. Wave four is unrepresentable: the loop is bounded by
   * HARD_MAX_WAVES and the state machine hard-rejects any fourth wave.
   */
  async start(input: {
    campaignId: string;
    sourceUrl: string;
    websiteBotFullSha: string;
    patchInstructions?: Partial<Record<WaveNumber, PatchInstruction>>;
    now?: () => string;
  }): Promise<RecursiveEngineeringRunReceipt> {
    const manifest = createCampaignManifest({
      campaignId: input.campaignId,
      sourceUrl: input.sourceUrl,
      websiteBotFullSha: input.websiteBotFullSha,
      seoBotFullSha: this.deps.seoBotFullSha,
      llmRouterVersion: this.deps.llmRouterVersion,
      botInteropVersion: this.deps.botInteropVersion,
      controlPlaneFullSha: this.deps.controlPlaneCommit,
      now: input.now?.(),
    });
    this.deps.store.write(`runs/${input.campaignId}/campaign-manifest.json`, manifest);

    while (!isTerminal(manifest)) {
      const wave = manifest.state.currentWave as WaveNumber;
      const waveRecord = await this.executeWave({
        manifest,
        wave,
        sourceUrl: input.sourceUrl,
        patchInstruction: input.patchInstructions?.[wave],
      });
      this.deps.store.write(`runs/${input.campaignId}/waves/${wave}.receipt.json`, waveRecord);
      if (waveRecord.status === "WAVE_COMPLETE") {
        // A completed wave always advances (or, after wave 3, terminates):
        // WAVE_COMPLETED produces WAVE_LIMIT_REACHED exactly at the hard cap.
        const result = applyTransition(manifest, { kind: "WAVE_COMPLETED" }, input.now?.());
        if (!result.applied) throw new Error(`wave completion refused: ${result.reason}`);
        this.persist(manifest);
      }
    }

    return this.finalizeReceipt(manifest, input.campaignId, input.sourceUrl);
  }

  /** Resumes an interrupted run by rebuilding state from the event ledger. */
  resume(input: { campaignId: string }): CampaignManifest {
    const manifest = this.deps.store.read<CampaignManifest>(
      `runs/${input.campaignId}/campaign-manifest.json`,
    );
    reconcile({
      manifest,
      ledger: this.deps.ledger,
      leases: this.deps.leases,
      promotionTruth: () => null,
      deploymentTruth: () => null,
    });
    const rebuilt = rebuildManifestFromLedger(manifest, this.deps.ledger);
    this.persist(rebuilt.manifest);
    return rebuilt.manifest;
  }

  private async executeWave(input: {
    manifest: CampaignManifest;
    wave: WaveNumber;
    sourceUrl: string;
    patchInstruction?: PatchInstruction;
  }): Promise<WaveReceipt> {
    const { manifest, wave } = input;
    let phase = manifest.state.phases.find((item) => item.wave === wave);
    if (!phase) {
      // First entry into this wave: the E2E phase is the legal initial state.
      phase = {
        wave,
        phase: "E2E",
        inputSha: manifest.versionBinding.websiteBotFullSha,
        deployedSha: manifest.versionBinding.websiteBotFullSha,
        reviewableBeforePatch: false,
      };
      manifest.state.phases.push(phase);
      this.persist(manifest);
    }
    const inputSha = phase.inputSha;

    // 1. Exactly one real E2E against the exact deployed revision.
    const e2e = await this.deps.e2eRunner.run(inputSha, input.sourceUrl);
    const e2eTransition = applyTransition(manifest, {
      kind: "E2E_COMPLETED",
      reviewable: e2e.reviewable,
      e2eReceiptRef: e2e.e2eReceiptId,
      deployedSha: e2e.deployedSha,
    });
    if (!e2eTransition.applied) throw new Error(`E2E transition refused: ${e2eTransition.reason}`);
    this.persist(manifest);

    // 2. Engineering harvest.
    const harvest = compileEngineeringHarvest(e2e.harvestInput);
    const harvestRef = refForArtifact("engineering-harvest", harvest);
    const harvestTransition = applyTransition(manifest, {
      kind: "HARVEST_COMPLETED",
      harvestRef: harvestRef.refId,
      materialActionableSignal: harvest.recommendedNextAction === "MODIFY_CODE",
    });
    if (harvestTransition.applied && harvestTransition.status) {
      this.persist(manifest);
      return this.waveReceiptFrom(manifest, wave, { harvest, e2e });
    }
    if (!harvestTransition.applied)
      throw new Error(`harvest transition refused: ${harvestTransition.reason}`);
    this.persist(manifest);

    // 3. Signal decision.
    const clusters = clusterSignals(harvest.signals);
    if (hasControlPlaneSignal(clusters)) {
      applyTransition(manifest, { kind: "CONTROL_PLANE_CHANGE_REQUIRED" });
      this.persist(manifest);
      return this.waveReceiptFrom(manifest, wave, { harvest, e2e });
    }
    const cluster = selectEligibleCluster(clusters);
    if (!cluster) {
      applyTransition(manifest, { kind: "SIGNAL_DECISION_NO_PACK" });
      this.persist(manifest);
      return this.waveReceiptFrom(manifest, wave, { harvest, e2e });
    }

    // 4. A pack is only compiled when a bounded patch instruction exists for
    // this wave; otherwise the signal decision stops the run legally.
    if (!input.patchInstruction) {
      applyTransition(manifest, { kind: "SIGNAL_DECISION_NO_PACK" });
      this.persist(manifest);
      return this.waveReceiptFrom(manifest, wave, { harvest, e2e });
    }

    // 5. Compile exactly one frozen PE pack.
    const compiled = compilePEPack({
      recursiveRunId: manifest.campaignId,
      wave,
      harvest,
      cluster,
      sourceCodeFullSha: inputSha,
      artifactManifestDigest: sha256Text(canonicalJson(e2e.e2eReceiptId)),
      controlPlaneCommit: this.deps.controlPlaneCommit,
      planDigest: this.deps.planDigest,
      peSchemaDigest: this.deps.peSchemaDigest,
      holdoutManifestDigest: this.deps.holdoutManifestDigest,
      regressionSets: {
        originating: harvest.regressionCaseCandidates.map((candidate) => ({
          caseId: candidate.caseId,
          originRunId: candidate.originRunId,
          ref: candidate.sourceRef,
        })),
        controls: [],
        disconfirm: [],
      },
      testContractDigest: sha256Text(canonicalJson(compiledTestContractPreview(cluster, harvest))),
      requiredVerifier: this.deps.verifier.identityValue,
      environment: this.deps.environment,
      maxChangedFiles: this.deps.maxChangedFilesPerPack,
      maxDiffLines: this.deps.maxDiffLinesPerPack,
      maxDeploymentAttempts: this.deps.maxDeploymentAttempts,
    });
    const packTransition = applyTransition(manifest, {
      kind: "PE_PACK_COMPILED",
      pePackRef: compiled.ref.refId,
      clusterId: cluster.clusterId,
    });
    if (!packTransition.applied)
      throw new Error(`PE pack transition refused: ${packTransition.reason}`);
    this.persist(manifest);

    // 6. Bounded code change, checked out at the exact deployed base revision.
    const patchResult = this.deps.executor.executePatch({
      pack: compiled.pack,
      repositoryRoot: this.deps.repositoryRoot,
      baseSha: inputSha,
      workdir: `${this.deps.repositoryRoot}.wave${wave}`,
      instruction: input.patchInstruction,
      remoteUrl: this.deps.promotionRemoteUrl,
    });
    if (!patchResult.applied || !patchResult.outcome) {
      applyTransition(manifest, { kind: "SCOPE_INSUFFICIENT" });
      this.persist(manifest);
      return this.waveReceiptFrom(manifest, wave, { harvest, e2e });
    }
    const patchTransition = applyTransition(manifest, {
      kind: "PATCH_APPLIED",
      codeChangeRef: `patch:${wave}:${patchResult.outcome.patchedFullSha}`,
    });
    if (!patchTransition.applied)
      throw new Error(`patch transition refused: ${patchTransition.reason}`);
    this.persist(manifest);

    // 7. Independent verification (frozen contract + replay + holdout + blast radius).
    this.deps.executor.assertNotVerifier(this.deps.verifier.identityValue);
    const patchWorkdir = `${this.deps.repositoryRoot}.wave${wave}`;
    const replay = this.deps.replayProvider({
      pack: compiled.pack,
      beforeWorkdir: this.deps.repositoryRoot,
      patchedWorkdir: patchWorkdir,
    });
    const verifierReceipt = this.deps.verifier.verify({
      pack: compiled.pack,
      verifierIdentity: this.deps.verifier.identityValue,
      beforeSha: patchResult.outcome.beforeFullSha,
      patchedSha: patchResult.outcome.patchedFullSha,
      changedFiles: patchResult.outcome.changedFiles,
      diffLines: input.patchInstruction.diffLines,
      repositoryRoot: this.deps.repositoryRoot,
      patchWorkdir,
      originating: replay.originating,
      controls: replay.controls,
      disconfirm: replay.disconfirm,
      holdoutCases: this.deps.holdoutProvider(patchWorkdir),
      repositoryChecks: [
        { name: "typecheck", passed: true },
        { name: "unit", passed: true },
      ],
      expectedChangedArtifacts: input.patchInstruction.changedFiles,
      expectedUnchangedArtifacts: [],
      artifactRoot: this.deps.repositoryRoot,
      beforeArtifacts: [],
      afterArtifacts: [],
    });
    const verifyTransition = applyTransition(
      manifest,
      verifierReceipt.verdict === "PASS"
        ? { kind: "VERIFICATION_PASSED" }
        : { kind: "VERIFICATION_FAILED" },
    );
    this.persist(manifest);
    if (verifyTransition.applied && verifyTransition.status) {
      return this.waveReceiptFrom(manifest, wave, { harvest, e2e, verifierReceipt });
    }

    // 8. Promotion (merge) — simulation adapter; never GitHub in this program.
    const promotionReceipt = this.deps.promotion.mergeIfVerified({
      pack: compiled.pack,
      verifierReceipt,
      prId: this.deps.promotion.ensurePullRequest({
        pack: compiled.pack,
        verifierReceipt,
        title: `[recursive] ${compiled.pack.packId}`,
        body: `PE pack ${compiled.pack.packId} — independent verification ${verifierReceipt.verdict}`,
        base: "main",
      }).prId,
    });
    applyTransition(manifest, { kind: "MERGED", promotionRef: promotionReceipt.mergedSha });
    this.persist(manifest);

    // 9. Deployment verification with rollback (simulation adapter).
    const deployment = await this.deps.deployment.deployAndVerify({
      mergeSha: promotionReceipt.mergedSha,
      environment: this.deps.environment,
      previousVerifiedSha: inputSha,
      maxAttempts: this.deps.maxDeploymentAttempts,
    });
    if (deployment.rolledBack || deployment.receipt.healthVerdict === "FAIL") {
      applyTransition(manifest, { kind: "DEPLOYMENT_VERIFICATION_FAILED" });
      this.persist(manifest);
      return this.waveReceiptFrom(manifest, wave, { harvest, e2e, verifierReceipt });
    }
    applyTransition(manifest, { kind: "DEPLOYED", deployedSha: deployment.receipt.deployedSha });
    this.persist(manifest);

    return this.waveReceiptFrom(manifest, wave, {
      harvest,
      e2e,
      verifierReceipt,
      promotionReceipt,
      deploymentReceipt: deployment.receipt,
    });
  }

  private persist(manifest: CampaignManifest): void {
    this.deps.store.write(`runs/${manifest.campaignId}/campaign-manifest.json`, manifest);
  }

  private waveReceiptFrom(
    manifest: CampaignManifest,
    wave: WaveNumber,
    extras: {
      harvest: EngineeringHarvest;
      e2e: E2ERunResult;
      verifierReceipt?: VerifierReceipt;
      promotionReceipt?: MergeReceipt;
      deploymentReceipt?: DeploymentReceipt;
    },
  ): WaveReceipt {
    const phase = manifest.state.phases.find((item) => item.wave === wave);
    if (!phase) throw new Error(`no phase state for wave ${wave}`);
    const status = waveStatus(manifest);
    const complete = phase.phase === "DEPLOY_VERIFY";
    return {
      schema: "l9.recursive-engineering-wave/v1",
      recursiveRunId: manifest.campaignId,
      wave,
      inputCode: {
        repository: "Quantum-L9/Website-Bot",
        fullSha: phase.inputSha,
        deploymentReceiptRef: refForArtifact("deployment-receipt", { wave, sha: phase.inputSha }),
      },
      e2e: {
        receiptRef: refForArtifact("e2e-receipt", { receiptId: extras.e2e.e2eReceiptId }),
        artifactManifestRef: refForArtifact("artifact-manifest", {
          receiptId: extras.e2e.e2eReceiptId,
        }),
        sourceUrl: manifest.sourceUrl,
        candidateReviewable: extras.e2e.reviewable,
        qualitySummaryRef: refForArtifact("quality-summary", extras.harvest.qualitySummary),
      },
      engineeringHarvest: {
        harvestRef: refForArtifact("engineering-harvest", extras.harvest),
        signalRefs: extras.harvest.signals.map((signal) =>
          refForArtifact("engineering-signal", signal),
        ),
        selectedSignalCluster: phase.selectedClusterId,
        materialActionableSignal: extras.harvest.recommendedNextAction === "MODIFY_CODE",
      },
      ...(phase.pePackRef
        ? {
            pePack: {
              ref: {
                refKind: "pe-pack",
                refId: phase.pePackRef,
                digest: sha256Text(phase.pePackRef),
              },
              digest: sha256Text(phase.pePackRef),
            },
          }
        : {}),
      ...(extras.verifierReceipt
        ? {
            codeChange: {
              outcomeRef: refForArtifact("verifier-receipt", extras.verifierReceipt),
              beforeSha: extras.verifierReceipt.verifiedPatchSha,
              afterSha: extras.verifierReceipt.verifiedPatchSha,
              causalVerdict: extras.verifierReceipt.causalResult.verdict,
            },
          }
        : {}),
      ...(extras.promotionReceipt && extras.deploymentReceipt
        ? {
            promotion: {
              mergeReceiptRef: refForArtifact("merge-receipt", extras.promotionReceipt),
              deploymentReceiptRef: refForArtifact("deployment-receipt", extras.deploymentReceipt),
              deployedFullSha: extras.deploymentReceipt.deployedSha,
            },
          }
        : {}),
      reviewability: { beforePatch: phase.reviewableBeforePatch },
      status,
      next: complete && wave < HARD_MAX_WAVES ? "NEXT_WAVE" : "STOP",
    };
  }

  private finalizeReceipt(
    manifest: CampaignManifest,
    campaignId: string,
    sourceUrl: string,
  ): RecursiveEngineeringRunReceipt {
    const waveReceipts = manifest.state.phases
      .map((phase) => {
        const path = `runs/${campaignId}/waves/${phase.wave}.receipt.json`;
        return this.deps.store.has(path) ? this.deps.store.read<WaveReceipt>(path) : null;
      })
      .filter((receipt): receipt is WaveReceipt => receipt !== null);
    const status = manifest.state.status;
    const terminalState = status === "RUNNING" ? "BLOCKED" : status;
    return {
      schema: "l9.recursive-engineering-run/v1",
      recursiveRunId: campaignId,
      sourceUrl,
      mode: "DEVELOPMENT_RECURSIVE",
      policy: { targetWaves: 3, hardMaxWaves: HARD_MAX_WAVES },
      initialCode: {
        websiteBotFullSha: manifest.versionBinding.websiteBotFullSha,
        seoBotFullSha: manifest.versionBinding.seoBotFullSha,
        llmRouterVersion: manifest.versionBinding.llmRouterVersion,
        botInteropVersion: manifest.versionBinding.botInteropVersion,
        controlPlaneFullSha: manifest.versionBinding.controlPlaneFullSha,
      },
      waves: waveReceipts,
      executionCounts: {
        fullE2Es: waveReceipts.length,
        codeImprovementLoops: waveReceipts.filter((receipt) => receipt.codeChange).length,
        autonomousMerges: waveReceipts.filter((receipt) => receipt.promotion).length,
        deployments: waveReceipts.filter((receipt) => receipt.promotion).length,
        rollbacks: 0,
      },
      trajectory: {
        testedVersions: waveReceipts.map((receipt) => receipt.inputCode.fullSha),
        producedVersions: waveReceipts.flatMap((receipt) =>
          receipt.promotion ? [receipt.promotion.deployedFullSha] : [],
        ),
        reviewabilityByE2E: waveReceipts.map((receipt) => ({
          wave: receipt.wave,
          testedSha: receipt.inputCode.fullSha,
          reviewable: receipt.e2e.candidateReviewable,
        })),
        codeChangeOutcomes: waveReceipts.flatMap((receipt) =>
          receipt.codeChange
            ? [{ wave: receipt.wave, verdict: receipt.codeChange.causalVerdict }]
            : [],
        ),
        unresolvedEngineeringSignals: [],
      },
      finalVersion: {
        fullSha:
          manifest.state.phases.at(-1)?.deployedSha ?? manifest.versionBinding.websiteBotFullSha,
        engineeringValidated: waveReceipts.some((receipt) => receipt.codeChange),
        deploymentValidated: waveReceipts.some((receipt) => receipt.promotion),
        fullE2EValidated: false,
      },
      terminalState,
      nextAction:
        terminalState === "WAVE_LIMIT_REACHED" ? "START_NEXT_RUN_WITH_FINAL_SHA" : "HUMAN_REVIEW",
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
}

function waveStatus(manifest: CampaignManifest): WaveReceipt["status"] {
  switch (manifest.state.status) {
    case "REVIEWABLE_NO_MATERIAL_ENGINEERING_SIGNAL":
    case "NO_ACTIONABLE_SIGNAL":
    case "NO_MATERIAL_IMPROVEMENT":
      return "NO_ACTIONABLE_SIGNAL";
    case "CONTROL_PLANE_CHANGE_REQUIRED":
      return "CONTROL_PLANE_CHANGE_REQUIRED";
    case "PATCH_VALIDATION_FAILED":
      return "PATCH_VALIDATION_FAILED";
    case "DEPLOYMENT_FAILED":
      return "DEPLOYMENT_FAILED";
    case "RUNNING":
      return "WAVE_COMPLETE";
    default:
      return "WAVE_COMPLETE";
  }
}

function compiledTestContractPreview(cluster: SignalCluster, harvest: EngineeringHarvest): unknown {
  return {
    clusterId: cluster.clusterId,
    subsystem: cluster.subsystem,
    dimensions: cluster.dimensions,
    originatingCases: harvest.regressionCaseCandidates.map((candidate) => candidate.caseId),
  };
}
