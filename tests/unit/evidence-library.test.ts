import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileEvidenceStore } from '../../src/pipeline/evidence/FileEvidenceStore.js';
import { MemoryEvidenceStore } from '../../src/pipeline/evidence/MemoryEvidenceStore.js';
import {
  evidenceDigest,
  sanitizeEvidenceText,
  sanitizeEvidenceDetails,
  sha256Text,
} from '../../src/pipeline/evidence/EvidenceCanonicalizer.js';
import { recordToReference, validateEvidenceReference } from '../../src/pipeline/evidence/EvidenceReference.js';
import { checkpointDigest, validateStageCheckpoint } from '../../src/pipeline/StageCheckpoint.js';
import {
  computeAssemblySourceDigest,
  validateAssemblyManifest,
  type AssemblyManifest,
} from '../../src/pipeline/evidence/AssemblyManifest.js';

function fixtureManifest(buildId = 'c-1', clientId = 'c'): AssemblyManifest {
  const files = [
    { path: 'src/pages/index.astro', sha256: sha256Text('index'), owner: 'website-bot' as const, bytes: 5 },
    { path: '.l9/generated-manifest.json', sha256: sha256Text('manifest'), owner: 'website-bot' as const, bytes: 8 },
  ];
  return {
    schema: 'website-bot.assembly-manifest/v1',
    buildId,
    clientId,
    generatorVersion: '2.1.0',
    routes: ['/'],
    files,
    sourceDigest: computeAssemblySourceDigest(files),
  };
}

test('FileEvidenceStore persists, reloads, and hash-verifies an artifact across a process boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wb2-evidence-'));
  try {
    const store = new FileEvidenceStore({ clientId: 'c', buildId: 'c-1', mode: 'local-proof', evidenceRoot: root });
    await store.initialize();
    const manifest = fixtureManifest();
    const record = await store.writeAssembly(manifest);

    // A fresh store instance (simulating a new process) reloads and validates from disk.
    const reloaded = new FileEvidenceStore({ clientId: 'c', buildId: 'c-1', mode: 'local-proof', evidenceRoot: root });
    const stored = await reloaded.readAssembly();
    assert.ok(stored, 'assembly should reload from disk');
    assert.deepEqual(stored.value.sourceDigest, manifest.sourceDigest);
    assert.equal(await reloaded.verifyReference(recordToReference(record)), true);

    const index = await reloaded.readIndex();
    assert.ok(index.artifacts.assembly, 'index records the assembly artifact');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('FileEvidenceStore fails hash verification when the artifact bytes are tampered', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wb2-evidence-'));
  try {
    const store = new FileEvidenceStore({ clientId: 'c', buildId: 'c-1', mode: 'local-proof', evidenceRoot: root });
    await store.initialize();
    const record = await store.writeAssembly(fixtureManifest());
    // Corrupt the persisted bytes.
    writeFileSync(join(store.rootDir, record.relativePath), '{"schema":"tampered"}');
    assert.equal(await store.verifyReference(recordToReference(record)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MemoryEvidenceStore is a plan-mode no-op that refuses to persist runtime evidence', async () => {
  const store = new MemoryEvidenceStore('c', 'c-1', 'plan');
  assert.equal(await store.readAssembly(), undefined);
  await assert.rejects(() => store.writeAssembly(fixtureManifest()));
  const index = await store.readIndex();
  assert.equal(index.chain_status, 'empty');
});

test('evidenceDigest is stable and independent of key order', () => {
  assert.equal(evidenceDigest({ a: 1, b: 2 }), evidenceDigest({ b: 2, a: 1 }));
  assert.notEqual(evidenceDigest({ a: 1 }), evidenceDigest({ a: 2 }));
});

test('sanitizeEvidence redacts secret-shaped values and sensitive keys', () => {
  assert.match(sanitizeEvidenceText('token ghp_abcdefghijklmnopqrstuvwxyz0123'), /\[REDACTED\]/);
  assert.match(sanitizeEvidenceText('Authorization: Bearer abc.def.ghi'), /\[REDACTED\]/);
  const cleaned = sanitizeEvidenceDetails({ github_token: 'ghp_secret', note: 'ok' }) as Record<string, unknown>;
  assert.equal(cleaned.github_token, '[REDACTED]');
  assert.equal(cleaned.note, 'ok');
});

test('StageCheckpoint digest is deterministic and validation rejects a mismatched digest', () => {
  const references = [
    { kind: 'assembly' as const, schema: 's', logical_id: 'a', relative_path: 'assembly-manifest.json', sha256: sha256Text('a') },
  ];
  const digest = checkpointDigest(references);
  assert.equal(digest, checkpointDigest(references));
  const base = {
    schema: 'website-bot.stage-checkpoint/v1' as const,
    buildId: 'c-1', clientId: 'c', stage: 'site-assembler', attempt: 1,
    inputEvidence: [], outputEvidence: references,
    inputDigest: checkpointDigest([]), outputDigest: digest,
    status: 'passed' as const, startedAt: '2026-07-20T00:00:00.000Z', completedAt: '2026-07-20T00:00:01.000Z',
  };
  assert.doesNotThrow(() => validateStageCheckpoint(base));
  assert.throws(() => validateStageCheckpoint({ ...base, outputDigest: sha256Text('wrong') }));
});

test('AssemblyManifest validation rejects unsafe paths and digest drift', () => {
  assert.doesNotThrow(() => validateAssemblyManifest(fixtureManifest()));
  const unsafe = fixtureManifest();
  unsafe.files[0].path = '../escape.astro';
  unsafe.sourceDigest = computeAssemblySourceDigest(unsafe.files);
  assert.throws(() => validateAssemblyManifest(unsafe));
  const drifted = fixtureManifest();
  drifted.sourceDigest = sha256Text('not-the-real-digest'.padEnd(0, 'x'));
  assert.throws(() => validateAssemblyManifest(drifted));
});

test('recordToReference maps a record and validateEvidenceReference guards path safety', () => {
  const reference = recordToReference({
    kind: 'build', schema: 'website-bot.build-proof/v1', logicalId: 'b',
    relativePath: 'build-proof.json', sha256: sha256Text('b'), writtenAt: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(reference.relative_path, 'build-proof.json');
  assert.doesNotThrow(() => validateEvidenceReference(reference));
  assert.throws(() => validateEvidenceReference({ ...reference, relative_path: '../x.json' }));
});
