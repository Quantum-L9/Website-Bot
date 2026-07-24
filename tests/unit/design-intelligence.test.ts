// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDesignTokens } from '../../src/stages/DesignIntelligenceStage.js';

void test('resolved fixture token aliases remain buildable', () => {
  const tokens = normalizeDesignTokens(
    { primary: '#1a365d', secondary: '#2b6cb0' },
    { heading: 'Inter', body: 'Inter' },
  );
  assert.equal(tokens.accent, '#1a365d');
  assert.equal(tokens.font_heading, 'Inter');
  assert.equal(tokens.font_body, 'Inter');
});

void test('unsafe token values fail closed', () => {
  assert.throws(() => normalizeDesignTokens(
    { primary: '#fff;body{}', secondary: '#2b6cb0' },
    { heading: 'Inter', body: 'Inter' },
  ), /valid CSS color/);
});
