// L9_META: layer=stage, role=client_auto_provisioning, stage_index=2, status=active, version=1.0.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { ProvisioningCoordinator } from '../provisioning/ProvisioningCoordinator.js';
import { buildProvisioningRequest } from '../provisioning/request.js';

const logger = createModuleLogger('stage:provision-client');

export class ProvisionClientStage implements Stage {
  name = 'provision-client';

  constructor(
    private readonly specPath: string,
    private readonly options: { persistDeployBlock?: boolean; rollbackCreatedResources?: boolean } = {},
    private readonly coordinator = new ProvisioningCoordinator(),
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    try {
      const request = buildProvisioningRequest(ctx.domainSpec, this.specPath, {
        planOnly: ctx.dryRun,
        persistDeployBlock: this.options.persistDeployBlock,
        rollbackCreatedResources: this.options.rollbackCreatedResources,
      });
      const receipt = await this.coordinator.provision(request);
      ctx.provisioningReceipt = receipt;
      if (!receipt.github || !receipt.vercel) throw new Error('Provisioning receipt is missing GitHub or Vercel target');
      ctx.domainSpec.deploy = {
        github_repo: receipt.github.fullName,
        github_repo_id: receipt.github.repositoryId,
        source_branch: receipt.github.sourceBranch,
        publish_credential_ref: request.github.publishCredentialRef,
        vercel_project_id: receipt.vercel.projectId,
        seo_bot_github_credential_ref: request.maintenance.githubCredentialRef,
        ...(request.maintenance.vercelDeployHookRef ? { seo_bot_vercel_deploy_hook_ref: request.maintenance.vercelDeployHookRef } : {}),
      };
      ctx.deployTarget = {
        githubRepo: receipt.github.fullName,
        githubRepoId: receipt.github.repositoryId,
        sourceBranch: receipt.github.sourceBranch,
        publishCredentialRef: request.github.publishCredentialRef,
        vercelProjectId: receipt.vercel.projectId,
        seoBotGithubCredentialRef: request.maintenance.githubCredentialRef,
        ...(request.maintenance.vercelDeployHookRef ? { seoBotVercelDeployHookRef: request.maintenance.vercelDeployHookRef } : {}),
      };
      logger.info({ clientId: ctx.clientId, repository: receipt.github.fullName, project: receipt.vercel.projectId, status: receipt.status }, 'Client provisioning converged');
    } catch (error) {
      throw new BuildError('PROVISIONING_FAILED', error instanceof Error ? error.message : String(error), false);
    }
  }
}
