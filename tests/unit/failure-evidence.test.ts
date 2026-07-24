// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEvidenceDetails, sanitizeEvidenceText } from '../../src/pipeline/evidence/EvidenceCanonicalizer.js';
import { checkpointDigest } from '../../src/pipeline/StageCheckpoint.js';
import { recordToReference } from '../../src/pipeline/evidence/EvidenceReference.js';
import { cleanupContext, fixtureContext } from '../helpers/siteFactoryFixture.js';

void test('sanitizes provider failures and persists failed evidence/checkpoint state', async () => {
  const ctx = fixtureContext();
  try {
    const message = sanitizeEvidenceText('provider rejected token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890');
    const details = sanitizeEvidenceDetails({ authorization: 'Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890', safe: 'kept' }) as Record<string, unknown>;
    const failureRecord = await ctx.evidenceStore.writeFailure({
      schema: 'website-bot.stage-failure/v2',
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: 'credential-bound-stage',
      attempt: 1,
      code: 'SOURCE_PUBLISH_FAILED',
      message,
      recoverable: false,
      inputEvidence: [],
      sanitizedDetails: details,
      failedAt: '2026-07-20T00:00:01.000Z',
    });
    const outputEvidence = [recordToReference(failureRecord)];
    await ctx.evidenceStore.writeCheckpoint({
      schema: 'website-bot.stage-checkpoint/v2',
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      stage: 'credential-bound-stage',
      stageVersion: '1.0.0',
      attempt: 1,
      inputEvidence: [],
      outputEvidence,
      inputDigest: checkpointDigest([]),
      outputDigest: checkpointDigest(outputEvidence),
      status: 'failed',
      startedAt: '2026-07-20T00:00:00.000Z',
      completedAt: '2026-07-20T00:00:01.000Z',
    });

    const failure = await ctx.evidenceStore.readFailure();
    assert.ok(failure);
    assert.doesNotMatch(failure.value.message, /ghp_super_secret/);
    assert.match(failure.value.message, /\[REDACTED\]/);
    assert.equal(failure.value.sanitizedDetails?.authorization, '[REDACTED]');
    assert.equal(failure.value.sanitizedDetails?.safe, 'kept');
    assert.equal((await ctx.evidenceStore.readCheckpoint('credential-bound-stage'))?.status, 'failed');
    assert.equal((await ctx.evidenceStore.readIndex()).chain_status, 'failed');
  } finally {
    cleanupContext(ctx);
  }
});
