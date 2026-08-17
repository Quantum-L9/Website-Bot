// L9_META: layer=recursive, role=state_machine_authority, status=active, version=1.0.0
// The recursive run state machine. Transitions are atomic: a transition is
// applied only when its precondition evidence passes, and each application
// persists one new state record. This module is control plane; the pack's
// execution DAG is the SSOT for the legal transition graph.
import type { WaveNumber } from "../contracts/types.js";
import { HARD_MAX_WAVES } from "./constants.js";
import {
  type CampaignManifest,
  isLegalWave,
  type RunStatus,
  type WavePhase,
  type WaveState,
} from "./run-manifest.js";

const PHASE_ORDER: readonly WavePhase[] = [
  "E2E",
  "HARVEST",
  "SIGNAL_DECISION",
  "PE_PACK",
  "PATCH",
  "VERIFY",
  "MERGE",
  "DEPLOY",
  "DEPLOY_VERIFY",
];

export type TransitionAction =
  | { kind: "E2E_COMPLETED"; reviewable: boolean; e2eReceiptRef: string; deployedSha: string }
  | { kind: "HARVEST_COMPLETED"; harvestRef: string; materialActionableSignal: boolean }
  | { kind: "SIGNAL_DECISION_NO_PACK" }
  | { kind: "CONTROL_PLANE_CHANGE_REQUIRED" }
  | { kind: "PE_PACK_COMPILED"; pePackRef: string; clusterId: string }
  | { kind: "PATCH_APPLIED"; codeChangeRef: string }
  | { kind: "PATCH_VALIDATION_FAILED" }
  | { kind: "SCOPE_INSUFFICIENT" }
  | { kind: "VERIFICATION_PASSED" }
  | { kind: "VERIFICATION_FAILED" }
  | { kind: "MERGED"; promotionRef: string }
  | { kind: "DEPLOYED"; deployedSha: string }
  | { kind: "DEPLOYMENT_VERIFICATION_FAILED" }
  | { kind: "WAVE_COMPLETED" };

export interface TransitionResult {
  applied: boolean;
  reason?: string;
  status?: RunStatus;
}

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "REVIEWABLE_NO_MATERIAL_ENGINEERING_SIGNAL",
  "NO_ACTIONABLE_SIGNAL",
  "NO_MATERIAL_IMPROVEMENT",
  "CONTROL_PLANE_CHANGE_REQUIRED",
  "PATCH_VALIDATION_FAILED",
  "DEPLOYMENT_FAILED",
  "BLOCKED",
  "FATAL",
  "WAVE_LIMIT_REACHED",
]);

export function isTerminal(manifest: CampaignManifest): boolean {
  return TERMINAL_STATUSES.has(manifest.state.status);
}

function currentWaveState(manifest: CampaignManifest): WaveState {
  const wave = manifest.state.currentWave;
  const existing = manifest.state.phases.find((phase) => phase.wave === wave);
  if (existing) return existing;
  const fresh: WaveState = {
    wave,
    phase: "E2E",
    inputSha: manifest.versionBinding.websiteBotFullSha,
    deployedSha: manifest.versionBinding.websiteBotFullSha,
    reviewableBeforePatch: false,
  };
  manifest.state.phases.push(fresh);
  return fresh;
}

/**
 * Applies one legal transition and returns the resulting terminal status when
 * the transition ends the run. Attempted wave four is unrepresentable: no
 * action can produce a fourth wave, and any attempt is hard rejected.
 */
