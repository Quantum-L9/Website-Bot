// L9_META: layer=service, role=image_asset_planner, status=active, version=1.0.0
//
// Deterministic slot → source resolution. Given the declared image slots, the
// provided-image inventory, and the source-site candidates, decide which source
// fills each slot. Selection is deterministic and LLM-free: candidates are
// scored on placement, aspect ratio, resolution, and alt-text signals, and the
// configured source precedence (provided → source-site → generated) breaks ties.
// Ambiguous semantic ranking is a later, optional refinement — never basic
// filtering.

import type { ImageSlotSpec } from '../../pipeline/BuildContext.js';
import type { IngestedImage } from '../../pipeline/evidence/SourceSiteManifest.js';
import type {
  ImageAssetPlan,
  ImageGenerationBrief,
  ImageAssetResolution,
  PlannedImageAsset,
} from '../../pipeline/evidence/ImageAssetPlan.js';

export const IMAGE_ASSET_PLAN_VERSION = '1.0.0';
const DEFAULT_PRECEDENCE: Array<'provided' | 'source-site' | 'generated'> = ['provided', 'source-site', 'generated'];
const MIN_ACCEPTABLE_SCORE = 1;

/** A provided image after inspection, ready to be scored against slots. */
export interface ProvidedCandidate {
  id: string;
  intendedPlacement?: string;
  altText?: string;
  width: number;
  height: number;
  mimeType?: string;
}

export function parseAspectRatio(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!h) return undefined;
  return w / h;
}

/** True when a candidate's dimensions match the slot's target ratio (±8%). */
export function aspectMatches(slot: ImageSlotSpec, width: number, height: number): boolean {
  const target = parseAspectRatio(slot.aspectRatio);
  if (target === undefined || !width || !height) return false;
  const actual = width / height;
  return Math.abs(actual - target) / target <= 0.08;
}

function altKeywordMatch(slot: ImageSlotSpec, altText: string | undefined): boolean {
  if (!altText || !slot.altText) return false;
  const wanted = slot.altText.toLowerCase().split(/\W+/).filter(word => word.length > 3);
  if (wanted.length === 0) return false;
  const haystack = altText.toLowerCase();
  return wanted.some(word => haystack.includes(word));
}

export function scoreProvided(slot: ImageSlotSpec, candidate: ProvidedCandidate): number {
  let score = 0;
  if (candidate.intendedPlacement === slot.placement) score += 60;
  else if (candidate.intendedPlacement && candidate.intendedPlacement !== slot.placement) return Number.NEGATIVE_INFINITY;
  else if (candidate.id === slot.id) score += 40;
  if (aspectMatches(slot, candidate.width, candidate.height)) score += 20;
  if (candidate.width >= 1600) score += 10;
  else if (candidate.width >= 960) score += 5;
  if (altKeywordMatch(slot, candidate.altText)) score += 5;
  return score;
}

/** The route slug a placement targets ("/:hero" → "/", "/services:hero" →
 *  "/services"); undefined for global placements ("global:logo"). */
export function routeSlugFromPlacement(placement: string): string | undefined {
  if (placement.startsWith('global:')) return undefined;
  const separator = placement.lastIndexOf(':');
  const route = separator > 0 ? placement.slice(0, separator) : placement;
  return route || '/';
}

function candidatePagePath(candidate: IngestedImage): string | undefined {
  try {
    const path = new URL(candidate.referringPageUrl).pathname.replace(/\/$/, '');
    return path || '/';
  } catch {
    return undefined;
  }
}

