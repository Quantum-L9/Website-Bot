// L9_META: layer=provisioning, role=github_repository_provisioner, status=active, version=1.0.0
import type { FetchLike } from './http.js';
import { ProvisioningHttpError, requestJson } from './http.js';
import type { GitHubProvisioningResult, ProvisioningRequest } from './types.js';

const API = 'https://api.github.com';

export class GitHubProvisioningError extends Error {
  constructor(message: string, public readonly result?: GitHubProvisioningResult, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GitHubProvisioningError';
  }
}

interface GitHubRepository {
  id: number | string;
  full_name: string;
  html_url: string;
  default_branch: string;
  archived?: boolean;
}

interface GitHubIdentity { login: string; type: 'User' | 'Organization'; }
interface GitRef { object?: { sha?: string }; }
interface GitObject { sha?: string; }

export class GitHubProvisioner {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async provision(request: ProvisioningRequest, token: string): Promise<GitHubProvisioningResult> {
    const fullName = `${request.github.owner}/${request.github.repository}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
    let repository = await this.getRepository(fullName, headers);
    let created = false;

    if (!repository) {
      if (request.planOnly) {
        return {
          provider: 'github',
          created: false,
          repositoryId: 'planned',
          fullName,
          sourceBranch: request.github.sourceBranch,
          htmlUrl: `https://github.com/${fullName}`,
        };
      }
      const owner = await requestJson<GitHubIdentity>(this.fetchImpl, 'github', `${API}/users/${encodeURIComponent(request.github.owner)}`, { headers }, [200]);
      const body = {
        name: request.github.repository,
        description: request.github.description,
        visibility: request.github.visibility,
        private: request.github.visibility === 'private',
        auto_init: true,
        has_issues: true,
        has_projects: false,
        has_wiki: false,
        allow_squash_merge: true,
        allow_merge_commit: false,
        allow_rebase_merge: true,
        delete_branch_on_merge: true,
      };
      const url = owner.body.type === 'Organization'
        ? `${API}/orgs/${encodeURIComponent(request.github.owner)}/repos`
        : `${API}/user/repos`;
      if (owner.body.type === 'User') {
        const authenticated = await requestJson<GitHubIdentity>(this.fetchImpl, 'github', `${API}/user`, { headers }, [200]);
        if (authenticated.body.login.toLowerCase() !== request.github.owner.toLowerCase()) {
          throw new Error(`Cannot create a repository under user ${request.github.owner} while authenticated as ${authenticated.body.login}`);
        }
      }
      repository = (await requestJson<GitHubRepository>(this.fetchImpl, 'github', url, {
        method: 'POST', headers, body: JSON.stringify(body),
      }, [201])).body;
      created = true;
    }

    const result: GitHubProvisioningResult = {
      provider: 'github',
      created,
      repositoryId: String(repository.id),
      fullName: repository.full_name,
      sourceBranch: request.github.sourceBranch,
      htmlUrl: repository.html_url,
    };
    try {
      if (repository.archived) throw new Error(`GitHub repository ${fullName} is archived`);
      if (repository.full_name.toLowerCase() !== fullName.toLowerCase()) throw new Error(`GitHub repository identity mismatch: expected ${fullName}, observed ${repository.full_name}`);
      await this.ensureBranch(repository, request.github.sourceBranch, headers, request.planOnly);
      return result;
    } catch (error) {
      throw new GitHubProvisioningError(error instanceof Error ? error.message : String(error), result, { cause: error });
    }
  }

  async verifyAccess(fullName: string, token: string, label: string): Promise<void> {
    await requestJson<GitHubRepository>(this.fetchImpl, 'github', `${API}/repos/${fullName}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, [200]).catch(error => {
      throw new Error(`${label} cannot access ${fullName}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async remove(result: GitHubProvisioningResult, token: string): Promise<void> {
    if (!result.created) return;
    const response = await this.fetchImpl(`${API}/repos/${result.fullName}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (response.status !== 204 && response.status !== 404) {
      throw new ProvisioningHttpError('github', response.status, `Failed to rollback GitHub repository ${result.fullName}`, await response.text());
    }
  }

  private async getRepository(fullName: string, headers: Record<string, string>): Promise<GitHubRepository | undefined> {
    try {
      return (await requestJson<GitHubRepository>(this.fetchImpl, 'github', `${API}/repos/${fullName}`, { headers }, [200])).body;
    } catch (error) {
      if (error instanceof ProvisioningHttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  private async ensureBranch(repository: GitHubRepository, branch: string, headers: Record<string, string>, planOnly: boolean): Promise<void> {
    const encoded = branch.split('/').map(encodeURIComponent).join('/');
    try {
      await requestJson<GitRef>(this.fetchImpl, 'github', `${API}/repos/${repository.full_name}/git/ref/heads/${encoded}`, { headers }, [200]);
      return;
    } catch (error) {
      if (!(error instanceof ProvisioningHttpError) || error.status !== 404) throw error;
    }
    if (planOnly) return;

    const defaultEncoded = repository.default_branch.split('/').map(encodeURIComponent).join('/');
    let baseSha: string | undefined;
    try {
      baseSha = (await requestJson<GitRef>(this.fetchImpl, 'github', `${API}/repos/${repository.full_name}/git/ref/heads/${defaultEncoded}`, { headers }, [200])).body.object?.sha;
    } catch (error) {
      if (!(error instanceof ProvisioningHttpError) || (error.status !== 404 && error.status !== 409)) throw error;
    }

    if (!baseSha) baseSha = await this.seedEmptyRepository(repository.full_name, branch, headers);
    else {
      await requestJson<GitObject>(this.fetchImpl, 'github', `${API}/repos/${repository.full_name}/git/refs`, {
        method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
      }, [201]);
    }

    if (repository.default_branch !== branch) {
      await requestJson<GitHubRepository>(this.fetchImpl, 'github', `${API}/repos/${repository.full_name}`, {
        method: 'PATCH', headers, body: JSON.stringify({ default_branch: branch }),
      }, [200]);
    }
  }

  private async seedEmptyRepository(fullName: string, branch: string, headers: Record<string, string>): Promise<string> {
    const blob = (await requestJson<GitObject>(this.fetchImpl, 'github', `${API}/repos/${fullName}/git/blobs`, {
      method: 'POST', headers, body: JSON.stringify({ content: '# Provisioned client site\n', encoding: 'utf-8' }),
    }, [201])).body.sha;
    if (!blob) throw new Error(`GitHub did not return a seed blob SHA for ${fullName}`);
    const tree = (await requestJson<GitObject>(this.fetchImpl, 'github', `${API}/repos/${fullName}/git/trees`, {
      method: 'POST', headers, body: JSON.stringify({ tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob }] }),
    }, [201])).body.sha;
    if (!tree) throw new Error(`GitHub did not return a seed tree SHA for ${fullName}`);
    const commit = (await requestJson<GitObject>(this.fetchImpl, 'github', `${API}/repos/${fullName}/git/commits`, {
      method: 'POST', headers, body: JSON.stringify({ message: 'chore: initialize provisioned client site', tree, parents: [] }),
    }, [201])).body.sha;
    if (!commit) throw new Error(`GitHub did not return a seed commit SHA for ${fullName}`);
    await requestJson<GitObject>(this.fetchImpl, 'github', `${API}/repos/${fullName}/git/refs`, {
      method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit }),
    }, [201]);
    return commit;
  }
}
