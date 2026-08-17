// L9_META: layer=pipeline, role=source_ingestion_evidence, status=active, version=1.0.0
//
// Evidence models for source-site ingestion. These types preserve *what was
// observed* on a crawled source site before any interpretation into final
// assets. They are foundation contracts consumed by the (future) source-site
// crawler and the image asset planner; nothing here reaches out to the network.

/** A single crawled page, reduced to the structured signals later stages need. */
export interface IngestedPage {
  url: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  headings: string[];
  textExcerpt?: string;
  bodyText?: string;
  phones?: string[];
  nav?: Array<{ href: string; label: string }>;
  screenshotPath?: string;
  depth: number;
}

/** Placement context captured for a discovered image, used by the planner to
 *  decide whether a candidate reads as a hero, logo, portrait, or decoration. */
export interface ImageDomContext {
  tagName: string;
  nearestSectionId?: string;
  nearestHeading?: string;
  nearbyText?: string;
  cssClasses: string[];
  isAboveFold: boolean;
  renderedWidth: number;
  renderedHeight: number;
}

/** A downloaded, inspected, and hashed source-site image candidate. */
export interface IngestedImage {
  id: string;
  sourceUrl: string;
  referringPageUrl: string;
  localPath: string;
  altText?: string;
  title?: string;
  surroundingText?: string;
  domContext?: ImageDomContext;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  provenance: "source-site";
}

/** A rejected candidate, retained with its reason rather than silently dropped. */
export interface RejectedImage {
  sourceUrl: string;
  referringPageUrl: string;
  reason: string;
}

export interface SourceSiteManifest {
  schema: "website-bot.source-site-manifest/v1";
  sourceUrl: string;
  crawledAt: string;
  crawlerVersion: string;
  pages: IngestedPage[];
  images: IngestedImage[];
  rejected: RejectedImage[];
  warnings: string[];
  /** Observed brand colors from crawled CSS. Design stage reuses these as-is. */
  palette?: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
}

export function emptySourceSiteManifest(
  sourceUrl: string,
  crawlerVersion: string,
  crawledAt: string,
): SourceSiteManifest {
  return {
    schema: "website-bot.source-site-manifest/v1",
    sourceUrl,
    crawledAt,
    crawlerVersion,
    pages: [],
    images: [],
    rejected: [],
    warnings: [],
  };
}

const SHA256 = /^[a-f0-9]{64}$/;

/** Assert an object is a structurally valid source-site manifest (persisted evidence). */
export function validateSourceSiteManifest(value: unknown): asserts value is SourceSiteManifest {
  if (!value || typeof value !== "object")
    throw new Error("source site manifest must be an object");
  const manifest = value as Partial<SourceSiteManifest>;
  if (
    manifest.schema !== "website-bot.source-site-manifest/v1" ||
    !manifest.sourceUrl ||
    !manifest.crawledAt ||
    !manifest.crawlerVersion
  ) {
    throw new Error("source site manifest identity is invalid");
  }
  if (
    !Array.isArray(manifest.pages) ||
    !Array.isArray(manifest.images) ||
    !Array.isArray(manifest.rejected) ||
    !Array.isArray(manifest.warnings)
  ) {
    throw new TypeError("source site manifest collections must be arrays");
  }
  for (const image of manifest.images) {
    if (image.provenance !== "source-site")
      throw new Error("source-site image provenance must be source-site");
    if (!SHA256.test(String(image.sha256)))
      throw new Error(`invalid sha256 for source-site image ${image.id}`);
    if (!Number.isInteger(image.byteLength) || image.byteLength < 0)
      throw new Error(`invalid byteLength for source-site image ${image.id}`);
  }
}
