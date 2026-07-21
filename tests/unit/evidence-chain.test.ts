import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { FileEvidenceStore } from '../../src/pipeline/evidence/FileEvidenceStore.js';
import { ReleaseReceiptStage } from '../../src/stages/ReleaseReceiptStage.js';
import { ReleaseReceiptFinalizerStage } from '../../src/stages/ReleaseReceiptFinalizerStage.js';
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureContext,
  persistFixtureBuildProof,
  persistFixturePublicationEvidence,
  fixtureDeploymentEvidence,
} from '../helpers/siteFactoryFixture.js';

async function prepareFullChain() {
  const ctx = fixtureContext();
  if (!ctx.evidenceStore.rootDir.startsWith('memory://')) rmSync(ctx.evidenceStore.rootDir, { recursive: true, force: true });
  ctx.mode = 'end-to-end';
  ctx.evidenceStore = new FileEvidenceStore({ rootDir: `${ctx.outputDir}.chain-evidence`, clientId: ctx.clientId, buildId: ctx.buildId, mode: 'end-to-end' });
  const assembly = fixtureAssemblyManifest(ctx);
  await ctx.evidenceStore.writeAssembly(assembly);
  await persistFixtureBuildProof(ctx, assembly.sourceDigest);
  const { publication, sha256 } = await persistFixturePublicationEvidence(ctx);
  const deployment = fixtureDeploymentEvidence(ctx, publication, sha256);
  await ctx.evidenceStore.writeDeployment(deployment);
  ctx.qualityEvidence = { seoBaseline: 'skipped', visualQa: 'passed' };
  ctx.visualQaPassed = true;
  await new ReleaseReceiptStage(() => new Date('2026-07-20T00:00:03.000Z')).run(ctx);
  await new ReleaseReceiptFinalizerStage().run(ctx);
  return ctx;
}

void test('validates a complete persisted end-to-end evidence chain', async () => {
  const ctx = await prepareFullChain();
  try {
    const bundle = await ctx.evidenceStore.loadValidatedReleaseBundle({ requireMode: 'end-to-end', requireStatus: 'succeeded' });
    assert.equal(bundle.validation.valid, true);
    assert.deepEqual(bundle.validation.errors, []);
    assert.equal(bundle.validation.identities.commitSha, bundle.publicationEvidence?.commitSha);
    assert.equal(bundle.validation.identities.deploymentId, bundle.deploymentEvidence?.deploymentId);
  } finally {
    cleanupContext(ctx);
  }
});

void test('rejects a deployment artifact that is valid alone but bound to another published commit', async () => {
  const ctx = fixtureContext();
  try {
    if (!ctx.evidenceStore.rootDir.startsWith('memory://')) rmSync(ctx.evidenceStore.rootDir, { recursive: true, force: true });
    ctx.mode = 'end-to-end';
    ctx.evidenceStore = new FileEvidenceStore({ rootDir: `${ctx.outputDir}.mismatch-evidence`, clientId: ctx.clientId, buildId: ctx.buildId, mode: 'end-to-end' });
    const assembly = fixtureAssemblyManifest(ctx);
    await ctx.evidenceStore.writeAssembly(assembly);
    await persistFixtureBuildProof(ctx, assembly.sourceDigest);
    const { publication, sha256 } = await persistFixturePublicationEvidence(ctx, 'e'.repeat(40));
    const deployment = fixtureDeploymentEvidence(ctx, publication, sha256);
    deployment.requestedCommitSha = 'f'.repeat(40);
    deployment.observedCommitSha = 'f'.repeat(40);
    await ctx.evidenceStore.writeDeployment(deployment);
    ctx.qualityEvidence.visualQa = 'passed';
    await new ReleaseReceiptStage(() => new Date('2026-07-20T00:00:03.000Z')).run(ctx);
    const validation = await ctx.evidenceStore.validateChain('end-to-end');
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(error => error.includes('deployment commit differs from published commit')));
  } finally {
    cleanupContext(ctx);
  }
});
