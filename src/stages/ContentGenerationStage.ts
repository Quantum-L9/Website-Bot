// L9_META: layer=stage, role=content_generation, stage_index=4, status=active, version=2.0.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:content-generation');
const MIN_WORDS = 80;
const BANNED_CLAIMS = ['guaranteed', 'we guarantee', '100% success', 'always win'];
const MAX_RETRIES = 1;
const countWords = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const bannedClaim = (value: string) => BANNED_CLAIMS.find(claim => value.toLowerCase().includes(claim));

export class ContentGenerationStage implements Stage {
  name = 'content-generation';
  version = '2.0.0';

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) { logger.info({ routes: ctx.domainSpec.routes.length }, '[dry-run] Would generate route content'); return; }
    const { vertical, business_name, geography, routes } = ctx.domainSpec;
    for (const route of routes) {
      for (const component of route.components) {
        const key = `${route.slug}:${component}`;
        let content = '';
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
          content = await ctx.llm.generateContent([
            `Write the ${component} section for the "${route.title}" page of a ${vertical} business.`,
            `Business: ${business_name}. States served: ${geography.states.join(', ')}.`,
            `Minimum ${MIN_WORDS} words. Do not include guaranteed outcomes, win rates, or legal advice.`,
            `Use active voice and second person. Output plain text only.`,
          ].join('\n'));
          const short = countWords(content) < MIN_WORDS;
          const banned = bannedClaim(content);
          if (!short && !banned) break;
          if (attempt === MAX_RETRIES) {
            throw new BuildError('CONTENT_VALIDATION_FAILED', short
              ? `${key}: generated content has ${countWords(content)} words, minimum ${MIN_WORDS}`
              : `${key}: banned claim "${banned}" persists after retry`);
          }
        }
        ctx.generatedContent.set(key, content);
      }
    }
    logger.info({ sections: ctx.generatedContent.size }, 'Content generation complete');
  }
}
