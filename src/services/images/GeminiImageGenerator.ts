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
      candidates?: Array<{ content?: { parts?: GeminiInlineData[] } }>;
    };
    const inline = json.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData,
    )?.inlineData;
    if (!inline?.data) {
      throw new Error("Gemini image generation returned no inline image data");
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
