// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkpointDigest, checkpointIsValid } from '../../src/pipeline/StageCheckpoint.js';
import { recordToReference } from '../../src/pipeline/evidence/EvidenceReference.js';
import { cleanupContext, fixtureAssemblyManifest, fixtureContext } from '../helpers/siteFactoryFixture.js';

void test('checkpoint validity is bound to persisted evidence bytes', async () => {
  const ctx = fixtureContext();
  try {
    const record = await ctx.evidenceStore.writeAssembly(fixtureAssemblyManifest(ctx));
    const reference = recordToReference(record);
    const checkpoint = {
      schema: 'website-bot.stage-checkpoint/v2' as const,
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: 'site-assembler',
      stageVersion: '3.0.0',
      attempt: 1,
      inputEvidence: [],
      outputEvidence: [reference],
      inputDigest: checkpointDigest([]),
      outputDigest: checkpointDigest([reference]),
      status: 'passed' as const,
      startedAt: '2026-07-20T00:00:00.000Z',
      completedAt: '2026-07-20T00:00:01.000Z',
    };
    await ctx.evidenceStore.writeCheckpoint(checkpoint);
    assert.equal(await checkpointIsValid(ctx, checkpoint), true);

    const artifactPath = join(ctx.evidenceStore.rootDir, record.relativePath);
    writeFileSync(artifactPath, `${readFileSync(artifactPath, 'utf-8')}\n`, 'utf-8');
    assert.equal(await checkpointIsValid(ctx, checkpoint), false);
  } finally {
    cleanupContext(ctx);
  }
});
