// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACEHOLDER_PATTERNS, scanText } from '../../src/validation/placeholderPatterns.js';
import { PlaceholderScanStage } from '../../src/stages/PlaceholderScanStage.js';
import { BuildError } from '../../src/pipeline/BuildError.js';
import type { BuildContext } from '../../src/pipeline/BuildContext.js';

function makeCtx(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    dryRun: false,
    generatedContent: new Map<string, string>(),
    generatedSchemas: new Map<string, object>(),
    ...overrides,
  } as BuildContext;
}

const CLEAN_COPY = 'Safe Haven Roofing serves Charlotte homeowners with storm damage inspections, '
  + 'roof replacement, and repair. Call (704) 812-3300 or request a free quote online today.';

// --- pattern catalog -------------------------------------------------------

test('catalog: every pattern has a unique id and a valid severity', () => {
  const ids = PLACEHOLDER_PATTERNS.map(pattern => pattern.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const pattern of PLACEHOLDER_PATTERNS) {
    assert.match(pattern.severity, /^(error|warning)$/);
    assert.ok(pattern.description.length > 10);
  }
});

test('catalog: no pattern uses the global flag (stateful regexes are a footgun)', () => {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    assert.equal(pattern.regex.global, false, `${pattern.id} must not use /g`);
  }
});

test('scanText: clean production copy yields zero findings', () => {
  assert.deepEqual(scanText('content:/:hero', CLEAN_COPY), []);
});

const ERROR_CASES: Array<[string, string]> = [
  ['bracketed-placeholder', 'Call us at [phone number] for a free estimate.'],
  ['bracketed-placeholder', 'Visit us at [your address here] any weekday.'],
  ['template-variable', 'Serving {{city}} and surrounding areas.'],
  ['template-variable', 'Call ${phone} now.'],
  ['template-variable', 'Reach us at <PHONE> today.'],
  ['lorem-ipsum', 'Lorem ipsum dolor sit amet, consectetur.'],
  ['todo-marker', 'TODO: replace this section with real testimonials.'],
  ['placeholder-word', 'This is placeholder text for the hero.'],
  ['example-domain', 'Book online at https://booking.example.com/schedule now.'],
  ['test-form-endpoint', 'Form posts to https://formspree.io/f/safehavenrr-test endpoint.'],
  ['empty-schema-value', '{"@type":"LocalBusiness","telephone":""}'],
];

for (const [expectedId, sample] of ERROR_CASES) {
  test(`scanText: detects ${expectedId} in ${JSON.stringify(sample.slice(0, 40))}`, () => {
    const findings = scanText('content:/contact:contact_form', sample);
    const ids = findings.map(finding => finding.patternId);
    assert.ok(ids.includes(expectedId), `expected ${expectedId}, got [${ids.join(', ')}]`);
    const finding = findings.find(item => item.patternId === expectedId)!;
    assert.equal(finding.severity, 'error');
    assert.equal(finding.source, 'content:/contact:contact_form');
    assert.ok(finding.excerpt.length > 0);
  });
}

test('scanText: reserved 555-01xx phone is a warning, not an error', () => {
  const findings = scanText('content:/:hero', 'Call (704) 555-0100 for service.');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].patternId, 'reserved-phone');
  assert.equal(findings[0].severity, 'warning');
});

test('scanText: "coming soon" stub is a warning', () => {
  const findings = scanText('content:/services:cta', 'More services coming soon to your area.');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
});

test('scanText: legitimate bracketed citations do not trip the bracket pattern', () => {
  assert.deepEqual(scanText('content:/:hero', 'Rated top roofer [2025] by the Charlotte Register.'), []);
});

// --- stage gate behavior ----------------------------------------------------

test('stage: passes with clean content and schemas', async () => {
  const ctx = makeCtx();
  ctx.generatedContent.set('/:hero', CLEAN_COPY);
  ctx.generatedSchemas.set('LocalBusiness', { '@type': 'LocalBusiness', telephone: '(704) 812-3300' });
  await new PlaceholderScanStage().run(ctx);
});

test('stage: fails closed with PLACEHOLDER_CONTENT_DETECTED and full finding context', async () => {
  const ctx = makeCtx();
  ctx.generatedContent.set('/contact:contact_form', 'Call [phone number] today.');
  ctx.generatedSchemas.set('LocalBusiness', { '@type': 'LocalBusiness', telephone: '' });
  await assert.rejects(
    () => new PlaceholderScanStage().run(ctx),
    (error: unknown) => {
      assert.ok(error instanceof BuildError);
      assert.equal(error.code, 'PLACEHOLDER_CONTENT_DETECTED');
      const findings = (error.context?.findings ?? []) as Array<{ source: string; patternId: string }>;
      assert.equal(findings.length, 2);
      assert.ok(findings.some(finding => finding.source === 'content:/contact:contact_form'));
      assert.ok(findings.some(finding => finding.source === 'schema:LocalBusiness'));
      return true;
    },
  );
});

test('stage: warnings alone never fail the build', async () => {
  const ctx = makeCtx();
  ctx.generatedContent.set('/:hero', 'Call (704) 555-0142 — more locations coming soon.');
  await new PlaceholderScanStage().run(ctx);
});

test('stage: dry-run skips scanning entirely', async () => {
  const ctx = makeCtx({ dryRun: true });
  ctx.generatedContent.set('/:hero', 'TODO: this would fail if scanned');
  await new PlaceholderScanStage().run(ctx);
});
