// L9_META: layer=pipeline, role=context_carrier, status=active, version=3.0.0
import type { WebsiteFactoryLLM } from '../services/llm.js';
import type { AssemblyManifest } from './evidence/AssemblyManifest.js';
import type { BuildProof } from './evidence/BuildProof.js';
import type { DeploymentEvidence } from './evidence/DeploymentEvidence.js';
import type { PublicationEvidence } from './evidence/PublicationEvidence.js';
import type { EvidenceGateStatus, ReleaseReceipt } from './evidence/ReleaseReceipt.js';
import type { EvidenceStore } from './evidence/EvidenceStore.js';
import type { EvidenceIndex } from './evidence/EvidenceIndex.js';
import type { ProvisioningReceipt, ProvisioningSpec } from '../provisioning/types.js';

/**
 * Execution modes. Additive: today's single full run maps to `end-to-end`; the
 * lighter modes gate which stages run and whether provider mutations occur.
 */
export type ExecutionMode = 'plan' | 'local-proof' | 'publish-proof' | 'end-to-end';

/** Resolved deploy target for a build (GitHub client repo + Vercel project). */
export interface DeployTarget {
  githubRepo: string;
  githubRepoId?: string;
  sourceBranch: string;
  publishCredentialRef?: string;
  vercelProjectId?: string;
  vercelDeployHook?: string;
  seoBotGithubCredentialRef?: string;
  seoBotVercelDeployHookRef?: string;
}

/** Quality-gate summary carried through the release receipt / handoff. */
export interface QualityEvidence {
  seoBaseline: EvidenceGateStatus;
  visualQa: EvidenceGateStatus;
}

export interface DomainSpec {
  client_id: string;
  business_name: string;
  vertical: string;
  geography: { states: string[]; primary_state: string };
  design: { status: 'resolved' | 'pending'; palette?: Record<string, string>; fonts?: Record<string, string> };
  routes: Array<{ slug: string; title: string; components: string[]; noindex?: boolean }>;
  seo_contract?: Record<string, unknown>;
  wom_flags?: Array<{ key: string; value: string; severity: 'error' | 'warning' | 'info' }>;
  deploy?: {
    github_repo: string;
    github_repo_id?: string;
    source_branch?: string;
    publish_credential_ref?: string;
    vercel_project_id?: string;
    vercel_deploy_hook?: string;
    seo_bot_github_credential_ref?: string;
    seo_bot_vercel_deploy_hook_ref?: string;
  };
  provision?: ProvisioningSpec;
}

export interface SiteConfig {
  businessName: string;
  siteUrl: string;
  vertical: string;
  clientId: string;
  namespace: string;
  geography: { primaryState: string; states: string[] };
  nav: Array<{ href: string; label: string }>;
  schemas: { siteWide: object[]; perRoute: Record<string, object[]> };
  designTokens: Record<string, string>;
  leadFormAction?: string;
}

export interface BuildContext {
  buildId: string;
  clientId: string;
  domainSpec: DomainSpec;
  dryRun: boolean;
  mode: ExecutionMode;
  autoRegisterSeoBot: boolean;
  llm: WebsiteFactoryLLM;
  outputDir: string;
  designTokens?: Record<string, string>;
  siteConfig?: SiteConfig;
  /** In-memory evidence fields are caches only. EvidenceStore is authoritative. */
  assemblyManifest?: AssemblyManifest;
  buildProof?: BuildProof;
  publicationEvidence?: PublicationEvidence;
  deploymentEvidence?: DeploymentEvidence;
  releaseReceipt?: ReleaseReceipt;
  releaseReceiptPath?: string;
  provisioningReceipt?: ProvisioningReceipt;
  evidenceStore: EvidenceStore;
  evidenceIndex: EvidenceIndex;
  resume: boolean;
  qualityEvidence: QualityEvidence;
  distDir?: string;
  deployTarget?: DeployTarget;
  deploymentUrl?: string;
  sourceCommitSha?: string;
  generatedContent: Map<string, string>;
  generatedSchemas: Map<string, object>;
  baselineRanks?: Record<string, number | null>;
  visualQaPassed: boolean;
  stageResults: Map<string, { ok: boolean; skipped?: boolean; error?: string }>;
  startedAt: Date;
}

export function makeBuildId(clientId: string): string {
  return `${clientId}-${Date.now()}`;
}
