// L9_META: layer=service, role=image_asset_planner, status=active, version=1.0.0
//
// Deterministic slot → source resolution. Given the declared image slots, the
// provided-image inventory, and the source-site candidates, decide which source
// fills each slot. Selection is deterministic and LLM-free: candidates are
// scored on placement, aspect ratio, resolution, and alt-text signals, and the
// configured source precedence (provided → source-site → generated) breaks ties.
// Ambiguous semantic ranking is a later, optional refinement — never basic
// filtering.

import type { ImageSlotSpec } from "../../pipeline/BuildContext.js";
import type {
  ImageAssetPlan,
  ImageAssetResolution,
  ImageGenerationBrief,
  PlannedImageAsset,
} from "../../pipeline/evidence/ImageAssetPlan.js";
import type { IngestedImage } from "../../pipeline/evidence/SourceSiteManifest.js";

export const IMAGE_ASSET_PLAN_VERSION = "1.0.0";
const DEFAULT_PRECEDENCE: Array<"provided" | "source-site" | "generated"> = [
  "provided",
  "source-site",
  "generated",
];
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
  const wanted = slot.altText
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
  if (wanted.length === 0) return false;
  const haystack = altText.toLowerCase();
  return wanted.some((word) => haystack.includes(word));
}

/**
 * Separator of a section-qualified placement (WB-GLUE-01). When several visual
 * requirements on one route share a role, each keeps its own placement
 * `<route>:<role>#<section_id>` so neither overwrites the other. Route ids
 * never contain "#"; everything after the first "#" is the section id.
 */
export const SECTION_PLACEMENT_SEPARATOR = "#";

/** The unqualified placement (`/:service#overview` → `/:service`). */
export function basePlacement(placement: string): string {
  const separator = placement.indexOf(SECTION_PLACEMENT_SEPARATOR);
  return separator < 0 ? placement : placement.slice(0, separator);
}

/** The blueprint section a section-qualified placement names, if any. */
export function placementSectionId(placement: string): string | undefined {
  const separator = placement.indexOf(SECTION_PLACEMENT_SEPARATOR);
  if (separator < 0) return undefined;
  return placement.slice(separator + 1) || undefined;
}

export function sectionQualifiedPlacement(placement: string, sectionId: string): string {
  return `${basePlacement(placement)}${SECTION_PLACEMENT_SEPARATOR}${sectionId}`;
}

/** The visual role a placement serves (`/about:team#crew` → `team`). */
export function placementRole(placement: string): string {
  const base = basePlacement(placement);
  return base
    .slice(base.lastIndexOf(":") + 1)
    .trim()
    .toLowerCase();
}

/** True when an explicit intended placement names this slot (exactly, or its route + role). */
function intendedFor(slot: ImageSlotSpec, intendedPlacement: string): boolean {
  return (
    intendedPlacement === slot.placement ||
    (placementSectionId(intendedPlacement) === undefined &&
      intendedPlacement === basePlacement(slot.placement))
  );
}

/**
 * Semantic evidence that an unplaced provided image depicts what the slot
 * needs: its id or alt text names the slot's role, or shares a keyword with
 * the slot's alt guidance. Resolution and aspect ratio alone never qualify.
 */
