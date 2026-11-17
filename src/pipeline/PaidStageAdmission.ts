// L9_META: layer=pipeline, role=paid_stage_admission, status=active, version=1.0.0
//
// Stage-level spend admission for costs that are not dispatched through the
// build's LLM adapter:
//   - DataForSEO is billed inside SEO-Bot. Website-Bot receives no billed
//     figure, so each SEO-Bot paid stage execution is admitted and charged at
//     the configured reserve (an upper bound, recorded as such).
//   - Image generation is admitted against the spec's generation budget (the
//     stage's own in-call ImageBudget limit) and charged from the cost each
//     fresh generation writes into the persistent asset cache.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BuildContext, clientPersistentAssetRoot } from "./BuildContext.js";
import { loadPersistedRedesignIntelligence } from "./evidence/RedesignIntelligenceArtifacts.js";
import type { SpendLedger } from "./SpendLedger.js";

/** SEO-Bot build-intelligence stages and the persisted artifacts that let them self-hydrate. */
const SEO_BOT_PAID_STAGES: Record<
  string,
  (keyof ReturnType<typeof loadPersistedRedesignIntelligence>)[]
> = {
  "competitive-intelligence": ["competitiveLandscape", "acceptedDonors", "websiteBlueprint"],
  "redesign-content-authority": [
    "seoContentBlueprint",
    "pageContentContract",
    "pccDeterminism",
    "structuredContentPackage",
  ],
};

export const IMAGE_GENERATION_STAGE = "image-generation";

export function isSeoBotPaidStage(stage: string): boolean {
  return stage in SEO_BOT_PAID_STAGES;
}

/** True when a resumed SEO-Bot stage will rehydrate from sealed artifacts without a paid call. */
function seoBotStageWillHydrate(ctx: BuildContext, stage: string): boolean {
  if (!ctx.resume || ctx.dryRun) return false;
  const required = SEO_BOT_PAID_STAGES[stage] ?? [];
  try {
    const persisted = loadPersistedRedesignIntelligence(ctx);
    return required.every((key) => persisted[key] !== undefined);
  } catch {
    // Corrupt or broken lineage: the stage itself fails closed; treat as paid.
    return false;
  }
}

function generatedCacheDir(ctx: BuildContext): string {
  return resolve(clientPersistentAssetRoot(ctx), "generated");
}

function cacheMetadataFiles(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((name) => name.endsWith(".json")));
}

function plannedGenerations(ctx: BuildContext): number {
  return (ctx.imageAssetPlan?.assets ?? []).filter(
    (asset) => asset.resolution.source === "generated",
  ).length;
}

/**
 * Admit a stage's non-LLM paid work before it starts. Returns the settlement
 * to run after the stage (success or failure) to charge what was spent.
 * Throws BUDGET_EXCEEDED (via the ledger) before any paid work begins.
 */
export function admitPaidStage(ctx: BuildContext, ledger: SpendLedger, stage: string): () => void {
  if (isSeoBotPaidStage(stage) && ctx.buildIntent === "REDESIGN_IMPROVE") {
    if (seoBotStageWillHydrate(ctx, stage)) return () => {};
    const reserve = ledger.reserve.dataforseo;
    ledger.admit("dataforseo", reserve, stage);
    return () => ledger.charge("dataforseo", reserve, "upper_bound", stage);
  }
  if (stage === IMAGE_GENERATION_STAGE) {
    const dir = generatedCacheDir(ctx);
    const before = cacheMetadataFiles(dir);
    if (plannedGenerations(ctx) > 0 && ctx.domainSpec.assets?.generation?.enabled !== false) {
      const budget = ctx.domainSpec.assets?.generation?.budgetUsd;
      ledger.admit("images", budget ?? ledger.reserve.images, stage);
    }
    return () => {
      let spent = 0;
      for (const name of cacheMetadataFiles(dir)) {
        if (before.has(name)) continue;
        try {
          const meta = JSON.parse(readFileSync(join(dir, name), "utf-8")) as {
            estimatedCostUsd?: unknown;
          };
          if (typeof meta.estimatedCostUsd === "number" && meta.estimatedCostUsd > 0)
            spent += meta.estimatedCostUsd;
        } catch {
          // A torn metadata file carries no cost figure; the image budget bounded it.
        }
      }
      if (spent > 0) ledger.charge("images", spent, "cache_metadata", stage);
    };
  }
  return () => {};
}
