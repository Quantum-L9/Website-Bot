// L9_META: layer=pipeline, role=evidence_lifecycle_authority, status=active, version=1.0.0
import type { EvidenceIndex, EvidenceChainStatus } from './EvidenceIndex.js';
import type { EvidenceRecord } from './EvidenceReference.js';

export function derivedChainStatus(index: EvidenceIndex): EvidenceChainStatus {
  if (index.artifacts.failure) return 'failed';
  if (index.artifacts.registration_ack) return 'handed_off';
  if (index.artifacts.handoff || index.artifacts.release) return 'released';
  if (index.artifacts.deployment) return 'deployed';
  if (index.artifacts.publication) return 'published';
  if (index.artifacts.build) return 'built';
  if (index.artifacts.assembly) return 'assembling';
  return 'empty';
}

export function transitionStageFailed(index: EvidenceIndex, stage: string, failure: EvidenceRecord, now: string): EvidenceIndex {
  return {
    ...index,
    revision: index.revision + 1,
    artifacts: { ...index.artifacts, failure },
    failure_history: [...index.failure_history, failure],
    failed_stage: stage,
    chain_status: 'failed',
    updated_at: now,
  };
}

export function transitionStageSucceeded(index: EvidenceIndex, stage: string, now: string): EvidenceIndex {
  const artifacts={...index.artifacts};
  const supersedesActiveFailure=index.failed_stage === stage;
  if (supersedesActiveFailure) delete artifacts.failure;
  const next: EvidenceIndex={
    ...index,
    revision:index.revision+1,
    artifacts,
    last_successful_stage:stage,
    failed_stage:supersedesActiveFailure ? undefined : index.failed_stage,
    chain_status:index.chain_status,
    updated_at:now,
  };
  next.chain_status=derivedChainStatus(next);
  return next;
}

export function transitionRunConverged(index: EvidenceIndex, now: string): EvidenceIndex {
  if (index.failed_stage || index.artifacts.failure) throw new Error('cannot converge evidence chain with an active failure');
  const next={...index, revision:index.revision+1, updated_at:now};
  next.chain_status=derivedChainStatus(next);
  return next;
}
