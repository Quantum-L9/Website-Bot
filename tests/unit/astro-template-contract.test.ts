// L9_META: layer=test, role=astro_template_contract, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('canonical Astro template is versioned and exposes the required section registry', () => {
  const version = readFileSync(resolve('astro_template/TEMPLATE_VERSION'), 'utf8').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const registry = readFileSync(resolve('astro_template/src/components/SectionRegistry.ts'), 'utf8');
  for (const component of ['hero','process','cta','compliance_note','faq','contact_form']) {
    assert.match(registry, new RegExp(`['\"]${component}['\"]`));
  }
  const renderer = readFileSync(resolve('astro_template/src/components/SectionRenderer.astro'), 'utf8');
  assert.match(renderer, /const registry/);
  assert.match(renderer, /ProseSection/);
});
