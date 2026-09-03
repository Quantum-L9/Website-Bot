// L9_META: layer=pipeline, role=error_taxonomy, status=active, version=4.0.0
export type BuildErrorCode =
  | "MISSING_INPUT"
  | "VALIDATION_FAILED"
  | "SPEC_LOAD_FAILED"
  | "UNKNOWN_RESOLUTION_BLOCKED"
  | "DESIGN_REASONING_FAILED"
  | "CONTENT_GENERATION_FAILED"
  | "CONTENT_VALIDATION_FAILED"
  | "SCHEMA_GENERATION_FAILED"
  | "PLACEHOLDER_CONTENT_DETECTED"
  | "PROVISIONING_FAILED"
  | "PROVISION_ROLLBACK_FAILED"
  | "SITE_ASSEMBLY_FAILED"
  | "ASSEMBLY_PROOF_FAILED"
  | "BUILD_FAILED"
  | "BUILD_PROOF_STALE"
  | "SOURCE_PUBLISH_FAILED"
  | "SOURCE_PUBLISH_CONFLICT"
  | "SOURCE_PUBLISH_NO_PROOF"
  | "POSTHOG_INJECT_FAILED"
  | "VERCEL_DEPLOY_FAILED"
  | "VERCEL_POLL_TIMEOUT"
  | "DEPLOYMENT_CORRELATION_FAILED"
  | "DEPLOYMENT_COMMIT_MISMATCH"
  | "RELEASE_RECEIPT_INVALID"
  | "RELEASE_EVIDENCE_INCOMPLETE"
  | "EVIDENCE_STORE_FAILED"
  | "EVIDENCE_SCHEMA_INVALID"
  | "EVIDENCE_DIGEST_MISMATCH"
  | "EVIDENCE_REFERENCE_MISSING"
  | "EVIDENCE_CHAIN_INCOMPLETE"
  | "INTELLIGENCE_UNAVAILABLE"
  | "INTELLIGENCE_PARSE_FAILED"
  | "INTELLIGENCE_EVIDENCE_INCOMPLETE"
  | "BLUEPRINT_GATE_FAILED"
  | "BUILD_INTENT_REQUIRED"
  | "PLAN_MODE_UNSUPPORTED_FOR_REDESIGN"
  | "REDESIGN_PIPELINE_INCOMPLETE"
  | "COMPETITIVE_INTELLIGENCE_REQUIRED"
  | "COMPETITIVE_EVIDENCE_INCOMPLETE"
  | "DONOR_EVIDENCE_INCOMPLETE"
  | "DONOR_SCREENSHOT_INCOMPLETE"
  | "COMPETITIVE_LANDSCAPE_MISMATCH"
  | "SEO_CONTENT_BLUEPRINT_INVALID"
  | "ROUTE_SET_MISMATCH"
  | "CONTENT_REQUIREMENT_UNPLACED"
  | "CONTENT_CONTRACT_HASH_MISMATCH"
  | "STRUCTURED_CONTENT_LINEAGE_MISMATCH"
  | "FORBIDDEN_LLM_OPERATION"
  | "LEGACY_CONTENT_AUTHORITY_USED"
  | "VISUAL_ASSET_REQUIREMENT_UNSATISFIED"
  | "SOURCE_ASSET_REUSE_UNEXPLAINED"
  | "VISUAL_QA_REQUIRED"
  | "EVIDENCE_IDENTITY_MISMATCH"
  | "EVIDENCE_RESUME_CONFLICT"
  | "EVIDENCE_ARTIFACT_MISSING"
  | "SEO_BOT_UNREACHABLE"
  | "SEO_BOT_AUTH_FAILED"
  | "SEO_BOT_CAPABILITY_MISMATCH"
  | "SEO_BOT_ROUTER_VERSION_MISMATCH"
  | "DESIGN_REFERENCE_UNACQUIRED"
  | "REDESIGN_ARTIFACT_INVALID"
  | "RENDERED_SITE_VALIDATION_FAILED"
  | "EVIDENCE_ARTIFACT_CORRUPT"
  | "EVIDENCE_CHAIN_INVALID"
  | "CHECKPOINT_INVALID"
  | "RESUME_REVERIFY_FAILED"
  | "HANDOFF_ACK_MISMATCH"
  | "SEO_BASELINE_FAILED"
  | "VISUAL_QA_FAILED"
  | "HANDOFF_EMIT_FAILED"
  | "LLM_CALL_FAILED"
  | "DB_ERROR"
  | "UNKNOWN";

