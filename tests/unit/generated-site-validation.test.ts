// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComponentName, normalizeRouteSlug, normalizeSiteUrl, safeChild, validateRouteContracts } from '../../src/validation/validate-generated-site.js';

void test('normalizes scheme-less site URLs to HTTPS', () => {
  assert.equal(normalizeSiteUrl('ci-test.example.com'), 'https://ci-test.example.com');
});

void test('normalizes hyphenated and underscored component names to one identity', () => {
  assert.equal(normalizeComponentName('contact-form'), 'contact_form');
  assert.equal(normalizeComponentName('contact_form'), 'contact_form');
});

void test('rejects route traversal and duplicate normalized routes', () => {
  assert.throws(() => normalizeRouteSlug('/../escape'), /Unsafe route slug|Invalid route slug/);
  assert.throws(() => validateRouteContracts([
    { slug: '/services', title: 'One', components: ['hero'] },
    { slug: '/services', title: 'Two', components: ['cta'] },
  ]), /Duplicate normalized route slug/);
});

void test('safeChild rejects paths outside the generated root', () => {
  assert.throws(() => safeChild('/tmp/site-root', '../escape.txt'), /escaped output directory/);
});
