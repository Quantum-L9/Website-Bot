// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { SiteAssemblerStage } from '../../src/stages/SiteAssemblerStage.js';
import { ClientSourcePublishStage } from '../../src/stages/ClientSourcePublishStage.js';
import {
  canonicalJson,
  collectRegularFiles,
  digestDirectory,
  gitBlobSha,
  isPublicationExcluded,
  isSourceDigestExcluded,
  normalizeRelativePath,
  sha256Text,
} from '../../src/services/hashing.js';
import { normalizeManagedPath } from '../../src/validation/validate-generated-site.js';
import {
  cleanupContext,
  fixtureContext,
  persistFixtureBuildProof,
  withEnv,
} from '../helpers/siteFactoryFixture.js';

const gitSha = (character: string) => character.repeat(40);
const MANIFEST_PATH = '.l9/generated-manifest.json';

async function prepareContext() {
  const ctx = fixtureContext({ deploy: { github_repo: 'example/disposable-site', source_branch: 'main' } });
  await new SiteAssemblerStage().run(ctx);
  const source = digestDirectory(ctx.outputDir, { exclude: isSourceDigestExcluded });
  await persistFixtureBuildProof(ctx, source.digest);
  return ctx;
}

void test('publishes one fast-forward commit and persists authoritative publication evidence', async () => {
  const ctx = await prepareContext();
  try {
    const calls: Array<{ url: string; method: string }> = [];
    let refReads = 0;
    const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const url = String(input);
      const method = init.method ?? 'GET';
      calls.push({ url, method });
      if (url.includes('/git/ref/heads/')) { refReads++; return Response.json({ object: { sha: gitSha('a') } }); }
      if (url.includes(`/git/commits/${gitSha('a')}`)) return Response.json({ tree: { sha: gitSha('b') } });
      if (url.includes(`/git/trees/${gitSha('b')}?recursive=1`)) return Response.json({ sha: gitSha('b'), truncated: false, tree: [] });
      if (url.includes('/contents/.l9/generated-manifest.json')) return new Response('', { status: 404 });
      if (url.endsWith('/git/blobs')) return Response.json({ sha: gitSha('c') });
      if (url.endsWith('/git/trees')) return Response.json({ sha: gitSha('d') });
      if (url.endsWith('/git/commits')) return Response.json({ sha: gitSha('e') });
      if (url.includes('/git/refs/heads/') && method === 'PATCH') return Response.json({ object: { sha: gitSha('e') } });
      throw new Error(`Unexpected GitHub request ${method} ${url}`);
    };

    await withEnv({ GITHUB_SITE_TOKEN: 'test-token' }, async () => {
      await new ClientSourcePublishStage(fakeFetch, () => new Date('2026-07-20T00:00:02.000Z'), async () => {}).run(ctx);
    });

    const stored = await ctx.evidenceStore.readPublication();
    assert.ok(stored);
    assert.equal(refReads, 2);
    assert.equal(stored.value.commitSha, gitSha('e'));
    assert.equal(stored.value.verifiedBranchHeadSha, gitSha('e'));
    assert.equal(stored.value.noOp, false);
    assert.ok(stored.value.changedPaths.length > 5);
    assert.equal(calls.at(-1)?.method, 'PATCH');
  } finally {
    cleanupContext(ctx);
  }
});

