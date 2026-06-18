// L9_META: layer=stage, role=seo_baseline, stage_index=8, status=active, version=2.0.0
// Captures Day-0 keyword rank baseline via DataForSEO API.
// Graceful-degrades to null values when API is unavailable.
import { createModuleLogger } from '../core/logger.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:seo-baseline');
const DATAFORSEO_URL = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

interface DataForSEOResult {
  keyword: string;
  rank: number | null;
}

export class SEOBaselineStage implements Stage {
  name = 'seo-baseline';

  async run(ctx: BuildContext): Promise<void> {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    if (!login || !password) {
      logger.warn('DATAFORSEO_LOGIN/PASSWORD not set — skipping SEO baseline (non-blocking)');
      ctx.baselineRanks = {};
      return;
    }

    if (ctx.dryRun) {
      logger.info('[dry-run] Would capture SEO baseline ranks');
      ctx.baselineRanks = {};
      return;
    }

    const { geography, seo_contract } = ctx.domainSpec;
    const keywords = (seo_contract?.['target_keywords'] as string[] | undefined)
      ?? ctx.domainSpec.routes.map(r => `${r.title} ${geography.primary_state}`);

    const ranks: Record<string, number | null> = {};
    const credentials = Buffer.from(`${login}:${password}`).toString('base64');

    for (const keyword of keywords.slice(0, 10)) { // Cap at 10 to control API cost
      try {
        const res = await fetch(DATAFORSEO_URL, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([{
            keyword,
            location_code: 2840, // United States
            language_code: 'en',
            depth: 100,
          }]),
        });

        if (!res.ok) {
          logger.warn({ keyword, status: res.status }, 'DataForSEO request failed — null rank');
          ranks[keyword] = null;
          continue;
        }

        const data = await res.json() as { tasks?: Array<{ result?: Array<{ items?: Array<{ type: string; rank_absolute: number; domain?: string }> }> }> };
        const siteUrl = (ctx.domainSpec.seo_contract?.['site_url'] as string | undefined)?.replace(/^https?:\/\//, '') ?? '';
        const item = data.tasks?.[0]?.result?.[0]?.items?.find(
          i => i.type === 'organic' && (siteUrl ? i.domain?.includes(siteUrl) : false),
        );
        ranks[keyword] = item?.rank_absolute ?? null;
        logger.debug({ keyword, rank: ranks[keyword] }, 'Baseline rank captured');
      } catch (e) {
        logger.warn({ keyword, error: String(e) }, 'DataForSEO call error — null rank (non-blocking)');
        ranks[keyword] = null;
      }
    }

    ctx.baselineRanks = ranks;
    logger.info({ keywords: Object.keys(ranks).length, found: Object.values(ranks).filter(v => v !== null).length }, 'SEO baseline complete');
  }
}
