import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import type { 
  PreflightCheck, 
  PreflightStatus, 
  PrimaryFailureClassification,
  RepositoryAdapter,
  ValidationGateStatus
} from '../types/index.js';
import type { EvidenceCollector } from './EvidenceCollector.js';

/**
 * PreflightEngine implements Step 4 of the validation specification:
 * "Execute Complete Preflight Suite"
 * 
 * MUST execute every independently executable discovered preflight check.
 * MUST enforce the preflight gate before end-to-end execution.
 */
export class PreflightEngine {
  private readonly logger = createLogger('PreflightEngine');

  constructor(
    private readonly adapter: RepositoryAdapter,
    private readonly evidenceCollector: EvidenceCollector
  ) {}

  /**
   * Execute all preflight checks according to the specification
   */
  async executeAll(preflightChecks: PreflightCheck[]): Promise<PreflightCheck[]> {
    this.logger.info({ count: preflightChecks.length }, 'Starting preflight execution');

    const results: PreflightCheck[] = [];

    for (const check of preflightChecks) {
      try {
        const result = await this.executeCheck(check);
        results.push(result);
        
        // Store evidence for this check
        await this.evidenceCollector.storeEvidence(`preflight_${check.check_id}`, {
          check_id: check.check_id,
          command: check.command,
          status: result.status,
          exit_code: result.exit_code,
          duration: result.duration,
          stdout: '', // Will be captured by command execution
          stderr: '', // Will be captured by command execution
          started_at: result.started_at,
          ended_at: result.ended_at
        });

      } catch (error) {
        this.logger.error({ error, checkId: check.check_id }, 'Preflight check execution failed');
        
        const failedResult: PreflightCheck = {
          ...check,
          status: 'Error',
          exit_code: null,
          termination_signal: null,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration: 0,
          primary_failure_classification: 'RunnerFailure',
          contributing_causes: ['Check execution threw exception'],
          root_cause_group: null,
          evidence_references: [`preflight_error_${check.check_id}_${randomUUID()}`]
        };
        
        results.push(failedResult);
      }
    }

    this.logger.info({ 
      total: results.length,
      passed: results.filter(r => r.status === 'Passed').length,
      failed: results.filter(r => r.status === 'Failed').length,
      errors: results.filter(r => r.status === 'Error').length
    }, 'Preflight execution completed');

    return results;
  }

