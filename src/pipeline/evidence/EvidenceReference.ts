// L9_META: layer=pipeline, role=evidence_reference_contract, status=active, version=1.1.0
export type EvidenceKind =
  | 'assembly'
  | 'build'
  | 'publication'
  | 'deployment'
  | 'release'
  | 'handoff'
  | 'registration_ack'
  | 'failure';

export interface EvidenceRecord {
  kind: EvidenceKind;
  schema: string;
  logicalId: string;
  relativePath: string;
  sha256: string;
  writtenAt: string;
}

export interface EvidenceReference {
  kind: EvidenceKind;
  schema: string;
  logical_id: string;
  relative_path: string;
  sha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function validateEvidenceReference(value: unknown): asserts value is EvidenceReference {
  if (!value || typeof value !== 'object') throw new Error('evidence reference must be an object');
  const reference = value as Partial<EvidenceReference>;
  if (!reference.kind || !reference.schema || !reference.logical_id || !reference.relative_path) {
    throw new Error('evidence reference identity is incomplete');
  }
  if (reference.relative_path.startsWith('/') || reference.relative_path.split('/').some(part => part === '..')) {
    throw new Error('evidence reference path is unsafe');
  }
  if (!SHA256.test(String(reference.sha256))) throw new Error('evidence reference digest is invalid');
}

export function recordToReference(record: EvidenceRecord): EvidenceReference {
  return {
    kind: record.kind,
    schema: record.schema,
    logical_id: record.logicalId,
    relative_path: record.relativePath,
    sha256: record.sha256,
  };
}
