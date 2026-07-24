// L9_META: layer=test, role=execution_plan_regression, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFactoryExecutionPlan } from '../../src/pipeline/FactoryExecutionPlan.js';

test('end-to-end plan owns the complete proof-gated topology', () => {
  const plan = buildFactoryExecutionPlan({ mode: 'end-to-end', specPath: 'fixtures/ci-test-spec.yaml' });
  const names = plan.stages.map(stage => stage.name);
  assert.deepEqual(names, [
    'domain-spec-loader', 'unknown-resolver', 'design-intelligence', 'content-generation',
    'schema-generator', 'placeholder-scan', 'site-assembler', 'posthog-snippet', 'site-build',
    'client-source-publish', 'vercel-deploy', 'release-receipt', 'seo-baseline',
    'visual-qa', 'release-receipt-finalizer', 'handoff-emitter', 'terminal-convergence',
  ]);
  assert.ok(plan.requiredEvidence.includes('handoff'));
});

test('mandatory evidence stages cannot be skipped', () => {
  assert.throws(
    () => buildFactoryExecutionPlan({ mode: 'end-to-end', specPath: 'fixtures/ci-test-spec.yaml', skipStages: ['site-build'] }),
    /Cannot skip mandatory end-to-end stages: site-build/,
  );
});

test('plan mode contains no provider mutation stages', () => {
  const plan = buildFactoryExecutionPlan({ mode: 'plan', specPath: 'fixtures/ci-test-spec.yaml' });
  const names = plan.stages.map(stage => stage.name);
  assert.equal(names.includes('client-source-publish'), false);
  assert.equal(names.includes('vercel-deploy'), false);
  assert.equal(names.at(-1), 'terminal-convergence');
});
