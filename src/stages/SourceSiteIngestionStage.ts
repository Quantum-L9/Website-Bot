// L9_META: layer=stage, role=source_site_ingestion, stage_index=2, status=active, version=2.0.0
//
// Gathers evidence from a source website: validates the seed URL against the SSRF
// policy, crawls within page/depth/time limits, extracts structured page data,
// downloads and inspects acceptable images, and writes a SourceSiteManifest to
// the build context. It interprets nothing — later stages (planning, generation)
// consume the evidence. A no-op unless assets.sourceSite.enabled is true.
//
// The manifest is persisted as canonical `source_site` evidence so terminal
// convergence can require it. On a re-run the stage reuses that evidence WITHOUT
// re-crawling when every downloaded image (and captured screenshot) still verifies
// byte-for-byte; a missing or tampered file fails closed to a fresh crawl.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import { sha256File } from '../pipeline/evidence/EvidenceCanonicalizer.js';
import type { SourceSiteManifest } from '../pipeline/evidence/SourceSiteManifest.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { EvidenceKind } from '../pipeline/evidence/EvidenceReference.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { assertUrlAllowed, UrlPolicyError } from '../ingestion/UrlPolicy.js';
import { SourceCrawler } from '../ingestion/SourceCrawler.js';
import { PlaywrightScreenshotCapturer } from '../ingestion/ScreenshotCapturer.js';

const logger = createModuleLogger('stage:source-site-ingestion');

export class SourceSiteIngestionStage implements Stage {
  name = 'source-site-ingestion';
  version = '2.0.0';
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (ctx: BuildContext): EvidenceKind[] =>
      ctx.dryRun || ctx.domainSpec.assets?.sourceSite?.enabled !== true ? [] : ['source_site'],
    resumable: false,
    externalMutation: false,
  };

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

    // Resume fast-path: reuse persisted evidence when its downloaded files verify.
    const cached = await ctx.evidenceStore.readSourceSite();
    if (cached && this.storedFilesIntact(cached.value)) {
      ctx.sourceSiteManifest = cached.value;
      this.persistManifestFile(ctx, cached.value);
      logger.info({ url: sourceSite.url, images: cached.value.images.length }, 'Source site reused from verified evidence (no crawl)');
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
    this.persistManifestFile(ctx, manifest);
    await ctx.evidenceStore.writeSourceSite(manifest);

    logger.info(
      { url: sourceSite.url, pages: manifest.pages.length, images: manifest.images.length, rejected: manifest.rejected.length },
      'Source site ingested',
    );
  }

  /** True only when every downloaded image and captured screenshot still verifies. */
  private storedFilesIntact(manifest: SourceSiteManifest): boolean {
    for (const image of manifest.images) {
      const path = resolve(image.localPath);
      if (!existsSync(path)) return false;
      try {
        if (sha256File(path) !== image.sha256) return false;
      } catch {
        return false;
      }
    }
    for (const page of manifest.pages) {
      if (page.screenshotPath && !existsSync(resolve(page.screenshotPath))) return false;
    }
    return true;
  }

  private persistManifestFile(ctx: BuildContext, manifest: SourceSiteManifest): void {
    const manifestDir = resolve('build', 'assets', ctx.clientId, 'manifests');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(resolve(manifestDir, 'source-site-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  }
}