void test('refuses publication when source changed after persisted build proof', async () => {
  const ctx = await prepareContext();
  try {
    const page = resolve(ctx.outputDir, 'src/pages/index.astro');
    const content = readFileSync(page, 'utf-8');
    await import('node:fs').then(({ writeFileSync }) => writeFileSync(page, `${content}\n<!-- drift -->\n`, 'utf-8'));
    await assert.rejects(() => new ClientSourcePublishStage().run(ctx), /changed after local proof/);
    assert.equal(await ctx.evidenceStore.readPublication(), undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test('refuses to overwrite a repository manifest owned by another client', async () => {
  const ctx = await prepareContext();
  try {
    const previousManifest = Buffer.from(JSON.stringify({
      schema: 'website-bot.generated-manifest/v1',
      clientId: 'different-client',
      sourceDigest: '0'.repeat(64),
      paths: ['src/pages/index.astro'],
    }), 'utf-8').toString('base64');
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes('/git/ref/heads/')) return Response.json({ object: { sha: gitSha('a') } });
      if (url.includes(`/git/commits/${gitSha('a')}`)) return Response.json({ tree: { sha: gitSha('b') } });
      if (url.includes(`/git/trees/${gitSha('b')}?recursive=1`)) return Response.json({ sha: gitSha('b'), truncated: false, tree: [] });
      if (url.includes('/contents/.l9/generated-manifest.json')) return Response.json({ encoding: 'base64', content: previousManifest });
      throw new Error(`Unexpected GitHub request ${url}`);
    };
    await withEnv({ GITHUB_SITE_TOKEN: 'test-token' }, async () => {
      await assert.rejects(() => new ClientSourcePublishStage(fakeFetch).run(ctx), /refusing cross-client overwrite/);
    });
  } finally {
    cleanupContext(ctx);
  }
});

void test('refuses non-fast-forward publication when branch head moves before update', async () => {
  const ctx = await prepareContext();
  try {
    let refReads = 0;
    let patchAttempted = false;
    const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const url = String(input);
      const method = init.method ?? 'GET';
      if (url.includes('/git/ref/heads/')) {
        refReads += 1;
        return Response.json({ object: { sha: refReads === 1 ? gitSha('a') : gitSha('f') } });
      }
      if (url.includes(`/git/commits/${gitSha('a')}`)) return Response.json({ tree: { sha: gitSha('b') } });
      if (url.includes(`/git/trees/${gitSha('b')}?recursive=1`)) return Response.json({ sha: gitSha('b'), truncated: false, tree: [] });
      if (url.includes('/contents/.l9/generated-manifest.json')) return new Response('', { status: 404 });
      if (url.endsWith('/git/blobs')) return Response.json({ sha: gitSha('c') });
      if (url.endsWith('/git/trees')) return Response.json({ sha: gitSha('d') });
      if (url.endsWith('/git/commits')) return Response.json({ sha: gitSha('e') });
      if (url.includes('/git/refs/heads/') && method === 'PATCH') { patchAttempted = true; return Response.json({}); }
      throw new Error(`Unexpected GitHub request ${method} ${url}`);
    };
    await withEnv({ GITHUB_SITE_TOKEN: 'test-token' }, async () => {
      await assert.rejects(() => new ClientSourcePublishStage(fakeFetch, () => new Date(), async () => {}).run(ctx), /Target branch changed during publication/);
    });
    assert.equal(patchAttempted, false);
    assert.equal(await ctx.evidenceStore.readPublication(), undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test('records a no-op when the generated repository tree already matches', async () => {
  const ctx = await prepareContext();
  try {
    const source = digestDirectory(ctx.outputDir, { exclude: isSourceDigestExcluded });
    const files = collectRegularFiles(ctx.outputDir, { exclude: isPublicationExcluded });
    const paths = files.map(path => normalizeManagedPath(normalizeRelativePath(relative(ctx.outputDir, path)))).filter(path => path !== MANIFEST_PATH).sort();
    paths.push(MANIFEST_PATH);
    paths.sort();
    const manifest = { schema: 'website-bot.generated-manifest/v1', clientId: ctx.clientId, sourceDigest: source.digest, paths };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const tree = files.map(path => ({
      path: normalizeManagedPath(normalizeRelativePath(relative(ctx.outputDir, path))),
      type: 'blob',
      mode: '100644',
      sha: gitBlobSha(readFileSync(path)),
    }));
    tree.push({ path: MANIFEST_PATH, type: 'blob', mode: '100644', sha: gitBlobSha(Buffer.from(manifestText, 'utf-8')) });
    const previousManifest = Buffer.from(manifestText, 'utf-8').toString('base64');
    const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.includes('/git/ref/heads/')) return Response.json({ object: { sha: gitSha('a') } });
      if (url.includes(`/git/commits/${gitSha('a')}`)) return Response.json({ tree: { sha: gitSha('b') } });
      if (url.includes(`/git/trees/${gitSha('b')}?recursive=1`)) return Response.json({ sha: gitSha('b'), truncated: false, tree });
      if (url.includes('/contents/.l9/generated-manifest.json')) return Response.json({ encoding: 'base64', content: previousManifest });
      throw new Error(`Unexpected GitHub request ${url}`);
    };
    await withEnv({ GITHUB_SITE_TOKEN: 'test-token' }, async () => {
      await new ClientSourcePublishStage(fakeFetch, () => new Date('2026-07-20T00:00:02.000Z')).run(ctx);
    });
    const stored = await ctx.evidenceStore.readPublication();
    assert.ok(stored);
    assert.equal(stored.value.noOp, true);
    assert.equal(stored.value.commitSha, gitSha('a'));
    assert.equal(stored.value.sourceDigest, source.digest);
    assert.equal(stored.value.managedManifestDigest, sha256Text(canonicalJson(manifest)));
  } finally {
    cleanupContext(ctx);
  }
});

void test('deletes only stale generated paths and preserves human-owned files', async () => {
  const ctx = await prepareContext();
  try {
    const stalePath = 'src/pages/obsolete/index.astro';
    const humanPath = 'HUMAN_NOTES.md';
    const previousManifest = Buffer.from(JSON.stringify({
      schema: 'website-bot.generated-manifest/v1', clientId: ctx.clientId, sourceDigest: '0'.repeat(64),
      paths: [stalePath, MANIFEST_PATH],
    }), 'utf-8').toString('base64');
    let submittedTree: Array<{ path: string; sha: string | null }> = [];
    let refReads = 0;
    const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const url = String(input);
      const method = init.method ?? 'GET';
      if (url.includes('/git/ref/heads/')) { refReads += 1; return Response.json({ object: { sha: gitSha('a') } }); }
      if (url.includes(`/git/commits/${gitSha('a')}`)) return Response.json({ tree: { sha: gitSha('b') } });
      if (url.includes(`/git/trees/${gitSha('b')}?recursive=1`)) return Response.json({
        sha: gitSha('b'), truncated: false,
        tree: [
          { path: stalePath, type: 'blob', mode: '100644', sha: gitSha('8') },
          { path: humanPath, type: 'blob', mode: '100644', sha: gitSha('9') },
        ],
      });
      if (url.includes('/contents/.l9/generated-manifest.json')) return Response.json({ encoding: 'base64', content: previousManifest });
      if (url.endsWith('/git/blobs')) return Response.json({ sha: gitSha('c') });
      if (url.endsWith('/git/trees')) {
        submittedTree = (JSON.parse(String(init.body)) as { tree: Array<{ path: string; sha: string | null }> }).tree;
        return Response.json({ sha: gitSha('d') });
      }
      if (url.endsWith('/git/commits')) return Response.json({ sha: gitSha('e') });
      if (url.includes('/git/refs/heads/') && method === 'PATCH') return Response.json({ object: { sha: gitSha('e') } });
      throw new Error(`Unexpected GitHub request ${method} ${url}`);
    };
    await withEnv({ GITHUB_SITE_TOKEN: 'test-token' }, async () => {
      await new ClientSourcePublishStage(fakeFetch, () => new Date('2026-07-20T00:00:02.000Z'), async () => {}).run(ctx);
    });
    assert.equal(refReads, 2);
    assert.ok(submittedTree.some(entry => entry.path === stalePath && entry.sha === null));
    assert.ok(!submittedTree.some(entry => entry.path === humanPath));
    const stored = await ctx.evidenceStore.readPublication();
    assert.deepEqual(stored?.value.deletedPaths, [stalePath]);
  } finally {
    cleanupContext(ctx);
  }
});
