// L9_META: layer=contract, role=website_factory_handoff_v3, status=active, version=3.2.0
import { createHash } from 'node:crypto';
import type { DeployTarget, DomainSpec, QualityEvidence } from '../pipeline/BuildContext.js';
import type { ValidatedReleaseBundle } from '../pipeline/evidence/ValidatedReleaseBundle.js';

export const WEBSITE_FACTORY_HANDOFF_PROTOCOL = 'l9.website-factory.handoff' as const;
export const WEBSITE_FACTORY_HANDOFF_VERSION = '3.0' as const;
export const DEFAULT_MANAGED_MANIFEST_PATH = '.l9/generated-manifest.json';
export const DEFAULT_REQUIRED_PATHS = [DEFAULT_MANAGED_MANIFEST_PATH, 'src/pages/index.astro'] as const;

export type KeywordPriority = 'critical' | 'high' | 'medium' | 'low';

export interface WebsiteFactoryHandoffV3 {
  protocol: typeof WEBSITE_FACTORY_HANDOFF_PROTOCOL;
  schema_version: typeof WEBSITE_FACTORY_HANDOFF_VERSION;
  contract_id: string;
  emitted_at: string;
  client: {
    id: string;
    domain: string;
    name: string;
    industry: string;
    city?: string;
    state?: string;
  };
  seo: {
    target_keywords: Array<{ keyword: string; priority: KeywordPriority }>;
    competitor_urls: string[];
  };
  site: {
    repository: {
      provider: 'github';
      full_name: string;
      repository_id?: string;
      branch: string;
      commit_sha: string;
      source_digest: string;
      managed_manifest_path: string;
      editable_root: 'src/pages';
      page_path_strategy: 'directory-index-astro';
    };
    deployment: {
      provider: 'vercel';
      project_id: string;
      deployment_id: string;
      deployment_url: string;
      state: 'READY';
      requested_commit_sha: string;
      observed_commit_sha: string;
    };
    maintenance: {
      enabled: true;
      transport: 'github-contents-api';
      github_credential_ref: string;
      vercel_deploy_hook_ref?: string;
      required_paths: string[];
    };
  };
  proof: {
    receipt_id: string;
    receipt_status: 'succeeded';
    source_digest: string;
    dist_digest: string;
    local_build_status: 'passed';
    publication_status: 'passed';
    deployment_status: 'passed';
  };
  integrity: {
    algorithm: 'sha256';
    payload_digest: string;
  };
}

export interface WebsiteFactoryHandoffBuildInput {
  domainSpec: DomainSpec;
  clientId: string;
  buildId: string;
  releaseBundle: ValidatedReleaseBundle;
  deployTarget: DeployTarget;
  qualitySummary: QualityEvidence;
  emittedAt?: string;
}

type ContractPayload = Omit<WebsiteFactoryHandoffV3, 'integrity'>;

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ENV_REFERENCE = /^env:\/\/[A-Z][A-Z0-9_]*$/;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function digestHandoffPayload(payload: ContractPayload): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function hostnameOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
}

function keywordPriority(value: unknown): KeywordPriority {
  return value === 'critical' || value === 'high' || value === 'low' ? value : 'medium';
}

function buildTargetKeywords(spec: DomainSpec): Array<{ keyword: string; priority: KeywordPriority }> {
  const raw = (spec.seo_contract as { target_keywords?: unknown } | undefined)?.target_keywords;
  if (Array.isArray(raw)) {
    const values = raw.flatMap((item): Array<{ keyword: string; priority: KeywordPriority }> => {
      if (typeof item === 'string' && item.trim()) return [{ keyword: item.trim(), priority: 'medium' }];
      if (!item || typeof item !== 'object') return [];
      const keyword = (item as { keyword?: unknown }).keyword;
      if (typeof keyword !== 'string' || !keyword.trim()) return [];
      return [{ keyword: keyword.trim(), priority: keywordPriority((item as { priority?: unknown }).priority) }];
    });
    if (values.length > 0) return values;
  }
  return spec.routes.map(route => ({
    keyword: `${route.title} ${spec.geography.primary_state}`.trim(),
    priority: 'medium',
  }));
}

