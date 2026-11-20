// L9_META: layer=service, role=gemini_image_generator, status=active, version=1.0.0
//
// Direct Gemini image-generation adapter behind the local ImageGenerator
// interface. Uses fetch against the REST endpoint (no provider SDK dependency)
// and is constructed only when an API key is available; it is never exercised in
// CI. When the pipeline later routes generation through LLM-Router, a
// RouterImageGenerator replaces this class without touching any consumer.

import { createModuleLogger } from "../../core/logger.js";
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenerator,
  ImageSizeHint,
} from "./ImageGenerator.js";

const logger = createModuleLogger("service:gemini-image");

export interface GeminiImageOptions {
  apiKey: string;
  model?: string;
  endpointBase?: string;
  /** Per-image cost estimate recorded for budgeting and evidence. */
  costPerImageUsd?: number;
}

/**
 * Aspect ratios accepted by `generationConfig.imageConfig.aspectRatio`
 * (Gemini API reference, ImageConfig; output table for gemini-2.5-flash-image).
 * The newer 3.1 / Nano Banana 2.1 models add the extreme ratios.
 */
const BASE_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;
const EXTENDED_ASPECT_RATIOS = ["1:4", "4:1", "1:8", "8:1"] as const;

/**
 * Models documented with 1K/2K/4K size tiers. gemini-2.5-flash-image ("legacy
 * Nano Banana") documents a single size per ratio, and the API returns an
 * error when a model receives a config field it does not support, so the size
 * is only sent to these families.
 */
const SIZE_TIER_MODEL = /^gemini-(3-pro-image|3\.1-flash-image|3\.1-flash-lite-image|nano-banana)/;
const EXTENDED_RATIO_MODEL = /^gemini-(3\.1-flash-image|nano-banana-2\.1)/;

function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
}

/** Ratios this model accepts, for the request config. */
export function supportedAspectRatios(model: string): readonly string[] {
  return EXTENDED_RATIO_MODEL.test(model)
    ? [...BASE_ASPECT_RATIOS, ...EXTENDED_ASPECT_RATIOS]
    : BASE_ASPECT_RATIOS;
}

export function modelSupportsImageSize(model: string): boolean {
  return SIZE_TIER_MODEL.test(model);
}

/**
 * The image config to send for a request: the requested ratio when the model
 * accepts it, else the nearest accepted ratio (by log-distance); the size tier
 * only where the model offers tiers. Every deviation is recorded.
 */
export function geminiImageConfig(
  model: string,
  request: Pick<ImageGenerationRequest, "aspectRatio" | "imageSize">,
): { config: { aspectRatio?: string; imageSize?: ImageSizeHint }; adjustments: string[] } {
  const config: { aspectRatio?: string; imageSize?: ImageSizeHint } = {};
  const adjustments: string[] = [];
  const requested = request.aspectRatio?.trim().replace(/\s+/g, "").replace(/[x/]/, ":");
  if (requested) {
    const supported = supportedAspectRatios(model);
    const parsed = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(requested);
    if (supported.includes(requested)) {
      config.aspectRatio = requested;
    } else if (parsed && Number(parsed[2]) > 0) {
      const target = Math.log(Number(parsed[1]) / Number(parsed[2]));
      const nearest = [...supported].sort(
        (a, b) =>
          Math.abs(Math.log(ratioValue(a)) - target) - Math.abs(Math.log(ratioValue(b)) - target),
      )[0];
      config.aspectRatio = nearest;
      adjustments.push(
        `aspectRatio ${request.aspectRatio} is not accepted by ${model}; requested nearest ${nearest} and the slot crop is applied after generation`,
      );
    } else {
      adjustments.push(`aspectRatio ${request.aspectRatio} is not a ratio; not sent`);
    }
  }
  if (request.imageSize) {
    if (modelSupportsImageSize(model)) config.imageSize = request.imageSize;
    else
      adjustments.push(
        `imageSize ${request.imageSize} not sent: ${model} has no size tiers; the output is resized to the slot after generation`,
      );
  }
  return { config, adjustments };
}

interface GeminiInlineData {
  inlineData?: { data: string; mimeType?: string };
}

export class GeminiImageGenerator implements ImageGenerator {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpointBase: string;
  private readonly costPerImageUsd: number;

  constructor(options: GeminiImageOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gemini-2.5-flash-image";
    this.endpointBase = options.endpointBase ?? "https://generativelanguage.googleapis.com";
    this.costPerImageUsd = options.costPerImageUsd ?? 0.03;
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    // One bounded retry for the transient no-inline-data class: the image
    // endpoint intermittently returns a text-only candidate for a benign
    // prompt (golden run #56: the identical prompt produced a valid PNG
    // when replayed). HTTP failures and budget/refusal failures propagate
    // immediately with full diagnostics.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await this.generateOnce(request);
      if (result) return result;
    }
    throw new Error("Gemini image generation returned no inline image data after one retry");
  }

  private async generateOnce(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult | undefined> {
    const url = `${this.endpointBase}/v1beta/models/${this.model}:generateContent`;
    const { config, adjustments } = geminiImageConfig(this.model, request);
    const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
    for (const reference of request.referenceImages ?? []) {
      parts.push({
        inlineData: { mimeType: reference.mimeType, data: reference.bytes.toString("base64") },
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        ...(Object.keys(config).length > 0 ? { generationConfig: { imageConfig: config } } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`Gemini image generation failed: HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: GeminiInlineData[] };
        finishReason?: string;
      }>;
      promptFeedback?: unknown;
    };
    const first = json.candidates?.[0];
    const part = first?.content?.parts?.find((entry) => entry.inlineData);
    const inline = part?.inlineData;
    if (!inline?.data) {
      // Diagnosable failure: the response shape matters — a text-only
      // response (safety refusal or transient) is indistinguishable from a
      // malformed one without the parts/finishReason evidence (golden run
      // #56). Log the shape and let the caller's bounded retry decide.
      const shapes = (first?.content?.parts ?? []).map((entry) => Object.keys(entry));
      const textSnippet = (first?.content?.parts ?? [])
        .map((entry) => (entry as { text?: string }).text)
        .filter((text): text is string => Boolean(text))
        .join(" ")
        .slice(0, 300);
      logger.warn(
        {
          model: this.model,
          finishReason: first?.finishReason ?? "none",
          partShapes: shapes,
          promptFeedback: json.promptFeedback ?? null,
          textSnippet,
        },
        "Gemini image response carried no inline image data",
      );
      return undefined;
    }
    logger.info({ model: this.model }, "Generated image via Gemini");
    return {
      bytes: Buffer.from(inline.data, "base64"),
      mimeType: inline.mimeType ?? "image/png",
      model: this.model,
      estimatedCostUsd: this.costPerImageUsd,
      requestConfig: config,
      adjustments,
    };
  }
}

export interface CreateImageGeneratorOptions {
  apiKey?: string;
  model?: string;
}

/** Select a real image provider from configuration/environment, or undefined
 *  when none is available (the caller decides whether that is fatal). */
export function createImageGenerator(
  options: CreateImageGeneratorOptions = {},
): ImageGenerator | undefined {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return undefined;
  return new GeminiImageGenerator({ apiKey, model: options.model });
}
