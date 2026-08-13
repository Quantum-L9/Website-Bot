// L9_META: layer=test, role=source_image_policy_regression, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import type { InspectedImage } from '../../src/services/images/ImageInspector.js';
import { evaluateSourceImage, normalizeUrl, shouldSkipUrl } from '../../src/ingestion/SourceImagePolicy.js';

function inspected(overrides: Partial<InspectedImage>): InspectedImage {
  return { mimeType: 'image/jpeg', width: 1600, height: 900, byteLength: 200_000, sha256: 'a'.repeat(64), ...overrides };
}

void test('accepts a well-formed hero-sized image', () => {
  assert.equal(evaluateSourceImage(inspected({})).accepted, true);
});

void test('rejects unsupported mime, oversize, tiny, and extreme-aspect images', () => {
  assert.equal(evaluateSourceImage(inspected({ mimeType: 'image/x-icon' })).accepted, false);
  assert.equal(evaluateSourceImage(inspected({ byteLength: 20 * 1024 * 1024 })).accepted, false);
  assert.equal(evaluateSourceImage(inspected({ width: 80, height: 45 })).accepted, false);
  assert.equal(evaluateSourceImage(inspected({ width: 2000, height: 100 })).accepted, false);
});

void test('accepts a compact logo that would fail the photo minimum', () => {
  assert.equal(
    evaluateSourceImage(inspected({ width: 298, height: 144 }), undefined, { sourceUrl: 'https://x.test/images/logo.webp' }).accepted,
    true,
  );
});

void test('accepts SVG without intrinsic dimensions', () => {
  assert.equal(evaluateSourceImage(inspected({ mimeType: 'image/svg+xml', width: 0, height: 0 })).accepted, true);
});

void test('normalizeUrl drops fragments, tracking params, and trailing slash', () => {
  assert.equal(normalizeUrl('https://x.test/a/?utm_source=fb&id=7#frag'), 'https://x.test/a?id=7');
  assert.equal(normalizeUrl('https://x.test/a//b/'), 'https://x.test/a/b');
  assert.equal(normalizeUrl('https://x.test/'), 'https://x.test/');
});

void test('shouldSkipUrl blocks auth, commerce, search, and binaries', () => {
  assert.equal(shouldSkipUrl('https://x.test/login'), true);
  assert.equal(shouldSkipUrl('https://x.test/cart'), true);
  assert.equal(shouldSkipUrl('https://x.test/search?q=a'), true);
  assert.equal(shouldSkipUrl('https://x.test/whitepaper.pdf'), true);
  assert.equal(shouldSkipUrl('https://x.test/whitepaper.pdf', { allowPdf: true }), false);
  assert.equal(shouldSkipUrl('https://x.test/services'), false);
});
