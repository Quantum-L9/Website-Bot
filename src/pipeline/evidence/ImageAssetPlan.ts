// L9_META: layer=pipeline, role=image_asset_plan_contract, status=active, version=1.0.0
//
// The image asset plan is the decision record produced by ImageAssetPlanningStage:
// for every declared image slot it names the resolved source (a provided image, a
// source-site candidate, a generation brief, the built-in static conceptual
// illustration, or an explicit unresolved reason). Generation stages consume only
// the `generated` entries; assembly consumes the resolved images collected on the
// BuildContext and renders `static-illustration` entries as inline SVG (no file).

/** The one placement a static conceptual illustration may fill: the home hero. */
export const STATIC_ILLUSTRATION_PLACEMENT = "/:hero";
/** The built-in illustration (CRM rows → relationship graph) used for the home hero. */
export const HOME_HERO_ILLUSTRATION_ID = "crm-to-graph";

/**
 * Which client verticals each built-in illustration truthfully depicts. The
 * CRM rows → relationship graph diagram describes a data / CRM / software
 * business; on a roofer's or plumber's home page it is a wrong picture, not a
 * fallback. An illustration is eligible only for a declared vertical whose
 * tokens include one of these; an undeclared vertical never matches.
 */
export const STATIC_ILLUSTRATION_VERTICALS: Readonly<Record<string, readonly string[]>> = {
  [HOME_HERO_ILLUSTRATION_ID]: [
    "ai",
    "analytics",
    "automation",
    "crm",
    "data",
    "saas",
    "software",
    "technology",
    "tech",
  ],
};

/** True when the illustration fits the client's declared vertical. */
export function illustrationFitsVertical(
  illustrationId: string,
  vertical: string | undefined,
): boolean {
  const fits = STATIC_ILLUSTRATION_VERTICALS[illustrationId];
  if (!fits || !vertical) return false;
  const tokens = vertical
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => fits.includes(token));
}

/** Compiled generation instruction for a slot that must be produced, not reused. */
export interface ImageGenerationBrief {
  slotId: string;
  intent: string;
  subject?: string;
  composition?: string;
  style?: string;
  exclusions?: string[];
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
}

export type ImageAssetResolution =
  | { source: "provided"; candidateId: string; score: number }
  | { source: "source-site"; candidateId: string; score: number }
  | { source: "generated"; compiledBrief: ImageGenerationBrief }
  /**
   * Operator decision D1 (2026-11-17): the required home hero may be filled by
   * a built-in, static, labelled conceptual illustration rendered as inline
   * SVG. No file is staged; there is nothing on disk for this source.
   */
  | { source: "static-illustration"; illustrationId: string; reason: string }
  | { source: "unresolved"; reason: string };

export interface PlannedImageAsset {
  slotId: string;
  placement: string;
  required: boolean;
  resolution: ImageAssetResolution;
}

export interface ImageAssetPlan {
  schema: "website-bot.image-asset-plan/v1";
  version: string;
  assets: PlannedImageAsset[];
}

/** Required slots the plan could not satisfy from any allowed source. */
export function unresolvedRequiredSlots(plan: ImageAssetPlan): PlannedImageAsset[] {
  return plan.assets.filter((asset) => asset.required && asset.resolution.source === "unresolved");
}

const RESOLUTION_SOURCES = new Set([
  "provided",
  "source-site",
  "generated",
  "static-illustration",
  "unresolved",
]);

export type StaticIllustrationResolution = Extract<
  ImageAssetResolution,
  { source: "static-illustration" }
>;
export type IllustratedImageAsset = PlannedImageAsset & {
  resolution: StaticIllustrationResolution;
};

/** Plan entries filled by a static conceptual illustration (no image file). */
export function staticIllustrationAssets(
  plan: ImageAssetPlan | undefined,
): IllustratedImageAsset[] {
  return (plan?.assets ?? []).filter(
    (asset): asset is IllustratedImageAsset => asset.resolution.source === "static-illustration",
  );
}

/** Assert an object is a structurally valid image asset plan (persisted evidence). */
export function validateImageAssetPlan(value: unknown): asserts value is ImageAssetPlan {
  if (!value || typeof value !== "object") throw new Error("image asset plan must be an object");
  const plan = value as Partial<ImageAssetPlan>;
  if (plan.schema !== "website-bot.image-asset-plan/v1" || !plan.version)
    throw new Error("image asset plan identity is invalid");
  if (!Array.isArray(plan.assets)) throw new Error("image asset plan assets must be an array");
  for (const asset of plan.assets) {
    if (!asset.slotId || !asset.placement)
      throw new Error("image asset plan entry identity is invalid");
    if (!asset.resolution || !RESOLUTION_SOURCES.has(asset.resolution.source)) {
      throw new Error(`invalid resolution source for ${asset.slotId}`);
    }
    if (asset.resolution.source === "static-illustration") {
      if (!asset.resolution.illustrationId)
        throw new Error(`static illustration for ${asset.slotId} names no illustration`);
      // Hero only: a factual or any other placement is never an illustration.
      if (asset.placement !== STATIC_ILLUSTRATION_PLACEMENT)
        throw new Error(
          `static illustration is only valid for ${STATIC_ILLUSTRATION_PLACEMENT}, not ${asset.placement}`,
        );
    }
  }
}
