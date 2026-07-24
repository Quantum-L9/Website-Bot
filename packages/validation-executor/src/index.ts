/**
 * @quantum-l9/validation-executor
 * 
 * Evidence-driven validation execution kernel for comprehensive 
 * preflight and E2E testing with complete audit trails.
 */

export { ValidationExecutor } from './core/ValidationExecutor.js';
export { ContextResolver } from './core/ContextResolver.js';
export { PreflightEngine } from './core/PreflightEngine.js';
export { E2EEngine } from './core/E2EEngine.js';
export { EvidenceCollector } from './core/EvidenceCollector.js';
export { AuditReporter } from './core/AuditReporter.js';

export type * from './types/index.js';

// Convenience function for simple execution
export async function executeValidation(
  adapter: import('./types/index.js').RepositoryAdapter,
  config: import('./types/index.js').ValidationConfig = {}
): Promise<import('./types/index.js').ValidationExecutionReport> {
  const { ValidationExecutor } = await import('./core/ValidationExecutor.js');
  const executor = new ValidationExecutor(adapter, config);
  return await executor.execute();
}