function buildCompetitorUrls(spec: DomainSpec): string[] {
  const raw = (spec.seo_contract as { competitor_urls?: unknown } | undefined)?.competitor_urls;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): string[] => {
    if (typeof value !== 'string') return [];
    try { return [new URL(value).toString()]; } catch { return []; }
  });
}

function requiredString(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error(`${field} is required for the v3 handoff`);
  return value.trim();
}

export function buildWebsiteFactoryHandoffV3(input: WebsiteFactoryHandoffBuildInput): WebsiteFactoryHandoffV3 {
  const {
    domainSpec,
    clientId,
    buildId,
    releaseBundle,
    deployTarget,
    qualitySummary,
    emittedAt = new Date().toISOString(),
  } = input;
  const buildProof = releaseBundle.buildProof;
  const publication = releaseBundle.publicationEvidence;
  const deployment = releaseBundle.deploymentEvidence;
  const receipt = releaseBundle.releaseReceipt;

  if (!releaseBundle.validation.valid) throw new Error('v3 handoff requires a valid release evidence bundle');
  if (releaseBundle.index.mode !== 'end-to-end') throw new Error('v3 handoff requires end-to-end evidence mode');
  if (!buildProof || !publication || !deployment) throw new Error('v3 handoff requires build, publication, and deployment evidence');
  if (receipt.status !== 'succeeded' || receipt.missing_gates.length > 0) throw new Error('release receipt is not complete');
  if (qualitySummary.visualQa !== 'passed' || receipt.qa.visual_qa !== 'passed') throw new Error('v3 handoff requires passed visual QA');
  if (clientId !== releaseBundle.index.client_id || buildId !== releaseBundle.index.build_id) throw new Error('handoff identity differs from the release bundle');
  if (domainSpec.client_id !== clientId) throw new Error('DomainSpec client identity differs from the release bundle');

  const githubCredentialRef = deployTarget.seoBotGithubCredentialRef
    ?? process.env.SEO_BOT_SITE_GITHUB_CREDENTIAL_REF
    ?? 'env://SEO_BOT_SITE_GITHUB_TOKEN';
  const deployHookRef = deployTarget.seoBotVercelDeployHookRef ?? process.env.SEO_BOT_SITE_VERCEL_HOOK_REF;
  const deploymentUrl = requiredString(deployment.deploymentUrl, 'deployment.deploymentUrl');
  const vercelProjectId = requiredString(deployment.projectId, 'deployment.projectId');
  const city = (domainSpec.seo_contract as { city?: unknown } | undefined)?.city;

  const payload: ContractPayload = {
    protocol: WEBSITE_FACTORY_HANDOFF_PROTOCOL,
    schema_version: WEBSITE_FACTORY_HANDOFF_VERSION,
    contract_id: `${clientId}:${buildId}:${publication.commitSha}`,
    emitted_at: emittedAt,
    client: {
      id: clientId,
      domain: hostnameOf(deploymentUrl),
      name: domainSpec.business_name,
      industry: domainSpec.vertical,
      ...(typeof city === 'string' && city.trim() ? { city: city.trim() } : {}),
      ...(domainSpec.geography.primary_state.length === 2
        ? { state: domainSpec.geography.primary_state.toUpperCase() }
        : {}),
    },
    seo: {
      target_keywords: buildTargetKeywords(domainSpec),
      competitor_urls: buildCompetitorUrls(domainSpec),
    },
    site: {
      repository: {
        provider: 'github',
        full_name: publication.repository,
        ...(publication.repositoryId ? { repository_id: publication.repositoryId } : {}),
        branch: publication.branch,
        commit_sha: publication.commitSha,
        source_digest: publication.sourceDigest,
        managed_manifest_path: DEFAULT_MANAGED_MANIFEST_PATH,
        editable_root: 'src/pages',
        page_path_strategy: 'directory-index-astro',
      },
      deployment: {
        provider: 'vercel',
        project_id: vercelProjectId,
        deployment_id: deployment.deploymentId,
        deployment_url: deploymentUrl,
        state: 'READY',
        requested_commit_sha: deployment.requestedCommitSha,
        observed_commit_sha: deployment.observedCommitSha,
      },
      maintenance: {
        enabled: true,
        transport: 'github-contents-api',
        github_credential_ref: githubCredentialRef,
        ...(deployHookRef ? { vercel_deploy_hook_ref: deployHookRef } : {}),
        required_paths: [...DEFAULT_REQUIRED_PATHS],
      },
    },
    proof: {
      receipt_id: receipt.receipt_id,
      receipt_status: 'succeeded',
      source_digest: receipt.correlation.source_digest,
      dist_digest: requiredString(receipt.correlation.dist_digest, 'receipt.correlation.dist_digest'),
      local_build_status: 'passed',
      publication_status: 'passed',
      deployment_status: 'passed',
    },
  };

  const contract: WebsiteFactoryHandoffV3 = {
    ...payload,
    integrity: { algorithm: 'sha256', payload_digest: digestHandoffPayload(payload) },
  };
  assertWebsiteFactoryHandoffV3(contract);
  return contract;
}

