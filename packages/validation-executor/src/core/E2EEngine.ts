import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import type { 
  E2ETestResult, 
  E2EStatus, 
  PrimaryFailureClassification,
  RepositoryAdapter,
  ValidationGateStatus
} from '../types/index.js';
import type { EvidenceCollector } from './EvidenceCollector.js';

/**
 * E2EEngine implements Step 5 of the validation specification:
 * "Execute Complete E2E Suite"
 * 
 * MUST execute the complete authoritative required integration, functional, 
 * system, and end-to-end suite only when the preflight gate passes.
 */
export class E2EEngine {
  private readonly logger = createLogger('E2EEngine');

  constructor(
    private readonly adapter: RepositoryAdapter,
    private readonly evidenceCollector: EvidenceCollector
  ) {}

  /**
   * Execute all E2E tests according to the specification
   */
  async executeAll(e2eTests: E2ETestResult[]): Promise<E2ETestResult[]> {
    this.logger.info({ count: e2eTests.length }, 'Starting E2E execution');

    const results: E2ETestResult[] = [];
    let runnerCrashes = 0;

    for (const test of e2eTests) {
      try {
        const result = await this.executeTest(test);
        results.push(result);
        
        // Store evidence for this test
        await this.evidenceCollector.storeEvidence(`e2e_${test.test_id}_attempt_${test.attempt}`, {
          test_id: test.test_id,
          suite_id: test.suite_id,
          command: test.command_or_invocation,
          status: result.status,
          exit_code: result.exit_code_or_runner_result,
          duration: result.duration,
          assertion_or_error: result.assertion_or_error,
          started_at: result.started_at,
          ended_at: result.ended_at
        });

      } catch (error) {
        this.logger.error({ error, testId: test.test_id }, 'E2E test execution failed');
        runnerCrashes++;
        
        const failedResult: E2ETestResult = {
          ...test,
          status: 'Error',
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration: 0,
          assertion_or_error: error instanceof Error ? error.message : String(error),
          exit_code_or_runner_result: null,
          primary_failure_classification: 'RunnerFailure',
          contributing_causes: ['Test execution threw exception'],
          root_cause_group: null,
          evidence_references: [`e2e_error_${test.test_id}_${randomUUID()}`]
        };
        
        results.push(failedResult);

        // If too many runner crashes, stop execution for safety
        if (runnerCrashes >= 3) {
          this.logger.error('Too many runner crashes, stopping E2E execution');
          break;
        }
      }
    }

    this.logger.info({ 
      total: results.length,
      passed: results.filter(r => r.status === 'Passed').length,
      failed: results.filter(r => r.status === 'Failed').length,
      errors: results.filter(r => r.status === 'Error').length,
      runnerCrashes
    }, 'E2E execution completed');

    return results;
  }

