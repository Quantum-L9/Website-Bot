// L9_META: layer=ingestion, role=source_crawler, status=active, version=1.0.0
//
// Breadth-first crawl of a source site, bounded by page/depth/time limits, that
// gathers structured page evidence and downloads acceptable image candidates.
// Page navigation is scoped to the seed site; image downloads may be cross-origin
// but are still SSRF-checked (no local/private/metadata targets, DNS-resolved
// addresses verified). Output is a SourceSiteManifest — observations, not final
// assets.

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import type {
  IngestedImage,
  IngestedPage,
  RejectedImage,
  SourceSiteManifest,
} from "../pipeline/evidence/SourceSiteManifest.js";
import { EXTENSION_BY_MIME, inspectImage } from "../services/images/ImageInspector.js";
import { crawlPagePriority } from "./CrawlPriority.js";
import { type ExtractedPage, extractPage } from "./PageExtractor.js";
import { type FetchedResource, HttpPageFetcher } from "./PageFetcher.js";
import { NoopScreenshotCapturer, type ScreenshotCapturer } from "./ScreenshotCapturer.js";
import {
  DEFAULT_SOURCE_IMAGE_POLICY,
  evaluateSourceImage,
  normalizeUrl,
  type SourceImagePolicy,
  shouldSkipUrl,
} from "./SourceImagePolicy.js";
import { extractHexColors, inferPalette } from "./SourcePalette.js";
import { assertUrlAllowed, isForbiddenAddress, isUrlAllowed } from "./UrlPolicy.js";

const logger = createModuleLogger("ingestion:crawler");
export const CRAWLER_VERSION = "1.1.0";

export interface CrawlOptions {
  seedUrl: string;
  maxPages?: number;
  maxDepth?: number;
  allowSubdomains?: boolean;
  downloadImages?: boolean;
  captureScreenshots?: boolean;
  allowPdf?: boolean;
  navigationTimeoutMs?: number;
  totalTimeoutMs?: number;
  outputDir?: string;
  imagePolicy?: SourceImagePolicy;
  screenshotCapturer?: ScreenshotCapturer;
  /** Injectable fetcher (tests). When set, used for both pages and images. */
  fetcher?: HttpPageFetcher;
  /** Test-only: permit loopback/private hosts so a local fixture server is reachable. */
  allowPrivateHosts?: boolean;
  /** Injectable clock for deterministic manifests. */
  now?: () => Date;
}

const DEFAULTS = {
  maxPages: 40,
  maxDepth: 2,
  navigationTimeoutMs: 20_000,
  totalTimeoutMs: 180_000,
};

function isHtml(contentType: string | undefined): boolean {
  return !contentType || /text\/html|application\/xhtml\+xml/i.test(contentType);
}

export class SourceCrawler {
  private readonly opts: CrawlOptions;
  private readonly seedHost: string;
  private readonly outputDir: string;
  private readonly policy: SourceImagePolicy;
  private readonly screenshots: ScreenshotCapturer;

  constructor(options: CrawlOptions) {
    this.opts = options;
    this.seedHost = new URL(options.seedUrl).hostname;
    this.outputDir = resolve(options.outputDir ?? "build/assets/source-site");
    this.policy = options.imagePolicy ?? DEFAULT_SOURCE_IMAGE_POLICY;
    this.screenshots = options.screenshotCapturer ?? new NoopScreenshotCapturer();
  }

  private async assertResolvedSafe(hostname: string): Promise<void> {
    if (this.opts.allowPrivateHosts) return;
    // IP literals are already validated by assertUrlAllowed; resolve names to
    // defend against DNS rebinding to an internal address.
    if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return;
    const records = await lookup(hostname, { all: true });
    for (const record of records) {
      if (isForbiddenAddress(record.address))
        throw new Error(`hostname ${hostname} resolves to forbidden address ${record.address}`);
    }
  }

  private pageValidator = async (url: string): Promise<void> => {
    if (this.opts.allowPrivateHosts) {
      assertProtocol(url);
      return;
    }
    const parsed = assertUrlAllowed(url, {
      seedHost: this.seedHost,
      allowSubdomains: this.opts.allowSubdomains,
    });
    await this.assertResolvedSafe(parsed.hostname);
  };

  private imageValidator = async (url: string): Promise<void> => {
    if (this.opts.allowPrivateHosts) {
      assertProtocol(url);
      return;
    }
    const parsed = assertUrlAllowed(url); // SSRF-safe but not seed-scoped: CDNs allowed
    await this.assertResolvedSafe(parsed.hostname);
  };

