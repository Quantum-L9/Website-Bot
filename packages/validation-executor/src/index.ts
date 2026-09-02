/**
 * @quantum-l9/validation-executor
 *
 * Evidence-driven validation execution kernel for comprehensive
 * preflight and E2E testing with complete audit trails.
 */

export { AuditReporter } from "./core/AuditReporter.js";
export { ContextResolver } from "./core/ContextResolver.js";
export { E2EEngine } from "./core/E2EEngine.js";
export { EvidenceCollector } from "./core/EvidenceCollector.js";
export { PreflightEngine } from "./core/PreflightEngine.js";
export { ValidationExecutor } from "./core/ValidationExecutor.js";

// Enumerated rather than `export type *`: that TS 5.0 form is valid but
// semgrep's TypeScript grammar cannot parse it, which failed the org CI
// provider on this whole file. Every symbol below is type-only, so this is
// exactly equivalent and emits no runtime re-export.
export type {
  E2EStatus,
  E2ETestDefinition,
  E2ETestResult,
  ExecutionContext,
  FinalVerdict,
  PreflightCheck,
  PreflightCheckDefinition,
  PreflightStatus,
  PrimaryFailureClassification,
  RepositoryAdapter,
  ValidationConfig,
  ValidationExecutionReport,
  ValidationGate,
  ValidationGateStatus,
} from "./types/index.js";

// Convenience function for simple execution
export async function executeValidation(
  adapter: import("./types/index.js").RepositoryAdapter,
  config: import("./types/index.js").ValidationConfig = {},
): Promise<import("./types/index.js").ValidationExecutionReport> {
  const { ValidationExecutor } = await import("./core/ValidationExecutor.js");
  const executor = new ValidationExecutor(adapter, config);
  return await executor.execute();
}
