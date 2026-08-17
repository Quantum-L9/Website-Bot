// L9_META: layer=ingestion, role=source_image_policy, status=active, version=1.0.0
//
// Not every downloaded file belongs in the candidate pool. This module holds the
// accept/reject rules for source-site images — enforced after download and
// inspection — and the URL normalization + skip rules that keep the crawl inside
// useful content. Rejected candidates are recorded with a reason, never silently
// dropped.

import type { InspectedImage } from "../services/images/ImageInspector.js";

export interface SourceImagePolicy {
  maxBytes: number;
  minWidth: number;
  minHeight: number;
  heroMinWidth: number;
  acceptedMimeTypes: string[];
  /** Reject dimensions whose aspect ratio is more extreme than this (w/h or h/w). */
  maxAspectRatio: number;
}

export const DEFAULT_SOURCE_IMAGE_POLICY: SourceImagePolicy = {
  maxBytes: 15 * 1024 * 1024,
  minWidth: 320,
  minHeight: 180,
  heroMinWidth: 960,
  acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/svg+xml"],
  maxAspectRatio: 6,
};

export interface PolicyDecision {
  accepted: boolean;
  reason?: string;
}

export function looksLikeLogoAsset(sourceUrl?: string, altText?: string): boolean {
  return /logo|favicon|apple-touch|icon/i.test(`${sourceUrl ?? ""} ${altText ?? ""}`);
}

const LOGO_MIN_EDGE = 48;

/** Apply the accept/reject policy to an inspected image. */
export function evaluateSourceImage(
  inspected: InspectedImage,
  policy: SourceImagePolicy = DEFAULT_SOURCE_IMAGE_POLICY,
  context: { sourceUrl?: string; altText?: string } = {},
): PolicyDecision {
  if (!policy.acceptedMimeTypes.includes(inspected.mimeType)) {
    return { accepted: false, reason: `unsupported mime type ${inspected.mimeType}` };
  }
  if (inspected.byteLength > policy.maxBytes) {
    return {
      accepted: false,
      reason: `exceeds max bytes (${inspected.byteLength} > ${policy.maxBytes})`,
    };
  }
  // Scalable vectors carry no intrinsic pixel size (width/height 0) — accepted.
  if (inspected.mimeType !== "image/svg+xml") {
    const logoLike = looksLikeLogoAsset(context.sourceUrl, context.altText);
    const minWidth = logoLike ? LOGO_MIN_EDGE : policy.minWidth;
    const minHeight = logoLike ? LOGO_MIN_EDGE : policy.minHeight;
    if (inspected.width < minWidth || inspected.height < minHeight) {
      return {
        accepted: false,
        reason: `below minimum dimensions (${inspected.width}x${inspected.height})`,
      };
    }
    if (inspected.width > 0 && inspected.height > 0) {
      const ratio = Math.max(
        inspected.width / inspected.height,
        inspected.height / inspected.width,
      );
      if (ratio > policy.maxAspectRatio)
        return { accepted: false, reason: `extreme aspect ratio (${ratio.toFixed(1)}:1)` };
    }
  }
  return { accepted: true };
}

const TRACKING_PARAM =
  /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$|_ga$|sessionid$|sid$|phpsessid$|jsessionid$)/i;

/** Canonicalize a URL for de-duplication: drop fragments, tracking + session
 *  params, and redundant trailing slashes. */
export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams) {
    if (!TRACKING_PARAM.test(key)) kept.push([key, value]);
  }
  url.search = "";
  kept.sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of kept) url.searchParams.append(key, value);
  if (url.pathname.length > 1 && url.pathname.endsWith("/"))
    url.pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}

const SKIP_WORD_PATH =
  /\/(login|logout|signin|signout|register|account|cart|checkout|basket|search|wishlist)(\/|$|\?)/i;
const SKIP_INDEXED_PATH = /\/(tag|tags|page|category)\/\d+/i;

/** True when a link should not be crawled (auth, commerce, search, pagination). */
export function shouldSkipUrl(rawUrl: string, options: { allowPdf?: boolean } = {}): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return true;
  }
  const path = url.pathname.toLowerCase();
  if (!options.allowPdf && /\.(pdf|zip|dmg|exe|mp4|mov|avi|woff2?|ttf|eot)$/i.test(path))
    return true;
  if (
    SKIP_WORD_PATH.test(url.pathname + url.search) ||
    SKIP_INDEXED_PATH.test(url.pathname + url.search)
  )
    return true;
  return false;
}