export function applyTransition(
  manifest: CampaignManifest,
  action: TransitionAction,
  now?: string,
): TransitionResult {
  const stamp = () => {
    manifest.updatedAt = now ?? new Date().toISOString();
  };
  if (isTerminal(manifest)) {
    return { applied: false, reason: `run already terminal: ${manifest.state.status}` };
  }
  // Phase checks use the EXISTING wave state (defaulting to E2E before the
  // first transition). A rejected transition must never mutate the manifest,
  // so the wave state is only created inside succeeding branches.
  const existing = manifest.state.phases.find((phase) => phase.wave === manifest.state.currentWave);
  const state: WaveState = existing ?? {
    wave: manifest.state.currentWave,
    phase: "E2E",
    inputSha: manifest.versionBinding.websiteBotFullSha,
    deployedSha: manifest.versionBinding.websiteBotFullSha,
    reviewableBeforePatch: false,
  };
  const ensure = (): WaveState => {
    if (!manifest.state.phases.includes(state)) manifest.state.phases.push(state);
    return state;
  };

  const reject = (reason: string): TransitionResult => ({ applied: false, reason });

  switch (action.kind) {
    case "E2E_COMPLETED":
      if (state.phase !== "E2E") return reject(`E2E already completed in wave ${state.wave}`);
      ensure();
      state.phase = "HARVEST";
      state.e2eReceiptRef = action.e2eReceiptRef;
      state.reviewableBeforePatch = action.reviewable;
      state.deployedSha = action.deployedSha;
      stamp();
      return { applied: true };

    case "HARVEST_COMPLETED":
      if (state.phase !== "HARVEST") return reject(`harvest is not due in phase ${state.phase}`);
      ensure();
      state.harvestRef = action.harvestRef;
      state.phase = "SIGNAL_DECISION";
      stamp();
      if (!action.materialActionableSignal) {
        if (state.reviewableBeforePatch) {
          manifest.state.status = "REVIEWABLE_NO_MATERIAL_ENGINEERING_SIGNAL";
        } else {
          manifest.state.status = "NO_ACTIONABLE_SIGNAL";
        }
        stamp();
        return { applied: true, status: manifest.state.status };
      }
      return { applied: true };

    case "SIGNAL_DECISION_NO_PACK":
      if (state.phase !== "SIGNAL_DECISION")
        return reject(`signal decision is not due in phase ${state.phase}`);
      manifest.state.status = state.reviewableBeforePatch
        ? "REVIEWABLE_NO_MATERIAL_ENGINEERING_SIGNAL"
        : "NO_ACTIONABLE_SIGNAL";
      stamp();
      return { applied: true, status: manifest.state.status };

    case "CONTROL_PLANE_CHANGE_REQUIRED":
      manifest.state.status = "CONTROL_PLANE_CHANGE_REQUIRED";
      stamp();
      return { applied: true, status: manifest.state.status };

    case "PE_PACK_COMPILED":
      if (state.phase !== "SIGNAL_DECISION")
        return reject(`PE pack is not due in phase ${state.phase}`);
      ensure();
      state.pePackRef = action.pePackRef;
      state.selectedClusterId = action.clusterId;
      state.phase = "PATCH";
      stamp();
      return { applied: true };

    case "PATCH_APPLIED":
      if (state.phase !== "PATCH") return reject(`patch is not due in phase ${state.phase}`);
      ensure();
      state.codeChangeRef = action.codeChangeRef;
      state.phase = "VERIFY";
      stamp();
      return { applied: true };

    case "PATCH_VALIDATION_FAILED":
      if (state.phase !== "VERIFY")
        return reject(`patch validation is not due in phase ${state.phase}`);
      manifest.state.status = "PATCH_VALIDATION_FAILED";
      stamp();
      return { applied: true, status: manifest.state.status };

    case "SCOPE_INSUFFICIENT":
      if (state.phase !== "VERIFY")
        return reject(`scope verdict is not due in phase ${state.phase}`);
      manifest.state.status = "PATCH_VALIDATION_FAILED";
      stamp();
      return { applied: true, status: manifest.state.status };

    case "VERIFICATION_PASSED":
      if (state.phase !== "VERIFY")
        return reject(`verification is not due in phase ${state.phase}`);
      ensure();
      state.phase = "MERGE";
      stamp();
      return { applied: true };

    case "VERIFICATION_FAILED":
      if (state.phase !== "VERIFY")
        return reject(`verification is not due in phase ${state.phase}`);
      manifest.state.status = "PATCH_VALIDATION_FAILED";
      stamp();
      return { applied: true, status: manifest.state.status };

    case "MERGED":
      if (state.phase !== "MERGE") return reject(`merge is not due in phase ${state.phase}`);
      ensure();
      state.promotionRef = action.promotionRef;
      state.phase = "DEPLOY";
      stamp();
      return { applied: true };

    case "DEPLOYED":
      if (state.phase !== "DEPLOY") return reject(`deployment is not due in phase ${state.phase}`);
      ensure();
      state.deployedSha = action.deployedSha;
      state.phase = "DEPLOY_VERIFY";
      stamp();
      return { applied: true };

    case "DEPLOYMENT_VERIFICATION_FAILED":
      if (state.phase !== "DEPLOY_VERIFY")
        return reject(`deployment verification is not due in phase ${state.phase}`);
      manifest.state.status = "DEPLOYMENT_FAILED";
      stamp();
      return { applied: true, status: manifest.state.status };

    case "WAVE_COMPLETED": {
      if (state.phase !== "DEPLOY_VERIFY")
        return reject(`wave completion is not due in phase ${state.phase}`);
      const next = nextWaveAfter(state.wave);
      if (next === null) {
        manifest.state.status = "WAVE_LIMIT_REACHED";
        stamp();
        return { applied: true, status: manifest.state.status };
      }
      // The completed wave's phase stays DEPLOY_VERIFY as its durable record;
      // only the fresh wave is initialized.
      manifest.state.currentWave = next;
      const fresh = currentWaveState(manifest);
      fresh.phase = "E2E";
      fresh.inputSha = state.deployedSha;
      fresh.deployedSha = state.deployedSha;
      stamp();
      return { applied: true };
    }

    default:
      return reject(`unknown action ${(action as TransitionAction).kind}`);
  }
}

function nextWaveAfter(wave: WaveNumber): WaveNumber | null {
  const next = wave + 1;
  if (!isLegalWave(next) || next > HARD_MAX_WAVES) return null;
  return next as WaveNumber;
}

export function phaseIndex(phase: WavePhase): number {
  return PHASE_ORDER.indexOf(phase);
}

export { PHASE_ORDER };
