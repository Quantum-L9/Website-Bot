// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteAssemblerStage } from '../../../src/stages/SiteAssemblerStage.js';
import { ClientSourcePublishStage } from '../../../src/stages/ClientSourcePublishStage.js';
import { digestDirectory, isSourceDigestExcluded } from '../../../src/services/hashing.js';
import { cleanupContext, fixtureContext, persistFixtureBuildProof } from '../../helpers/siteFactoryFixture.js';

void test('publishes to an explicitly disposable GitHub repository', { skip: !process.env.WEBSITE_BOT_TEST_GITHUB_REPO || !process.env.GITHUB_SITE_TOKEN }, async () => {
  const repository = process.env.WEBSITE_BOT_TEST_GITHUB_REPO as string;
  assert.match(repository, /(?:disposable|throwaway|test)/i, 'refusing to mutate a repository not marked disposable/test');
  const ctx = fixtureContext({ deploy: { github_repo: repository, source_branch: process.env.WEBSITE_BOT_TEST_GITHUB_BRANCH ?? 'website-bot-e2e' } });
  try {
    await new SiteAssemblerStage().run(ctx);
    const source = digestDirectory(ctx.outputDir, { exclude: isSourceDigestExcluded });
    await persistFixtureBuildProof(ctx, source.digest);
    await new ClientSourcePublishStage().run(ctx);
    const stored = await ctx.evidenceStore.readPublication();
    assert.equal(stored?.value.repository, repository);
    assert.match(stored?.value.commitSha ?? '', /^[0-9a-f]{40}$/);
    assert.equal(stored?.value.verifiedBranchHeadSha, stored?.value.commitSha);
  } finally {
    cleanupContext(ctx);
  }
});
