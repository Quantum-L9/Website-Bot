// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { FileEvidenceStore } from '../../../src/pipeline/evidence/FileEvidenceStore.js';
import { ReleaseReceiptStage } from '../../../src/stages/ReleaseReceiptStage.js';
import { ReleaseReceiptFinalizerStage } from '../../../src/stages/ReleaseReceiptFinalizerStage.js';
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureContext,
  persistFixtureBuildProof,
  persistFixturePublicationEvidence,
  fixtureDeploymentEvidence,
} from '../../helpers/siteFactoryFixture.js';

void test('a fresh process-equivalent store rehydrates the succeeded release bundle', async () => {
  const ctx = fixtureContext();
  try {
    if (!ctx.evidenceStore.rootDir.startsWith('memory://')) rmSync(ctx.evidenceStore.rootDir, { recursive: true, force: true });
    const rootDir = `${ctx.outputDir}.process-evidence`;
    ctx.mode = 'end-to-end';
    ctx.evidenceStore = new FileEvidenceStore({ rootDir, clientId: ctx.clientId, buildId: ctx.buildId, mode: 'end-to-end' });
    const assembly = fixtureAssemblyManifest(ctx);
    await ctx.evidenceStore.writeAssembly(assembly);
    await persistFixtureBuildProof(ctx, assembly.sourceDigest);
    const { publication, sha256 } = await persistFixturePublicationEvidence(ctx);
    await ctx.evidenceStore.writeDeployment(fixtureDeploymentEvidence(ctx, publication, sha256));
    ctx.qualityEvidence = { seoBaseline: 'skipped', visualQa: 'passed' };
    ctx.visualQaPassed = true;
    await new ReleaseReceiptStage(() => new Date('2026-07-20T00:00:03.000Z')).run(ctx);
    await new ReleaseReceiptFinalizerStage().run(ctx);

    const rehydrated = new FileEvidenceStore({ rootDir, clientId: ctx.clientId, buildId: ctx.buildId, mode: 'end-to-end' });
    const bundle = await rehydrated.loadValidatedReleaseBundle({ requireMode: 'end-to-end', requireStatus: 'succeeded' });
    assert.equal(bundle.validation.valid, true);
    assert.equal(bundle.releaseReceipt.status, 'succeeded');
    assert.equal(bundle.publicationEvidence?.commitSha, bundle.deploymentEvidence?.observedCommitSha);
  } finally {
    cleanupContext(ctx);
  }
});
