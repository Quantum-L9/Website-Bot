// L9_META: layer=test, role=image_inspector_regression, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  detectMimeType,
  ImageInspectError,
  inspectImage,
} from "../../src/services/images/ImageInspector.js";

// A valid 1x1 opaque PNG; the same bytes the deterministic generator emits.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Patch a copy of the 1x1 PNG's IHDR width/height (big-endian uint32 at 16/20). */
function pngWith(width: number, height: number): Buffer {
  const buffer = Buffer.from(PNG_1x1);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

void test("detects PNG mime and 1x1 dimensions", () => {
  const inspected = inspectImage(PNG_1x1);
  assert.equal(inspected.mimeType, "image/png");
  assert.equal(inspected.width, 1);
  assert.equal(inspected.height, 1);
  assert.match(inspected.sha256, /^[a-f0-9]{64}$/);
  assert.equal(inspected.byteLength, PNG_1x1.byteLength);
});

void test("reads patched PNG dimensions for a hero-sized image", () => {
  const inspected = inspectImage(pngWith(1920, 1080));
  assert.equal(inspected.width, 1920);
  assert.equal(inspected.height, 1080);
});

void test("detects a minimal GIF header", () => {
  const gif = Buffer.concat([
    Buffer.from("GIF89a", "ascii"),
    Buffer.from([0x40, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00]), // 64x32 logical screen
  ]);
  const inspected = inspectImage(gif);
  assert.equal(inspected.mimeType, "image/gif");
  assert.equal(inspected.width, 64);
  assert.equal(inspected.height, 32);
});

void test("detects SVG from markup and extracts declared size", () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"></svg>',
    "utf8",
  );
  assert.equal(detectMimeType(svg), "image/svg+xml");
  const inspected = inspectImage(svg);
  assert.equal(inspected.width, 120);
  assert.equal(inspected.height, 48);
});

void test("rejects non-image bytes", () => {
  assert.throws(() => inspectImage(Buffer.from("not an image at all", "utf8")), ImageInspectError);
});
