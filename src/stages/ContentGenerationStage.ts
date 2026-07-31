// L9_META: layer=stage, role=content_generation, stage_index=4, status=active, version=2.1.0
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
  version = '2.1.0';

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) { logger.info({ routes: ctx.domainSpec.routes.length }, '[dry-run] Would generate route content'); return; }
    const { vertical, business_name, geography, routes } = ctx.domainSpec;
    for (const route of routes) {
      for (const component of route.components) {
        const key = `${route.slug}:${component}`;
        let content = '';
        // On retry, feed back the concrete validation failure so a real model gets
        // corrective signal instead of receiving the identical prompt twice.
        let correction = '';
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
          content = await ctx.llm.generateContent([
            `Write the ${component} section for the "${route.title}" page of a ${vertical} business.`,
            `Business: ${business_name}. States served: ${geography.states.join(', ')}.`,
            `Minimum ${MIN_WORDS} words. Do not include guaranteed outcomes, win rates, or legal advice.`,
            `Use active voice and second person. Output plain text only.`,
            correction,
          ].filter(Boolean).join('\n'));
          const wordCount = countWords(content);
          const banned = bannedClaim(content);
          if (wordCount >= MIN_WORDS && !banned) break;
          if (attempt === MAX_RETRIES) {
            throw new BuildError('CONTENT_VALIDATION_FAILED', wordCount < MIN_WORDS
              ? `${key}: generated content has ${wordCount} words, minimum ${MIN_WORDS}`
              : `${key}: banned claim "${banned}" persists after retry`);
          }
          correction = [
            'Your previous answer failed validation.',
            wordCount < MIN_WORDS ? `It contained ${wordCount} words; provide at least ${MIN_WORDS}.` : '',
            banned ? `It contained the prohibited claim "${banned}"; remove that claim and any equivalent promise.` : '',
            'Rewrite the complete section from scratch.',
          ].filter(Boolean).join(' ');
        }
        ctx.generatedContent.set(key, content);
      }
    }
    logger.info({ sections: ctx.generatedContent.size }, 'Content generation complete');
  }
}
