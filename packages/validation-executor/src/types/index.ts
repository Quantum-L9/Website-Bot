/**
 * Evidence-Driven Validation Execution Types
 * Based on the comprehensive validation specification
 */

export type PreflightStatus = 
  | 'Passed' 
  | 'Failed' 
  | 'Error' 
  | 'Timeout' 
  | 'Blocked' 
  | 'AuthoritativelySkipped' 
  | 'NotExecuted' 
  | 'Unknown';

export type E2EStatus = 
  | 'Passed' 
  | 'Failed' 
  | 'Error' 
  | 'Timeout' 
  | 'BlockedByPreflightGate' 
  | 'BlockedByAuthoritativeFailFast' 
  | 'Blocked' 
  | 'AuthoritativelySkipped' 
  | 'NotExecuted' 
  | 'Unknown';

export type FinalVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

export type ValidationGateStatus = 'Passed' | 'Failed' | 'Unknown';

export type PrimaryFailureClassification = 
  | 'PreflightFailure'
  | 'AssertionFailure'
  | 'ApplicationRuntimeFailure'
  | 'RunnerFailure'
  | 'DependencyFailure'
  | 'CredentialFailure'
  | 'ConfigurationDefect'
  | 'EnvironmentFailure'
  | 'AccessFailure'
  | 'Timeout'
  | 'Regression'
  | 'Blocked'
  | 'AuthoritativelySkipped'
  | 'Unknown';

export interface ExecutionContext {
  target_roots: string[];
  source_revision: string;
  running_revision: string | null;
  target_environment: string;
  environment_type: string;
  active_identity: string;
  preflight_commands: string[];
  e2e_commands: string[];
  test_runner: string;
  test_runner_version: string;
  configuration_sources: string[];
  required_services: string[];
  target_endpoints: string[];
  required_dependencies: string[];
  required_credentials: string[];
  evidence_root: string;
}

export interface PreflightCheck {
  check_id: string;
  check_name: string;
  blocking: boolean;
  command: string;
  working_directory: string;
  status: PreflightStatus;
  exit_code: number | null;
  termination_signal: string | null;
  started_at: string;
  ended_at: string;
  duration: number;
  primary_failure_classification: PrimaryFailureClassification | null;
  contributing_causes: string[];
  root_cause_group: string | null;
  evidence_references: string[];
}

export interface E2ETestResult {
  suite_id: string;
  suite_name: string;
  test_id: string;
  test_name: string;
  attempt: number;
  command_or_invocation: string;
  status: E2EStatus;
  started_at: string;
  ended_at: string;
  duration: number;
  assertion_or_error: string | null;
  exit_code_or_runner_result: number | string | null;
  primary_failure_classification: PrimaryFailureClassification | null;
  contributing_causes: string[];
  root_cause_group: string | null;
  evidence_references: string[];
}

export interface ValidationGate {
  status: ValidationGateStatus;
  evidence_references: string[];
}

export interface ValidationExecutionReport {
  run_metadata: {
    run_id: string;
    report_schema_version: string;
    started_at: string;
    ended_at: string;
    duration: number;
    last_completed_stage: string;
  };
  
  execution_context: ExecutionContext;
  
  authority_sources: Array<{
    source: string;
    revision_or_version: string;
    applicable_scope: string;
    precedence: number;
    verification_status: string;
  }>;
  
  discovery_inventory: {
    preflight_checks: PreflightCheck[];
    e2e_suites: string[];
    required_e2e_tests: E2ETestResult[];
    dynamic_inventory_items: string[];
    authoritative_skips: string[];
    inventory_sources: string[];
    inventory_status: string;
  };
  
  preflight_summary: {
    discovered: number;
    executable: number;
    executed: number;
    passed: number;
    failed: number;
    errors: number;
    timeouts: number;
    blocked: number;
    authoritatively_skipped: number;
    not_executed: number;
    unknown: number;
    blocking_total: number;
    blocking_passed: number;
    gate_status: ValidationGateStatus;
  };
  
  preflight_results: PreflightCheck[];
  
