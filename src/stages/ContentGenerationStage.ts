// L9_META: layer=stage, role=content_generation, stage_index=4, status=active, version=2.1.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:content-generation');
const MIN_WORDS = 80;
const MAX_H1_WORDS = 12;
const BANNED_CLAIMS = ['guaranteed', 'we guarantee', '100% success', 'always win'];
const MAX_RETRIES = 2;
const countWords = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const bannedClaim = (value: string) => BANNED_CLAIMS.find(claim => value.toLowerCase().includes(claim));

function parseHeadlineAndBody(content: string): { headline: string; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const headline = (lines[0] ?? '').trim();
  let blankIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') {
      blankIndex = i;
      break;
    }
  }
  const body = blankIndex === -1 ? '' : lines.slice(blankIndex + 1).join('\n').trim();
  return { headline, body };
}

type SlotIssue = {
  message: string;
  correction: string;
};

function validateSlot(
  key: string,
  content: string,
  seenH1s: Set<string>,
  seenBodies: Set<string>,
): SlotIssue | undefined {
  const { headline, body } = parseHeadlineAndBody(content);
  const h1Words = countWords(headline);
  const bodyWords = countWords(body);
  const banned = bannedClaim(content);

  if (!headline) {
    return {
      message: `${key}: empty H1`,
      correction: `The headline (line 1) was empty; put a unique headline of at most ${MAX_H1_WORDS} words on line 1.`,
    };
  }
  if (h1Words > MAX_H1_WORDS) {
    return {
      message: `${key}: H1 has ${h1Words} words, maximum ${MAX_H1_WORDS}`,
      correction: `The headline had ${h1Words} words; keep line 1 to ${MAX_H1_WORDS} words or fewer.`,
    };
  }
  if (!body) {
    return {
      message: `${key}: missing body after headline`,
      correction: `The body after the headline was missing; add a blank line, then at least ${MIN_WORDS} words.`,
    };
  }
  if (bodyWords < MIN_WORDS) {
    return {
      message: `${key}: generated content has ${bodyWords} words, minimum ${MIN_WORDS}`,
      correction: `It contained ${bodyWords} words; provide at least ${MIN_WORDS}.`,
    };
  }
  if (banned) {
    return {
      message: `${key}: banned claim "${banned}" persists after retry`,
      correction: `It contained the prohibited claim "${banned}"; remove that claim and any equivalent promise.`,
    };
  }
  const h1Key = headline.toLowerCase();
  if (seenH1s.has(h1Key)) {
    return {
      message: `${key}: duplicate H1 "${headline}"`,
      correction: `The headline collided with another section ("${headline}"); write a unique headline.`,
    };
  }
  const bodyKey = body.toLowerCase();
  if (seenBodies.has(bodyKey)) {
    return {
      message: `${key}: duplicate body`,
      correction: `The body collided with another section; write unique body copy.`,
    };
  }
  return undefined;
}

export class ContentGenerationStage implements Stage {
  name = 'content-generation';
  version = '2.1.0';

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) { logger.info({ routes: ctx.domainSpec.routes.length }, '[dry-run] Would generate route content'); return; }
    const { vertical, business_name, geography, routes } = ctx.domainSpec;
    const seenH1s = new Set<string>();
    const seenBodies = new Set<string>();
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
            `Line 1 must be the headline (at most ${MAX_H1_WORDS} words, unique across sections).`,
            `Then a blank line.`,
            `Then the body: minimum ${MIN_WORDS} words, unique across sections.`,
            `Do not include guaranteed outcomes, win rates, or legal advice.`,
            `Use active voice and second person. Output plain text only.`,
            correction,
          ].filter(Boolean).join('\n'));
          const issue = validateSlot(key, content, seenH1s, seenBodies);
          if (!issue) break;
          if (attempt === MAX_RETRIES) {
            throw new BuildError('CONTENT_VALIDATION_FAILED', issue.message);
          }
          correction = [
            'Your previous answer failed validation.',
            issue.correction,
            'Rewrite the complete section from scratch.',
          ].filter(Boolean).join(' ');
        }
        const { headline, body } = parseHeadlineAndBody(content);
        seenH1s.add(headline.toLowerCase());
        seenBodies.add(body.toLowerCase());
        ctx.generatedContent.set(key, content);
      }
    }
    logger.info({ sections: ctx.generatedContent.size }, 'Content generation complete');
  }
}
