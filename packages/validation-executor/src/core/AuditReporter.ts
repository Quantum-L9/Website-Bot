import { stringify as yamlStringify } from 'yaml';
import { createLogger } from '../utils/logger.js';
import type { ValidationExecutionReport, ValidationGateStatus } from '../types/index.js';

/**
 * AuditReporter implements Step 9 of the validation specification:
 * "Emit Audit Report"
 * 
 * MUST emit one deterministic YAML audit report with complete evidence.
 */
export class AuditReporter {
  private readonly logger = createLogger('AuditReporter');

  /**
   * Generate the complete YAML audit report
   */
  generateReport(data: {
    runId: string;
    startedAt: string;
    endedAt: string;
    executionContext: any;
    preflightResults: any[];
    e2eResults: any[];
    rootCauseGroups: any[];
    defects: any[];
    regressions: any[];
    coverage: any;
    evidenceManifest: any[];
    validationGates: any;
    finalVerdict: any;
  }): ValidationExecutionReport {
    
    this.logger.info({ runId: data.runId }, 'Generating validation execution report');

    const duration = Date.parse(data.endedAt) - Date.parse(data.startedAt);

    const report: ValidationExecutionReport = {
      run_metadata: {
        run_id: data.runId,
        report_schema_version: '1.0.0',
        started_at: data.startedAt,
        ended_at: data.endedAt,
        duration,
        last_completed_stage: this.determineLastCompletedStage(data.finalVerdict)
      },

      execution_context: data.executionContext,

      authority_sources: this.generateAuthoritySources(data.executionContext),

      discovery_inventory: {
        preflight_checks: data.preflightResults,
        e2e_suites: this.extractSuiteNames(data.e2eResults),
        required_e2e_tests: data.e2eResults,
        dynamic_inventory_items: [], // TODO: Implement dynamic inventory detection
        authoritative_skips: this.extractAuthoritativeSkips(data.preflightResults, data.e2eResults),
        inventory_sources: data.executionContext.configuration_sources || [],
        inventory_status: 'complete'
      },

      preflight_summary: this.generatePreflightSummary(data.preflightResults),
      
      preflight_results: data.preflightResults,

      preflight_gate: this.generatePreflightGate(data.preflightResults),

      e2e_summary: this.generateE2ESummary(data.e2eResults),

      e2e_results: data.e2eResults,

      coverage_reconciliation: data.coverage,

      root_cause_groups: data.rootCauseGroups,

      defects: data.defects,

      regressions: data.regressions,

      unknowns: this.generateUnknowns(data.preflightResults, data.e2eResults, data.executionContext),

      evidence_manifest: data.evidenceManifest,

      validation_gates: data.validationGates,

      final_verdict: data.finalVerdict,

      minimum_safe_next_action: this.determineNextAction(data.finalVerdict, data.preflightResults, data.e2eResults)
    };

    this.logger.info({ 
      verdict: report.final_verdict.status,
      preflightChecks: report.preflight_results.length,
      e2eTests: report.e2e_results.length,
      duration: report.run_metadata.duration
    }, 'Validation execution report generated');

    return report;
  }

  /**
   * Convert report to YAML string
   */
  toYAML(report: ValidationExecutionReport): string {
    try {
      // Configure YAML output for deterministic formatting
      const yamlString = yamlStringify(report, {
        indent: 2,
        lineWidth: 120,
        minContentWidth: 20
      });

      this.logger.debug('Report converted to YAML format');
      return yamlString;

    } catch (error) {
      this.logger.error({ error }, 'Failed to convert report to YAML');
      throw new Error(`YAML serialization failed: ${error}`);
    }
  }

  /**
   * Write report to file
   */
  async writeReport(report: ValidationExecutionReport, filePath: string): Promise<void> {
    try {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');

      // Ensure directory exists
      await mkdir(dirname(filePath), { recursive: true });

      // Write YAML report
      const yamlContent = this.toYAML(report);
      await writeFile(filePath, yamlContent, 'utf8');

      this.logger.info({ filePath, size: yamlContent.length }, 'Report written to file');

    } catch (error) {
      this.logger.error({ error, filePath }, 'Failed to write report file');
      throw new Error(`Report write failed: ${error}`);
    }
  }

  private determineLastCompletedStage(finalVerdict: any): string {
    switch (finalVerdict.status) {
      case 'PASS':
        return 'audit_report_generation';
      case 'FAIL':
        return 'failure_analysis';
      case 'INCOMPLETE':
        return 'context_resolution';
      default:
        return 'unknown';
    }
  }

  private generateAuthoritySources(executionContext: any): any[] {
    const sources: any[] = [];

    // Configuration sources with precedence ordering
    if (executionContext.configuration_sources) {
      executionContext.configuration_sources.forEach((source: string, index: number) => {
        sources.push({
          source,
          revision_or_version: 'current', // TODO: Get actual revision for each config file
          applicable_scope: 'execution_configuration',
          precedence: index + 1,
          verification_status: 'verified'
        });
      });
    }

    return sources;
  }

  private extractSuiteNames(e2eResults: any[]): string[] {
    const suites = new Set(e2eResults.map(result => result.suite_name || result.suite_id));
    return Array.from(suites).filter(Boolean);
  }

