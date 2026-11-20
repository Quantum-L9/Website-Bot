// L9_META: layer=service, role=image_optimizer, status=active, version=1.0.0
//
// Every raster the site ships (provided, source-site, generated) passes through
// here before it is staged: centre-cropped to the slot's aspect ratio when it
// differs, resized to the largest width the slot renders at (never enlarged),
// and re-encoded (WebP; the OG card stays JPEG for crawler compatibility). The
// result carries its real width/height for the <img> attributes. An input that
// cannot be decoded, or an output that cannot be brought under the slot's byte
// cap, fails closed: a multi-megabyte image never reaches the site silently.

import sharp, { type OutputInfo, type Sharp } from "sharp";
import { parseAspectRatio, placementRole } from "./ImageAssetPlanner.js";

export class ImageOptimizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageOptimizationError";
  }
}

export type OptimizedFormat = "webp" | "jpeg";

/** How a slot renders: the widest pixel width it needs and its byte budget. */
export interface SlotRenderProfile {
  kind: "hero" | "og" | "logo" | "content";
  maxWidth: number;
  /** Fixed output height (OG card); otherwise derived from the aspect ratio. */
  fixedHeight?: number;
  /** Fixed aspect ratio enforced regardless of the slot spec (OG card). */
  aspectRatio?: string;
  format: OptimizedFormat;
  maxBytes: number;
}

/**
 * Render profiles. Widths are the largest the template renders each kind at on
 * a 2x display within its container; byte caps keep the heaviest page well
 * under the multi-megabyte sets the 08-16 run shipped.
 */
export const RENDER_PROFILES: Readonly<Record<SlotRenderProfile["kind"], SlotRenderProfile>> = {
  hero: { kind: "hero", maxWidth: 1920, format: "webp", maxBytes: 450_000 },
  og: {
    kind: "og",
    maxWidth: 1200,
    fixedHeight: 630,
    aspectRatio: "1200:630",
    format: "jpeg",
    maxBytes: 300_000,
  },
  logo: { kind: "logo", maxWidth: 640, format: "webp", maxBytes: 120_000 },
  content: { kind: "content", maxWidth: 1280, format: "webp", maxBytes: 300_000 },
};

export interface OptimizableSlot {
  id: string;
  placement: string;
  aspectRatio?: string;
}

function isOgSlot(slot: OptimizableSlot): boolean {
  return /og[-_]image/i.test(slot.placement) || /og[-_]image/i.test(slot.id);
}

export function slotRenderProfile(slot: OptimizableSlot): SlotRenderProfile {
  if (isOgSlot(slot)) return RENDER_PROFILES.og;
  if (/logo/i.test(slot.placement) || /logo/i.test(slot.id)) return RENDER_PROFILES.logo;
  const role = placementRole(slot.placement);
  if (/hero|banner|header/.test(role) || /hero|banner|header/i.test(slot.id))
    return RENDER_PROFILES.hero;
  return RENDER_PROFILES.content;
}

export interface OptimizedImage {
  bytes: Buffer;
  mimeType: "image/webp" | "image/jpeg";
  extension: "webp" | "jpg";
  width: number;
  height: number;
  byteLength: number;
  originalByteLength: number;
  originalWidth: number;
  originalHeight: number;
  /** What was done to the input, for the optimisation evidence. */
  adjustments: string[];
}

const QUALITY_LADDER = [82, 74, 66, 58, 50] as const;
/** Ratios within this tolerance are not cropped (rounding noise, not a mismatch). */
const ASPECT_TOLERANCE = 0.02;

function cropBox(
  width: number,
  height: number,
  ratio: number,
): { left: number; top: number; width: number; height: number } | undefined {
  const actual = width / height;
  if (Math.abs(actual - ratio) / ratio <= ASPECT_TOLERANCE) return undefined;
  if (actual > ratio) {
    const cropWidth = Math.max(1, Math.round(height * ratio));
    return { left: Math.floor((width - cropWidth) / 2), top: 0, width: cropWidth, height };
  }
  const cropHeight = Math.max(1, Math.round(width / ratio));
  return { left: 0, top: Math.floor((height - cropHeight) / 2), width, height: cropHeight };
}

