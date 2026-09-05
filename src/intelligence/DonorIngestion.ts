// L9_META: layer=intelligence, role=donor_ingestion, status=active, version=1.0.0
//
// Real bounded donor acquisition (Campaign 7 R5). A donor record from the
// CompetitiveLandscape is NOT sufficient donor ingestion: each accepted donor
// must have at least one successfully fetched real page, deterministic page
// evidence, and at least one rendered screenshot. Donor raw assets remain
// analytical evidence only — disposition is always DONOR_REFERENCE_ONLY.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import {
  PlaywrightScreenshotCapturer,
  type ScreenshotCapturer,
} from "../ingestion/ScreenshotCapturer.js";

export { NoopScreenshotCapturer } from "../ingestion/ScreenshotCapturer.js";

const logger = createModuleLogger("intelligence:donor-ingestion");

export interface DonorPageEvidence {
  url: string;
  status: number;
  content_digest: string;
  content_bytes: number;
  fetched_at: string;
}

export interface AcceptedDonorEvidence {
  domain: string;
  serp_observation_ids: string[];
  pages: DonorPageEvidence[];
  screenshot_paths: string[];
  crawl_manifest_path: string;
  evidence_digest: string;
  crawled_at: string;
  disposition: "DONOR_REFERENCE_ONLY";
}

export interface DonorIngestionRequest {
  domain: string;
  /** Ranked candidate URLs from the CompetitiveLandscape plus bounded discovery. */
  candidate_urls: string[];
  serp_observation_ids: string[];
  output_dir: string;
  max_pages: number;
}

export interface DonorIngestor {
  /** Returns evidence when the donor is usable; null when it must be replaced. */
  ingest(request: DonorIngestionRequest): Promise<AcceptedDonorEvidence | null>;
  close(): Promise<void>;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha12(value: string): string {
  return sha256(value).slice(0, 12);
}

/**
 * Fetch-based bounded crawler with Playwright screenshots. No whole-site
 * crawling: only the supplied ranked URLs, capped by max_pages.
 */
export class HttpDonorIngestor implements DonorIngestor {
  private readonly screenshots: ScreenshotCapturer;

  constructor(screenshots?: ScreenshotCapturer) {
    this.screenshots = screenshots ?? new PlaywrightScreenshotCapturer();
  }

  async ingest(request: DonorIngestionRequest): Promise<AcceptedDonorEvidence | null> {
    const pages: DonorPageEvidence[] = [];
    const screenshotPaths: string[] = [];
    const donorDir = resolve(request.output_dir, sha12(request.domain));
    mkdirSync(resolve(donorDir, "screenshots"), { recursive: true });

    const urls = request.candidate_urls.slice(0, Math.max(1, request.max_pages));
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
          headers: { "user-agent": "Mozilla/5.0 (compatible; L9-DonorEvidence/1.0)" },
        });
        const body = await response.text();
        if (!response.ok || body.length === 0) continue;
        pages.push({
          url,
          status: response.status,
          content_digest: sha256(body),
          content_bytes: body.length,
          fetched_at: new Date().toISOString(),
        });
        if (screenshotPaths.length === 0) {
          const shot = await this.screenshots.capture({
            url,
            outputPath: resolve(donorDir, "screenshots", `${sha12(url)}.png`),
          });
          if (shot) screenshotPaths.push(shot);
        }
      } catch (error) {
        logger.warn(
          {
            donor: request.domain,
            url,
            reason: error instanceof Error ? error.message : String(error),
          },
          "donor page fetch failed; continuing bounded acquisition",
        );
      }
    }

    // Minimum evidence policy: >=1 fetched page AND >=1 rendered screenshot.
    if (pages.length === 0 || screenshotPaths.length === 0) {
      logger.warn(
        { donor: request.domain, pages: pages.length, screenshots: screenshotPaths.length },
        "donor failed minimum evidence policy; must be replaced",
      );
      return null;
    }

    const crawledAt = new Date().toISOString();
    const evidence: Omit<AcceptedDonorEvidence, "evidence_digest" | "crawl_manifest_path"> = {
      domain: request.domain,
      serp_observation_ids: [...request.serp_observation_ids],
      pages,
      screenshot_paths: screenshotPaths,
      crawled_at: crawledAt,
      disposition: "DONOR_REFERENCE_ONLY",
    };
    const evidenceDigest = sha256(JSON.stringify(evidence));
    const manifestPath = resolve(donorDir, "crawl-manifest.json");
    const complete: AcceptedDonorEvidence = {
      ...evidence,
      evidence_digest: evidenceDigest,
      crawl_manifest_path: manifestPath,
    };
    writeFileSync(manifestPath, `${JSON.stringify(complete, null, 2)}\n`, "utf-8");
    return complete;
  }

  async close(): Promise<void> {
    await this.screenshots.close();
  }
}
