// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupContext, fixtureAssemblyManifest, fixtureContext } from '../helpers/siteFactoryFixture.js';

void test('EvidenceStore atomically persists, indexes, verifies, and repairs assembly evidence', async () => {
  const ctx = fixtureContext();
  try {
    const manifest = fixtureAssemblyManifest(ctx);
    const record = await ctx.evidenceStore.writeAssembly(manifest);
    const index = await ctx.evidenceStore.readIndex();
    assert.equal(index.artifacts.assembly?.sha256, record.sha256);
    assert.equal(index.chain_status, 'assembling');
    assert.equal(await ctx.evidenceStore.verifyReference({
      kind: record.kind,
      schema: record.schema,
      logical_id: record.logicalId,
      relative_path: record.relativePath,
      sha256: record.sha256,
    }), true);
    assert.equal(readdirSync(ctx.evidenceStore.rootDir).some(name => name.includes('.tmp-')), false);

    const path = join(ctx.evidenceStore.rootDir, record.relativePath);
    const changed = JSON.parse(readFileSync(path, 'utf-8')) as typeof manifest;
    changed.generatedAt = '2026-07-20T00:00:05.000Z';
    writeFileSync(path, `${JSON.stringify(changed, null, 2)}\n`, 'utf-8');
    await assert.rejects(() => ctx.evidenceStore.readAssembly(), /hash mismatch/);

    const repaired = await ctx.evidenceStore.repairIndex();
    assert.notEqual(repaired.artifacts.assembly?.sha256, record.sha256);
    assert.equal((await ctx.evidenceStore.readAssembly())?.value.generatedAt, changed.generatedAt);
    assert.equal(existsSync(join(ctx.evidenceStore.rootDir, 'evidence-index.json')), true);
  } finally {
    cleanupContext(ctx);
  }
});