async function encode(pipeline: Sharp, format: OptimizedFormat, quality: number): Promise<Buffer> {
  const clone = pipeline.clone();
  return format === "jpeg"
    ? clone.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer()
    : clone.webp({ quality, effort: 4 }).toBuffer();
}

/**
 * Optimise one image for one slot. Deterministic for a given input and slot.
 * `overrides` exists for tests and stricter callers; it can only tighten.
 */
export async function optimizeImageForSlot(
  input: Buffer,
  slot: OptimizableSlot,
  overrides: { maxBytes?: number } = {},
): Promise<OptimizedImage> {
  const profile = slotRenderProfile(slot);
  const maxBytes = Math.min(profile.maxBytes, overrides.maxBytes ?? profile.maxBytes);
  const adjustments: string[] = [];

  let decoded: { data: Buffer; info: OutputInfo };
  try {
    // Decode fully (not just the header) so a corrupt or truncated file fails here.
    decoded = await sharp(input, { failOn: "error" })
      .rotate()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new ImageOptimizationError(
      `image for slot ${slot.id} cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const { width: originalWidth, height: originalHeight, channels } = decoded.info;
  let pipeline = sharp(decoded.data, {
    raw: { width: originalWidth, height: originalHeight, channels },
  });
  let width = originalWidth;
  let height = originalHeight;

  const ratio = parseAspectRatio(profile.aspectRatio ?? slot.aspectRatio);
  if (ratio !== undefined) {
    const box = cropBox(width, height, ratio);
    if (box) {
      pipeline = pipeline.extract(box);
      adjustments.push(
        `cropped ${width}x${height} to ${box.width}x${box.height} (centre) for aspect ${profile.aspectRatio ?? slot.aspectRatio}`,
      );
      width = box.width;
      height = box.height;
    }
  }

  const targetWidth = Math.min(width, profile.maxWidth);
  const targetHeight =
    profile.fixedHeight !== undefined && targetWidth === profile.maxWidth
      ? profile.fixedHeight
      : Math.max(1, Math.round((targetWidth * height) / width));
  if (targetWidth !== width || targetHeight !== height) {
    pipeline = pipeline.resize(targetWidth, targetHeight, { fit: "fill" });
    adjustments.push(`resized ${width}x${height} to ${targetWidth}x${targetHeight}`);
  }

  for (const quality of QUALITY_LADDER) {
    const bytes = await encode(pipeline, profile.format, quality);
    if (bytes.length <= maxBytes) {
      adjustments.push(
        `encoded ${profile.format} q${quality}: ${input.length} -> ${bytes.length} bytes`,
      );
      return {
        bytes,
        mimeType: profile.format === "jpeg" ? "image/jpeg" : "image/webp",
        extension: profile.format === "jpeg" ? "jpg" : "webp",
        width: targetWidth,
        height: targetHeight,
        byteLength: bytes.length,
        originalByteLength: input.length,
        originalWidth,
        originalHeight,
        adjustments,
      };
    }
  }
  throw new ImageOptimizationError(
    `image for slot ${slot.id} exceeds its ${maxBytes}-byte cap at ${targetWidth}x${targetHeight} even at quality ${QUALITY_LADDER[QUALITY_LADDER.length - 1]}`,
  );
}

/** Vector and animated inputs are not re-encoded as single-frame rasters. */
export function isOptimizableRaster(mimeType: string): boolean {
  return /^image\/(png|jpe?g|webp|avif|tiff)$/i.test(mimeType);
}

/** One line of the optimisation evidence written beside the image manifest. */
export interface ImageOptimizationRecord {
  slotId: string;
  placement: string;
  source: string;
  originalBytes: number;
  optimizedBytes: number;
  originalDimensions: string;
  optimizedDimensions: string;
  mimeType: string;
  adjustments: string[];
}

export function optimizationRecord(
  slot: OptimizableSlot,
  source: string,
  result: OptimizedImage,
): ImageOptimizationRecord {
  return {
    slotId: slot.id,
    placement: slot.placement,
    source,
    originalBytes: result.originalByteLength,
    optimizedBytes: result.byteLength,
    originalDimensions: `${result.originalWidth}x${result.originalHeight}`,
    optimizedDimensions: `${result.width}x${result.height}`,
    mimeType: result.mimeType,
    adjustments: result.adjustments,
  };
}
