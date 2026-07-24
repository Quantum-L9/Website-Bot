// L9_META: layer=pipeline, role=evidence_index_contract, status=active, version=2.0.0
import type { ExecutionMode } from '../BuildContext.js';
import type { EvidenceKind, EvidenceRecord } from './EvidenceReference.js';

export type EvidenceChainStatus = 'empty' | 'assembling' | 'built' | 'published' | 'deployed' | 'released' | 'handed_off' | 'failed';

export interface EvidenceIndex {
  schema: 'website-bot.evidence-index/v2';
  build_id: string;
  client_id: string;
  mode: ExecutionMode;
  revision: number;
  artifacts: Partial<Record<EvidenceKind, EvidenceRecord>>;
  /** Immutable history. Only artifacts.failure represents the active unresolved failure. */
  failure_history: EvidenceRecord[];
  chain_status: EvidenceChainStatus;
  last_successful_stage?: string;
  failed_stage?: string;
  created_at: string;
  updated_at: string;
}

const VALID_MODES: ExecutionMode[] = ['plan','local-proof','publish-proof','end-to-end'];
const VALID_STATUSES: EvidenceChainStatus[] = ['empty','assembling','built','published','deployed','released','handed_off','failed'];
const SHA256=/^[a-f0-9]{64}$/;
function validateRecord(record: EvidenceRecord, expectedKind?: string): void {
  if (expectedKind && record.kind !== expectedKind) throw new Error(`evidence index record kind mismatch for ${expectedKind}`);
  if (!record.kind || !record.schema || !record.logicalId || !record.relativePath || !record.writtenAt) throw new Error('evidence index record identity is invalid');
  if (!SHA256.test(record.sha256)) throw new Error(`evidence index digest is invalid for ${record.kind}`);
  if (Number.isNaN(Date.parse(record.writtenAt))) throw new Error(`evidence index timestamp is invalid for ${record.kind}`);
}
export function validateEvidenceIndex(value: unknown): asserts value is EvidenceIndex {
  if (!value || typeof value !== 'object') throw new Error('evidence index must be an object');
  const index=value as Partial<EvidenceIndex>;
  if (index.schema !== 'website-bot.evidence-index/v2') throw new Error('unsupported evidence index schema');
  if (!index.build_id || !index.client_id || !VALID_MODES.includes(index.mode as ExecutionMode)) throw new Error('evidence index identity is incomplete');
  if (!Number.isInteger(index.revision) || Number(index.revision)<1) throw new Error('evidence index revision is invalid');
  if (!VALID_STATUSES.includes(index.chain_status as EvidenceChainStatus)) throw new Error('evidence index chain status is invalid');
  if (!index.artifacts || typeof index.artifacts !== 'object' || Array.isArray(index.artifacts)) throw new Error('evidence index artifacts are missing');
  for (const [kind,record] of Object.entries(index.artifacts)) if (record) validateRecord(record,kind);
  if (!Array.isArray(index.failure_history)) throw new Error('evidence index failure_history must be an array');
  for (const record of index.failure_history) validateRecord(record,'failure');
  if (!index.created_at || Number.isNaN(Date.parse(index.created_at))) throw new Error('evidence index created_at is invalid');
  if (!index.updated_at || Number.isNaN(Date.parse(index.updated_at))) throw new Error('evidence index updated_at is invalid');
  if (index.chain_status === 'failed' && (!index.failed_stage || !index.artifacts.failure)) throw new Error('failed index requires active failure state');
  if (index.chain_status !== 'failed' && (index.failed_stage || index.artifacts.failure)) throw new Error('non-failed index cannot retain active failure state');
}