function semanticallySuits(slot: ImageSlotSpec, candidate: ProvidedCandidate): boolean {
  const role = placementRole(slot.placement)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const words = ` ${`${candidate.id} ${candidate.altText ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  if (role && words.includes(` ${role} `)) return true;
  return altKeywordMatch(slot, candidate.altText);
}

export function scoreProvided(slot: ImageSlotSpec, candidate: ProvidedCandidate): number {
  let score = 0;
  if (candidate.intendedPlacement && intendedFor(slot, candidate.intendedPlacement)) {
    score += candidate.intendedPlacement === slot.placement ? 60 : 50;
  } else if (candidate.intendedPlacement) return Number.NEGATIVE_INFINITY;
  else if (candidate.id === slot.id) score += 40;
  else if (semanticallySuits(slot, candidate)) score += 10;
  else return Number.NEGATIVE_INFINITY;
  if (aspectMatches(slot, candidate.width, candidate.height)) score += 20;
  if (candidate.width >= 1600) score += 10;
  else if (candidate.width >= 960) score += 5;
  if (altKeywordMatch(slot, candidate.altText)) score += 5;
  return score;
}

/** The route slug a placement targets ("/:hero" → "/", "/services:hero" →
 *  "/services"); undefined for global placements ("global:logo"). */
export function routeSlugFromPlacement(placement: string): string | undefined {
  if (placement.startsWith("global:")) return undefined;
  const base = basePlacement(placement);
  const separator = base.lastIndexOf(":");
  const route = separator > 0 ? base.slice(0, separator) : base;
  return route || "/";
}

function candidatePagePath(candidate: IngestedImage): string | undefined {
  try {
    const path = new URL(candidate.referringPageUrl).pathname.replace(/\/$/, "");
    return path || "/";
  } catch {
    return undefined;
  }
}

/** True when the candidate is a brand mark (logo, favicon, OG card) rather than a photo. */
export function isBrandMarkCandidate(
  candidate: Pick<IngestedImage, "sourceUrl" | "altText" | "surroundingText">,
): boolean {
  const hay =
    `${candidate.sourceUrl} ${candidate.altText ?? ""} ${candidate.surroundingText ?? ""}`.toLowerCase();
  return /logo|favicon|apple-touch|opengraph|\bog\.(png|jpe?g|webp|gif)|\/og[-_/]|social.?card|icon[-_/]/.test(
    hay,
  );
}

function isHeroSlot(slot: ImageSlotSpec): boolean {
  return /hero|banner|header/i.test(slot.placement) || /hero|banner|header/i.test(slot.id);
}

export function isLogoSlot(slot: Pick<ImageSlotSpec, "id" | "placement">): boolean {
  return /logo/i.test(slot.placement) || /logo/i.test(slot.id);
}

function isGalleryCandidate(candidate: IngestedImage): boolean {
  return /\/(gallery|portfolio|our-work|projects|photos)\b/i.test(
    `${candidate.sourceUrl} ${candidate.referringPageUrl}`,
  );
}

function routeScore(slot: ImageSlotSpec, candidate: IngestedImage): number {
  // Prefer a candidate discovered on the same route the slot renders on; for a
  // global placement, prefer an image found on the home page.
  const routeSlug = routeSlugFromPlacement(slot.placement);
  const pagePath = candidatePagePath(candidate);
  if (routeSlug && pagePath === routeSlug) return 20;
  if (!routeSlug && pagePath === "/") return 8;
  return 0;
}

function signalScore(
  slot: ImageSlotSpec,
  heroLike: boolean,
  logoLike: boolean,
  brandMark: boolean,
  candidate: IngestedImage,
): number {
  let score = 0;
  if (heroLike && candidate.domContext?.isAboveFold) score += 15;
  if (logoLike && /\/logo\./i.test(candidate.sourceUrl)) score += 40;
  if (logoLike && brandMark) score += 25;
  if (heroLike && brandMark) score -= 80;
  if (logoLike && !brandMark) score -= 40;
  if (heroLike && isGalleryCandidate(candidate)) score += 12;
  if (altKeywordMatch(slot, candidate.altText)) score += 5;
  return score;
}

function sizeScore(candidate: IngestedImage): number {
  if (candidate.width >= 1600) return 10;
  if (candidate.width >= 960) return 5;
  return 0;
}

function penaltyScore(logoLike: boolean, candidate: IngestedImage): number {
  let score = 0;
  if (!logoLike && candidate.byteLength < 10_000) score -= 40;
  if (!logoLike && (candidate.width < 320 || candidate.height < 180)) score -= 40;
  return score;
}

export function scoreSourceCandidate(slot: ImageSlotSpec, candidate: IngestedImage): number {
  const heroLike = isHeroSlot(slot);
  const logoLike = isLogoSlot(slot);
  const brandMark = isBrandMarkCandidate(candidate);
  return (
    (aspectMatches(slot, candidate.width, candidate.height) ? 20 : 0) +
    routeScore(slot, candidate) +
    signalScore(slot, heroLike, logoLike, brandMark, candidate) +
    sizeScore(candidate) +
    penaltyScore(logoLike, candidate)
  );
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

function bestProvided(
  slot: ImageSlotSpec,
  candidates: ProvidedCandidate[],
  usedIds: Set<string>,
): { candidate: ProvidedCandidate; score: number } | undefined {
  let best: { candidate: ProvidedCandidate; score: number } | undefined;
  for (const candidate of candidates) {
    if (usedIds.has(candidate.id)) continue;
    const score = scoreProvided(slot, candidate);
    if (score >= MIN_ACCEPTABLE_SCORE && (!best || score > best.score)) best = { candidate, score };
  }
  return best;
}

function bestSource(
  slot: ImageSlotSpec,
  candidates: IngestedImage[],
  usedIds: Set<string>,
): { candidate: IngestedImage; score: number } | undefined {
  let best: { candidate: IngestedImage; score: number } | undefined;
  for (const candidate of candidates) {
    if (usedIds.has(candidate.id)) continue;
    const score = scoreSourceCandidate(slot, candidate);
    if (score >= MIN_ACCEPTABLE_SCORE && (!best || score > best.score)) best = { candidate, score };
  }
  return best;
}

function slotAssignPriority(slot: ImageSlotSpec): number {
  if (isLogoSlot(slot)) return 0;
  if (/og-image|og_image/i.test(slot.placement) || /og-image|og_image/i.test(slot.id)) return 1;
  if (isHeroSlot(slot)) return 2;
  return 3;
}

export interface PlanInputs {
  slots: ImageSlotSpec[];
  provided: ProvidedCandidate[];
  sourceCandidates: IngestedImage[];
  /** When false, "generated" is dropped from precedence for every slot. */
  generationEnabled: boolean;
}

/** A provided image explicitly assigned to this slot (by placement or slot id). */
function explicitProvided(
  slot: ImageSlotSpec,
  candidates: ProvidedCandidate[],
  usedIds: Set<string>,
): { candidate: ProvidedCandidate; score: number } | undefined {
  const hit = bestProvided(slot, candidates, usedIds);
  if (!hit) return undefined;
  const { candidate } = hit;
  const explicit = candidate.intendedPlacement
    ? intendedFor(slot, candidate.intendedPlacement)
    : candidate.id === slot.id;
  return explicit ? hit : undefined;
}

function resolveSlot(
  slot: ImageSlotSpec,
  inputs: PlanInputs,
  usedProvided: Set<string>,
  usedSource: Set<string>,
): ImageAssetResolution {
  // An explicitly assigned client asset is never excluded by a slot's
  // preferred-source order (e.g. a blueprint that prefers generation).
  const assigned = explicitProvided(slot, inputs.provided, usedProvided);
  if (assigned) {
    return { source: "provided", candidateId: assigned.candidate.id, score: assigned.score };
  }
  // A logo is a protected brand asset: it is never synthesized (WB-GLUE-01).
  const logo = isLogoSlot(slot);
  const precedence = (slot.preferredSources ?? DEFAULT_PRECEDENCE).filter(
    (source) => source !== "generated" || (inputs.generationEnabled && !logo),
  );
  for (const source of precedence) {
    if (source === "provided") {
      const hit = bestProvided(slot, inputs.provided, usedProvided);
      if (hit) return { source: "provided", candidateId: hit.candidate.id, score: hit.score };
    } else if (source === "source-site") {
      const hit = bestSource(slot, inputs.sourceCandidates, usedSource);
      if (hit) return { source: "source-site", candidateId: hit.candidate.id, score: hit.score };
    } else if (source === "generated") {
      return { source: "generated", compiledBrief: briefFromSlot(slot) };
    }
  }
  return {
    source: "unresolved",
    reason: `No candidate satisfied slot ${slot.id} from sources [${precedence.join(", ")}]`,
  };
}

export function planImageAssets(inputs: PlanInputs): ImageAssetPlan {
  const usedProvided = new Set<string>();
  const usedSource = new Set<string>();
  const resolved = new Map<string, PlannedImageAsset>();
  const ordered = [...inputs.slots].sort((a, b) => slotAssignPriority(a) - slotAssignPriority(b));
  for (const slot of ordered) {
    const resolution = resolveSlot(slot, inputs, usedProvided, usedSource);
    if (resolution.source === "provided" && resolution.candidateId)
      usedProvided.add(resolution.candidateId);
    if (resolution.source === "source-site" && resolution.candidateId)
      usedSource.add(resolution.candidateId);
    resolved.set(slot.id, {
      slotId: slot.id,
      placement: slot.placement,
      required: slot.required,
      resolution,
    });
  }
  const assets: PlannedImageAsset[] = inputs.slots.map((slot) => resolved.get(slot.id)!);
  return { schema: "website-bot.image-asset-plan/v1", version: IMAGE_ASSET_PLAN_VERSION, assets };
}