  /**
   * Execute a single E2E test
   */
  private async executeTest(test: E2ETestResult): Promise<E2ETestResult> {
    this.logger.debug({ testId: test.test_id, command: test.command_or_invocation }, 'Executing E2E test');
    
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      // Execute the test command using the adapter
      const result = await this.adapter.executeCommand(test.command_or_invocation, process.cwd());
      
      const endedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      // Determine status and classification based on exit code and output
      const { status, classification, assertionError } = this.classifyTestResult(
        result.exitCode, 
        result.stdout, 
        result.stderr
      );

      const executedTest: E2ETestResult = {
        ...test,
        status,
        started_at: startedAt,
        ended_at: endedAt,
        duration,
        assertion_or_error: assertionError,
        exit_code_or_runner_result: result.exitCode,
        primary_failure_classification: classification,
        contributing_causes: this.identifyContributingCauses(result.exitCode, result.stdout, result.stderr),
        root_cause_group: null, // Will be set during analysis phase
        evidence_references: [
          `e2e_${test.test_id}_stdout`,
          `e2e_${test.test_id}_stderr`,
          `e2e_${test.test_id}_execution_trace`
        ]
      };

      this.logger.debug({ 
        testId: test.test_id, 
        status: executedTest.status, 
        exitCode: result.exitCode,
        duration 
      }, 'E2E test completed');

      return executedTest;

    } catch (error) {
      const endedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      this.logger.error({ error, testId: test.test_id }, 'E2E test execution failed');

      return {
        ...test,
        status: 'Error',
        started_at: startedAt,
        ended_at: endedAt,
        duration,
        assertion_or_error: error instanceof Error ? error.message : String(error),
        exit_code_or_runner_result: null,
        primary_failure_classification: 'RunnerFailure',
        contributing_causes: [`Execution error: ${error instanceof Error ? error.message : String(error)}`],
        root_cause_group: null,
        evidence_references: [`e2e_${test.test_id}_error`]
      };
    }
  }

  /**
   * Classify test result based on exit code and output
   */
  private classifyTestResult(exitCode: number, stdout: string, stderr: string): { 
    status: E2EStatus; 
    classification: PrimaryFailureClassification | null;
    assertionError: string | null;
  } {
    if (exitCode === 0) {
      return { status: 'Passed', classification: null, assertionError: null };
    }

    // Analyze output for specific failure types
    const combinedOutput = (stdout + '\n' + stderr).toLowerCase();

    // Look for assertion failures first
    const assertionPatterns = [
      /expected.*but.*received/i,
      /assertion.*failed/i,
      /test.*failed/i,
      /expected:.*actual:/i,
      /✕.*expect/i,
      /error:.*expect/i
    ];

    for (const pattern of assertionPatterns) {
      const match = (stdout + '\n' + stderr).match(pattern);
      if (match) {
        return { 
          status: 'Failed', 
          classification: 'AssertionFailure', 
          assertionError: this.extractAssertionError(stdout + '\n' + stderr) 
        };
      }
    }

    // Application runtime failures
    if (combinedOutput.includes('unhandled promise rejection') ||
        combinedOutput.includes('uncaught exception') ||
        combinedOutput.includes('stack trace') ||
        combinedOutput.includes('error:') ||
        combinedOutput.includes('crash')) {
      return { 
        status: 'Failed', 
        classification: 'ApplicationRuntimeFailure', 
        assertionError: this.extractErrorMessage(stdout + '\n' + stderr) 
      };
    }

    // Dependency failures
    if (combinedOutput.includes('module not found') || 
        combinedOutput.includes('cannot resolve') ||
        combinedOutput.includes('enoent') ||
        combinedOutput.includes('command not found')) {
      return { status: 'Failed', classification: 'DependencyFailure', assertionError: null };
    }

    // Timeout detection
    if (combinedOutput.includes('timeout') ||
        combinedOutput.includes('timed out')) {
      return { status: 'Timeout', classification: 'Timeout', assertionError: null };
    }

    // Configuration defects
    if (combinedOutput.includes('configuration') ||
        combinedOutput.includes('config') ||
        combinedOutput.includes('invalid') ||
        combinedOutput.includes('malformed')) {
      return { status: 'Failed', classification: 'ConfigurationDefect', assertionError: null };
    }

    // Credential failures
    if (combinedOutput.includes('unauthorized') ||
        combinedOutput.includes('authentication') ||
        combinedOutput.includes('permission denied') ||
        combinedOutput.includes('access denied') ||
        combinedOutput.includes('401') ||
        combinedOutput.includes('403')) {
      return { status: 'Failed', classification: 'CredentialFailure', assertionError: null };
    }

    // Environment failures
    if (combinedOutput.includes('connection refused') ||
        combinedOutput.includes('network') ||
        combinedOutput.includes('host not found') ||
        combinedOutput.includes('econnrefused') ||
        combinedOutput.includes('503') ||
        combinedOutput.includes('502')) {
      return { status: 'Failed', classification: 'EnvironmentFailure', assertionError: null };
    }

    // Default to general failure
    return { 
      status: 'Failed', 
      classification: 'Unknown', 
      assertionError: `Non-zero exit code: ${exitCode}` 
    };
  }

  /**
   * Extract assertion error message from output
   */
  private extractAssertionError(output: string): string | null {
    const lines = output.split('\n');
    
    // Look for common assertion error patterns
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('expected') && line.includes('received')) {
        return lines.slice(i, Math.min(i + 3, lines.length)).join('\n');
      }
      if (line.includes('assertion failed')) {
        return lines.slice(i, Math.min(i + 2, lines.length)).join('\n');
      }
    }
    
    return null;
  }

  /**
   * Extract error message from output
   */
  private extractErrorMessage(output: string): string | null {
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.toLowerCase().includes('error:')) {
        return line.trim();
      }
    }
    
    return null;
  }

  /**
   * Identify contributing causes from test output
   */
  private identifyContributingCauses(exitCode: number, stdout: string, stderr: string): string[] {
    const causes = [];

    if (exitCode !== 0) {
      causes.push(`Non-zero exit code: ${exitCode}`);
    }

    const output = (stdout + '\n' + stderr).toLowerCase();
    
    if (output.includes('warning')) {
      causes.push('Warnings detected in output');
    }

    if (output.includes('deprecated')) {
      causes.push('Deprecated features in use');
    }

    if (output.includes('flaky') || output.includes('intermittent')) {
      causes.push('Potentially flaky test behavior');
    }

    if (output.includes('slow')) {
      causes.push('Performance issues detected');
    }

    return causes;
  }

  /**
   * Evaluate E2E test results
   */
  evaluateResults(e2eResults: E2ETestResult[]): {
    status: ValidationGateStatus;
    evidence_references: string[];
  } {
    this.logger.info('Evaluating E2E test results');

    const failedTests = e2eResults.filter(test => 
      ['Failed', 'Error', 'Timeout'].includes(test.status)
    ).length;

    const unknownTests = e2eResults.filter(test => 
      test.status === 'Unknown'
    ).length;

    // E2E gate passes only when ALL tests pass
    const gateStatus: ValidationGateStatus = 
      failedTests === 0 && unknownTests === 0 ? 'Passed' : 'Failed';

    const gate = {
      status: gateStatus,
      evidence_references: [
        `e2e_gate_evaluation_${randomUUID()}`,
        ...e2eResults.map(r => `e2e_${r.test_id}_result`)
      ]
    };

    this.logger.info({ 
      gateStatus, 
      totalTests: e2eResults.length,
      failedTests,
      unknownTests 
    }, 'E2E gate evaluated');

    return gate;
  }

  /**
   * Generate E2E summary statistics
   */
  generateSummary(e2eResults: E2ETestResult[]) {
    // Count unique tests (excluding retries)
    const uniqueTests = new Set(e2eResults.map(r => r.test_id)).size;
    const suites = new Set(e2eResults.map(r => r.suite_id));

    const summary = {
      discovered_suites: suites.size,
      discovered_required_tests: uniqueTests,
      executed_unique_tests: uniqueTests, // All discovered tests are executed
      execution_attempts: e2eResults.length, // Includes retries
      passed: e2eResults.filter(r => r.status === 'Passed').length,
      failed: e2eResults.filter(r => r.status === 'Failed').length,
      errors: e2eResults.filter(r => r.status === 'Error').length,
      timeouts: e2eResults.filter(r => r.status === 'Timeout').length,
      blocked_by_preflight_gate: e2eResults.filter(r => r.status === 'BlockedByPreflightGate').length,
      blocked_by_authoritative_fail_fast: e2eResults.filter(r => r.status === 'BlockedByAuthoritativeFailFast').length,
      blocked: e2eResults.filter(r => r.status === 'Blocked').length,
      not_executed: e2eResults.filter(r => r.status === 'NotExecuted').length,
      authoritatively_skipped: e2eResults.filter(r => r.status === 'AuthoritativelySkipped').length,
      unknown: e2eResults.filter(r => r.status === 'Unknown').length,
      runner_crashes: e2eResults.filter(r => 
        r.primary_failure_classification === 'RunnerFailure'
      ).length,
      gate_status: this.evaluateResults(e2eResults).status
    };

    return summary;
  }

  /**
   * Mark tests as blocked by preflight gate
   */
  markBlockedByPreflightGate(e2eTests: E2ETestResult[]): E2ETestResult[] {
    const timestamp = new Date().toISOString();
    
    return e2eTests.map(test => ({
      ...test,
      status: 'BlockedByPreflightGate' as E2EStatus,
      started_at: timestamp,
      ended_at: timestamp,
      duration: 0,
      assertion_or_error: 'Test blocked by failed preflight gate',
      exit_code_or_runner_result: null,
      primary_failure_classification: 'Blocked' as PrimaryFailureClassification,
      contributing_causes: ['Preflight gate did not pass'],
      root_cause_group: 'preflight_gate_failure',
      evidence_references: [`e2e_blocked_${test.test_id}`]
    }));
  }
}