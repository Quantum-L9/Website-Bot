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
} from "./ImageGenerator.js";

const logger = createModuleLogger("service:gemini-image");

export interface GeminiImageOptions {
  apiKey: string;
  model?: string;
  endpointBase?: string;
  /** Per-image cost estimate recorded for budgeting and evidence. */
  costPerImageUsd?: number;
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
    throw new Error(
      "Gemini image generation returned no inline image data after one retry",
    );
  }

  private async generateOnce(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult | undefined> {
    const url = `${this.endpointBase}/v1beta/models/${this.model}:generateContent`;
    const parts: Array<Record<string, unknown>> = [{ text: request.prompt }];
    for (const reference of request.referenceImages ?? []) {
      parts.push({
        inlineData: { mimeType: reference.mimeType, data: reference.bytes.toString("base64") },
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts }] }),
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
