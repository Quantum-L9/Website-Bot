// L9_META: layer=provisioning, role=contracts, status=active, version=1.0.0

export type RepositoryVisibility = 'private' | 'public';
export type VercelEnvironmentTarget = 'production' | 'preview' | 'development';
export type VercelEnvironmentType = 'plain' | 'encrypted' | 'sensitive';

export interface ProvisioningSpec {
  enabled?: boolean;
  github: {
    owner: string;
    repository?: string;
    visibility?: RepositoryVisibility;
    description?: string;
    source_branch?: string;
    publish_credential_ref?: string;
  };
  vercel: {
    project?: string;
    team_id?: string;
    environment?: Array<{
      key: string;
      value_ref: string;
      type?: VercelEnvironmentType;
      targets?: VercelEnvironmentTarget[];
      comment?: string;
    }>;
  };
  maintenance?: {
    github_credential_ref?: string;
    vercel_deploy_hook_ref?: string;
  };
  persist_deploy_block?: boolean;
  rollback_created_resources?: boolean;
}

export interface ProvisioningRequest {
  clientId: string;
  businessName: string;
  specPath: string;
  planOnly: boolean;
  persistDeployBlock: boolean;
  rollbackCreatedResources: boolean;
  github: {
    owner: string;
    repository: string;
    visibility: RepositoryVisibility;
    description: string;
    sourceBranch: string;
    publishCredentialRef: string;
  };
  vercel: {
    project: string;
    teamId?: string;
    environment: Array<{
      key: string;
      valueRef: string;
      type: VercelEnvironmentType;
      targets: VercelEnvironmentTarget[];
      comment?: string;
    }>;
  };
  maintenance: {
    githubCredentialRef: string;
    vercelDeployHookRef?: string;
  };
}

export interface GitHubProvisioningResult {
  provider: 'github';
  created: boolean;
  repositoryId: string;
  fullName: string;
  sourceBranch: string;
  htmlUrl: string;
}

export interface VercelProvisioningResult {
  provider: 'vercel';
  created: boolean;
  projectId: string;
  projectName: string;
  teamId?: string;
  linkedRepository: string;
  productionBranch: string;
  environmentKeys: string[];
  deploymentTrigger: 'git-push';
}

export interface ProvisioningReceipt {
  schema: 'website-bot.provisioning-receipt/v1';
  status: 'planned' | 'succeeded' | 'rolled_back' | 'failed';
  clientId: string;
  idempotencyKey: string;
  github?: GitHubProvisioningResult;
  vercel?: VercelProvisioningResult;
  spec: {
    path: string;
    persisted: boolean;
    backupPath?: string;
  };
  maintenance: {
    githubCredentialRef: string;
    vercelDeployHookRef?: string;
  };
  errors: string[];
  rollback: {
    attempted: boolean;
    completed: boolean;
    actions: string[];
    errors: string[];
  };
  createdAt: string;
}
