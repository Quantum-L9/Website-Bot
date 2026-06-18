// L9_META: layer=pipeline, role=error_taxonomy, status=active, version=2.0.0

export type BuildErrorCode =
  | 'MISSING_INPUT'
  | 'VALIDATION_FAILED'
  | 'SPEC_LOAD_FAILED'
  | 'UNKNOWN_RESOLUTION_BLOCKED'
  | 'DESIGN_REASONING_FAILED'
  | 'CONTENT_GENERATION_FAILED'
  | 'CONTENT_VALIDATION_FAILED'
  | 'SCHEMA_GENERATION_FAILED'
  | 'POSTHOG_INJECT_FAILED'
  | 'VERCEL_DEPLOY_FAILED'
  | 'VERCEL_POLL_TIMEOUT'
  | 'SEO_BASELINE_FAILED'
  | 'VISUAL_QA_FAILED'
  | 'HANDOFF_EMIT_FAILED'
  | 'LLM_CALL_FAILED'
  | 'DB_ERROR'
  | 'UNKNOWN';

export class BuildError extends Error {
  constructor(
    public readonly code: BuildErrorCode,
    message: string,
    public readonly recoverable: boolean = false,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BuildError';
  }
}
