// L9_META: layer=provisioning, role=request_normalizer, status=active, version=1.0.0
import type { ProvisioningRequest, ProvisioningSpec, RepositoryVisibility, VercelEnvironmentTarget, VercelEnvironmentType } from './types.js';

export interface ProvisionableDomainSpec {
  client_id: string;
  business_name: string;
  provision?: ProvisioningSpec;
}
import { assertEnvRef } from './secret-ref.js';

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}$/;
const BRANCH = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,255}$/;
const ENV_KEY = /^[A-Z][A-Z0-9_]*$/;

export function slugifyProvisioningName(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!slug) throw new Error('client_id cannot be normalized into a provisioning name');
  return slug;
}

function visibility(value: unknown): RepositoryVisibility {
  return value === 'public' ? 'public' : 'private';
}

function envType(value: unknown): VercelEnvironmentType {
  return value === 'plain' || value === 'sensitive' ? value : 'encrypted';
}

function envTargets(value: unknown): VercelEnvironmentTarget[] {
  const allowed = new Set<VercelEnvironmentTarget>(['production', 'preview', 'development']);
  if (!Array.isArray(value) || value.length === 0) return ['production', 'preview'];
  const targets = value.filter((item): item is VercelEnvironmentTarget => typeof item === 'string' && allowed.has(item as VercelEnvironmentTarget));
  if (targets.length !== value.length || new Set(targets).size !== targets.length) throw new Error('provision.vercel.environment.targets contains invalid or duplicate values');
  return targets;
}

export function buildProvisioningRequest(
  domainSpec: ProvisionableDomainSpec,
  specPath: string,
  options: { planOnly: boolean; persistDeployBlock?: boolean; rollbackCreatedResources?: boolean },
): ProvisioningRequest {
  const provision = domainSpec.provision as ProvisioningSpec | undefined;
  if (!provision) throw new Error('DomainSpec.provision is required when automatic provisioning is requested');
  if (provision.enabled === false) throw new Error('DomainSpec.provision.enabled is false');

  const normalized = slugifyProvisioningName(domainSpec.client_id);
  const owner = provision.github?.owner?.trim();
  if (!owner || !OWNER.test(owner)) throw new Error('provision.github.owner is invalid');
  const repository = (provision.github.repository?.trim() || `${normalized}-site`).slice(0, 100);
  if (!REPOSITORY.test(repository)) throw new Error('provision.github.repository is invalid');
  const sourceBranch = provision.github.source_branch?.trim() || 'main';
  if (!BRANCH.test(sourceBranch)) throw new Error('provision.github.source_branch is invalid');
  const project = (provision.vercel?.project?.trim() || repository).slice(0, 100);
  if (!REPOSITORY.test(project)) throw new Error('provision.vercel.project is invalid');

  const publishCredentialRef = provision.github.publish_credential_ref?.trim() || 'env://GITHUB_SITE_TOKEN';
  assertEnvRef(publishCredentialRef, 'provision.github.publish_credential_ref');
  const githubCredentialRef = provision.maintenance?.github_credential_ref?.trim() || 'env://SEO_BOT_SITE_GITHUB_TOKEN';
  assertEnvRef(githubCredentialRef, 'provision.maintenance.github_credential_ref');
  const vercelDeployHookRef = provision.maintenance?.vercel_deploy_hook_ref?.trim();
  if (vercelDeployHookRef) assertEnvRef(vercelDeployHookRef, 'provision.maintenance.vercel_deploy_hook_ref');

  const environment = (provision.vercel.environment ?? []).map((item, index) => {
    if (!ENV_KEY.test(item.key)) throw new Error(`provision.vercel.environment[${index}].key is invalid`);
    assertEnvRef(item.value_ref, `provision.vercel.environment[${index}].value_ref`);
    return {
      key: item.key,
      valueRef: item.value_ref,
      type: envType(item.type),
      targets: envTargets(item.targets),
      ...(item.comment?.trim() ? { comment: item.comment.trim() } : {}),
    };
  });
  if (new Set(environment.map(item => item.key)).size !== environment.length) throw new Error('provision.vercel.environment contains duplicate keys');

  return {
    clientId: domainSpec.client_id,
    businessName: domainSpec.business_name,
    specPath,
    planOnly: options.planOnly,
    persistDeployBlock: options.persistDeployBlock ?? provision.persist_deploy_block ?? true,
    rollbackCreatedResources: options.rollbackCreatedResources ?? provision.rollback_created_resources ?? true,
    github: {
      owner,
      repository,
      visibility: visibility(provision.github.visibility),
      description: provision.github.description?.trim() || `Generated Astro website for ${domainSpec.business_name}`,
      sourceBranch,
      publishCredentialRef,
    },
    vercel: {
      project,
      ...(provision.vercel.team_id?.trim() ? { teamId: provision.vercel.team_id.trim() } : {}),
      environment,
    },
    maintenance: {
      githubCredentialRef,
      ...(vercelDeployHookRef ? { vercelDeployHookRef } : {}),
    },
  };
}
