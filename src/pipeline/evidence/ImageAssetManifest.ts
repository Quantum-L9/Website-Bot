// L9_META: layer=pipeline, role=image_asset_evidence, status=active, version=1.0.0
//
// Final image-asset provenance. A ResolvedImageAsset is a fully inspected image
// staged on disk, ready for the assembler to copy into the Astro project. The
// ImageAssetManifest is the auxiliary provenance record for a build's images.
//
// Image evidence is intentionally OUTSIDE the mandatory release-evidence chain:
// text-only builds carry no image slots and must not fail for the absence of an
// image manifest. Presence of the copied files is already attested by the
// assembly manifest; this record adds source, hashes, dimensions, and cost.

import { sha256Text } from "./EvidenceCanonicalizer.js";

export type ImageSource = "provided" | "source-site" | "generated";

/** Provenance disposition — only client-owned assets may be republished. */
export type ReuseDisposition =
  | "approved-client-owned"
  | "reference-only"
  | "unknown-rights"
  | "rejected";

/** A fully inspected image staged for assembly into the generated site. */
export interface ResolvedImageAsset {
  slotId: string;
  placement: string;
  source: ImageSource;
  /** Absolute path to the staged file the assembler copies into public/images/. */
  absolutePath: string;
  /** File name (relative to public/images/) used in the generated site. */
  outputFileName: string;
  altText: string;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  sourceUrl?: string;
  originalPath?: string;
  promptHash?: string;
  model?: string;
  estimatedCostUsd?: number;
  disposition: ReuseDisposition;
  provenanceWarnings: string[];
}

/** One image's provenance as recorded in the manifest (post-assembly). */
export interface ImageAssetEvidence {
  slotId: string;
  placement: string;
  source: ImageSource;
  sourceUrl?: string;
  originalPath?: string;
  outputPath: string;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  promptHash?: string;
  model?: string;
  estimatedCostUsd?: number;
  disposition: ReuseDisposition;
  provenanceWarnings: string[];
}

export interface ImageAssetManifest {
  schema: "website-bot.image-asset-manifest/v1";
  buildId: string;
  clientId: string;
  generatedAt: string;
  assets: ImageAssetEvidence[];
  digest: string;
}

export function evidenceFromResolved(asset: ResolvedImageAsset): ImageAssetEvidence {
  return {
    slotId: asset.slotId,
    placement: asset.placement,
    source: asset.source,
    sourceUrl: asset.sourceUrl,
    originalPath: asset.originalPath,
    outputPath: `public/images/${asset.outputFileName}`,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    promptHash: asset.promptHash,
    model: asset.model,
    estimatedCostUsd: asset.estimatedCostUsd,
    disposition: asset.disposition,
    provenanceWarnings: asset.provenanceWarnings,
  };
}

export function computeImageManifestDigest(assets: ImageAssetEvidence[]): string {
  const lines = [...assets]
    .sort((left, right) => left.placement.localeCompare(right.placement))
    .map((asset) => `${asset.placement}\0${asset.source}\0${asset.sha256}\0${asset.byteLength}\n`)
    .join("");
  return sha256Text(lines);
}

export function buildImageAssetManifest(
  buildId: string,
  clientId: string,
  generatedAt: string,
  resolved: ResolvedImageAsset[],
): ImageAssetManifest {
  const assets = resolved.map(evidenceFromResolved);
  return {
    schema: "website-bot.image-asset-manifest/v1",
    buildId,
    clientId,
    generatedAt,
    assets,
    digest: computeImageManifestDigest(assets),
  };
}

const SHA256 = /^[a-f0-9]{64}$/;

export function validateImageAssetManifest(value: unknown): asserts value is ImageAssetManifest {
  if (!value || typeof value !== "object")
    throw new Error("image asset manifest must be an object");
  const manifest = value as Partial<ImageAssetManifest>;
  if (
    manifest.schema !== "website-bot.image-asset-manifest/v1" ||
    !manifest.buildId ||
    !manifest.clientId
  ) {
    throw new Error("image asset manifest identity is invalid");
  }
  if (!Array.isArray(manifest.assets))
    throw new Error("image asset manifest assets must be an array");
  const placements = new Set<string>();
  for (const asset of manifest.assets) {
    if (!asset.placement || placements.has(asset.placement))
      throw new Error(`invalid or duplicate placement: ${asset.placement}`);
    placements.add(asset.placement);
    if (!SHA256.test(asset.sha256)) throw new Error(`invalid sha256 for ${asset.placement}`);
    if (!Number.isInteger(asset.byteLength) || asset.byteLength < 0)
      throw new Error(`invalid byteLength for ${asset.placement}`);
  }
  if (computeImageManifestDigest(manifest.assets) !== manifest.digest) {
    throw new Error("image asset manifest digest does not match assets");
  }
}
