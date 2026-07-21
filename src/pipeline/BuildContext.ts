// L9_META: layer=pipeline, role=context_carrier, status=active, version=2.0.0
import type { WebsiteFactoryLLM } from '../services/llm.js';
import type { EvidenceGateStatus } from './evidence/ReleaseReceipt.js';

/**
 * Execution modes for the release pipeline. Additive: today's single full run maps
 * to `end-to-end`; the lighter modes gate which stages run and whether provider
 * mutations occur. (Wired into the runner in a later change; declared here so the
 * evidence subsystem can reference it.)
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
}

export interface BuildContext {
  buildId: string;
  clientId: string;
  domainSpec: DomainSpec;
  dryRun: boolean;
  autoRegisterSeoBot: boolean;
  llm: WebsiteFactoryLLM;
  deploymentUrl?: string;
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
