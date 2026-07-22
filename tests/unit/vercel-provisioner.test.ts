// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { VercelProvisioner, VercelProvisioningError } from '../../src/provisioning/VercelProvisioner.js';
import type { FetchLike } from '../../src/provisioning/http.js';
import type { GitHubProvisioningResult, ProvisioningRequest } from '../../src/provisioning/types.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const repository: GitHubProvisioningResult = {
  provider: 'github', created: true, repositoryId: '42', fullName: 'Quantum-L9/acme-site',
  sourceBranch: 'main', htmlUrl: 'https://github.com/Quantum-L9/acme-site',
};

function request(): ProvisioningRequest {
  return {
    clientId: 'acme', businessName: 'Acme', specPath: 'input.yaml', planOnly: false,
    persistDeployBlock: true, rollbackCreatedResources: true,
    github: {
      owner: 'Quantum-L9', repository: 'acme-site', visibility: 'private', description: 'Acme',
      sourceBranch: 'main', publishCredentialRef: 'env://GITHUB_SITE_TOKEN',
    },
    vercel: {
      project: 'acme-site',
      environment: [{ key: 'PUBLIC_SITE_URL', valueRef: 'env://ACME_SITE_URL', type: 'encrypted', targets: ['production'] }],
    },
    maintenance: { githubCredentialRef: 'env://SEO_BOT_SITE_GITHUB_TOKEN' },
  };
}

void test('creates and links an Astro project, then upserts declared environment keys', async () => {
  process.env.ACME_SITE_URL = 'https://acme.example';
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'; calls.push({ url, method, body: init?.body as string | undefined });
    if (url.includes('/v9/projects/acme-site') && method === 'GET') return json(404, { error: { message: 'not found' } });
    if (url.endsWith('/v11/projects') && method === 'POST') return json(201, {
      id: 'prj_1', name: 'acme-site', link: { type: 'github', org: 'Quantum-L9', repo: 'acme-site', repoId: 42, productionBranch: 'main' },
    });
    if (url.includes('/v10/projects/prj_1/env?upsert=true') && method === 'POST') return json(201, { created: [], failed: [] });
    return json(500, { error: { message: `unexpected ${method} ${url}` } });
  };
  try {
    const result = await new VercelProvisioner(fetchImpl).provision(request(), repository, 'vercel-token');
    assert.equal(result.created, true);
    assert.deepEqual(result.environmentKeys, ['PUBLIC_SITE_URL']);
    const create = calls.find(call => call.url.endsWith('/v11/projects'));
    assert.deepEqual(JSON.parse(create?.body ?? '{}').gitRepository, { type: 'github', repo: 'Quantum-L9/acme-site' });
    const envCall = calls.find(call => call.url.includes('/env?upsert=true'));
    assert.equal(JSON.parse(envCall?.body ?? '[]')[0].value, 'https://acme.example');
    assert.equal(JSON.stringify(result).includes('https://acme.example'), false);
  } finally {
    delete process.env.ACME_SITE_URL;
  }
});

void test('rejects an existing project linked to another repository', async () => {
  const fetchImpl: FetchLike = async () => json(200, {
    id: 'prj_wrong', name: 'acme-site', link: { type: 'github', org: 'Quantum-L9', repo: 'other-site', repoId: 99, productionBranch: 'main' },
  });
  await assert.rejects(
    new VercelProvisioner(fetchImpl).provision({ ...request(), vercel: { project: 'acme-site', environment: [] } }, repository, 'token'),
    /linked to Quantum-L9\/other-site/,
  );
});

void test('exposes a newly created project for compensation when environment convergence fails', async () => {
  process.env.ACME_SITE_URL = 'https://acme.example';
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    if (url.includes('/v9/projects/acme-site') && method === 'GET') return json(404, { error: { message: 'not found' } });
    if (url.endsWith('/v11/projects')) return json(201, {
      id: 'prj_created', name: 'acme-site', link: { type: 'github', org: 'Quantum-L9', repo: 'acme-site', repoId: 42, productionBranch: 'main' },
    });
    return json(500, { error: { message: 'env write failed' } });
  };
  try {
    await assert.rejects(
      new VercelProvisioner(fetchImpl).provision(request(), repository, 'token'),
      (error: unknown) => error instanceof VercelProvisioningError && error.result?.created === true,
    );
  } finally {
    delete process.env.ACME_SITE_URL;
  }
});
