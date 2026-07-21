// L9_META: layer=pipeline, role=deployment_evidence_contract, status=active, version=2.1.0
export interface DeploymentEvidence {
  schema: 'website-bot.deployment-evidence/v1';
  deploymentEvidenceId: string;
  buildId: string;
  clientId: string;
  publicationId: string;
  publicationSha256: string;
  provider: 'vercel';
  projectId: string;
  deploymentId: string;
  requestedCommitSha: string;
  observedCommitSha: string;
  state: 'READY';
  deploymentUrl: string;
  aliases: string[];
  sourceRepository: string;
  sourceBranch: string;
  triggerMode: 'api' | 'deploy_hook';
  target: 'preview' | 'production';
  createdAt?: string;
  readyAt: string;
  status: 'passed';
}

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function validateDeploymentEvidence(value: unknown): asserts value is DeploymentEvidence {
  if (!value || typeof value !== 'object') throw new Error('deployment evidence must be an object');
  const evidence = value as Partial<DeploymentEvidence>;
  if (evidence.schema !== 'website-bot.deployment-evidence/v1' || evidence.status !== 'passed' || evidence.provider !== 'vercel' || evidence.state !== 'READY') {
    throw new Error('deployment identity or status is invalid');
  }
  if (!evidence.deploymentEvidenceId || !evidence.buildId || !evidence.clientId || !evidence.publicationId || !evidence.projectId || !evidence.deploymentId) {
    throw new Error('deployment identity is incomplete');
  }
  if (!SHA256.test(String(evidence.publicationSha256))) throw new Error('deployment publication digest is invalid');
  if (!SHA1.test(String(evidence.requestedCommitSha)) || !SHA1.test(String(evidence.observedCommitSha))) {
    throw new Error('deployment commit identity is invalid');
  }
  if (evidence.requestedCommitSha !== evidence.observedCommitSha) throw new Error('deployment commit correlation failed');
  if (!REPOSITORY.test(String(evidence.sourceRepository)) || !evidence.sourceBranch) throw new Error('deployment source identity is invalid');
  if (!['api', 'deploy_hook'].includes(String(evidence.triggerMode)) || !['preview', 'production'].includes(String(evidence.target))) {
    throw new Error('deployment trigger or target is invalid');
  }
  try {
    const url = new URL(String(evidence.deploymentUrl));
    if (url.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('deploymentUrl must be HTTPS');
  }
  if (!Array.isArray(evidence.aliases) || evidence.aliases.some(alias => typeof alias !== 'string')) throw new Error('deployment aliases are invalid');
  if (!evidence.readyAt || Number.isNaN(Date.parse(evidence.readyAt))) throw new Error('deployment readyAt is invalid');
}