  preflight_gate: {
    status: ValidationGateStatus;
    blocking_failures: string[];
    blocking_unknowns: string[];
    e2e_authorized: boolean;
    decision_evidence: string[];
  };
  
  e2e_summary: {
    discovered_suites: number;
    discovered_required_tests: number;
    executed_unique_tests: number;
    execution_attempts: number;
    passed: number;
    failed: number;
    errors: number;
    timeouts: number;
    blocked_by_preflight_gate: number;
    blocked_by_authoritative_fail_fast: number;
    blocked: number;
    not_executed: number;
    authoritatively_skipped: number;
    unknown: number;
    runner_crashes: number;
    gate_status: ValidationGateStatus;
  };
  
  e2e_results: E2ETestResult[];
  
  coverage_reconciliation: {
    preflight_discovered_total: number;
    preflight_accounted_total: number;
    preflight_reconciled: boolean;
    e2e_required_discovered_total: number;
    e2e_required_accounted_total: number;
    e2e_reconciled: boolean;
    dynamic_inventory_reconciliation: string;
    retry_accounting: string;
    unaccounted_items: string[];
    status: string;
  };
  
  root_cause_groups: Array<{
    group_id: string;
    primary_cause: string;
    confidence: string;
    affected_result_ids: string[];
    evidence_references: string[];
  }>;
  
  defects: Array<{
    defect_id: string;
    category: string;
    severity: string;
    confidence: string;
    affected_component: string;
    observed_behavior: string;
    expected_behavior: string;
    primary_failure_classification: PrimaryFailureClassification;
    contributing_causes: string[];
    evidence_references: string[];
  }>;
  
  regressions: Array<{
    regression_id: string;
    affected_component: string;
    baseline_revision: string;
    baseline_environment: string;
    baseline_configuration: string;
    verified_baseline_behavior: string;
    current_behavior: string;
    confidence: string;
    evidence_references: string[];
  }>;
  
  unknowns: Array<{
    unknown_id: string;
    item: string;
    reason: string;
    execution_impact: string;
    affected_results: string[];
    minimum_resolution_evidence: string;
  }>;
  
  evidence_manifest: Array<{
    evidence_id: string;
    evidence_type: string;
    path_or_reference: string;
    checksum: string | null;
    redaction_status: string;
    availability_status: string;
  }>;
  
  validation_gates: {
    execution_context_resolved: ValidationGate;
    authoritative_inventory_resolved: ValidationGate;
    preparation_passed: ValidationGate;
    preflight_inventory_complete: ValidationGate;
    preflight_passed: ValidationGate;
    e2e_gate_enforced: ValidationGate;
    e2e_inventory_complete: ValidationGate;
    e2e_tests_passed: ValidationGate;
    no_unauthorized_skips: ValidationGate;
    no_result_replacement: ValidationGate;
    evidence_complete: ValidationGate;
    failure_classification_complete: ValidationGate;
    regression_evidence_valid: ValidationGate;
    coverage_reconciled: ValidationGate;
    target_unchanged: ValidationGate;
    report_schema_valid: ValidationGate;
    overall_validation_run: ValidationGate;
  };
  
  final_verdict: {
    status: FinalVerdict;
    preflight_status: string;
    e2e_status: string;
    coverage_status: string;
    evidence_status: string;
    required_failure_count: number;
    blocking_defect_ids: string[];
    unknown_count: number;
    verdict_reason: string;
  };
  
  minimum_safe_next_action: {
    action: string;
    blocker_or_failure: string;
    expected_evidence: string;
  };
}

export interface ValidationConfig {
  target?: string;
  environment?: string;
  profile?: string;
  preflight_commands?: string[];
  e2e_commands?: string[];
  evidence_root?: string;
  timeout?: number;
  fail_fast?: boolean;
  skip_patterns?: string[];
}

export interface RepositoryAdapter {
  resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext>;
  discoverPreflightChecks(): Promise<PreflightCheck[]>;
  discoverE2ETests(): Promise<E2ETestResult[]>;
  executeCommand(command: string, workingDir: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
  }>;
  storeEvidence(evidenceId: string, data: any): Promise<string>;
  loadBaseline?(testId: string): Promise<any>;
}