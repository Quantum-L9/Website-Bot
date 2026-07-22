// L9_META: layer=provisioning, role=vercel_project_provisioner, status=active, version=1.0.0
import type { FetchLike } from './http.js';
import { ProvisioningHttpError, requestJson } from './http.js';
import { resolveEnvRef } from './secret-ref.js';
import type { GitHubProvisioningResult, ProvisioningRequest, VercelProvisioningResult } from './types.js';

const API = 'https://api.vercel.com';

export class VercelProvisioningError extends Error {
  constructor(message: string, public readonly result?: VercelProvisioningResult, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VercelProvisioningError';
  }
}

interface VercelProject {
  id: string;
  name: string;
  accountId?: string;
  link?: {
    type?: string;
    org?: string;
    repo?: string;
    repoId?: number | string;
    productionBranch?: string;
    deployHooks?: Array<{ id?: string; name?: string; ref?: string; url?: string }>;
  };
}

export class VercelProvisioner {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async provision(
    request: ProvisioningRequest,
    repository: GitHubProvisioningResult,
    token: string,
  ): Promise<VercelProvisioningResult> {
    const query = request.vercel.teamId ? `?teamId=${encodeURIComponent(request.vercel.teamId)}` : '';
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    let project = await this.getProject(request.vercel.project, query, headers);
    let created = false;

    if (!project) {
      if (request.planOnly) {
        return {
          provider: 'vercel',
          created: false,
          projectId: 'planned',
          projectName: request.vercel.project,
          ...(request.vercel.teamId ? { teamId: request.vercel.teamId } : {}),
          linkedRepository: repository.fullName,
          productionBranch: repository.sourceBranch,
          environmentKeys: request.vercel.environment.map(item => item.key).sort(),
          deploymentTrigger: 'git-push',
        };
      }
      project = (await requestJson<VercelProject>(this.fetchImpl, 'vercel', `${API}/v11/projects${query}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: request.vercel.project,
          framework: 'astro',
          gitRepository: { type: 'github', repo: repository.fullName },
          installCommand: 'npm ci',
          buildCommand: 'npm run build',
          outputDirectory: 'dist',
          rootDirectory: null,
          skipGitConnectDuringLink: false,
        }),
      }, [200, 201])).body;
      created = true;
    }

    const result: VercelProvisioningResult = {
      provider: 'vercel',
      created,
      projectId: project.id,
      projectName: project.name,
      ...(request.vercel.teamId ? { teamId: request.vercel.teamId } : {}),
      linkedRepository: repository.fullName,
      productionBranch: repository.sourceBranch,
      environmentKeys: request.vercel.environment.map(item => item.key).sort(),
      deploymentTrigger: 'git-push',
    };
    try {
      this.assertProjectIdentity(project, request, repository);
      if (!request.planOnly) {
        await this.upsertEnvironment(project.id, request, token);
        this.assertDeployHookReference(project, request);
      }
      return result;
    } catch (error) {
      throw new VercelProvisioningError(error instanceof Error ? error.message : String(error), result, { cause: error });
    }
  }

  async remove(result: VercelProvisioningResult, token: string): Promise<void> {
    if (!result.created) return;
    const query = result.teamId ? `?teamId=${encodeURIComponent(result.teamId)}` : '';
    const response = await this.fetchImpl(`${API}/v9/projects/${encodeURIComponent(result.projectId)}${query}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status !== 204 && response.status !== 404) {
      throw new ProvisioningHttpError('vercel', response.status, `Failed to rollback Vercel project ${result.projectId}`, await response.text());
    }
  }

  private async getProject(name: string, query: string, headers: Record<string, string>): Promise<VercelProject | undefined> {
    try {
      return (await requestJson<VercelProject>(this.fetchImpl, 'vercel', `${API}/v9/projects/${encodeURIComponent(name)}${query}`, { headers }, [200])).body;
    } catch (error) {
      if (error instanceof ProvisioningHttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  private assertProjectIdentity(project: VercelProject, request: ProvisioningRequest, repository: GitHubProvisioningResult): void {
    if (!project.id || !project.name) throw new Error('Vercel project response is missing id or name');
    if (project.name !== request.vercel.project) throw new Error(`Vercel project collision: expected ${request.vercel.project}, observed ${project.name}`);
    if (!project.link || project.link.type !== 'github') {
      throw new Error(`Vercel project ${project.name} is not linked to a GitHub repository`);
    }
    const observedRepo = project.link.repo
      ? (project.link.repo.includes('/') ? project.link.repo : `${project.link.org ?? request.github.owner}/${project.link.repo}`)
      : undefined;
    if (!observedRepo) {
      throw new Error(`Vercel project ${project.name} did not report its linked GitHub repository`);
    }
    if (observedRepo.toLowerCase() !== repository.fullName.toLowerCase()) {
      throw new Error(`Vercel project ${project.name} is linked to ${observedRepo}, not ${repository.fullName}`);
    }
    if (project.link?.repoId !== undefined && String(project.link.repoId) !== repository.repositoryId) {
      throw new Error(`Vercel project ${project.name} repository id mismatch`);
    }
    if (project.link?.productionBranch && project.link.productionBranch !== repository.sourceBranch) {
      throw new Error(`Vercel production branch is ${project.link.productionBranch}, expected ${repository.sourceBranch}`);
    }
  }

  private async upsertEnvironment(projectId: string, request: ProvisioningRequest, token: string): Promise<void> {
    if (request.vercel.environment.length === 0) return;
    const query = new URLSearchParams({ upsert: 'true' });
    if (request.vercel.teamId) query.set('teamId', request.vercel.teamId);
    const values = request.vercel.environment.map(item => ({
      key: item.key,
      value: resolveEnvRef(item.valueRef, `provision.vercel.environment.${item.key}`),
      type: item.type,
      target: item.targets,
      ...(item.comment ? { comment: item.comment } : {}),
    }));
    const response = await requestJson<{ failed?: Array<{ error?: { message?: string; key?: string } }> }>(
      this.fetchImpl,
      'vercel',
      `${API}/v10/projects/${encodeURIComponent(projectId)}/env?${query.toString()}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      },
      [200, 201],
    );
    if ((response.body.failed ?? []).length > 0) {
      const details = response.body.failed?.map(item => `${item.error?.key ?? 'UNKNOWN'}: ${item.error?.message ?? 'failed'}`).join('; ');
      throw new Error(`Vercel environment upsert was partial: ${details}`);
    }
  }

  private assertDeployHookReference(project: VercelProject, request: ProvisioningRequest): void {
    const ref = request.maintenance.vercelDeployHookRef;
    if (!ref) return;
    const expectedUrl = resolveEnvRef(ref, 'provision.maintenance.vercel_deploy_hook_ref');
    const matching = project.link?.deployHooks?.some(hook => hook.url === expectedUrl && (!hook.ref || hook.ref === request.github.sourceBranch));
    if (!matching) {
      throw new Error(`The Vercel deploy hook referenced by ${ref} is not registered for ${project.name}@${request.github.sourceBranch}`);
    }
  }
}
