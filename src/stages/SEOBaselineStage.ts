// L9_META: layer=stage, role=seo_baseline, stage_index=8, status=active, version=2.0.0
// Captures Day-0 keyword rank baseline via DataForSEO API.
// Graceful-degrades to null values when API is unavailable.
import { createModuleLogger } from '../core/logger.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:seo-baseline');
const DATAFORSEO_URL = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

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
    // target_keywords may be authored as plain strings or as { keyword, priority }
    // objects (the v2 seo_contract shape HandoffEmitterStage consumes). Normalize
    // both to keyword strings so we never send "[object Object]" to DataForSEO.
    const rawKeywords = seo_contract?.['target_keywords'];
    const configured = Array.isArray(rawKeywords)
      ? rawKeywords
          .map(k => (typeof k === 'string' ? k : String((k as { keyword?: unknown }).keyword ?? '')).trim())
          .filter(k => k.length > 0)
      : [];
    const keywords = configured.length > 0
      ? configured
      : ctx.domainSpec.routes.map(r => `${r.title} ${geography.primary_state}`);

    const targetKeywords = keywords.slice(0, 10); // Cap at 10 to control API cost
    const ranks: Record<string, number | null> = {};
    const credentials = Buffer.from(`${login}:${password}`).toString('base64');

    // Batch all keywords into a single DataForSEO request (supports up to 100 tasks)
    const tasks = targetKeywords.map(keyword => ({
      keyword,
      location_code: 2840, // United States
      language_code: 'en',
      depth: 100,
    }));

    try {
      const res = await fetch(DATAFORSEO_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tasks),
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, 'DataForSEO batch request failed — all ranks null');
        for (const kw of targetKeywords) ranks[kw] = null;
        ctx.baselineRanks = ranks;
        return;
      }

      const data = await res.json() as {
        tasks?: Array<{
          data?: { keyword?: string };
          result?: Array<{ items?: Array<{ type: string; rank_absolute: number; domain?: string }> }>;
        }>;
      };

      const siteUrl = (ctx.domainSpec.seo_contract?.['site_url'] as string | undefined)?.replace(/^https?:\/\//, '') ?? '';

      for (let i = 0; i < targetKeywords.length; i++) {
        const keyword = targetKeywords[i];
        const task = data.tasks?.[i];
        const item = task?.result?.[0]?.items?.find(
          it => it.type === 'organic' && (siteUrl ? it.domain?.includes(siteUrl) : false),
        );
        ranks[keyword] = item?.rank_absolute ?? null;
        logger.debug({ keyword, rank: ranks[keyword] }, 'Baseline rank captured');
      }
    } catch (e) {
      logger.warn({ error: String(e) }, 'DataForSEO batch call error — all ranks null (non-blocking)');
      for (const kw of targetKeywords) ranks[kw] = null;
    }

    ctx.baselineRanks = ranks;
    logger.info({ keywords: Object.keys(ranks).length, found: Object.values(ranks).filter(v => v !== null).length }, 'SEO baseline complete');
  }
}
