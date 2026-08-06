// L9_META: layer=service, role=image_prompt_compiler, status=active, version=1.0.0
//
// Compile a slot's generation brief into a provider-agnostic prompt string.
// Deterministic: the same brief + compiler + tokens always yields the same
// prompt, so the generation cache fingerprint is stable across runs.

import type { ImageGenerationBrief } from '../../pipeline/evidence/ImageAssetPlan.js';

export const PROMPT_COMPILER_VERSION = '1.0.0';

export type PromptCompilerName = 'default' | 'igor-motif';

export interface CompiledPrompt {
  prompt: string;
  compiler: PromptCompilerName;
  compilerVersion: string;
}

export interface CompileOptions {
  compiler?: PromptCompilerName;
  designTokens?: Record<string, string>;
}

function paletteHint(tokens: Record<string, string> | undefined): string | undefined {
  if (!tokens) return undefined;
  const parts = ['primary', 'secondary', 'accent']
    .map(key => tokens[key])
    .filter((value): value is string => Boolean(value));
  return parts.length ? `Brand palette: ${parts.join(', ')}.` : undefined;
}

export function compileImagePrompt(brief: ImageGenerationBrief, options: CompileOptions = {}): CompiledPrompt {
  const compiler = options.compiler ?? 'default';
  const sentences: string[] = [];

  if (compiler === 'igor-motif') {
    sentences.push('Editorial, cinematic photograph with confident negative space and natural light.');
  }
  sentences.push(brief.intent.trim().replace(/\.$/, '') + '.');
  if (brief.subject) sentences.push(`Subject: ${brief.subject}.`);
  if (brief.composition) sentences.push(`Composition: ${brief.composition}.`);
  if (brief.style) sentences.push(`Style: ${brief.style}.`);
  const palette = paletteHint(options.designTokens);
  if (palette) sentences.push(palette);
  if (brief.aspectRatio) sentences.push(`Aspect ratio ${brief.aspectRatio}.`);
  if (brief.exclusions?.length) sentences.push(`Do not include: ${brief.exclusions.join(', ')}.`);
  sentences.push('Photorealistic, high detail, no text or watermarks.');

  return { prompt: sentences.join(' '), compiler, compilerVersion: PROMPT_COMPILER_VERSION };
}