  /**
   * Execute a single preflight check
   */
  private async executeCheck(check: PreflightCheck): Promise<PreflightCheck> {
    this.logger.debug({ checkId: check.check_id, command: check.command }, 'Executing preflight check');
    
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      // Execute the command using the adapter
      const result = await this.adapter.executeCommand(check.command, check.working_directory);
      
      const endedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      // Determine status and classification based on exit code and output
      const { status, classification } = this.classifyResult(result.exitCode, result.stdout, result.stderr);

      const executedCheck: PreflightCheck = {
        ...check,
        status,
        exit_code: result.exitCode,
        termination_signal: null,
        started_at: startedAt,
        ended_at: endedAt,
        duration,
        primary_failure_classification: classification,
        contributing_causes: this.identifyContributingCauses(result.exitCode, result.stdout, result.stderr),
        root_cause_group: null, // Will be set during analysis phase
        evidence_references: [
          `preflight_${check.check_id}_stdout`,
          `preflight_${check.check_id}_stderr`,
          `preflight_${check.check_id}_execution_trace`
        ]
      };

      this.logger.debug({ 
        checkId: check.check_id, 
        status: executedCheck.status, 
        exitCode: result.exitCode,
        duration 
      }, 'Preflight check completed');

      return executedCheck;

    } catch (error) {
      const endedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      this.logger.error({ error, checkId: check.check_id }, 'Preflight check execution failed');

      return {
        ...check,
        status: 'Error',
        exit_code: null,
        termination_signal: null,
        started_at: startedAt,
        ended_at: endedAt,
        duration,
        primary_failure_classification: 'RunnerFailure',
        contributing_causes: [`Execution error: ${error instanceof Error ? error.message : String(error)}`],
        root_cause_group: null,
        evidence_references: [`preflight_${check.check_id}_error`]
      };
    }
  }

  /**
   * Classify the result based on exit code and output
   */
  private classifyResult(exitCode: number, stdout: string, stderr: string): { 
    status: PreflightStatus; 
    classification: PrimaryFailureClassification | null 
  } {
    if (exitCode === 0) {
      return { status: 'Passed', classification: null };
    }

    // Analyze output for specific failure types
    const combinedOutput = (stdout + '\n' + stderr).toLowerCase();

    // Dependency failures
    if (combinedOutput.includes('module not found') || 
        combinedOutput.includes('cannot resolve') ||
        combinedOutput.includes('enoent') ||
        combinedOutput.includes('command not found')) {
      return { status: 'Failed', classification: 'DependencyFailure' };
    }

    // Configuration defects
    if (combinedOutput.includes('configuration') ||
        combinedOutput.includes('config') ||
        combinedOutput.includes('invalid') ||
        combinedOutput.includes('malformed')) {
      return { status: 'Failed', classification: 'ConfigurationDefect' };
    }

    // Credential failures
    if (combinedOutput.includes('unauthorized') ||
        combinedOutput.includes('authentication') ||
        combinedOutput.includes('permission denied') ||
        combinedOutput.includes('access denied')) {
      return { status: 'Failed', classification: 'CredentialFailure' };
    }

    // Environment failures
    if (combinedOutput.includes('connection refused') ||
        combinedOutput.includes('network') ||
        combinedOutput.includes('timeout') ||
        combinedOutput.includes('host not found')) {
      return { status: 'Failed', classification: 'EnvironmentFailure' };
    }

    // Default to PreflightFailure for other non-zero exit codes
    return { status: 'Failed', classification: 'PreflightFailure' };
  }

  /**
   * Identify contributing causes from command output
   */
  private identifyContributingCauses(exitCode: number, stdout: string, stderr: string): string[] {
    const causes = [];

    if (exitCode !== 0) {
      causes.push(`Non-zero exit code: ${exitCode}`);
    }

    const errorOutput = stderr.toLowerCase();
    if (errorOutput.includes('warning')) {
      causes.push('Warnings detected in output');
    }

    if (errorOutput.includes('deprecated')) {
      causes.push('Deprecated features in use');
    }

    if (errorOutput.includes('peer dep')) {
      causes.push('Peer dependency issues');
    }

    return causes;
  }

  /**
   * Evaluate the preflight gate according to the specification
   */
  evaluateGate(preflightResults: PreflightCheck[]): {
    status: ValidationGateStatus;
    blocking_failures: string[];
    blocking_unknowns: string[];
    e2e_authorized: boolean;
    decision_evidence: string[];
  } {
    this.logger.info('Evaluating preflight gate');

    const blockingChecks = preflightResults.filter(check => check.blocking);
    const blockingFailures: string[] = [];
    const blockingUnknowns: string[] = [];

    for (const check of blockingChecks) {
      if (['Failed', 'Error', 'Timeout', 'Blocked', 'NotExecuted'].includes(check.status)) {
        blockingFailures.push(check.check_id);
      } else if (check.status === 'Unknown') {
        blockingUnknowns.push(check.check_id);
      }
    }

    // Gate passes only when ALL blocking checks pass
    const gateStatus: ValidationGateStatus = 
      blockingFailures.length === 0 && blockingUnknowns.length === 0 ? 'Passed' : 'Failed';
    
    const e2eAuthorized = gateStatus === 'Passed';

    const gate = {
      status: gateStatus,
      blocking_failures: blockingFailures,
      blocking_unknowns: blockingUnknowns,
      e2e_authorized: e2eAuthorized,
      decision_evidence: [
        `preflight_gate_evaluation_${randomUUID()}`,
        ...preflightResults.map(r => `preflight_${r.check_id}_result`)
      ]
    };

    this.logger.info({ 
      gateStatus, 
      blockingFailures: blockingFailures.length,
      blockingUnknowns: blockingUnknowns.length,
      e2eAuthorized 
    }, 'Preflight gate evaluated');

    return gate;
  }

  /**
   * Generate preflight summary statistics
   */
  generateSummary(preflightResults: PreflightCheck[]) {
    const blockingChecks = preflightResults.filter(check => check.blocking);
    
    const summary = {
      discovered: preflightResults.length,
      executable: preflightResults.length, // All discovered checks are executable
      executed: preflightResults.filter(r => r.status !== 'NotExecuted').length,
      passed: preflightResults.filter(r => r.status === 'Passed').length,
      failed: preflightResults.filter(r => r.status === 'Failed').length,
      errors: preflightResults.filter(r => r.status === 'Error').length,
      timeouts: preflightResults.filter(r => r.status === 'Timeout').length,
      blocked: preflightResults.filter(r => r.status === 'Blocked').length,
      authoritatively_skipped: preflightResults.filter(r => r.status === 'AuthoritativelySkipped').length,
      not_executed: preflightResults.filter(r => r.status === 'NotExecuted').length,
      unknown: preflightResults.filter(r => r.status === 'Unknown').length,
      blocking_total: blockingChecks.length,
      blocking_passed: blockingChecks.filter(r => r.status === 'Passed').length,
      gate_status: this.evaluateGate(preflightResults).status
    };

    return summary;
  }
}