  private inScope(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (this.opts.allowPrivateHosts) return parsed.host === new URL(this.opts.seedUrl).host;
    return isUrlAllowed(url, {
      seedHost: this.seedHost,
      allowSubdomains: this.opts.allowSubdomains,
    });
  }

  async crawl(): Promise<SourceSiteManifest> {
    const now = this.opts.now ?? (() => new Date());
    const maxPages = this.opts.maxPages ?? DEFAULTS.maxPages;
    const maxDepth = this.opts.maxDepth ?? DEFAULTS.maxDepth;
    const deadline = Date.now() + (this.opts.totalTimeoutMs ?? DEFAULTS.totalTimeoutMs);

    const pageFetcher =
      this.opts.fetcher ??
      new HttpPageFetcher({
        validateUrl: this.pageValidator,
        navigationTimeoutMs: this.opts.navigationTimeoutMs ?? DEFAULTS.navigationTimeoutMs,
      });
    const imageFetcher =
      this.opts.fetcher ??
      new HttpPageFetcher({
        validateUrl: this.imageValidator,
        navigationTimeoutMs: this.opts.navigationTimeoutMs ?? DEFAULTS.navigationTimeoutMs,
        maxBytes: this.policy.maxBytes,
      });

    const pages: IngestedPage[] = [];
    const images: IngestedImage[] = [];
    const rejected: RejectedImage[] = [];
    const warnings: string[] = [];
    const visited = new Set<string>();
    const imageHashes = new Set<string>();
    const imageUrlsSeen = new Set<string>();
    const cssUrlsSeen = new Set<string>();
    const cssChunks: string[] = [];
    const queue: Array<{ url: string; depth: number }> = [
      { url: normalizeUrl(this.opts.seedUrl), depth: 0 },
    ];

    while (queue.length > 0 && pages.length < maxPages) {
      if (Date.now() > deadline) {
        warnings.push("crawl stopped: total time budget exceeded");
        break;
      }
      queue.sort(
        (a, b) => crawlPagePriority(a.url) - crawlPagePriority(b.url) || a.depth - b.depth,
      );
      const { url, depth } = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      const fetched = await this.fetchPage(url, pageFetcher, warnings);
      if (!fetched) continue;

      const extracted = extractPage(fetched.body.toString("utf8"), fetched.finalUrl);
      const page = await this.buildIngestedPage(fetched, extracted, url, depth);
      pages.push(page);

      if (depth === 0) {
        await this.collectStylesheets(
          extracted.stylesheets,
          imageFetcher,
          cssUrlsSeen,
          cssChunks,
          warnings,
        );
      }

      if (depth < maxDepth) this.enqueueLinks(extracted, depth, visited, queue);

      if (this.opts.downloadImages !== false)
        await this.downloadPageImages(
          extracted,
          fetched.finalUrl,
          imageFetcher,
          images,
          rejected,
          imageHashes,
          imageUrlsSeen,
        );
    }

    await this.screenshots.close();
    const palette = inferPalette(extractHexColors(cssChunks.join("\n")));
    if (!palette) warnings.push("source palette could not be inferred from crawled CSS");
    logger.info(
      {
        pages: pages.length,
        images: images.length,
        rejected: rejected.length,
        palette: Boolean(palette),
      },
      "Source crawl complete",
    );
    return {
      schema: "website-bot.source-site-manifest/v1",
      sourceUrl: this.opts.seedUrl,
      crawledAt: now().toISOString(),
      crawlerVersion: CRAWLER_VERSION,
      pages,
      images,
      rejected,
      warnings,
      ...(palette ? { palette } : {}),
    };
  }

  private async fetchPage(
    url: string,
    pageFetcher: HttpPageFetcher,
    warnings: string[],
  ): Promise<FetchedResource | null> {
    let fetched: FetchedResource | undefined;
    try {
      fetched = await pageFetcher.fetch(url);
    } catch (error) {
      warnings.push(`page fetch failed ${url}: ${String(error)}`);
      return null;
    }
    if (fetched.status >= 400 || !isHtml(fetched.contentType)) {
      warnings.push(`skipped non-HTML or error page ${url} (status ${fetched.status})`);
      return null;
    }
    return fetched;
  }

