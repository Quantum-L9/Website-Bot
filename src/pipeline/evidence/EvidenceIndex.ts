// L9_META: layer=pipeline, role=evidence_index_contract, status=active, version=1.1.0
import type { ExecutionMode } from '../BuildContext.js';
import type { EvidenceKind, EvidenceRecord } from './EvidenceReference.js';

export type EvidenceChainStatus =
  | 'empty'
  | 'assembling'
  | 'built'
  | 'published'
  | 'deployed'
  | 'released'
  | 'handed_off'
  | 'failed';

export interface EvidenceIndex {
  schema: 'website-bot.evidence-index/v1';
  build_id: string;
  client_id: string;
  mode: ExecutionMode;
  revision: number;
  artifacts: Partial<Record<EvidenceKind, EvidenceRecord>>;
  chain_status: EvidenceChainStatus;
  last_successful_stage?: string;
  failed_stage?: string;
  created_at: string;
  updated_at: string;
}

const VALID_MODES: ExecutionMode[] = ['plan', 'local-proof', 'publish-proof', 'end-to-end'];
const VALID_STATUSES: EvidenceChainStatus[] = [
  'empty', 'assembling', 'built', 'published', 'deployed', 'released', 'handed_off', 'failed',
];
const SHA256 = /^[a-f0-9]{64}$/;

export function validateEvidenceIndex(value: unknown): asserts value is EvidenceIndex {
  if (!value || typeof value !== 'object') throw new Error('evidence index must be an object');
  const index = value as Partial<EvidenceIndex>;
  if (index.schema !== 'website-bot.evidence-index/v1') throw new Error('unsupported evidence index schema');
  if (!index.build_id || !index.client_id || !VALID_MODES.includes(index.mode as ExecutionMode)) {
    throw new Error('evidence index identity is incomplete');
  }
  if (!Number.isInteger(index.revision) || Number(index.revision) < 1) throw new Error('evidence index revision is invalid');
  if (!VALID_STATUSES.includes(index.chain_status as EvidenceChainStatus)) throw new Error('evidence index chain status is invalid');
  if (!index.artifacts || typeof index.artifacts !== 'object' || Array.isArray(index.artifacts)) {
    throw new Error('evidence index artifacts are missing');
  }
  for (const [kind, record] of Object.entries(index.artifacts)) {
    if (!record) continue;
    if (record.kind !== kind || !record.schema || !record.logicalId || !record.relativePath) {
      throw new Error(`evidence index record is invalid for ${kind}`);
    }
    if (!SHA256.test(record.sha256)) throw new Error(`evidence index digest is invalid for ${kind}`);
  }
  if (!index.created_at || Number.isNaN(Date.parse(index.created_at))) throw new Error('evidence index created_at is invalid');
  if (!index.updated_at || Number.isNaN(Date.parse(index.updated_at))) throw new Error('evidence index updated_at is invalid');
}
