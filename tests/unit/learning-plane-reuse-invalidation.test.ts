// L9_META: layer=test, role=reuse_invalidation, status=active, version=1.0.0
// Determinism contracts 5, 6, 7:
//   - completed content-addressed artifacts are not recomputed
//   - a design mutation does not trigger donor / DataForSEO / pattern synthesis
//   - a blueprint mutation invalidates downstream content and design
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFrontier,
  DESIGN_FORBIDDEN_STAGES,
  frontierFor,
  isDesignForbiddenStage,
  PIPELINE_STAGES,
  reclassifyLayerIfIntelligenceInputsChanged,
} from '../../src/campaigns/invalidation-frontier.js';
import { semanticInputDigest } from '../../src/campaigns/semantic-digest.js';

const REF = (id: string) => ({ artifact_type: 'WebsiteBuildBlueprint', artifact_id: `WebsiteBuildBlueprint:${id}`, payload_digest: id });

test('a design mutation reuses intelligence, blueprints, and content', () => {
  const frontier = frontierFor('DESIGN');
  for (const stage of ['donor-intelligence', 'dataforseo', 'pattern-synthesis', 'competitive-landscape', 'baseline-market-gap', 'website-blueprint', 'seo-content-blueprint', 'page-content-contract', 'structured-content']) {
    assert.ok((frontier.reuse as readonly string[]).includes(stage), `DESIGN must reuse ${stage}`);
  }
  assert.ok((frontier.invalidate as readonly string[]).includes('design-artifact'));
  assert.ok((frontier.invalidate as readonly string[]).includes('quality'));
});

test('a design mutation must not trigger donor, DataForSEO, or pattern synthesis', () => {
  const violations = assertFrontier('DESIGN', [
    { stage: 'donor-intelligence', reason: 'attempted' },
    { stage: 'dataforseo', reason: 'attempted' },
    { stage: 'pattern-synthesis', reason: 'attempted' },
  ]);
  assert.equal(violations.length, 3);
  for (const stage of DESIGN_FORBIDDEN_STAGES) {
    assert.ok(isDesignForbiddenStage(stage), `${stage} must be design-forbidden`);
  }
});

test('a blueprint mutation invalidates downstream content and design', () => {
  const frontier = frontierFor('BLUEPRINT');
  for (const stage of ['page-content-contract', 'structured-content', 'design-artifact', 'assembly', 'build', 'quality']) {
    assert.ok((frontier.invalidate as readonly string[]).includes(stage), `BLUEPRINT must invalidate ${stage}`);
  }
  for (const stage of ['donor-intelligence', 'dataforseo', 'pattern-synthesis']) {
    assert.ok((frontier.reuse as readonly string[]).includes(stage), `BLUEPRINT must reuse ${stage}`);
  }
});

test('blueprint reclassifies to INTELLIGENCE when intelligence inputs actually change', () => {
  assert.equal(reclassifyLayerIfIntelligenceInputsChanged('BLUEPRINT', true), 'INTELLIGENCE');
  assert.equal(reclassifyLayerIfIntelligenceInputsChanged('BLUEPRINT', false), 'BLUEPRINT');
  assert.equal(reclassifyLayerIfIntelligenceInputsChanged('DESIGN', true), 'DESIGN');
});

test('completed content-addressed artifacts are not recomputed: same digest reuses', () => {
  const inputs = { stage_version: '1.3.0', relevant_input_artifact_refs: [REF('aaa'), REF('bbb')], relevant_configuration: { mode: 'design' } };
  const first = semanticInputDigest(inputs);
  const second = semanticInputDigest({ ...inputs, relevant_input_artifact_refs: [REF('bbb'), REF('aaa')] });
  assert.equal(first, second, 'digest must be invariant under ref ordering');
  const different = semanticInputDigest({ ...inputs, stage_version: '1.4.0' });
  assert.notEqual(first, different, 'different stage version must recompute');
});

test('every pipeline stage belongs to the frontier vocabulary', () => {
  for (const stage of PIPELINE_STAGES) {
    const covered = (['INITIAL', 'INTELLIGENCE', 'BLUEPRINT', 'CONTENT', 'DESIGN', 'ASSET', 'ASSEMBLY', 'REPAIR'] as const).some(layer => {
      const frontier = frontierFor(layer);
      return (frontier.reuse as readonly string[]).includes(stage) || (frontier.invalidate as readonly string[]).includes(stage);
    });
    assert.ok(covered, `${stage} must be in reuse or invalidate of some layer`);
  }
});
