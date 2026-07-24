// L9_META: layer=test, role=evidence_lifecycle_regression, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEvidenceStore } from '../../src/pipeline/evidence/FileEvidenceStore.js';

const failure = {
  schema: 'website-bot.stage-failure/v2' as const,
  buildId: 'build-lifecycle',
  clientId: 'client-lifecycle',
  stage: 'site-build',
  attempt: 1,
  code: 'BUILD_FAILED',
  message: 'synthetic failure',
  recoverable: true,
  inputEvidence: [],
  failedAt: '2026-07-21T00:00:00.000Z',
};

test('successful retry supersedes the active failure without deleting immutable history', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'evidence-lifecycle-'));
  const store = new FileEvidenceStore({ rootDir, buildId: failure.buildId, clientId: failure.clientId, mode: 'local-proof' });
  await store.initialize();
  await store.writeFailure(failure);
  const failed = await store.readIndex();
  assert.equal(failed.chain_status, 'failed');
  assert.equal(failed.failed_stage, 'site-build');
  assert.equal(failed.failure_history.length, 1);
  assert.ok(failed.artifacts.failure);
  assert.equal(existsSync(join(rootDir, 'failures', 'active.json')), true);

  const recovered = await store.transitionStageSucceeded('site-build');
  assert.notEqual(recovered.chain_status, 'failed');
  assert.equal(recovered.failed_stage, undefined);
  assert.equal(recovered.artifacts.failure, undefined);
  assert.equal(recovered.failure_history.length, 1);
  assert.equal(existsSync(join(rootDir, 'failures', 'active.json')), false);

  const rebuilt = await store.rebuildIndex();
  assert.equal(rebuilt.failure_history.length, 1);
  assert.notEqual(rebuilt.chain_status, 'failed');
});

test('persisted artifacts use snake_case and concurrent writers leave a verifiable index', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'evidence-codec-'));
  const store = new FileEvidenceStore({ rootDir, buildId: 'build-codec', clientId: 'client-codec', mode: 'local-proof' });
  await store.initialize();
  const files = [{ path: 'src/pages/index.astro', sha256: 'a'.repeat(64), owner: 'website-bot' as const, bytes: 1 }];
  const sourceDigest = (await import('../../src/pipeline/evidence/AssemblyManifest.js')).computeAssemblySourceDigest(files);
  const base = {
    schema: 'website-bot.assembly-manifest/v2' as const,
    buildId: 'build-codec', clientId: 'client-codec', generatorVersion: '3.0.0',
    templateVersion: '1.0.0', templateDigest: 'b'.repeat(64), routes: ['/'], files, sourceDigest,
  };
  await Promise.all([
    store.writeAssembly({ ...base, generatedAt: '2026-07-21T00:00:01.000Z' }),
    store.writeAssembly({ ...base, generatedAt: '2026-07-21T00:00:02.000Z' }),
  ]);
  const raw = JSON.parse((await import('node:fs')).readFileSync(join(rootDir, 'assembly-manifest.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(raw.build_id, 'build-codec');
  assert.equal('buildId' in raw, false);
  assert.equal(raw.template_version, '1.0.0');
  const reference = await store.referenceFor('assembly');
  assert.ok(reference);
  assert.equal(await store.verifyReference(reference!), true);
  assert.notEqual((await store.readIndex()).chain_status, 'failed');
});
