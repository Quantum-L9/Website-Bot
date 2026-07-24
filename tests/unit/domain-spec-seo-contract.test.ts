// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDomainSpec } from '../../src/pipeline/validateDomainSpec.js';

function baseSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client_id: 'test-client',
    business_name: 'Test Roofing Co',
    vertical: 'roofing',
    geography: { states: ['NC'], primary_state: 'NC' },
    design: { status: 'resolved' },
    routes: [
      { slug: '/', title: 'Home', components: ['hero'] },
    ],
    ...overrides,
  };
}

const CONTACT_ROUTES = [
  { slug: '/', title: 'Home', components: ['hero'] },
  { slug: '/contact', title: 'Contact', components: ['contact_form'] },
];

void test('valid spec with full seo_contract passes', () => {
  const spec = baseSpec({
    routes: CONTACT_ROUTES,
    seo_contract: {
      site_url: 'safehavenrr.com',
      phone: '(704) 555-0100',
      lead_form_action: 'https://formspree.io/f/abcd1234',
      target_keywords: ['roof repair charlotte'],
    },
  });
  assert.doesNotThrow(() => validateDomainSpec(spec, 'test.yaml'));
});

void test('contact_form route without seo_contract fails at spec load', () => {
  const spec = baseSpec({ routes: CONTACT_ROUTES });
  assert.throws(() => validateDomainSpec(spec, 'test.yaml'), /lead_form_action/);
});

void test('contact_form route without lead_form_action fails at spec load', () => {
  const spec = baseSpec({ routes: CONTACT_ROUTES, seo_contract: { site_url: 'example.com' } });
  assert.throws(() => validateDomainSpec(spec, 'test.yaml'), /lead_form_action is required/);
});

void test('lead_form_action must be absolute https', () => {
  for (const bad of ['http://formspree.io/f/x', '/relative/path', 'ftp://x.com/f', 'not a url']) {
    const spec = baseSpec({ routes: CONTACT_ROUTES, seo_contract: { lead_form_action: bad } });
    assert.throws(() => validateDomainSpec(spec, 'test.yaml'), /lead_form_action/, `expected rejection for ${bad}`);
  }
});

void test('site_url accepts bare hostnames and https, rejects other protocols and garbage', () => {
  assert.doesNotThrow(() => validateDomainSpec(baseSpec({ seo_contract: { site_url: 'example.com' } }), 'test.yaml'));
  assert.doesNotThrow(() => validateDomainSpec(baseSpec({ seo_contract: { site_url: 'https://example.com/base' } }), 'test.yaml'));
  assert.throws(() => validateDomainSpec(baseSpec({ seo_contract: { site_url: 'http://example.com' } }), 'test.yaml'), /site_url/);
  assert.throws(() => validateDomainSpec(baseSpec({ seo_contract: { site_url: '   ' } }), 'test.yaml'), /site_url/);
});

void test('phone accepts E.164 and US formats, rejects placeholders', () => {
  for (const good of ['+16155550100', '615-555-0100', '(615) 555-0100', '615 555 0100']) {
    assert.doesNotThrow(() => validateDomainSpec(baseSpec({ seo_contract: { phone: good } }), 'test.yaml'), `expected acceptance for ${good}`);
  }
  for (const bad of ['[phone number]', 'TBD', '', 'call us', '123']) {
    assert.throws(() => validateDomainSpec(baseSpec({ seo_contract: { phone: bad } }), 'test.yaml'), /phone/, `expected rejection for ${bad}`);
  }
});

void test('target_keywords must be a non-empty string array when present', () => {
  assert.throws(() => validateDomainSpec(baseSpec({ seo_contract: { target_keywords: [] } }), 'test.yaml'), /target_keywords/);
  assert.throws(() => validateDomainSpec(baseSpec({ seo_contract: { target_keywords: ['ok', ''] } }), 'test.yaml'), /target_keywords/);
});

void test('spec without contact_form and without seo_contract still passes', () => {
  assert.doesNotThrow(() => validateDomainSpec(baseSpec(), 'test.yaml'));
});

void test('unresolved lead-form wom_flag defers lead_form_action enforcement to UnknownResolverStage', () => {
  // An error-severity `conversion.lead_capture.form_action: unresolved` flag
  // means the operator has not yet supplied the endpoint. The spec must still
  // load (authoring/normalization workflow) — UnknownResolverStage blocks the
  // actual build on the error-severity flag before any site is assembled.
  const flag = { key: 'conversion.lead_capture.form_action', value: 'unresolved', severity: 'error' };
  const spec = baseSpec({
    routes: CONTACT_ROUTES,
    seo_contract: { site_url: 'example.com' },
    wom_flags: [flag],
  });
  assert.doesNotThrow(() => validateDomainSpec(spec, 'test.yaml'));
});

void test('non-error or mismatched wom_flags do NOT bypass the lead_form_action requirement', () => {
  const cases = [
    [{ key: 'conversion.lead_capture.form_action', value: 'unresolved', severity: 'warning' }],
    [{ key: 'identity.contact.phone', value: 'unresolved', severity: 'error' }],
    [{ key: 'conversion.lead_capture.form_action', value: 'resolved', severity: 'error' }],
  ];
  for (const womFlags of cases) {
    const spec = baseSpec({ routes: CONTACT_ROUTES, seo_contract: { site_url: 'example.com' }, wom_flags: womFlags });
    assert.throws(() => validateDomainSpec(spec, 'test.yaml'), /lead_form_action is required/, `expected rejection for ${JSON.stringify(womFlags)}`);
  }
});
