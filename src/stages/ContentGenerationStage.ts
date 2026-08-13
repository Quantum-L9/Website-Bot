// L9_META: layer=stage, role=content_generation, stage_index=4, status=active, version=2.2.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { stripMarkdownDecorators } from '../services/content/plainText.js';
import { assembleSourceSection, matchSourcePage } from '../services/content/sourceCopy.js';

const logger = createModuleLogger('stage:content-generation');
const MIN_WORDS = 80;
const SHORT_SECTION_MIN_WORDS = 8;
const SHORT_SECTIONS = /^(gallery|cta|final_cta|contact_form|trust_bar|trust_signals)$/;
const BANNED_CLAIMS = ['guaranteed', 'we guarantee', '100% success', 'always win'];
const MAX_RETRIES = 1;
const countWords = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const bannedClaim = (value: string) => BANNED_CLAIMS.find(claim => value.toLowerCase().includes(claim));
const sectionKey = (component: string) => component.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const minWordsFor = (component: string) => SHORT_SECTIONS.test(sectionKey(component)) ? SHORT_SECTION_MIN_WORDS : MIN_WORDS;

export class ContentGenerationStage implements Stage {
  name = 'content-generation';
  version = '2.3.0';

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) { logger.info({ routes: ctx.domainSpec.routes.length }, '[dry-run] Would generate route content'); return; }
    const sourceEnabled = ctx.domainSpec.assets?.sourceSite?.enabled === true;
    const hasPages = Boolean(ctx.sourceSiteManifest?.pages.length);
    if (sourceEnabled && !hasPages) {
      throw new BuildError(
        'CONTENT_VALIDATION_FAILED',
        'Source-site reconstruction requires crawled pages. Refusing to invent copy.',
      );
    }
    const reconstructing = hasPages;
    const { vertical, business_name, geography, routes } = ctx.domainSpec;
    const phone = ctx.domainSpec.seo_contract?.phone?.trim();
    for (const route of routes) {
      for (const component of route.components) {
        const key = `${route.slug}:${component}`;
        if (reconstructing) {
          const page = matchSourcePage(ctx.sourceSiteManifest, route.slug);
          if (!page) {
            throw new BuildError(
              'CONTENT_VALIDATION_FAILED',
              `${key}: source-site reconstruction is on but no crawled page matched ${route.slug}`,
            );
          }
          ctx.generatedContent.set(key, assembleSourceSection(page, component));
          continue;
        }
        let content = '';
        const minWords = minWordsFor(component);
        const keyName = sectionKey(component);
        const ctaHint = /^(contact_form|cta|final_cta)$/.test(keyName)
          ? 'First line must be a concrete offer headline. For roofing and home services use exactly: Free Roof Inspection Within 24 Hours. Never write "Tell us about the job", "Take the next step", or similar uninviting filler.'
          : '';
        let correction = '';
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
          content = await ctx.llm.generateContent([
            `Write the ${component} section for the "${route.title}" page of a ${vertical} business.`,
            `Business: ${business_name}. States served: ${geography.states.join(', ')}.`,
            phone
              ? `Known phone: ${phone}. Use this number when a phone is needed. Never invent a number and never write bracketed placeholders such as [phone number].`
              : 'No phone is on file. Omit phone numbers. Never write bracketed placeholders such as [phone number].',
            `Minimum ${minWords} words. Do not include guaranteed outcomes, win rates, or legal advice.`,
            'Use active voice and second person. Output plain text only. Do not use Markdown, asterisks, or # headings.',
            ctaHint,
            correction,
          ].filter(Boolean).join('\n'));
          if (phone) {
            content = content.replace(/\[(?:your |insert |add |enter )?phone(?: number)?\]/gi, phone);
          }
          content = stripMarkdownDecorators(content);
          const wordCount = countWords(content);
          const banned = bannedClaim(content);
          if (wordCount >= minWords && !banned) break;
          if (attempt === MAX_RETRIES) {
            throw new BuildError('CONTENT_VALIDATION_FAILED', wordCount < minWords
              ? `${key}: generated content has ${wordCount} words, minimum ${minWords}`
              : `${key}: banned claim "${banned}" persists after retry`);
          }
          correction = [
            'Your previous answer failed validation.',
            wordCount < minWords ? `It contained ${wordCount} words; provide at least ${minWords}.` : '',
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
