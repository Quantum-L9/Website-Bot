// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualQAStage, type VisualQaExec } from '../../src/stages/VisualQAStage.js';
import { BuildError } from '../../src/pipeline/BuildError.js';
import type { BuildContext } from '../../src/pipeline/BuildContext.js';
import { cleanupContext, fixtureContext } from '../helpers/siteFactoryFixture.js';

const QA_SCRIPT = 'scripts/verify-visual-qa.mjs';
const DEPLOY_URL = 'https://preview.example.com';

interface ExecCall { command: string; args: string[]; options: { encoding: 'utf-8'; timeout: number; stdio: 'pipe' }; }

/** Records every invocation and either returns output or throws the configured error. */
function recordingExec(behaviour: { output?: string; throws?: Error } = {}): { exec: VisualQaExec; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const exec: VisualQaExec = (command, args, options) => {
    calls.push({ command, args, options });
    if (behaviour.throws) throw behaviour.throws;
    return behaviour.output ?? '';
  };
  return { exec, calls };
}

/** Replaces the deployment evidence read with a stub that reports the given URL. */
function stubDeploymentUrl(ctx: BuildContext, deploymentUrl: string): void {
  ctx.evidenceStore.requireDeploymentEvidence =
    (async () => ({ value: { deploymentUrl } })) as typeof ctx.evidenceStore.requireDeploymentEvidence;
}

void test('invokes the QA verifier with node, --url, and a 120s piped timeout, then marks passed', async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, DEPLOY_URL);
  const { exec, calls } = recordingExec({ output: 'Visual review complete: no defects found.' });
  try {
    await new VisualQAStage(exec).run(ctx);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args, [QA_SCRIPT, '--url', DEPLOY_URL]);
    assert.equal(calls[0].options.timeout, 120_000);
    assert.equal(calls[0].options.stdio, 'pipe');
    assert.equal(calls[0].options.encoding, 'utf-8');
    assert.equal(ctx.visualQaPassed, true);
    assert.equal(ctx.qualityEvidence.visualQa, 'passed');
  } finally {
    cleanupContext(ctx);
  }
});

void test('fails closed when the verifier output reports CRITICAL defects', async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, DEPLOY_URL);
  const { exec } = recordingExec({ output: 'Hero section overflow — CRITICAL contrast failure.' });
  try {
    await assert.rejects(
      () => new VisualQAStage(exec).run(ctx),
      (error: unknown) => error instanceof BuildError && error.code === 'VISUAL_QA_FAILED',
    );
    assert.equal(ctx.qualityEvidence.visualQa, 'failed');
    assert.equal(ctx.visualQaPassed, false);
  } finally {
    cleanupContext(ctx);
  }
});

void test('marks the gate failed without throwing on a non-critical execution failure', async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, DEPLOY_URL);
  const { exec } = recordingExec({ throws: new Error('Command failed: node scripts/verify-visual-qa.mjs (exit 1)') });
  try {
    await new VisualQAStage(exec).run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, 'failed');
    assert.equal(ctx.visualQaPassed, false);
  } finally {
    cleanupContext(ctx);
  }
});

void test('escalates to a hard gate failure when an execution failure surfaces CRITICAL output', async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, DEPLOY_URL);
  const { exec } = recordingExec({ throws: new Error('verifier crashed after logging CRITICAL layout break') });
  try {
    await assert.rejects(
      () => new VisualQAStage(exec).run(ctx),
      (error: unknown) => error instanceof BuildError && error.code === 'VISUAL_QA_FAILED',
    );
    assert.equal(ctx.qualityEvidence.visualQa, 'failed');
  } finally {
    cleanupContext(ctx);
  }
});

void test('skips the gate when the QA script is absent, without invoking the verifier', async () => {
  const ctx = fixtureContext();
  const { exec, calls } = recordingExec({ throws: new Error('exec must not run') });
  try {
    await new VisualQAStage(exec, 'scripts/does-not-exist-visual-qa.mjs').run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, 'skipped');
    assert.equal(ctx.visualQaPassed, false);
    assert.equal(calls.length, 0);
  } finally {
    cleanupContext(ctx);
  }
});

void test('skips the gate in dry-run without invoking the verifier', async () => {
  const ctx = fixtureContext();
  ctx.dryRun = true;
  const { exec, calls } = recordingExec({ throws: new Error('exec must not run') });
  try {
    await new VisualQAStage(exec).run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, 'skipped');
    assert.equal(calls.length, 0);
  } finally {
    cleanupContext(ctx);
  }
});

void test('skips the gate when the deployment reports no URL', async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, '');
  const { exec, calls } = recordingExec({ throws: new Error('exec must not run') });
  try {
    await new VisualQAStage(exec).run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, 'skipped');
    assert.equal(calls.length, 0);
  } finally {
    cleanupContext(ctx);
  }
});
