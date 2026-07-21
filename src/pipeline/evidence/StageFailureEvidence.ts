// L9_META: layer=pipeline, role=stage_failure_evidence, status=active, version=1.1.0
import type { EvidenceReference } from './EvidenceReference.js';
import { validateEvidenceReference } from './EvidenceReference.js';

export interface StageFailureEvidence {
  schema: 'website-bot.stage-failure/v1';
  buildId: string;
  clientId: string;
  stage: string;
  attempt: number;
  code: string;
  message: string;
  recoverable: boolean;
  inputEvidence: EvidenceReference[];
  providerStatus?: number;
  providerRequestId?: string;
  sanitizedDetails?: Record<string, unknown>;
  failedAt: string;
}

export function validateStageFailureEvidence(value: unknown): asserts value is StageFailureEvidence {
  if (!value || typeof value !== 'object') throw new Error('failure evidence must be an object');
  const failure = value as Partial<StageFailureEvidence>;
  if (failure.schema !== 'website-bot.stage-failure/v1' || !failure.buildId || !failure.clientId || !failure.stage || !failure.code || !failure.message) {
    throw new Error('failure evidence identity is invalid');
  }
  if (!Number.isInteger(failure.attempt) || Number(failure.attempt) < 1) throw new Error('failure evidence attempt is invalid');
  if (!Array.isArray(failure.inputEvidence)) throw new Error('failure evidence inputs are missing');
  for (const reference of failure.inputEvidence) validateEvidenceReference(reference);
  if (!failure.failedAt || Number.isNaN(Date.parse(failure.failedAt))) throw new Error('failure evidence timestamp is invalid');
}
