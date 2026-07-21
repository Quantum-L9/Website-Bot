import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryEvidenceStore } from '../../src/pipeline/evidence/MemoryEvidenceStore.js';
import { FileEvidenceStore } from '../../src/pipeline/evidence/FileEvidenceStore.js';
import { ReleaseReceiptStage } from '../../src/stages/ReleaseReceiptStage.js';
import { ReleaseReceiptFinalizerStage } from '../../src/stages/ReleaseReceiptFinalizerStage.js';
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureBuildProof,
  fixtureContext,
  fixtureDeploymentEvidence,
  fixturePublicationEvidence,
} from '../helpers/siteFactoryFixture.js';

async function persistLocalProof(ctx: ReturnType<typeof fixtureContext>) {
  const assembly = fixtureAssemblyManifest(ctx);
  const assemblyRecord = await ctx.evidenceStore.writeAssembly(assembly);
  const build = fixtureBuildProof(ctx, assemblyRecord.sha256, assembly.sourceDigest);
  const buildRecord = await ctx.evidenceStore.writeBuild(build);
  ctx.assemblyManifest = assembly;
  ctx.buildProof = build;
  return { assembly, assemblyRecord, build, buildRecord };
}

void test('plan mode creates no runtime evidence', async () => {
  const ctx = fixtureContext();
  try {
    ctx.mode = 'plan';
    ctx.dryRun = true;
    ctx.evidenceStore = new MemoryEvidenceStore(ctx.clientId, ctx.buildId, 'plan');
    ctx.evidenceIndex = await ctx.evidenceStore.initialize();
    await new ReleaseReceiptStage().run(ctx);
    assert.equal(await ctx.evidenceStore.readReleaseReceipt(), undefined);
  } finally { cleanupContext(ctx); }
});

void test('local-proof mode persists a partial receipt with explicit remote gaps', async () => {
  const ctx = fixtureContext();
  try {
    await persistLocalProof(ctx);
    await new ReleaseReceiptStage(() => new Date('2026-07-20T00:00:02.000Z')).run(ctx);
    const stored = await ctx.evidenceStore.readReleaseReceipt();
    assert.equal(stored?.value.status, 'partial');
    assert.deepEqual(stored?.value.missing_gates, ['github_publication', 'vercel_deployment']);
    assert.equal(stored?.value.evidence.build?.sha256, (await ctx.evidenceStore.readBuild())?.record.sha256);
  } finally { cleanupContext(ctx); }
});

void test('end-to-end receipt finalizes only after passed visual QA', async () => {
  const ctx = fixtureContext();
  try {
    ctx.mode = 'end-to-end';
    ctx.evidenceStore = new FileEvidenceStore({
      rootDir: ctx.evidenceStore.rootDir,
      clientId: ctx.clientId,
      buildId: ctx.buildId,
      mode: 'end-to-end',
      now: () => new Date('2026-07-20T00:00:03.000Z'),
    });
    ctx.evidenceIndex = await ctx.evidenceStore.initialize();
    const { build, buildRecord } = await persistLocalProof(ctx);
    const publication = fixturePublicationEvidence(ctx, build, buildRecord.sha256);
    const publicationRecord = await ctx.evidenceStore.writePublication(publication);
    const deployment = fixtureDeploymentEvidence(ctx, publication, publicationRecord.sha256);
    await ctx.evidenceStore.writeDeployment(deployment);
    await new ReleaseReceiptStage(() => new Date('2026-07-20T00:00:03.000Z')).run(ctx);
    assert.equal((await ctx.evidenceStore.readReleaseReceipt())?.value.status, 'partial');
    ctx.qualityEvidence.visualQa = 'passed';
    ctx.visualQaPassed = true;
    await new ReleaseReceiptFinalizerStage().run(ctx);
    const bundle = await ctx.evidenceStore.loadValidatedReleaseBundle({ requireStatus: 'succeeded', requireMode: 'end-to-end' });
    assert.equal(bundle.releaseReceipt.status, 'succeeded');
    assert.equal(bundle.validation.valid, true);
  } finally { cleanupContext(ctx); }
});
