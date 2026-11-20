// L9_META: layer=service, role=image_prompt_compiler, status=active, version=1.0.0
//
// Compile a slot's generation brief into a provider-agnostic prompt string.
// Deterministic: the same brief + compiler + tokens always yields the same
// prompt, so the generation cache fingerprint is stable across runs.

import type { ImageGenerationBrief } from "../../pipeline/evidence/ImageAssetPlan.js";

export const PROMPT_COMPILER_VERSION = "2.0.0";

/**
 * Rendering style a brief is compiled to. A brief that would depict people,
 * the client's staff or customers, or the client's work (crews, installs,
 * finished jobs) is never a photoreal image: a photo-like picture of invented
 * staff or invented completed jobs is an invented claim (AGENTS.md). Those
 * become illustrations. Only neutral scenes (materials, tools, textures,
 * places) may be photographic, and even they show no people.
 */
export type GeneratedImageStyle = "illustration" | "photographic-neutral";

const PEOPLE_OR_WORK =
  /\b(people|person|persons|man|men|woman|women|staff|team|crew|crews|worker|workers|employee|employees|technician|technicians|installer|installers|contractor|contractors|roofer|roofers|plumber|plumbers|electrician|electricians|owner|owners|homeowner|homeowners|customer|customers|client|clients|family|families|portrait|smiling|handshake|founder|founders|our work|completed|finished|installed|installing|installation|project|projects|job|jobs|before and after|before-and-after|testimonial)\b/i;

/** The style a brief must be rendered in (see GeneratedImageStyle). */
export function briefStyle(brief: ImageGenerationBrief): GeneratedImageStyle {
  const text = [brief.intent, brief.subject, brief.composition, brief.style]
    .filter(Boolean)
    .join(" ");
  return PEOPLE_OR_WORK.test(text) ? "illustration" : "photographic-neutral";
}

export type PromptCompilerName = "default" | "igor-motif";

export interface CompiledPrompt {
  prompt: string;
  style: GeneratedImageStyle;
  compiler: PromptCompilerName;
  compilerVersion: string;
}

export interface CompileOptions {
  compiler?: PromptCompilerName;
  designTokens?: Record<string, string>;
}

function paletteHint(tokens: Record<string, string> | undefined): string | undefined {
  if (!tokens) return undefined;
  const parts = ["primary", "secondary", "accent"]
    .map((key) => tokens[key])
    .filter((value): value is string => Boolean(value));
  return parts.length ? `Brand palette: ${parts.join(", ")}.` : undefined;
}

export function compileImagePrompt(
  brief: ImageGenerationBrief,
  options: CompileOptions = {},
): CompiledPrompt {
  const compiler = options.compiler ?? "default";
  const style = briefStyle(brief);
  const sentences: string[] = [];

  if (style === "illustration") {
    sentences.push(
      "Flat editorial illustration with simple geometric shapes and generous negative space; clearly drawn, never a camera image.",
    );
  } else if (compiler === "igor-motif") {
    sentences.push(
      "Editorial, cinematic photograph with confident negative space and natural light.",
    );
  }
  sentences.push(`${brief.intent.trim().replace(/\.$/, "")}.`);
  if (brief.subject) sentences.push(`Subject: ${brief.subject}.`);
  if (brief.composition) sentences.push(`Composition: ${brief.composition}.`);
  // A brief's own style cannot reintroduce photorealism for people or work.
  if (brief.style && !(style === "illustration" && /photo|realis/i.test(brief.style)))
    sentences.push(`Style: ${brief.style}.`);
  const palette = paletteHint(options.designTokens);
  if (palette) sentences.push(palette);
  if (brief.aspectRatio) sentences.push(`Aspect ratio ${brief.aspectRatio}.`);
  if (brief.exclusions?.length) sentences.push(`Do not include: ${brief.exclusions.join(", ")}.`);
  if (style === "illustration") {
    sentences.push(
      "Stylised figures only, no realistic people and no identifiable person, no real staff, customers, vehicles or completed client projects; no text, logos or watermarks.",
    );
  } else {
    sentences.push(
      "Neutral scene only: no people, no staff or customers, no completed client projects; natural detail, no text, logos or watermarks.",
    );
  }

  return {
    prompt: sentences.join(" "),
    style,
    compiler,
    compilerVersion: PROMPT_COMPILER_VERSION,
  };
}