export function scoreSourceCandidate(slot: ImageSlotSpec, candidate: IngestedImage): number {
  let score = 0;
  if (aspectMatches(slot, candidate.width, candidate.height)) score += 20;
  // Prefer a candidate discovered on the same route the slot renders on; for a
  // global placement, prefer an image found on the home page.
  const routeSlug = routeSlugFromPlacement(slot.placement);
  const pagePath = candidatePagePath(candidate);
  if (routeSlug && pagePath === routeSlug) score += 20;
  else if (!routeSlug && pagePath === '/') score += 8;
  const heroLike = /hero|banner|header/i.test(slot.placement) || /hero|banner|header/i.test(slot.id);
  if (heroLike && candidate.domContext?.isAboveFold) score += 15;
  const logoLike = /logo/i.test(slot.placement) || /logo/i.test(slot.id);
  if (logoLike && /logo/i.test(`${candidate.altText ?? ''} ${candidate.sourceUrl}`)) score += 25;
  if (candidate.width >= 1600) score += 10;
  else if (candidate.width >= 960) score += 5;
  if (altKeywordMatch(slot, candidate.altText)) score += 5;
  if (candidate.byteLength < 10_000) score -= 40;
  if (candidate.width < 320 || candidate.height < 180) score -= 40;
  return score;
}

function briefFromSlot(slot: ImageSlotSpec): ImageGenerationBrief {
  return {
    slotId: slot.id,
    intent: slot.generation?.intent ?? `Image for ${slot.placement}`,
    subject: slot.generation?.subject,
    composition: slot.generation?.composition,
    style: slot.generation?.style,
    exclusions: slot.generation?.exclusions,
    aspectRatio: slot.aspectRatio,
    imageSize: slot.imageSize,
  };
}

function bestProvided(slot: ImageSlotSpec, candidates: ProvidedCandidate[]): { candidate: ProvidedCandidate; score: number } | undefined {
  let best: { candidate: ProvidedCandidate; score: number } | undefined;
  for (const candidate of candidates) {
    const score = scoreProvided(slot, candidate);
    if (score >= MIN_ACCEPTABLE_SCORE && (!best || score > best.score)) best = { candidate, score };
  }
  return best;
}

function bestSource(slot: ImageSlotSpec, candidates: IngestedImage[]): { candidate: IngestedImage; score: number } | undefined {
  let best: { candidate: IngestedImage; score: number } | undefined;
  for (const candidate of candidates) {
    const score = scoreSourceCandidate(slot, candidate);
    if (score >= MIN_ACCEPTABLE_SCORE && (!best || score > best.score)) best = { candidate, score };
  }
  return best;
}

export interface PlanInputs {
  slots: ImageSlotSpec[];
  provided: ProvidedCandidate[];
  sourceCandidates: IngestedImage[];
  /** When false, "generated" is dropped from precedence for every slot. */
  generationEnabled: boolean;
}

function resolveSlot(slot: ImageSlotSpec, inputs: PlanInputs): ImageAssetResolution {
  const precedence = (slot.preferredSources ?? DEFAULT_PRECEDENCE).filter(
    source => source !== 'generated' || inputs.generationEnabled,
  );
  for (const source of precedence) {
    if (source === 'provided') {
      const hit = bestProvided(slot, inputs.provided);
      if (hit) return { source: 'provided', candidateId: hit.candidate.id, score: hit.score };
    } else if (source === 'source-site') {
      const hit = bestSource(slot, inputs.sourceCandidates);
      if (hit) return { source: 'source-site', candidateId: hit.candidate.id, score: hit.score };
    } else if (source === 'generated') {
      return { source: 'generated', compiledBrief: briefFromSlot(slot) };
    }
  }
  return {
    source: 'unresolved',
    reason: `No candidate satisfied slot ${slot.id} from sources [${precedence.join(', ')}]`,
  };
}

export function planImageAssets(inputs: PlanInputs): ImageAssetPlan {
  const assets: PlannedImageAsset[] = inputs.slots.map(slot => ({
    slotId: slot.id,
    placement: slot.placement,
    required: slot.required,
    resolution: resolveSlot(slot, inputs),
  }));
  return { schema: 'website-bot.image-asset-plan/v1', version: IMAGE_ASSET_PLAN_VERSION, assets };
}
