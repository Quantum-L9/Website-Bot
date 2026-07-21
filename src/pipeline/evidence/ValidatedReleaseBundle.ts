// L9_META: layer=pipeline, role=validated_release_bundle, status=active, version=2.0.0
import type { ExecutionMode } from '../BuildContext.js';
import type { AssemblyManifest } from './AssemblyManifest.js';
import type { BuildProof } from './BuildProof.js';
import type { DeploymentEvidence } from './DeploymentEvidence.js';
import type { EvidenceIndex } from './EvidenceIndex.js';
import type { EvidenceRecord } from './EvidenceReference.js';
import type { PublicationEvidence } from './PublicationEvidence.js';
import type { ReleaseReceipt } from './ReleaseReceipt.js';

export interface StoredEvidence<T> {
  value: T;
  record: EvidenceRecord;
}

export interface EvidenceChainGate {
  name: string;
  status: 'passed' | 'failed' | 'not_required';
  detail?: string;
}

export interface EvidenceChainValidation {
  valid: boolean;
  mode: ExecutionMode;
  checkedAt: string;
  gates: EvidenceChainGate[];
  identities: {
    sourceDigest?: string;
    distDigest?: string;
    commitSha?: string;
    deploymentId?: string;
  };
  errors: string[];
}

export interface ValidatedReleaseBundle {
  index: EvidenceIndex;
  assemblyManifest: AssemblyManifest;
  buildProof?: BuildProof;
  publicationEvidence?: PublicationEvidence;
  deploymentEvidence?: DeploymentEvidence;
  releaseReceipt: ReleaseReceipt;
  validation: EvidenceChainValidation;
  references: {
    assembly: EvidenceRecord;
    build?: EvidenceRecord;
    publication?: EvidenceRecord;
    deployment?: EvidenceRecord;
    release: EvidenceRecord;
  };

  /** Compatibility aliases for stage code that needs record and value together. */
  assembly: StoredEvidence<AssemblyManifest>;
  build?: StoredEvidence<BuildProof>;
  publication?: StoredEvidence<PublicationEvidence>;
  deployment?: StoredEvidence<DeploymentEvidence>;
  receipt: StoredEvidence<ReleaseReceipt>;
}

export interface LoadReleaseBundleOptions {
  requireStatus?: ReleaseReceipt['status'];
  requireMode?: ExecutionMode;
}
