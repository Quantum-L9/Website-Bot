// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { FileEvidenceStore } from '../../src/pipeline/evidence/FileEvidenceStore.js';
import { VercelDeployStage } from '../../src/stages/VercelDeployStage.js';
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureContext,
  persistFixtureBuildProof,
  persistFixturePublicationEvidence,
  withEnv,
} from '../helpers/siteFactoryFixture.js';

const commit = 'e'.repeat(40);

async function prepareContext() {
  const ctx = fixtureContext({ deploy: { github_repo: 'example/disposable-site', github_repo_id: '123', vercel_project_id: 'prj_123' } });
  if (!ctx.evidenceStore.rootDir.startsWith('memory://')) rmSync(ctx.evidenceStore.rootDir, { recursive: true, force: true });
  ctx.mode = 'end-to-end';
  ctx.evidenceStore = new FileEvidenceStore({
    rootDir: `${ctx.outputDir}.e2e-evidence`,
    clientId: ctx.clientId,
    buildId: ctx.buildId,
    mode: 'end-to-end',
    now: () => new Date('2026-07-20T00:00:00.000Z'),
  });
  ctx.deployTarget = { githubRepo: 'example/disposable-site', githubRepoId: '123', sourceBranch: 'main', vercelProjectId: 'prj_123' };
  const assembly = fixtureAssemblyManifest(ctx);
  await ctx.evidenceStore.writeAssembly(assembly);
  await persistFixtureBuildProof(ctx, assembly.sourceDigest);
  await persistFixturePublicationEvidence(ctx, commit);
  return ctx;
}

void test('correlates READY Vercel deployment to persisted publication evidence', async () => {
  const ctx = await prepareContext();
  try {
    const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/v13/deployments')) {
        assert.equal(init.method, 'POST');
        const body = JSON.parse(String(init.body)) as { gitSource?: { sha?: string } };
        assert.equal(body.gitSource?.sha, commit);
        return Response.json({ id: 'dep_123', url: 'preview.example.vercel.app' });
      }
      if (url.includes('/v13/deployments/dep_123')) return Response.json({
        id: 'dep_123', readyState: 'READY', url: 'preview.example.vercel.app', aliases: ['preview.example.com'],
        projectId: 'prj_123', meta: { githubCommitSha: commit }, createdAt: 1_721_436_000_000, ready: 1_721_436_001_000,
      });
      throw new Error(`Unexpected Vercel request ${url}`);
    };
    await withEnv({ VERCEL_TOKEN: 'test-token', VERCEL_TARGET: 'preview' }, async () => {
      await new VercelDeployStage(fakeFetch, async () => {}, () => new Date('2026-07-20T00:00:02.000Z'), 0, 2).run(ctx);
    });
    const stored = await ctx.evidenceStore.readDeployment();
    assert.ok(stored);
    assert.equal(stored.value.requestedCommitSha, commit);
    assert.equal(stored.value.observedCommitSha, commit);
    assert.equal(stored.value.state, 'READY');
    assert.equal(ctx.deploymentUrl, 'https://preview.example.com');
    assert.equal(stored.value.publicationSha256, (await ctx.evidenceStore.readPublication())?.record.sha256);
  } finally {
    cleanupContext(ctx);
  }
});

void test('fails closed and writes no deployment evidence when Vercel reports another commit', async () => {
  const ctx = await prepareContext();
  try {
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => String(input).endsWith('/v13/deployments')
      ? Response.json({ id: 'dep_bad', url: 'bad.vercel.app' })
      : Response.json({ id: 'dep_bad', readyState: 'READY', url: 'bad.vercel.app', projectId: 'prj_123', meta: { githubCommitSha: 'f'.repeat(40) } });
    await withEnv({ VERCEL_TOKEN: 'test-token', VERCEL_TARGET: 'preview' }, async () => {
      await assert.rejects(() => new VercelDeployStage(fakeFetch, async () => {}, () => new Date(), 0, 1).run(ctx), /different commit/);
    });
    assert.equal(await ctx.evidenceStore.readDeployment(), undefined);
  } finally {
    cleanupContext(ctx);
  }
});
