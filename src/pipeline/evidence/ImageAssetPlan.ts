// L9_META: layer=pipeline, role=image_asset_plan_contract, status=active, version=1.0.0
//
// The image asset plan is the decision record produced by ImageAssetPlanningStage:
// for every declared image slot it names the resolved source (a provided image, a
// source-site candidate, a generation brief, or an explicit unresolved reason).
// Generation stages consume only the `generated` entries; assembly consumes the
// resolved images collected on the BuildContext.

/** Compiled generation instruction for a slot that must be produced, not reused. */
export interface ImageGenerationBrief {
  slotId: string;
  intent: string;
  subject?: string;
  composition?: string;
  style?: string;
  exclusions?: string[];
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
}

export type ImageAssetResolution =
  | { source: 'provided'; candidateId: string; score: number }
  | { source: 'source-site'; candidateId: string; score: number }
  | { source: 'generated'; compiledBrief: ImageGenerationBrief }
  | { source: 'unresolved'; reason: string };

export interface PlannedImageAsset {
  slotId: string;
  placement: string;
  required: boolean;
  resolution: ImageAssetResolution;
}

export interface ImageAssetPlan {
  schema: 'website-bot.image-asset-plan/v1';
  version: string;
  assets: PlannedImageAsset[];
}

/** Required slots the plan could not satisfy from any allowed source. */
export function unresolvedRequiredSlots(plan: ImageAssetPlan): PlannedImageAsset[] {
  return plan.assets.filter(asset => asset.required && asset.resolution.source === 'unresolved');
}

const RESOLUTION_SOURCES = new Set(['provided', 'source-site', 'generated', 'unresolved']);

/** Assert an object is a structurally valid image asset plan (persisted evidence). */
export function validateImageAssetPlan(value: unknown): asserts value is ImageAssetPlan {
  if (!value || typeof value !== 'object') throw new Error('image asset plan must be an object');
  const plan = value as Partial<ImageAssetPlan>;
  if (plan.schema !== 'website-bot.image-asset-plan/v1' || !plan.version) throw new Error('image asset plan identity is invalid');
  if (!Array.isArray(plan.assets)) throw new Error('image asset plan assets must be an array');
  for (const asset of plan.assets) {
    if (!asset.slotId || !asset.placement) throw new Error('image asset plan entry identity is invalid');
    if (!asset.resolution || !RESOLUTION_SOURCES.has(asset.resolution.source)) {
      throw new Error(`invalid resolution source for ${asset.slotId}`);
    }
  }
}