export interface BuildErrorPolicy {
  owner: string;
  retry: "never" | "after-input-fix" | "bounded" | "external-reverify";
  redactEvidence: boolean;
  remediation: string;
}

const DEFAULT_POLICY: BuildErrorPolicy = {
  owner: "pipeline",
  retry: "after-input-fix",
  redactEvidence: true,
  remediation: "Inspect the sanitized failure evidence and repair the named input or stage.",
};

export const BUILD_ERROR_POLICIES: Partial<Record<BuildErrorCode, BuildErrorPolicy>> = {
  BUILD_FAILED: {
    owner: "site-build",
    retry: "after-input-fix",
    redactEvidence: true,
    remediation:
      "Fix the generated Astro source, then rebuild from the persisted assembly evidence.",
  },
  PLACEHOLDER_CONTENT_DETECTED: {
    owner: "placeholder-scan",
    retry: "after-input-fix",
    redactEvidence: false,
    remediation:
      "Fix the spec field or regenerate the flagged section; the finding list names every source, pattern, and excerpt.",
  },
  SOURCE_PUBLISH_CONFLICT: {
    owner: "client-source-publish",
    retry: "external-reverify",
    redactEvidence: true,
    remediation: "Reconcile the client branch head before retrying publication.",
  },
  VERCEL_POLL_TIMEOUT: {
    owner: "vercel-deploy",
    retry: "external-reverify",
    redactEvidence: true,
    remediation:
      "Inspect the deployment in Vercel and resume only after its terminal state is known.",
  },
  EVIDENCE_DIGEST_MISMATCH: {
    owner: "evidence-store",
    retry: "never",
    redactEvidence: true,
    remediation:
      "Treat the artifact as corrupt, preserve it for forensics, and rebuild the affected evidence chain.",
  },
  EVIDENCE_REFERENCE_MISSING: {
    owner: "evidence-store",
    retry: "after-input-fix",
    redactEvidence: true,
    remediation: "Restore or regenerate the referenced evidence artifact.",
  },
  EVIDENCE_RESUME_CONFLICT: {
    owner: "pipeline-runner",
    retry: "external-reverify",
    redactEvidence: true,
    remediation: "Reverify provider state or begin a new build identity.",
  },
  DESIGN_REFERENCE_UNACQUIRED: {
    owner: "design-reference-acquisition",
    retry: "external-reverify",
    redactEvidence: false,
    remediation:
      "Every client-supplied design reference URL failed acquisition; the manifest names each URL and reason. Fix or replace the URLs (or author principles explicitly) and re-run.",
  },
  REDESIGN_ARTIFACT_INVALID: {
    owner: "redesign-intelligence",
    retry: "never",
    redactEvidence: true,
    remediation:
      "A persisted redesign intelligence artifact failed digest, integrity, identity, or lineage verification. Treat it as corrupt and start a new build identity.",
  },
  RENDERED_SITE_VALIDATION_FAILED: {
    owner: "rendered-site-validation",
    retry: "after-input-fix",
    redactEvidence: false,
    remediation:
      "The built site did not render correctly in a real browser; the validation report names every failing route, viewport, and check.",
  },
  HANDOFF_ACK_MISMATCH: {
    owner: "handoff-emitter",
    retry: "never",
    redactEvidence: true,
    remediation:
      "Reject activation and reconcile the SEO-Bot acknowledgement with the emitted contract.",
  },
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
    this.name = "BuildError";
  }
}
