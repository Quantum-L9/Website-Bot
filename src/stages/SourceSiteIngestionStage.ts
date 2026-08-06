// L9_META: layer=stage, role=source_site_ingestion, stage_index=2, status=active, version=1.0.0
//
// Gathers evidence from a source website: validates the seed URL against the SSRF
// policy, crawls within page/depth/time limits, extracts structured page data,
// downloads and inspects acceptable images, and writes a SourceSiteManifest to
// the build context. It interprets nothing — later stages (planning, generation)
// consume the evidence. A no-op unless assets.sourceSite.enabled is true.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { assertUrlAllowed, UrlPolicyError } from '../ingestion/UrlPolicy.js';
import { SourceCrawler } from '../ingestion/SourceCrawler.js';
import { PlaywrightScreenshotCapturer } from '../ingestion/ScreenshotCapturer.js';

const logger = createModuleLogger('stage:source-site-ingestion');

export class SourceSiteIngestionStage implements Stage {
  name = 'source-site-ingestion';
  version = '1.0.0';
  evidence = { inputs: (_ctx: BuildContext) => [], outputs: (_ctx: BuildContext) => [], resumable: false, externalMutation: false };

  async run(ctx: BuildContext): Promise<void> {
    const sourceSite = ctx.domainSpec.assets?.sourceSite;
    if (!sourceSite || sourceSite.enabled !== true) {
      logger.info('Source-site ingestion not enabled; skipping');
      return;
    }

    try {
      assertUrlAllowed(sourceSite.url, { allowSubdomains: sourceSite.allowSubdomains });
    } catch (error) {
      if (error instanceof UrlPolicyError) throw new BuildError('VALIDATION_FAILED', `Source site URL rejected (${error.reason}): ${sourceSite.url}`);
      throw error;
    }

    if (ctx.dryRun) {
      logger.info({ url: sourceSite.url }, '[dry-run] Would crawl source site');
      return;
    }

    const outputDir = resolve('build', 'assets', ctx.clientId, 'source-site');
    const crawler = new SourceCrawler({
      seedUrl: sourceSite.url,
      maxPages: sourceSite.maxPages,
      maxDepth: sourceSite.maxDepth,
      allowSubdomains: sourceSite.allowSubdomains,
      downloadImages: sourceSite.downloadImages,
      captureScreenshots: sourceSite.captureScreenshots,
      outputDir,
      screenshotCapturer: sourceSite.captureScreenshots ? new PlaywrightScreenshotCapturer() : undefined,
      now: () => ctx.startedAt,
    });

    const manifest = await crawler.crawl();
    ctx.sourceSiteManifest = manifest;

    const manifestDir = resolve('build', 'assets', ctx.clientId, 'manifests');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(resolve(manifestDir, 'source-site-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

    logger.info(
      { url: sourceSite.url, pages: manifest.pages.length, images: manifest.images.length, rejected: manifest.rejected.length },
      'Source site ingested',
    );
  }
}
