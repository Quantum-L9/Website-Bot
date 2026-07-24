// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { FileEvidenceStore } from '../../../src/pipeline/evidence/FileEvidenceStore.js';
import { VercelDeployStage } from '../../../src/stages/VercelDeployStage.js';
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureContext,
  persistFixtureBuildProof,
  persistFixturePublicationEvidence,
} from '../../helpers/siteFactoryFixture.js';

void test('deploys an explicitly disposable Vercel project and correlates its commit', {
  skip: !process.env.WEBSITE_BOT_TEST_VERCEL_PROJECT_ID || !process.env.WEBSITE_BOT_TEST_GITHUB_REPO_ID || !process.env.WEBSITE_BOT_TEST_COMMIT_SHA || !process.env.VERCEL_TOKEN,
}, async () => {
  const projectId = process.env.WEBSITE_BOT_TEST_VERCEL_PROJECT_ID as string;
  assert.match(projectId, /(?:test|disposable|throwaway)/i, 'refusing to mutate a project not marked disposable/test');
  const commit = process.env.WEBSITE_BOT_TEST_COMMIT_SHA as string;
  assert.match(commit, /^[0-9a-f]{40}$/i);
  const ctx = fixtureContext();
  try {
    if (!ctx.evidenceStore.rootDir.startsWith('memory://')) rmSync(ctx.evidenceStore.rootDir, { recursive: true, force: true });
    ctx.mode = 'end-to-end';
    ctx.evidenceStore = new FileEvidenceStore({ rootDir: `${ctx.outputDir}.e2e-evidence`, clientId: ctx.clientId, buildId: ctx.buildId, mode: 'end-to-end' });
    ctx.deployTarget = {
      githubRepo: process.env.WEBSITE_BOT_TEST_GITHUB_REPO ?? 'example/disposable',
      githubRepoId: process.env.WEBSITE_BOT_TEST_GITHUB_REPO_ID,
      sourceBranch: process.env.WEBSITE_BOT_TEST_GITHUB_BRANCH ?? 'main',
      vercelProjectId: projectId,
    };
    const assembly = fixtureAssemblyManifest(ctx);
    await ctx.evidenceStore.writeAssembly(assembly);
    await persistFixtureBuildProof(ctx, assembly.sourceDigest);
    await persistFixturePublicationEvidence(ctx, commit);
    await new VercelDeployStage().run(ctx);
    const stored = await ctx.evidenceStore.readDeployment();
    assert.equal(stored?.value.requestedCommitSha, commit);
    assert.equal(stored?.value.observedCommitSha, commit);
    assert.equal(stored?.value.state, 'READY');
  } finally {
    cleanupContext(ctx);
  }
});
