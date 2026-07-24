// L9_META: layer=pipeline, role=error_taxonomy, status=active, version=4.0.0
export type BuildErrorCode =
  | 'MISSING_INPUT'
  | 'VALIDATION_FAILED'
  | 'SPEC_LOAD_FAILED'
  | 'UNKNOWN_RESOLUTION_BLOCKED'
  | 'DESIGN_REASONING_FAILED'
  | 'CONTENT_GENERATION_FAILED'
  | 'CONTENT_VALIDATION_FAILED'
  | 'SCHEMA_GENERATION_FAILED'
  | 'PROVISIONING_FAILED'
  | 'PROVISION_ROLLBACK_FAILED'
  | 'SITE_ASSEMBLY_FAILED'
  | 'ASSEMBLY_PROOF_FAILED'
  | 'BUILD_FAILED'
  | 'BUILD_PROOF_STALE'
  | 'SOURCE_PUBLISH_FAILED'
  | 'SOURCE_PUBLISH_CONFLICT'
  | 'SOURCE_PUBLISH_NO_PROOF'
  | 'POSTHOG_INJECT_FAILED'
  | 'VERCEL_DEPLOY_FAILED'
  | 'VERCEL_POLL_TIMEOUT'
  | 'DEPLOYMENT_CORRELATION_FAILED'
  | 'DEPLOYMENT_COMMIT_MISMATCH'
  | 'RELEASE_RECEIPT_INVALID'
  | 'RELEASE_EVIDENCE_INCOMPLETE'
  | 'EVIDENCE_STORE_FAILED'
  | 'EVIDENCE_SCHEMA_INVALID'
  | 'EVIDENCE_DIGEST_MISMATCH'
  | 'EVIDENCE_REFERENCE_MISSING'
  | 'EVIDENCE_CHAIN_INCOMPLETE'
  | 'EVIDENCE_IDENTITY_MISMATCH'
  | 'EVIDENCE_RESUME_CONFLICT'
  | 'EVIDENCE_ARTIFACT_MISSING'
  | 'EVIDENCE_ARTIFACT_CORRUPT'
  | 'EVIDENCE_CHAIN_INVALID'
  | 'CHECKPOINT_INVALID'
  | 'RESUME_REVERIFY_FAILED'
  | 'HANDOFF_ACK_MISMATCH'
  | 'SEO_BASELINE_FAILED'
  | 'VISUAL_QA_FAILED'
  | 'HANDOFF_EMIT_FAILED'
  | 'LLM_CALL_FAILED'
  | 'DB_ERROR'
  | 'UNKNOWN';

export interface BuildErrorPolicy {
  owner: string;
  retry: 'never' | 'after-input-fix' | 'bounded' | 'external-reverify';
  redactEvidence: boolean;
  remediation: string;
}

const DEFAULT_POLICY: BuildErrorPolicy = {
  owner: 'pipeline',
  retry: 'after-input-fix',
  redactEvidence: true,
  remediation: 'Inspect the sanitized failure evidence and repair the named input or stage.',
};

export const BUILD_ERROR_POLICIES: Partial<Record<BuildErrorCode, BuildErrorPolicy>> = {
  BUILD_FAILED: { owner: 'site-build', retry: 'after-input-fix', redactEvidence: true, remediation: 'Fix the generated Astro source, then rebuild from the persisted assembly evidence.' },
  SOURCE_PUBLISH_CONFLICT: { owner: 'client-source-publish', retry: 'external-reverify', redactEvidence: true, remediation: 'Reconcile the client branch head before retrying publication.' },
  VERCEL_POLL_TIMEOUT: { owner: 'vercel-deploy', retry: 'external-reverify', redactEvidence: true, remediation: 'Inspect the deployment in Vercel and resume only after its terminal state is known.' },
  EVIDENCE_DIGEST_MISMATCH: { owner: 'evidence-store', retry: 'never', redactEvidence: true, remediation: 'Treat the artifact as corrupt, preserve it for forensics, and rebuild the affected evidence chain.' },
  EVIDENCE_REFERENCE_MISSING: { owner: 'evidence-store', retry: 'after-input-fix', redactEvidence: true, remediation: 'Restore or regenerate the referenced evidence artifact.' },
  EVIDENCE_RESUME_CONFLICT: { owner: 'pipeline-runner', retry: 'external-reverify', redactEvidence: true, remediation: 'Reverify provider state or begin a new build identity.' },
  HANDOFF_ACK_MISMATCH: { owner: 'handoff-emitter', retry: 'never', redactEvidence: true, remediation: 'Reject activation and reconcile the SEO-Bot acknowledgement with the emitted contract.' },
};

export function buildErrorPolicy(code: BuildErrorCode): BuildErrorPolicy {
  return BUILD_ERROR_POLICIES[code] ?? DEFAULT_POLICY;
}

export class BuildError extends Error {
  constructor(
    public readonly code: BuildErrorCode,
    message: string,
    public readonly recoverable = false,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BuildError';
  }
}
