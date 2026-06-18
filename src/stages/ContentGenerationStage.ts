// L9_META: layer=stage, role=content_generation, stage_index=4, status=active, version=2.0.0
// Generates page copy per route × component using LLM.
// V-08 FIX: word count gate enforced post-generation. Auto-retry once on insufficient content.
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:content-generation');

const MIN_WORDS = 80;
const BANNED_CLAIMS = ['guaranteed', 'we guarantee', '100% success', 'always win'];
const MAX_RETRIES = 1;

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function hasBannedClaim(s: string): string | null {
  const lower = s.toLowerCase();
  for (const claim of BANNED_CLAIMS) {
    if (lower.includes(claim)) return claim;
  }
  return null;
}

export class ContentGenerationStage implements Stage {
  name = 'content-generation';

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) {
      logger.info(`[dry-run] Would generate content for ${ctx.domainSpec.routes.length} routes`);
      return;
    }

    const { vertical, business_name, geography, routes } = ctx.domainSpec;

    for (const route of routes) {
      for (const component of route.components) {
        const key = `${route.slug}:${component}`;
        let content = '';
        let retries = 0;

        while (retries <= MAX_RETRIES) {
          const prompt = `
Write the ${component} section for the "${route.title}" page of a ${vertical} business.
Business: ${business_name}. States served: ${geography.states.join(', ')}.
Requirements:
- Minimum ${MIN_WORDS} words
- Do NOT include guaranteed outcomes, win rates, or legal advice
- Use active voice, second person ("you"), SEO-optimized for "${route.title} ${geography.primary_state}"
- Output ONLY the content text, no HTML tags, no markdown
          `.trim();

          content = await ctx.llm.generateContent(prompt);

          // V-08: Word count gate
          const wordCount = countWords(content);
          if (wordCount < MIN_WORDS) {
            logger.warn({ key, wordCount, attempt: retries + 1 }, 'Content too short — retrying');
            retries++;
            if (retries > MAX_RETRIES) {
              throw new BuildError(
                'CONTENT_VALIDATION_FAILED',
                `${key}: generated content has ${wordCount} words (minimum ${MIN_WORDS}) after ${MAX_RETRIES + 1} attempts`,
              );
            }
            continue;
          }

          // Banned claim gate
          const banned = hasBannedClaim(content);
          if (banned) {
            logger.warn({ key, banned, attempt: retries + 1 }, 'Banned claim detected — retrying');
            retries++;
            if (retries > MAX_RETRIES) {
              throw new BuildError(
                'CONTENT_VALIDATION_FAILED',
                `${key}: banned claim "${banned}" persists after ${MAX_RETRIES + 1} generation attempts`,
              );
            }
            continue;
          }

          break; // Gates passed
        }

        ctx.generatedContent.set(key, content);
        logger.debug({ key, wordCount: countWords(content) }, 'Content generated and validated');
      }
    }

    logger.info({ pages: ctx.generatedContent.size }, 'Content generation complete');
  }
}
