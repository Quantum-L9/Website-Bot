// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubProvisioner, GitHubProvisioningError } from '../../src/provisioning/GitHubProvisioner.js';
import type { FetchLike } from '../../src/provisioning/http.js';
import type { GitHubProvisioningResult, ProvisioningRequest } from '../../src/provisioning/types.js';

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers[name];
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function request(): ProvisioningRequest {
  return {
    clientId: 'acme', businessName: 'Acme', specPath: 'input.yaml', planOnly: false,
    persistDeployBlock: true, rollbackCreatedResources: true,
    github: {
      owner: 'Quantum-L9', repository: 'acme-site', visibility: 'private',
      description: 'Acme generated site', sourceBranch: 'main', publishCredentialRef: 'env://GITHUB_SITE_TOKEN',
    },
    vercel: { project: 'acme-site', environment: [] },
    maintenance: { githubCredentialRef: 'env://SEO_BOT_SITE_GITHUB_TOKEN' },
  };
}

void test('adopts an existing repository without creating or deleting it', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'; calls.push({ url, method });
    if (url.endsWith('/repos/Quantum-L9/acme-site')) return json(200, { id: 42, full_name: 'Quantum-L9/acme-site', html_url: 'https://github.com/Quantum-L9/acme-site', default_branch: 'main' });
    if (url.includes('/git/ref/heads/main')) return json(200, { object: { sha: 'abc' } });
    return json(500, { message: `unexpected ${method} ${url}` });
  };
  const result = await new GitHubProvisioner(fetchImpl).provision(request(), 'provision-token');
  assert.equal(result.created, false);
  assert.equal(result.repositoryId, '42');
  assert.equal(calls.some(call => call.method === 'POST'), false);
});

void test('creates a missing organization repository and verifies its initialized branch', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'; calls.push({ url, method, body: init?.body as string | undefined });
    if (url.endsWith('/repos/Quantum-L9/acme-site') && method === 'GET') return json(404, { message: 'Not Found' });
    if (url.endsWith('/users/Quantum-L9')) return json(200, { login: 'Quantum-L9', type: 'Organization' });
    if (url.endsWith('/orgs/Quantum-L9/repos') && method === 'POST') return json(201, { id: 43, full_name: 'Quantum-L9/acme-site', html_url: 'https://github.com/Quantum-L9/acme-site', default_branch: 'main' });
    if (url.includes('/git/ref/heads/main')) return json(200, { object: { sha: 'seed' } });
    return json(500, { message: `unexpected ${method} ${url}` });
  };
  const result = await new GitHubProvisioner(fetchImpl).provision(request(), 'provision-token');
  assert.equal(result.created, true);
  const create = calls.find(call => call.url.endsWith('/orgs/Quantum-L9/repos'));
  assert.ok(create);
  assert.equal(JSON.parse(create.body ?? '{}').auto_init, true);
  assert.equal(JSON.parse(create.body ?? '{}').private, true);
});

void test('sends authenticated GitHub headers and the full repository governance policy on create', async () => {
  let createInit: RequestInit | undefined;
  let readInit: RequestInit | undefined;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    if (url.endsWith('/repos/Quantum-L9/acme-site') && method === 'GET') { readInit = init; return json(404, { message: 'Not Found' }); }
    if (url.endsWith('/users/Quantum-L9')) return json(200, { login: 'Quantum-L9', type: 'Organization' });
    if (url.endsWith('/orgs/Quantum-L9/repos') && method === 'POST') {
      createInit = init;
      return json(201, { id: 43, full_name: 'Quantum-L9/acme-site', html_url: 'https://github.com/Quantum-L9/acme-site', default_branch: 'main' });
    }
    if (url.includes('/git/ref/heads/main')) return json(200, { object: { sha: 'seed' } });
    return json(500, { message: `unexpected ${method} ${url}` });
  };
  await new GitHubProvisioner(fetchImpl).provision(request(), 'provision-token');

  // Authenticated read path carries the same auth + API-version contract.
  assert.equal(headerOf(readInit, 'Authorization'), 'Bearer provision-token');
  assert.equal(headerOf(readInit, 'Accept'), 'application/vnd.github+json');
  assert.equal(headerOf(readInit, 'X-GitHub-Api-Version'), '2022-11-28');

  // Create request headers.
  assert.equal(headerOf(createInit, 'Authorization'), 'Bearer provision-token');
  assert.equal(headerOf(createInit, 'Accept'), 'application/vnd.github+json');
  assert.equal(headerOf(createInit, 'X-GitHub-Api-Version'), '2022-11-28');
  assert.equal(headerOf(createInit, 'Content-Type'), 'application/json');

  // Repository governance policy — the full merge/feature contract, not just auto_init/private.
  const body = JSON.parse(String(createInit?.body)) as Record<string, unknown>;
  assert.equal(body.auto_init, true);
  assert.equal(body.private, true);
  assert.equal(body.has_issues, true);
  assert.equal(body.has_projects, false);
  assert.equal(body.has_wiki, false);
  assert.equal(body.allow_squash_merge, true);
  assert.equal(body.allow_merge_commit, false);
  assert.equal(body.allow_rebase_merge, true);
  assert.equal(body.delete_branch_on_merge, true);
});

void test('rolls back a created repository with an authenticated DELETE', async () => {
  const calls: Array<{ url: string; method: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', init });
    return new Response(undefined, { status: 204 });
  };
  const created: GitHubProvisioningResult = {
    provider: 'github', created: true, repositoryId: '43', fullName: 'Quantum-L9/acme-site',
    sourceBranch: 'main', htmlUrl: 'https://github.com/Quantum-L9/acme-site',
  };
  await new GitHubProvisioner(fetchImpl).remove(created, 'provision-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, 'https://api.github.com/repos/Quantum-L9/acme-site');
  assert.equal(headerOf(calls[0].init, 'Authorization'), 'Bearer provision-token');
  assert.equal(headerOf(calls[0].init, 'Accept'), 'application/vnd.github+json');
  assert.equal(headerOf(calls[0].init, 'X-GitHub-Api-Version'), '2022-11-28');
});

void test('does not delete a repository it did not create during rollback', async () => {
  let called = false;
  const fetchImpl: FetchLike = async () => { called = true; return new Response(undefined, { status: 204 }); };
  const adopted: GitHubProvisioningResult = {
    provider: 'github', created: false, repositoryId: '43', fullName: 'Quantum-L9/acme-site',
    sourceBranch: 'main', htmlUrl: 'https://github.com/Quantum-L9/acme-site',
  };
  await new GitHubProvisioner(fetchImpl).remove(adopted, 'provision-token');
  assert.equal(called, false);
});

void test('exposes a created repository for compensation when branch convergence fails', async () => {
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    if (url.endsWith('/repos/Quantum-L9/acme-site') && method === 'GET') return json(404, { message: 'Not Found' });
    if (url.endsWith('/users/Quantum-L9')) return json(200, { login: 'Quantum-L9', type: 'Organization' });
    if (url.endsWith('/orgs/Quantum-L9/repos')) return json(201, { id: 44, full_name: 'Quantum-L9/acme-site', html_url: 'https://github.com/Quantum-L9/acme-site', default_branch: 'main' });
    if (url.includes('/git/ref/heads/main')) return json(404, { message: 'missing' });
    if (url.endsWith('/git/blobs')) return json(500, { message: 'seed failed' });
    return json(404, { message: 'missing' });
  };
  await assert.rejects(
    new GitHubProvisioner(fetchImpl).provision(request(), 'provision-token'),
    (error: unknown) => error instanceof GitHubProvisioningError && error.result?.created === true,
  );
});
