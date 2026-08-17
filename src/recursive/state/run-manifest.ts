// L9_META: layer=recursive, role=campaign_manifest_contract, status=active, version=1.0.0
import type { WaveNumber } from "../contracts/types.js";
import { HARD_MAX_WAVES, TARGET_WAVES } from "./constants.js";

export type RunStatus =
  | "RUNNING"
  | "REVIEWABLE_NO_MATERIAL_ENGINEERING_SIGNAL"
  | "NO_ACTIONABLE_SIGNAL"
  | "NO_MATERIAL_IMPROVEMENT"
  | "CONTROL_PLANE_CHANGE_REQUIRED"
  | "PATCH_VALIDATION_FAILED"
  | "DEPLOYMENT_FAILED"
  | "BLOCKED"
  | "FATAL"
  | "WAVE_LIMIT_REACHED";

export type WavePhase =
  | "E2E"
  | "HARVEST"
  | "SIGNAL_DECISION"
  | "PE_PACK"
  | "PATCH"
  | "VERIFY"
  | "MERGE"
  | "DEPLOY"
  | "DEPLOY_VERIFY";

export interface WaveState {
  wave: WaveNumber;
  phase: WavePhase;
  inputSha: string;
  deployedSha: string;
  e2eReceiptRef?: string;
  harvestRef?: string;
  selectedClusterId?: string;
  pePackRef?: string;
  codeChangeRef?: string;
  promotionRef?: string;
  reviewableBeforePatch: boolean;
}

export interface CampaignManifest {
  schema: "l9.recursive.campaign-manifest/v1";
  campaignId: string;
  sourceUrl: string;
  mode: "DEVELOPMENT_RECURSIVE";
  limits: {
    maxWaves: typeof TARGET_WAVES;
    hardMaxWaves: typeof HARD_MAX_WAVES;
    maxCodeChangeCandidatesPerWave: 1;
    maxPatchRepairsPerWave: 1;
  };
  state: {
    currentWave: WaveNumber;
    status: RunStatus;
    phases: WaveState[];
  };
  versionBinding: {
    websiteBotFullSha: string;
    seoBotFullSha: string;
    llmRouterVersion: string;
    botInteropVersion: string;
    controlPlaneFullSha: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const CAMPAIGN_MANIFEST_SCHEMA = "l9.recursive.campaign-manifest/v1";

const SHA1 = /^[a-f0-9]{40}$/;
const TERMINAL = new Set<RunStatus>([
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

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export function isLegalWave(value: number): value is WaveNumber {
  return value === 1 || value === 2 || value === 3;
}

export function nextWave(current: WaveNumber): WaveNumber | null {
  if (current >= HARD_MAX_WAVES) return null;
  return (current + 1) as WaveNumber;
}

export function createCampaignManifest(input: {
  campaignId: string;
  sourceUrl: string;
  websiteBotFullSha: string;
  seoBotFullSha: string;
  llmRouterVersion: string;
  botInteropVersion: string;
  controlPlaneFullSha: string;
  now?: string;
}): CampaignManifest {
  const now = input.now ?? new Date().toISOString();
  return {
    schema: CAMPAIGN_MANIFEST_SCHEMA,
    campaignId: input.campaignId,
    sourceUrl: input.sourceUrl,
    mode: "DEVELOPMENT_RECURSIVE",
    limits: {
      maxWaves: TARGET_WAVES,
      hardMaxWaves: HARD_MAX_WAVES,
      maxCodeChangeCandidatesPerWave: 1,
      maxPatchRepairsPerWave: 1,
    },
    state: {
      currentWave: 1,
      status: "RUNNING",
      phases: [],
    },
    versionBinding: {
      websiteBotFullSha: input.websiteBotFullSha,
      seoBotFullSha: input.seoBotFullSha,
      llmRouterVersion: input.llmRouterVersion,
      botInteropVersion: input.botInteropVersion,
      controlPlaneFullSha: input.controlPlaneFullSha,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function validateCampaignManifest(value: unknown): asserts value is CampaignManifest {
  if (!value || typeof value !== "object") throw new Error("campaign manifest must be an object");
  const manifest = value as Partial<CampaignManifest>;
  if (manifest.schema !== CAMPAIGN_MANIFEST_SCHEMA || !manifest.campaignId) {
    throw new Error("campaign manifest identity is invalid");
  }
  if (!manifest.sourceUrl || typeof manifest.sourceUrl !== "string")
    throw new Error("campaign manifest source URL is invalid");
  if (manifest.mode !== "DEVELOPMENT_RECURSIVE")
    throw new Error("campaign manifest mode is invalid");
  const limits = manifest.limits;
  if (!limits || limits.maxWaves !== 3 || limits.hardMaxWaves !== 3) {
    throw new Error("campaign manifest wave limits must be exactly three");
  }
  if (
    !manifest.state ||
    !isLegalWave(manifest.state.currentWave) ||
    (!TERMINAL.has(manifest.state.status as RunStatus) && manifest.state.status !== "RUNNING")
  ) {
    throw new Error("campaign manifest state is invalid");
  }
  for (const [key, value] of Object.entries(manifest.versionBinding ?? {})) {
    if (key.endsWith("FullSha") && !SHA1.test(String(value)))
      throw new Error(`campaign manifest ${key} is not a full SHA`);
  }
}
