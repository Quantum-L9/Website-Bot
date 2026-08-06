// L9_META: layer=service, role=image_generator_interface, status=active, version=1.0.0
//
// The local image-generation boundary. Every provider (a direct Gemini client
// today, an LLM-Router-backed client later) implements ImageGenerator, so the
// generation stage, asset plan, assembly, and Astro components never depend on
// a specific provider. The future router migration swaps the implementation
// behind this interface without touching any consumer.

export type ImageSizeHint = '1K' | '2K' | '4K';

export interface ReferenceImage {
  mimeType: string;
  bytes: Buffer;
}

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio?: string;
  imageSize?: ImageSizeHint;
  referenceImages?: ReferenceImage[];
}

export interface ImageGenerationResult {
  bytes: Buffer;
  mimeType: string;
  model: string;
  /** Estimated cost of this generation in USD, when the provider reports it. */
  estimatedCostUsd?: number;
}

export interface ImageGenerator {
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Deterministic in-process generator for tests and CI: it never calls a network
 * provider, and it emits a valid 1x1 PNG whose bytes are stable for a given
 * request, so cache-hit and evidence assertions are reproducible. Production
 * code selects a real provider; this exists so the generation gap-fill path can
 * be exercised without external services or credentials.
 */
export class FakeImageGenerator implements ImageGenerator {
  constructor(private readonly model = 'fake-image-generator') {}

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    return {
      bytes: this.encodePng(),
      mimeType: 'image/png',
      model: this.model,
      estimatedCostUsd: 0,
    };
  }

  private encodePng(): Buffer {
    // Minimal valid 1x1 opaque PNG. Static content keeps fake generations stable.
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const buffer = Buffer.from(base64, 'base64');
    if (!PNG_SIGNATURE.every((value, index) => buffer[index] === value)) {
      throw new Error('FakeImageGenerator produced an invalid PNG');
    }
    return buffer;
  }
}
