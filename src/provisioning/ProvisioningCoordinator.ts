// L9_META: layer=provisioning, role=transaction_coordinator, status=active, version=1.0.0
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { canonicalJson, sha256Text } from '../services/hashing.js';
import { GitHubProvisioner, GitHubProvisioningError } from './GitHubProvisioner.js';
import { VercelProvisioner, VercelProvisioningError } from './VercelProvisioner.js';
import { ProvisioningHttpError } from './http.js';
import { resolveEnvRef } from './secret-ref.js';
import { SpecDeploymentWriter, type SpecWriteResult } from './SpecDeploymentWriter.js';
import type { GitHubProvisioningResult, ProvisioningReceipt, ProvisioningRequest, VercelProvisioningResult } from './types.js';

export class ProvisioningCoordinator {
  constructor(
    private readonly github = new GitHubProvisioner(),
    private readonly vercel = new VercelProvisioner(),
    private readonly specWriter = new SpecDeploymentWriter(),
    private readonly now: () => Date = () => new Date(),
    private readonly receiptRoot = 'build/provisioning',
  ) {}

  async provision(request: ProvisioningRequest): Promise<ProvisioningReceipt> {
    const idempotencyKey = sha256Text(canonicalJson({
      clientId: request.clientId,
      github: request.github,
      vercel: {
        project: request.vercel.project,
        teamId: request.vercel.teamId,
        environment: request.vercel.environment.map(item => ({ key: item.key, valueRef: item.valueRef, type: item.type, targets: item.targets })),
      },
      maintenance: request.maintenance,
    }));
    const baseReceipt: ProvisioningReceipt = {
      schema: 'website-bot.provisioning-receipt/v1',
      status: request.planOnly ? 'planned' : 'failed',
      clientId: request.clientId,
      idempotencyKey,
      spec: { path: resolve(request.specPath), persisted: false },
      maintenance: request.maintenance,
      errors: [],
      rollback: { attempted: false, completed: false, actions: [], errors: [] },
      createdAt: this.now().toISOString(),
    };

    if (request.planOnly) {
      const github: GitHubProvisioningResult = {
        provider: 'github', created: false, repositoryId: 'planned',
        fullName: `${request.github.owner}/${request.github.repository}`,
        sourceBranch: request.github.sourceBranch,
        htmlUrl: `https://github.com/${request.github.owner}/${request.github.repository}`,
      };
      const vercel: VercelProvisioningResult = {
        provider: 'vercel', created: false, projectId: 'planned', projectName: request.vercel.project,
        ...(request.vercel.teamId ? { teamId: request.vercel.teamId } : {}),
        linkedRepository: github.fullName,
        productionBranch: github.sourceBranch,
        environmentKeys: request.vercel.environment.map(item => item.key).sort(),
        deploymentTrigger: 'git-push',
      };
      return { ...baseReceipt, github, vercel };
    }

    let githubProvisionToken = '';
    let vercelToken = '';
    let publishToken = '';
    let maintenanceToken = '';
    let githubResult: GitHubProvisioningResult | undefined;
    let vercelResult: VercelProvisioningResult | undefined;
    let specResult: SpecWriteResult | undefined;

    try {
      // Resolve every credential before the first provider mutation. This keeps a
      // missing reference side-effect free while still producing a failed receipt.
      githubProvisionToken = this.requireEnv('GITHUB_PROVISION_TOKEN');
      vercelToken = this.requireEnv('VERCEL_TOKEN');
      publishToken = resolveEnvRef(request.github.publishCredentialRef, 'provision.github.publish_credential_ref');
      maintenanceToken = resolveEnvRef(request.maintenance.githubCredentialRef, 'provision.maintenance.github_credential_ref');
      githubResult = await this.github.provision(request, githubProvisionToken);
      await this.github.verifyAccess(githubResult.fullName, publishToken, request.github.publishCredentialRef);
      await this.github.verifyAccess(githubResult.fullName, maintenanceToken, request.maintenance.githubCredentialRef);
      vercelResult = await this.vercel.provision(request, githubResult, vercelToken);
      specResult = this.specWriter.write(request, githubResult, vercelResult);
      const receipt: ProvisioningReceipt = {
        ...baseReceipt,
        status: 'succeeded',
        github: githubResult,
        vercel: vercelResult,
        spec: specResult,
      };
      this.writeReceipt(receipt);
      return receipt;
    } catch (error) {
      if (!githubResult && error instanceof GitHubProvisioningError) githubResult = error.result;
      if (!vercelResult && error instanceof VercelProvisioningError) vercelResult = error.result;
      const rollback = { attempted: false, completed: false, actions: [] as string[], errors: [] as string[] };
      const hasCompensableState = Boolean(specResult?.persisted || vercelResult?.created || githubResult?.created);
      if (request.rollbackCreatedResources && hasCompensableState) {
        rollback.attempted = true;
        if (specResult?.persisted) {
          try { this.specWriter.restore(specResult); rollback.actions.push('restored-domain-spec'); }
          catch (rollbackError) { rollback.errors.push(`spec: ${this.receiptMessage(rollbackError)}`); }
        }
        if (vercelResult?.created && vercelToken) {
          try { await this.vercel.remove(vercelResult, vercelToken); rollback.actions.push('deleted-created-vercel-project'); }
          catch (rollbackError) { rollback.errors.push(`vercel: ${this.receiptMessage(rollbackError)}`); }
        }
        if (githubResult?.created && githubProvisionToken) {
          try { await this.github.remove(githubResult, githubProvisionToken); rollback.actions.push('deleted-created-github-repository'); }
          catch (rollbackError) { rollback.errors.push(`github: ${this.receiptMessage(rollbackError)}`); }
        }
        rollback.completed = rollback.errors.length === 0;
      }
      const receipt: ProvisioningReceipt = {
        ...baseReceipt,
        status: rollback.attempted && rollback.completed ? 'rolled_back' : 'failed',
        ...(githubResult ? { github: githubResult } : {}),
        ...(vercelResult ? { vercel: vercelResult } : {}),
        ...(specResult ? { spec: specResult } : {}),
        errors: [this.receiptMessage(error), ...rollback.errors],
        rollback,
      };
      this.writeReceipt(receipt);
      const suffix = rollback.errors.length ? ` Rollback errors: ${rollback.errors.join('; ')}` : '';
      throw new Error(`Client provisioning failed: ${this.message(error)}.${suffix}`);
    }
  }

  private requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is required for automatic provisioning`);
    return value;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private receiptMessage(error: unknown): string {
    if (error instanceof ProvisioningHttpError) {
      return `${error.provider} request failed (${error.status})`;
    }
    return this.message(error)
      .replace(/(?:ghp_|github_pat_|sk-|pplx-)[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[^\s]+/g, '[REDACTED_DEPLOY_HOOK]');
  }

  private writeReceipt(receipt: ProvisioningReceipt): void {
    const path = resolve(this.receiptRoot, `${receipt.clientId}.provisioning-receipt.json`);
    const temporary = `${path}.${process.pid}.tmp`;
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8');
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
