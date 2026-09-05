// L9_META: layer=test, role=gemini_image_generator, status=active, version=1.0.0
//
// The bounded retry for the transient no-inline-data class (golden run
// #56): the image endpoint intermittently returns a text-only candidate
// for a benign prompt; a replay of the identical prompt succeeds.

import assert from "node:assert/strict";
import test from "node:test";
import { GeminiImageGenerator } from "../../src/services/images/GeminiImageGenerator.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function textOnlyResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text: "I cannot generate that image." }] },
          finishReason: "SAFETY",
        },
      ],
      promptFeedback: { blockReason: "SAFETY" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function inlineResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ inlineData: { mimeType: "image/png", data: PNG_1X1.toString("base64") } }],
          },
          finishReason: "STOP",
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("retries once when the first response carries no inline image data", async () => {
  const calls: number[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, _init?: unknown) => {
    calls.push(1);
    return calls.length === 1 ? textOnlyResponse() : inlineResponse();
  }) as typeof fetch;
  try {
    const generator = new GeminiImageGenerator({ apiKey: "test-key" });
    const result = await generator.generate({ prompt: "hero image" });
    assert.equal(calls.length, 2);
    assert.equal(result.mimeType, "image/png");
    assert.ok(result.bytes.length > 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("fails after the bounded retry with a clear message", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => textOnlyResponse()) as typeof fetch;
  try {
    const generator = new GeminiImageGenerator({ apiKey: "test-key" });
    await assert.rejects(
      () => generator.generate({ prompt: "hero image" }),
      /no inline image data after one retry/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
