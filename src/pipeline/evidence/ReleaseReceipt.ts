// L9_META: layer=pipeline, role=release_receipt_contract, status=active, version=2.1.0
import type { ExecutionMode } from '../BuildContext.js';
import type { EvidenceReference } from './EvidenceReference.js';
import { validateEvidenceReference } from './EvidenceReference.js';

export type EvidenceGateStatus = 'pending' | 'passed' | 'failed' | 'skipped';
export type ReleaseReceiptStatus = 'planned' | 'partial' | 'succeeded' | 'failed';
export type ReleaseGate = 'assembly' | 'local_build' | 'github_publication' | 'vercel_deployment' | 'visual_qa';

export interface ReleaseReceipt {
  schema: 'website-bot.release-receipt/v2';
  receipt_id: string;
  build_id: string;
  client_id: string;
  mode: ExecutionMode;
  status: ReleaseReceiptStatus;
  missing_gates: ReleaseGate[];
  evidence: {
    assembly: EvidenceReference;
    build?: EvidenceReference;
    publication?: EvidenceReference;
    deployment?: EvidenceReference;
    failure?: EvidenceReference;
  };
  correlation: {
    source_digest: string;
    dist_digest?: string;
    commit_sha?: string;
    deployment_id?: string;
    all_required_identities_match: boolean;
  };
  qa: {
    seo_baseline: EvidenceGateStatus;
    visual_qa: EvidenceGateStatus;
  };
  created_at: string;
  finalized_at?: string;
}

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MODES: ExecutionMode[] = ['plan', 'local-proof', 'publish-proof', 'end-to-end'];
const STATUSES: ReleaseReceiptStatus[] = ['planned', 'partial', 'succeeded', 'failed'];
const GATES: ReleaseGate[] = ['assembly', 'local_build', 'github_publication', 'vercel_deployment', 'visual_qa'];

export function validateReleaseReceipt(value: unknown): asserts value is ReleaseReceipt {
  if (!value || typeof value !== 'object') throw new Error('release receipt must be an object');
  const receipt = value as Partial<ReleaseReceipt>;
  if (receipt.schema !== 'website-bot.release-receipt/v2' || !receipt.receipt_id || !receipt.build_id || !receipt.client_id) {
    throw new Error('release receipt identity is invalid');
  }
  if (!MODES.includes(receipt.mode as ExecutionMode) || !STATUSES.includes(receipt.status as ReleaseReceiptStatus)) {
    throw new Error('release receipt mode or status is invalid');
  }
  if (!Array.isArray(receipt.missing_gates) || receipt.missing_gates.some(gate => !GATES.includes(gate))) {
    throw new Error('release receipt missing_gates is invalid');
  }
  if (!receipt.evidence?.assembly) throw new Error('release receipt assembly reference is missing');
  for (const reference of Object.values(receipt.evidence)) if (reference) validateEvidenceReference(reference);
  if (!receipt.correlation || !SHA256.test(String(receipt.correlation.source_digest))) {
    throw new Error('release receipt source correlation is invalid');
  }
  if (receipt.correlation.dist_digest && !SHA256.test(receipt.correlation.dist_digest)) throw new Error('release receipt dist digest is invalid');
  if (receipt.correlation.commit_sha && !SHA1.test(receipt.correlation.commit_sha)) throw new Error('release receipt commit is invalid');
  if (!receipt.qa || !['pending', 'passed', 'failed', 'skipped'].includes(String(receipt.qa.seo_baseline)) || !['pending', 'passed', 'failed', 'skipped'].includes(String(receipt.qa.visual_qa))) {
    throw new Error('release receipt QA status is invalid');
  }
  if (!receipt.created_at || Number.isNaN(Date.parse(receipt.created_at))) throw new Error('release receipt created_at is invalid');
  if (receipt.finalized_at && Number.isNaN(Date.parse(receipt.finalized_at))) throw new Error('release receipt finalized_at is invalid');

  if (receipt.status === 'succeeded') {
    if (receipt.mode !== 'end-to-end' || receipt.missing_gates.length > 0) throw new Error('succeeded receipt requires end-to-end mode with no missing gates');
    if (!receipt.evidence.build || !receipt.evidence.publication || !receipt.evidence.deployment) {
      throw new Error('succeeded receipt requires build, publication, and deployment references');
    }
    if (!receipt.correlation.dist_digest || !receipt.correlation.commit_sha || !receipt.correlation.deployment_id || !receipt.correlation.all_required_identities_match) {
      throw new Error('succeeded receipt correlation is incomplete');
    }
    if (receipt.qa.visual_qa !== 'passed') throw new Error('succeeded receipt requires passed visual QA');
  }
  if (receipt.status === 'partial' && receipt.missing_gates.length === 0) throw new Error('partial receipt must name missing gates');
  if (receipt.status === 'planned' && receipt.mode !== 'plan') throw new Error('planned receipt requires plan mode');
  if (receipt.status === 'failed' && !receipt.evidence.failure) throw new Error('failed receipt requires failure evidence');
}