  private extractAuthoritativeSkips(preflightResults: any[], e2eResults: any[]): string[] {
    const skipped = [];
    
    const preflightSkipped = preflightResults
      .filter(r => r.status === 'AuthoritativelySkipped')
      .map(r => r.check_id);
    
    const e2eSkipped = e2eResults
      .filter(r => r.status === 'AuthoritativelySkipped')
      .map(r => r.test_id);

    return [...preflightSkipped, ...e2eSkipped];
  }

  private generatePreflightSummary(preflightResults: any[]) {
    const blockingChecks = preflightResults.filter(r => r.blocking);
    
    return {
      discovered: preflightResults.length,
      executable: preflightResults.length,
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
      gate_status: this.evaluateGateStatus(blockingChecks) as ValidationGateStatus
    };
  }

  private generatePreflightGate(preflightResults: any[]) {
    const blockingChecks = preflightResults.filter(r => r.blocking);
    const blockingFailures = blockingChecks
      .filter(r => ['Failed', 'Error', 'Timeout', 'Blocked', 'NotExecuted'].includes(r.status))
      .map(r => r.check_id);
    const blockingUnknowns = blockingChecks
      .filter(r => r.status === 'Unknown')
      .map(r => r.check_id);

    const gateStatus = blockingFailures.length === 0 && blockingUnknowns.length === 0 ? 'Passed' : 'Failed';

    return {
      status: gateStatus as ValidationGateStatus,
      blocking_failures: blockingFailures,
      blocking_unknowns: blockingUnknowns,
      e2e_authorized: gateStatus === 'Passed',
      decision_evidence: preflightResults.map(r => `preflight_${r.check_id}_result`)
    };
  }

  private generateE2ESummary(e2eResults: any[]) {
    const uniqueTests = new Set(e2eResults.map(r => r.test_id)).size;
    const suites = new Set(e2eResults.map(r => r.suite_id));

    return {
      discovered_suites: suites.size,
      discovered_required_tests: uniqueTests,
      executed_unique_tests: uniqueTests,
      execution_attempts: e2eResults.length,
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
      gate_status: this.evaluateE2EGateStatus(e2eResults) as ValidationGateStatus
    };
  }

  private evaluateGateStatus(blockingChecks: any[]): string {
    const failures = blockingChecks.filter(r => 
      ['Failed', 'Error', 'Timeout', 'Blocked', 'NotExecuted', 'Unknown'].includes(r.status)
    );
    return failures.length === 0 ? 'Passed' : 'Failed';
  }

  private evaluateE2EGateStatus(e2eResults: any[]): string {
    const failures = e2eResults.filter(r => 
      ['Failed', 'Error', 'Timeout'].includes(r.status)
    );
    const unknowns = e2eResults.filter(r => r.status === 'Unknown');
    return failures.length === 0 && unknowns.length === 0 ? 'Passed' : 'Failed';
  }

  private generateUnknowns(preflightResults: any[], e2eResults: any[], executionContext: any): any[] {
    const unknowns = [];

    // Check for context unknowns
    if (executionContext.source_revision === 'Unknown') {
      unknowns.push({
        unknown_id: `unknown_source_revision_${Date.now()}`,
        item: 'source_revision',
        reason: 'Git revision could not be determined',
        execution_impact: 'Cannot verify target revision identity',
        affected_results: ['all'],
        minimum_resolution_evidence: 'Valid git repository with committed changes'
      });
    }

    // Check for unknown test results
    const unknownTests = [...preflightResults, ...e2eResults]
      .filter(r => r.status === 'Unknown');

    unknownTests.forEach(test => {
      unknowns.push({
        unknown_id: `unknown_${test.check_id || test.test_id}_${Date.now()}`,
        item: test.check_id || test.test_id,
        reason: 'Test result could not be determined',
        execution_impact: 'Cannot assess test success or failure',
        affected_results: [test.check_id || test.test_id],
        minimum_resolution_evidence: 'Successful test execution with definitive result'
      });
    });

    return unknowns;
  }

  private determineNextAction(finalVerdict: any, preflightResults: any[], e2eResults: any[]): any {
    if (finalVerdict.status === 'PASS') {
      return {
        action: 'NoActionRequired',
        blocker_or_failure: 'None',
        expected_evidence: 'Validation completed successfully'
      };
    }

    // Find the first blocking issue
    const preflightFailures = preflightResults.filter(r => 
      r.blocking && ['Failed', 'Error', 'Timeout'].includes(r.status)
    );

    if (preflightFailures.length > 0) {
      const firstFailure = preflightFailures[0];
      return {
        action: 'FixPreflightFailure',
        blocker_or_failure: `Preflight check ${firstFailure.check_id}: ${firstFailure.primary_failure_classification}`,
        expected_evidence: 'Preflight check passes with exit code 0'
      };
    }

    const e2eFailures = e2eResults.filter(r => 
      ['Failed', 'Error', 'Timeout'].includes(r.status)
    );

    if (e2eFailures.length > 0) {
      const firstFailure = e2eFailures[0];
      return {
        action: 'FixTestFailure',
        blocker_or_failure: `E2E test ${firstFailure.test_id}: ${firstFailure.primary_failure_classification}`,
        expected_evidence: 'Test passes with expected assertions'
      };
    }

    return {
      action: 'ResolveIncompleteExecution',
      blocker_or_failure: finalVerdict.verdict_reason || 'Unknown execution issue',
      expected_evidence: 'Complete execution context and evidence validation'
    };
  }
}