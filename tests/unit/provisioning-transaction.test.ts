import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ProvisioningCoordinator } from '../../src/provisioning/ProvisioningCoordinator.js';
import { SpecDeploymentWriter } from '../../src/provisioning/SpecDeploymentWriter.js';
import { VercelProvisioningError } from '../../src/provisioning/VercelProvisioner.js';
import type { GitHubProvisioningResult, ProvisioningRequest, VercelProvisioningResult } from '../../src/provisioning/types.js';

function request(specPath: string, planOnly = false): ProvisioningRequest {
  return {
    clientId: 'acme', businessName: 'Acme', specPath, planOnly,
    persistDeployBlock: true, rollbackCreatedResources: true,
    github: {
      owner: 'Quantum-L9', repository: 'acme-site', visibility: 'private', description: 'Acme',
      sourceBranch: 'main', publishCredentialRef: 'env://ACME_PUBLISH_TOKEN',
    },
    vercel: { project: 'acme-site', environment: [] },
    maintenance: { githubCredentialRef: 'env://ACME_MAINTENANCE_TOKEN' },
  };
}

void test('persists the exact credential references and can restore the source spec', () => {
  const root = mkdtempSync(join(tmpdir(), 'provision-spec-'));
  const specPath = join(root, 'domain.yaml');
  writeFileSync(specPath, 'client_id: acme\nbusiness_name: Acme\n', 'utf-8');
  const writer = new SpecDeploymentWriter();
  const github: GitHubProvisioningResult = { provider: 'github', created: true, repositoryId: '42', fullName: 'Quantum-L9/acme-site', sourceBranch: 'main', htmlUrl: 'https://github.com/Quantum-L9/acme-site' };
  const vercel: VercelProvisioningResult = { provider: 'vercel', created: true, projectId: 'prj_1', projectName: 'acme-site', linkedRepository: github.fullName, productionBranch: 'main', environmentKeys: [], deploymentTrigger: 'git-push' };
  try {
    const result = writer.write(request(specPath), github, vercel);
    const written = readFileSync(specPath, 'utf-8');
    assert.match(written, /publish_credential_ref: env:\/\/ACME_PUBLISH_TOKEN/);
    assert.match(written, /seo_bot_github_credential_ref: env:\/\/ACME_MAINTENANCE_TOKEN/);
    writer.restore(result);
    assert.equal(readFileSync(specPath, 'utf-8'), 'client_id: acme\nbusiness_name: Acme\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('plan mode performs no provider calls and emits no secret values', async () => {
  const root = mkdtempSync(join(tmpdir(), 'provision-plan-'));
  const specPath = join(root, 'domain.yaml');
  writeFileSync(specPath, 'client_id: acme\n', 'utf-8');
  let calls = 0;
  const provider = { provision: async () => { calls += 1; throw new Error('must not run'); }, verifyAccess: async () => { calls += 1; }, remove: async () => { calls += 1; } };
  try {
    const coordinator = new ProvisioningCoordinator(provider as never, provider as never, new SpecDeploymentWriter(), () => new Date('2026-07-20T00:00:00Z'), join(root, 'receipts'));
    const receipt = await coordinator.provision(request(specPath, true));
    assert.equal(calls, 0);
    assert.equal(receipt.status, 'planned');
    assert.equal(JSON.stringify(receipt).includes('secret-value'), false);
    assert.equal(existsSync(join(root, 'receipts/acme.provisioning-receipt.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('missing bootstrap credentials fail before provider calls and emit a failed receipt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'provision-missing-secret-'));
  const specPath = join(root, 'domain.yaml');
  writeFileSync(specPath, 'client_id: acme\n', 'utf-8');
  for (const key of ['GITHUB_PROVISION_TOKEN', 'VERCEL_TOKEN', 'ACME_PUBLISH_TOKEN', 'ACME_MAINTENANCE_TOKEN']) delete process.env[key];
  let calls = 0;
  const provider = { provision: async () => { calls += 1; throw new Error('must not run'); }, verifyAccess: async () => { calls += 1; }, remove: async () => { calls += 1; } };
  try {
    const coordinator = new ProvisioningCoordinator(provider as never, provider as never, new SpecDeploymentWriter(), () => new Date('2026-07-20T00:00:00Z'), join(root, 'receipts'));
    await assert.rejects(coordinator.provision(request(specPath)), /GITHUB_PROVISION_TOKEN is required/);
    assert.equal(calls, 0);
    const receipt = JSON.parse(readFileSync(join(root, 'receipts/acme.provisioning-receipt.json'), 'utf-8'));
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.rollback.attempted, false);
    assert.deepEqual(receipt.errors, ['GITHUB_PROVISION_TOKEN is required for automatic provisioning']);
    assert.equal(JSON.stringify(receipt).includes('secret-value'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('compensates only resources created by a failed transaction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'provision-rollback-'));
  const specPath = join(root, 'domain.yaml');
  writeFileSync(specPath, 'client_id: acme\n', 'utf-8');
  process.env.GITHUB_PROVISION_TOKEN = 'provision';
  process.env.VERCEL_TOKEN = 'vercel';
  process.env.ACME_PUBLISH_TOKEN = 'publish';
  process.env.ACME_MAINTENANCE_TOKEN = 'maintenance';
  const actions: string[] = [];
  const githubResult: GitHubProvisioningResult = { provider: 'github', created: true, repositoryId: '42', fullName: 'Quantum-L9/acme-site', sourceBranch: 'main', htmlUrl: 'https://github.com/Quantum-L9/acme-site' };
  const vercelResult: VercelProvisioningResult = { provider: 'vercel', created: true, projectId: 'prj_created', projectName: 'acme-site', linkedRepository: githubResult.fullName, productionBranch: 'main', environmentKeys: [], deploymentTrigger: 'git-push' };
  const github = {
    provision: async () => githubResult,
    verifyAccess: async () => undefined,
    remove: async () => { actions.push('github'); },
  };
  const vercel = {
    provision: async () => { throw new VercelProvisioningError('environment convergence failed', vercelResult); },
    remove: async () => { actions.push('vercel'); },
  };
  try {
    const coordinator = new ProvisioningCoordinator(github as never, vercel as never, new SpecDeploymentWriter(), () => new Date('2026-07-20T00:00:00Z'), join(root, 'receipts'));
    await assert.rejects(coordinator.provision(request(specPath)), /Client provisioning failed/);
    assert.deepEqual(actions, ['vercel', 'github']);
    const receipt = JSON.parse(readFileSync(join(root, 'receipts/acme.provisioning-receipt.json'), 'utf-8'));
    assert.equal(receipt.status, 'rolled_back');
    assert.deepEqual(receipt.errors, ['environment convergence failed']);
    assert.deepEqual(receipt.rollback.actions, ['deleted-created-vercel-project', 'deleted-created-github-repository']);
  } finally {
    for (const key of ['GITHUB_PROVISION_TOKEN', 'VERCEL_TOKEN', 'ACME_PUBLISH_TOKEN', 'ACME_MAINTENANCE_TOKEN']) delete process.env[key];
    rmSync(root, { recursive: true, force: true });
  }
});

void test('never deletes adopted resources during rollback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'provision-adopted-'));
  const specPath = join(root, 'domain.yaml');
  writeFileSync(specPath, 'client_id: acme\n', 'utf-8');
  process.env.GITHUB_PROVISION_TOKEN = 'provision';
  process.env.VERCEL_TOKEN = 'vercel';
  process.env.ACME_PUBLISH_TOKEN = 'publish';
  process.env.ACME_MAINTENANCE_TOKEN = 'maintenance';
  let deletes = 0;
  const github = {
    provision: async () => ({ provider: 'github', created: false, repositoryId: '42', fullName: 'Quantum-L9/acme-site', sourceBranch: 'main', htmlUrl: 'https://github.com/Quantum-L9/acme-site' }),
    verifyAccess: async () => undefined,
    remove: async () => { deletes += 1; },
  };
  const vercel = { provision: async () => { throw new Error('collision'); }, remove: async () => { deletes += 1; } };
  try {
    const coordinator = new ProvisioningCoordinator(github as never, vercel as never, new SpecDeploymentWriter(), () => new Date('2026-07-20T00:00:00Z'), join(root, 'receipts'));
    await assert.rejects(coordinator.provision(request(specPath)), /collision/);
    assert.equal(deletes, 0);
  } finally {
    for (const key of ['GITHUB_PROVISION_TOKEN', 'VERCEL_TOKEN', 'ACME_PUBLISH_TOKEN', 'ACME_MAINTENANCE_TOKEN']) delete process.env[key];
    rmSync(root, { recursive: true, force: true });
  }
});
