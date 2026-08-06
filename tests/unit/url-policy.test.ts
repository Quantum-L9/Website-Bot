// L9_META: layer=test, role=ssrf_policy_regression, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUrlAllowed, isUrlAllowed, UrlPolicyError, isForbiddenAddress } from '../../src/ingestion/UrlPolicy.js';

void test('accepts a valid public HTTPS URL', () => {
  const url = assertUrlAllowed('https://www.example.com/services');
  assert.equal(url.hostname, 'www.example.com');
});

void test('rejects loopback and localhost targets', () => {
  for (const raw of ['http://localhost/', 'http://127.0.0.1/', 'https://127.0.0.5:8080/x', 'http://[::1]/']) {
    assert.equal(isUrlAllowed(raw), false, `${raw} must be rejected`);
  }
});

void test('rejects private RFC1918, CGNAT and link-local ranges', () => {
  for (const address of ['10.0.0.1', '172.16.5.4', '192.168.1.1', '100.64.0.1', '169.254.0.1']) {
    assert.equal(isForbiddenAddress(address), true, `${address} must be forbidden`);
  }
  assert.equal(isForbiddenAddress('8.8.8.8'), false);
  assert.equal(isForbiddenAddress('172.32.0.1'), false); // just outside the /12
});

void test('rejects the cloud metadata endpoint', () => {
  assert.equal(isUrlAllowed('http://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isUrlAllowed('http://metadata.google.internal/'), false);
});

void test('rejects non-HTTP protocols', () => {
  for (const raw of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/']) {
    assert.throws(
      () => assertUrlAllowed(raw),
      (error: unknown) => error instanceof UrlPolicyError && error.reason === 'forbidden-protocol',
    );
  }
});

void test('enforces same-site scope unless subdomains are allowed', () => {
  const seedHost = 'example.com';
  assert.equal(isUrlAllowed('https://blog.example.com/', { seedHost }), false);
  assert.equal(isUrlAllowed('https://blog.example.com/', { seedHost, allowSubdomains: true }), true);
  assert.equal(isUrlAllowed('https://example.com/a', { seedHost }), true);
  assert.equal(isUrlAllowed('https://evil.test/a', { seedHost }), false);
});

void test('rejects IPv4-mapped IPv6 loopback', () => {
  assert.equal(isForbiddenAddress('::ffff:127.0.0.1'), true);
  assert.equal(isForbiddenAddress('fd00::1'), true);
  assert.equal(isForbiddenAddress('fe80::1'), true);
});
