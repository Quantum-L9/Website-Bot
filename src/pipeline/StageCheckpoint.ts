// L9_META: layer=pipeline, role=stage_checkpoint, status=active, version=2.1.0
import { evidenceDigest } from './evidence/EvidenceCanonicalizer.js';
import type { EvidenceReference } from './evidence/EvidenceReference.js';
import { validateEvidenceReference } from './evidence/EvidenceReference.js';

export interface StageCheckpoint {
  schema: 'website-bot.stage-checkpoint/v1';
  buildId: string;
  clientId: string;
  stage: string;
  stageVersion?: string;
  attempt: number;
  inputEvidence: EvidenceReference[];
  outputEvidence: EvidenceReference[];
  inputDigest: string;
  outputDigest: string;
  externalId?: string;
  status: 'passed' | 'failed';
  startedAt: string;
  completedAt: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function checkpointDigest(references: EvidenceReference[]): string {
  return evidenceDigest([...references].sort((left, right) => left.kind.localeCompare(right.kind)));
}

export function validateStageCheckpoint(value: unknown): asserts value is StageCheckpoint {
  if (!value || typeof value !== 'object') throw new Error('checkpoint must be an object');
  const checkpoint = value as Partial<StageCheckpoint>;
  if (checkpoint.schema !== 'website-bot.stage-checkpoint/v1' || !checkpoint.buildId || !checkpoint.clientId || !checkpoint.stage) {
    throw new Error('checkpoint identity is invalid');
  }
  if (!Number.isInteger(checkpoint.attempt) || Number(checkpoint.attempt) < 1) throw new Error('checkpoint attempt is invalid');
  if (!Array.isArray(checkpoint.inputEvidence) || !Array.isArray(checkpoint.outputEvidence)) throw new Error('checkpoint evidence lists are invalid');
  for (const reference of [...checkpoint.inputEvidence, ...checkpoint.outputEvidence]) validateEvidenceReference(reference);
  if (!SHA256.test(String(checkpoint.inputDigest)) || !SHA256.test(String(checkpoint.outputDigest))) throw new Error('checkpoint digest is invalid');
  if (!['passed', 'failed'].includes(String(checkpoint.status))) throw new Error('checkpoint status is invalid');
  if (!checkpoint.startedAt || Number.isNaN(Date.parse(checkpoint.startedAt)) || !checkpoint.completedAt || Number.isNaN(Date.parse(checkpoint.completedAt))) {
    throw new Error('checkpoint timestamps are invalid');
  }
  if (checkpoint.inputDigest !== checkpointDigest(checkpoint.inputEvidence)) throw new Error('checkpoint input digest does not match references');
  if (checkpoint.outputDigest !== checkpointDigest(checkpoint.outputEvidence)) throw new Error('checkpoint output digest does not match references');
}
