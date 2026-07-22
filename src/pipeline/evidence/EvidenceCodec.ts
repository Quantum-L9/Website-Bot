// L9_META: layer=pipeline, role=evidence_serialization_codec, status=active, version=2.0.0
import type { EvidenceKind, EvidenceRecord } from './EvidenceReference.js';
import type { EvidenceIndex } from './EvidenceIndex.js';
import type { StageCheckpoint } from '../StageCheckpoint.js';

type JsonObject = Record<string, unknown>;

const ARTIFACT_KEYS: Record<Exclude<EvidenceKind, 'release' | 'handoff' | 'registration_ack'>, Record<string, string>> = {
  assembly: {
    buildId: 'build_id', clientId: 'client_id', generatorVersion: 'generator_version',
    templateVersion: 'template_version', templateDigest: 'template_digest', sourceDigest: 'source_digest', generatedAt: 'generated_at', outputDir: 'output_dir',
  },
  build: {
    proofId: 'proof_id', buildId: 'build_id', clientId: 'client_id',
    assemblyManifestSha256: 'assembly_manifest_sha256', sourceDir: 'source_dir', distDir: 'dist_dir',
    sourceDigest: 'source_digest', distDigest: 'dist_digest', packageManager: 'package_manager',
    packageManagerVersion: 'package_manager_version', installCommand: 'install_command',
    checkCommand: 'check_command', buildCommand: 'build_command', builtRoutes: 'built_routes',
    startedAt: 'started_at', completedAt: 'completed_at',
  },
  publication: {
    publicationId: 'publication_id', buildId: 'build_id', clientId: 'client_id',
    buildProofId: 'build_proof_id', buildProofSha256: 'build_proof_sha256', repositoryId: 'repository_id',
    previousHeadSha: 'previous_head_sha', commitSha: 'commit_sha', treeSha: 'tree_sha',
    verifiedBranchHeadSha: 'verified_branch_head_sha', sourceDigest: 'source_digest',
    managedManifestDigest: 'managed_manifest_digest', changedPaths: 'changed_paths',
    deletedPaths: 'deleted_paths', noOp: 'no_op', publishedAt: 'published_at',
  },
  deployment: {
    deploymentEvidenceId: 'deployment_evidence_id', buildId: 'build_id', clientId: 'client_id',
    publicationId: 'publication_id', publicationSha256: 'publication_sha256', projectId: 'project_id',
    deploymentId: 'deployment_id', requestedCommitSha: 'requested_commit_sha',
    observedCommitSha: 'observed_commit_sha', deploymentUrl: 'deployment_url',
    sourceRepository: 'source_repository', sourceBranch: 'source_branch', triggerMode: 'trigger_mode',
    createdAt: 'created_at', readyAt: 'ready_at',
  },
  failure: {
    buildId: 'build_id', clientId: 'client_id', inputEvidence: 'input_evidence',
    providerStatus: 'provider_status', providerRequestId: 'provider_request_id',
    sanitizedDetails: 'sanitized_details', failedAt: 'failed_at',
  },
};

const CHECKPOINT_KEYS: Record<string, string> = {
  buildId: 'build_id', clientId: 'client_id', stageVersion: 'stage_version',
  inputEvidence: 'input_evidence', outputEvidence: 'output_evidence', inputDigest: 'input_digest',
  outputDigest: 'output_digest', externalId: 'external_id', startedAt: 'started_at', completedAt: 'completed_at',
};
const RECORD_KEYS: Record<string, string> = {
  logicalId: 'logical_id', relativePath: 'relative_path', writtenAt: 'written_at',
};

function remap(value: unknown, map: Record<string, string>, reverse = false): unknown {
  if (Array.isArray(value)) return value.map(item => remap(item, map, reverse));
  if (!value || typeof value !== 'object') return value;
  const source = value as JsonObject;
  const mapping = reverse ? Object.fromEntries(Object.entries(map).map(([a,b]) => [b,a])) : map;
  return Object.fromEntries(Object.entries(source).map(([key, child]) => [mapping[key] ?? key, child]));
}

export function encodeEvidenceArtifact(kind: EvidenceKind, value: object): object {
  if (kind === 'release' || kind === 'handoff' || kind === 'registration_ack') return value;
  const encoded = remap(value, ARTIFACT_KEYS[kind]) as JsonObject;
  if (kind === 'build' && Array.isArray(encoded.checks)) {
    encoded.checks = encoded.checks.map(check => remap(check, { durationMs: 'duration_ms' }));
  }
  return encoded;
}

export function decodeEvidenceArtifact<T>(kind: EvidenceKind, value: unknown): T {
  if (kind === 'release' || kind === 'handoff' || kind === 'registration_ack') return value as T;
  const decoded = remap(value, ARTIFACT_KEYS[kind], true) as JsonObject;
  if (kind === 'build' && Array.isArray(decoded.checks)) {
    decoded.checks = decoded.checks.map(check => remap(check, { durationMs: 'duration_ms' }, true));
  }
  return decoded as T;
}

export function encodeCheckpoint(value: StageCheckpoint): object { return remap(value, CHECKPOINT_KEYS) as object; }
export function decodeCheckpoint(value: unknown): StageCheckpoint { return remap(value, CHECKPOINT_KEYS, true) as StageCheckpoint; }
export function encodeRecord(value: EvidenceRecord): object { return remap(value, RECORD_KEYS) as object; }
export function decodeRecord(value: unknown): EvidenceRecord { return remap(value, RECORD_KEYS, true) as EvidenceRecord; }

export function encodeIndex(index: EvidenceIndex): object {
  return {
    ...index,
    artifacts: Object.fromEntries(Object.entries(index.artifacts).map(([kind, record]) => [kind, record ? encodeRecord(record) : record])),
    failure_history: index.failure_history.map(encodeRecord),
  };
}

export function decodeIndex(value: unknown): EvidenceIndex {
  const source=value as JsonObject;
  return {
    ...(source as unknown as EvidenceIndex),
    artifacts: Object.fromEntries(Object.entries((source.artifacts ?? {}) as JsonObject).map(([kind, record]) => [kind, record ? decodeRecord(record) : record])),
    failure_history: Array.isArray(source.failure_history) ? source.failure_history.map(decodeRecord) : [],
  };
}
