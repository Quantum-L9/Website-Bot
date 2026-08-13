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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import { sha256File } from '../pipeline/evidence/EvidenceCanonicalizer.js';
import type { SourceSiteManifest } from '../pipeline/evidence/SourceSiteManifest.js';
import { validateSourceSiteManifest } from '../pipeline/evidence/SourceSiteManifest.js';
import { clientAssetRoot, clientPersistentAssetRoot, type BuildContext } from '../pipeline/BuildContext.js';
import { hasMediaPage } from '../ingestion/CrawlPriority.js';
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

    // Resume fast-path: reuse persisted evidence when its downloaded files verify
    // AND the crawl already captured a gallery/work page. A 15-page BFS that
    // never reached /gallery is not reusable — recrawl with media-page priority.
    const cached = await ctx.evidenceStore.readSourceSite();
    if (cached && this.canReuseManifest(cached.value, sourceSite.url)) {
      ctx.sourceSiteManifest = cached.value;
      this.persistManifestFile(ctx, cached.value);
      logger.info({ url: sourceSite.url, images: cached.value.images.length }, 'Source site reused from verified evidence (no crawl)');
      return;
    }

    const persistentDir = resolve(clientPersistentAssetRoot(ctx), 'source-site');
    const persistentManifestPath = resolve(persistentDir, 'source-site-manifest.json');
    if (existsSync(persistentManifestPath)) {
      try {
        const persistent = JSON.parse(readFileSync(persistentManifestPath, 'utf-8')) as unknown;
        validateSourceSiteManifest(persistent);
        if (this.canReuseManifest(persistent, sourceSite.url)) {
          ctx.sourceSiteManifest = persistent;
          this.persistManifestFile(ctx, persistent);
          await ctx.evidenceStore.writeSourceSite(persistent);
          logger.info({ url: sourceSite.url, images: persistent.images.length }, 'Source site reused from client cache (no crawl)');
          return;
        }
      } catch (error) {
        logger.warn({ err: String(error) }, 'Client source-site cache unusable; crawling');
      }
    }

    mkdirSync(persistentDir, { recursive: true });
    const crawler = new SourceCrawler({
      seedUrl: sourceSite.url,
      maxPages: sourceSite.maxPages,
      maxDepth: sourceSite.maxDepth,
      allowSubdomains: sourceSite.allowSubdomains,
      downloadImages: sourceSite.downloadImages,
      captureScreenshots: sourceSite.captureScreenshots,
      outputDir: persistentDir,
      screenshotCapturer: sourceSite.captureScreenshots ? new PlaywrightScreenshotCapturer() : undefined,
      now: () => ctx.startedAt,
    });

    const manifest = await crawler.crawl();
    ctx.sourceSiteManifest = manifest;
    this.persistManifestFile(ctx, manifest);
    writeFileSync(resolve(persistentDir, 'source-site-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
    await ctx.evidenceStore.writeSourceSite(manifest);

    logger.info(
      { url: sourceSite.url, pages: manifest.pages.length, images: manifest.images.length, rejected: manifest.rejected.length },
      'Source site ingested',
    );
  }

  private canReuseManifest(manifest: SourceSiteManifest, sourceUrl: string): boolean {
    if (!this.sourceUrlMatches(manifest.sourceUrl, sourceUrl)) return false;
    if (!this.storedFilesIntact(manifest)) return false;
    const home = manifest.pages.find(page => page.depth === 0) ?? manifest.pages[0];
    if (!home?.bodyText || !(home.phones?.length) || !(home.nav?.length)) return false;
    const pageUrls = manifest.pages.map(page => page.url);
    const imageUrls = manifest.images.map(image => image.sourceUrl);
    return hasMediaPage(pageUrls) || hasMediaPage(imageUrls) || manifest.images.length >= 12;
  }

  private sourceUrlMatches(cached: string, wanted: string): boolean {
    try {
      return new URL(cached).hostname.replace(/^www\./, '') === new URL(wanted).hostname.replace(/^www\./, '');
    } catch {
      return cached === wanted;
    }
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
    const manifestDir = resolve(clientAssetRoot(ctx), 'manifests');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(resolve(manifestDir, 'source-site-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  }
}
