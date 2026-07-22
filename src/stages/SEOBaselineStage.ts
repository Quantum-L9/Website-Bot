// L9_META: layer=stage, role=seo_baseline, stage_index=12, status=active, version=3.0.0
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
      logger.warn('DATAFORSEO_LOGIN/PASSWORD not set; SEO baseline skipped');
      ctx.baselineRanks = {};
      ctx.qualityEvidence.seoBaseline = 'skipped';
      return;
    }
    if (ctx.dryRun) {
      logger.info('[dry-run] Would capture SEO baseline ranks');
      ctx.baselineRanks = {};
      ctx.qualityEvidence.seoBaseline = 'skipped';
      return;
    }

    const { geography, seo_contract } = ctx.domainSpec;
    const rawKeywords = seo_contract?.target_keywords;
    const configured = Array.isArray(rawKeywords)
      ? rawKeywords.flatMap((keyword): string[] => {
          if (typeof keyword === 'string') return keyword.trim() ? [keyword.trim()] : [];
          if (keyword && typeof keyword === 'object') {
            const value = (keyword as { keyword?: unknown }).keyword;
            return typeof value === 'string' && value.trim() ? [value.trim()] : [];
          }
          return [];
        })
      : [];
    const keywords = configured.length > 0 ? configured : ctx.domainSpec.routes.map(route => `${route.title} ${geography.primary_state}`);
    const targetKeywords = keywords.slice(0, 10);
    const ranks: Record<string, number | null> = {};
    const credentials = Buffer.from(`${login}:${password}`).toString('base64');
    const tasks = targetKeywords.map(keyword => ({ keyword, location_code: 2840, language_code: 'en', depth: 100 }));

    try {
      const response = await fetch(DATAFORSEO_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tasks),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        for (const keyword of targetKeywords) ranks[keyword] = null;
        ctx.baselineRanks = ranks;
        ctx.qualityEvidence.seoBaseline = 'failed';
        logger.warn({ status: response.status }, 'DataForSEO request failed; SEO baseline marked failed');
        return;
      }
      const data = await response.json() as { tasks?: Array<{ result?: Array<{ items?: Array<{ type: string; rank_absolute: number; domain?: string }> }> }> };
      const rawSiteUrl = String(ctx.domainSpec.seo_contract?.site_url ?? '');
      const siteHost = rawSiteUrl ? new URL(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawSiteUrl) ? rawSiteUrl : `https://${rawSiteUrl}`).hostname : '';
      for (let index = 0; index < targetKeywords.length; index++) {
        const keyword = targetKeywords[index];
        const item = data.tasks?.[index]?.result?.[0]?.items?.find(result => result.type === 'organic' && Boolean(siteHost) && result.domain?.includes(siteHost));
        ranks[keyword] = item?.rank_absolute ?? null;
      }
      ctx.baselineRanks = ranks;
      ctx.qualityEvidence.seoBaseline = 'passed';
      logger.info({ keywords: Object.keys(ranks).length, found: Object.values(ranks).filter(value => value !== null).length }, 'SEO baseline completed');
    } catch (error) {
      for (const keyword of targetKeywords) ranks[keyword] = null;
      ctx.baselineRanks = ranks;
      ctx.qualityEvidence.seoBaseline = 'failed';
      logger.warn({ error: String(error) }, 'DataForSEO request failed; SEO baseline marked failed');
    }
  }
}