  private async buildIngestedPage(
    fetched: FetchedResource,
    extracted: ExtractedPage,
    url: string,
    depth: number,
  ): Promise<IngestedPage> {
    const page: IngestedPage = {
      url: fetched.finalUrl,
      canonicalUrl: extracted.canonicalUrl,
      title: extracted.title,
      description: extracted.description,
      headings: extracted.headings,
      textExcerpt: extracted.textExcerpt,
      bodyText: extracted.bodyText,
      phones: extracted.phones,
      nav: extracted.nav,
      depth,
    };
    if (this.opts.captureScreenshots) {
      const shotPath = resolve(this.outputDir, "screenshots", `${sha12(url)}.png`);
      mkdirSync(resolve(this.outputDir, "screenshots"), { recursive: true });
      page.screenshotPath = await this.screenshots.capture({
        url: fetched.finalUrl,
        outputPath: shotPath,
      });
    }
    return page;
  }

  private enqueueLinks(
    extracted: ExtractedPage,
    depth: number,
    visited: Set<string>,
    queue: Array<{ url: string; depth: number }>,
  ): void {
    for (const link of extracted.links) {
      const normalized = normalizeUrl(link);
      if (
        visited.has(normalized) ||
        !this.inScope(normalized) ||
        shouldSkipUrl(normalized, { allowPdf: this.opts.allowPdf })
      )
        continue;
      queue.push({ url: normalized, depth: depth + 1 });
    }
  }

  private async downloadPageImages(
    extracted: ExtractedPage,
    finalUrl: string,
    imageFetcher: HttpPageFetcher,
    images: IngestedImage[],
    rejected: RejectedImage[],
    imageHashes: Set<string>,
    imageUrlsSeen: Set<string>,
  ): Promise<void> {
    for (const candidate of extracted.images) {
      if (imageUrlsSeen.has(candidate.url)) continue;
      imageUrlsSeen.add(candidate.url);
      try {
        const download = await imageFetcher.fetch(candidate.url);
        if (download.status >= 400) {
          rejected.push({
            sourceUrl: candidate.url,
            referringPageUrl: finalUrl,
            reason: `status ${download.status}`,
          });
          continue;
        }
        const inspected = inspectImage(download.body);
        const decision = evaluateSourceImage(inspected, this.policy, {
          sourceUrl: candidate.url,
          altText: candidate.altText,
        });
        if (!decision.accepted) {
          rejected.push({
            sourceUrl: candidate.url,
            referringPageUrl: finalUrl,
            reason: decision.reason ?? "rejected",
          });
          continue;
        }
        if (imageHashes.has(inspected.sha256)) {
          rejected.push({
            sourceUrl: candidate.url,
            referringPageUrl: finalUrl,
            reason: "duplicate content hash",
          });
          continue;
        }
        imageHashes.add(inspected.sha256);
        const extension = EXTENSION_BY_MIME[inspected.mimeType] ?? "img";
        const localPath = resolve(this.outputDir, "downloads", `${inspected.sha256}.${extension}`);
        mkdirSync(resolve(this.outputDir, "downloads"), { recursive: true });
        writeFileSync(localPath, download.body);
        images.push({
          id: `src-${inspected.sha256.slice(0, 12)}`,
          sourceUrl: candidate.url,
          referringPageUrl: finalUrl,
          localPath,
          altText: candidate.altText,
          title: candidate.title,
          surroundingText: candidate.nearestHeading,
          domContext: {
            tagName: candidate.origin,
            nearestHeading: candidate.nearestHeading,
            cssClasses: candidate.cssClasses,
            isAboveFold: candidate.isAboveFold,
            renderedWidth: inspected.width,
            renderedHeight: inspected.height,
          },
          mimeType: inspected.mimeType,
          width: inspected.width,
          height: inspected.height,
          byteLength: inspected.byteLength,
          sha256: inspected.sha256,
          provenance: "source-site",
        });
      } catch (error) {
        rejected.push({
          sourceUrl: candidate.url,
          referringPageUrl: finalUrl,
          reason: `download failed: ${String(error)}`,
        });
      }
    }
  }

  private async collectStylesheets(
    hrefs: readonly string[],
    fetcher: HttpPageFetcher,
    seen: Set<string>,
    chunks: string[],
    warnings: string[],
  ): Promise<void> {
    for (const href of hrefs.slice(0, 4)) {
      if (seen.has(href)) continue;
      seen.add(href);
      try {
        const fetched = await fetcher.fetch(href);
        if (fetched.status >= 400) continue;
        const type = fetched.contentType ?? "";
        if (type && !/css|text\/plain/i.test(type)) continue;
        chunks.push(fetched.body.toString("utf8"));
      } catch (error) {
        warnings.push(`stylesheet fetch failed ${href}: ${String(error)}`);
      }
    }
  }
}

function assertProtocol(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(`protocol not allowed: ${parsed.protocol}`);
}

function sha12(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
