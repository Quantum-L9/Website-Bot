// L9_META: layer=test, role=execution_plan_regression, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFactoryExecutionPlan, TerminalConvergenceStage } from '../../src/pipeline/FactoryExecutionPlan.js';
import type { BuildContext } from '../../src/pipeline/BuildContext.js';

test('terminal convergence accepts a resume-skipped mandatory stage (valid checkpoint)', async () => {
  // Regression: resume marks checked stages {ok:true, skipped:true}; a resume
  // after a downstream failure (e.g. site-build) must converge, not dead-end.
  const ctx = {
    stageResults: new Map([['placeholder-scan', { ok: true, skipped: true }]]),
  } as unknown as BuildContext;
  await new TerminalConvergenceStage('plan', ['placeholder-scan'], []).run(ctx);
});

test('terminal convergence rejects a failed mandatory stage', async () => {
  const ctx = {
    stageResults: new Map([['placeholder-scan', { ok: false, skipped: false }]]),
  } as unknown as BuildContext;
  await assert.rejects(
    new TerminalConvergenceStage('plan', ['placeholder-scan'], []).run(ctx),
    /Mandatory stage did not converge: placeholder-scan/,
  );
});

test('end-to-end plan owns the complete proof-gated topology', () => {
  const plan = buildFactoryExecutionPlan({ mode: 'end-to-end', specPath: 'fixtures/ci-test-spec.yaml' });
  const names = plan.stages.map(stage => stage.name);
  assert.deepEqual(names, [
    'domain-spec-loader', 'unknown-resolver', 'source-site-ingestion', 'design-intelligence', 'content-generation',
    'schema-generator', 'image-asset-planning', 'image-generation', 'placeholder-scan', 'site-assembler', 'image-validation', 'posthog-snippet', 'site-build',
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

test('REDESIGN_IMPROVE inserts competitive-intelligence before design generation', () => {
  const plan = buildFactoryExecutionPlan({ mode: 'local-proof', specPath: 'fixtures/ci-test-spec.yaml', buildIntent: 'REDESIGN_IMPROVE' });
  const names = plan.stages.map(stage => stage.name);
  const intelligenceIndex = names.indexOf('competitive-intelligence');
  const designIndex = names.indexOf('design-intelligence');
  assert.ok(intelligenceIndex > -1, 'competitive-intelligence must be present in improve mode');
  assert.ok(intelligenceIndex < designIndex, 'competitive-intelligence must run before design-intelligence');
});

test('COPY intent (legacy default) keeps the original stage topology', () => {
  const plan = buildFactoryExecutionPlan({ mode: 'local-proof', specPath: 'fixtures/ci-test-spec.yaml' });
  const names = plan.stages.map(stage => stage.name);
  assert.equal(names.includes('competitive-intelligence'), false);
});