export function assertWebsiteFactoryHandoffV3(contract: WebsiteFactoryHandoffV3): void {
  if (contract.protocol !== WEBSITE_FACTORY_HANDOFF_PROTOCOL || contract.schema_version !== WEBSITE_FACTORY_HANDOFF_VERSION) {
    throw new Error('unsupported handoff protocol or version');
  }
  if (!REPOSITORY.test(contract.site.repository.full_name)) throw new Error('site.repository.full_name must be owner/repo');
  if (!SHA1.test(contract.site.repository.commit_sha)) throw new Error('site.repository.commit_sha must be a lowercase 40-character SHA');
  if (!SHA256.test(contract.site.repository.source_digest) || !SHA256.test(contract.proof.source_digest) || !SHA256.test(contract.proof.dist_digest)) {
    throw new Error('handoff digests must be lowercase SHA-256 hex');
  }
  if (!ENV_REFERENCE.test(contract.site.maintenance.github_credential_ref)) throw new Error('github_credential_ref must be env://NAME');
  if (contract.site.maintenance.vercel_deploy_hook_ref && !ENV_REFERENCE.test(contract.site.maintenance.vercel_deploy_hook_ref)) {
    throw new Error('vercel_deploy_hook_ref must be env://NAME');
  }
  if (contract.site.repository.commit_sha !== contract.site.deployment.requested_commit_sha
      || contract.site.repository.commit_sha !== contract.site.deployment.observed_commit_sha) {
    throw new Error('publication and deployment commit identities do not match');
  }
  if (contract.site.repository.source_digest !== contract.proof.source_digest) throw new Error('repository and proof source digests do not match');
  if (contract.site.repository.managed_manifest_path !== DEFAULT_MANAGED_MANIFEST_PATH) throw new Error('managed_manifest_path must use the canonical generated manifest');
  const requiredPaths = new Set(contract.site.maintenance.required_paths);
  if (requiredPaths.size !== contract.site.maintenance.required_paths.length
      || !DEFAULT_REQUIRED_PATHS.every(path => requiredPaths.has(path))) {
    throw new Error('maintenance.required_paths must uniquely include the canonical manifest and Astro home page');
  }
  const { integrity: _integrity, ...payload } = contract;
  if (digestHandoffPayload(payload) !== contract.integrity.payload_digest) throw new Error('handoff payload digest mismatch');
}
