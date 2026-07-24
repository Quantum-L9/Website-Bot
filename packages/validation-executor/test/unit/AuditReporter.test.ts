/**
 * Unit tests for AuditReporter
 * Tests report generation and schema compliance
 */

import { test, describe } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { AuditReporter } from '../../src/core/AuditReporter.js';
import { createTestEnvironment, createMockExecutionContext } from '../setup.js';

describe('AuditReporter', () => {
  test('generates complete validation execution report', async () => {
    const env = await createTestEnvironment();
    const reporter = new AuditReporter();

    const reportData = {
      runId: 'test-run-123',
      startedAt: '2024-01-01T10:00:00.000Z',
      endedAt: '2024-01-01T10:05:00.000Z',
      executionContext: createMockExecutionContext(),
      preflightResults: [
        {
          check_id: 'typecheck',
          check_name: 'TypeScript Check',
          blocking: true,
          command: 'npm run typecheck',
          working_directory: '/test',
          status: 'Passed',
          exit_code: 0,
          termination_signal: null,
          started_at: '2024-01-01T10:01:00.000Z',
          ended_at: '2024-01-01T10:02:00.000Z',
          duration: 60000,
          primary_failure_classification: null,
          contributing_causes: [],
          root_cause_group: null,
          evidence_references: ['typecheck_evidence']
        }
      ],
      e2eResults: [
        {
          suite_id: 'api-tests',
          suite_name: 'API Test Suite',
          test_id: 'login-test',
          test_name: 'User Login Test',
          attempt: 1,
          command_or_invocation: 'npm run test:login',
          status: 'Passed',
          started_at: '2024-01-01T10:03:00.000Z',
          ended_at: '2024-01-01T10:04:00.000Z',
          duration: 45000,
          assertion_or_error: null,
          exit_code_or_runner_result: 0,
          primary_failure_classification: null,
          contributing_causes: [],
          root_cause_group: null,
          evidence_references: ['login_test_evidence']
        }
      ],
      evidenceManifest: [
        {
          evidence_id: 'typecheck_evidence',
          evidence_type: 'command_execution',
          file_path: 'typecheck_evidence.json',
          checksum: 'abc123',
          file_size: 256,
          created_at: '2024-01-01T10:02:00.000Z',
          integrity_validated: true
        }
      ],
      rootCauseGroups: [],
      defects: [],
      regressions: [],
      coverage: { status: 'Passed', percentage: 95 },
      validationGates: {
        execution_context_resolved: { status: 'Passed', evidence_references: ['context_evidence'] },
        preflight_passed: { status: 'Passed', evidence_references: ['preflight_evidence'] },
        e2e_tests_passed: { status: 'Passed', evidence_references: ['e2e_evidence'] },
        coverage_reconciled: { status: 'Passed', evidence_references: ['coverage_evidence'] },
        evidence_complete: { status: 'Passed', evidence_references: ['manifest_evidence'] },
        target_unchanged: { status: 'Passed', evidence_references: [] },
        report_schema_valid: { status: 'Passed', evidence_references: [] },
        overall_validation_run: { status: 'Passed', evidence_references: [] }
      },
      finalVerdict: {
        status: 'PASS',
        preflight_status: 'Passed',
        e2e_status: 'Passed',
        coverage_status: 'Passed',
        evidence_status: 'Complete',
        required_failure_count: 0,
        blocking_defect_ids: [],
        unknown_count: 0,
        verdict_reason: 'All validation gates passed'
      }
    };

    try {
      const report = reporter.generateReport(reportData);

      // Validate report structure
      ok(report.run_metadata, 'Should have run metadata');
      strictEqual(report.run_metadata.run_id, 'test-run-123', 'Should preserve run ID');
      ok(report.run_metadata.duration > 0, 'Should calculate duration');

      // Validate execution context
      ok(report.execution_context, 'Should have execution context');
      strictEqual(report.execution_context.target_environment, 'test', 'Should preserve context data');

      // Validate preflight summary
      ok(report.preflight_summary, 'Should have preflight summary');
      strictEqual(report.preflight_summary.discovered, 1, 'Should count discovered checks');
      strictEqual(report.preflight_summary.passed, 1, 'Should count passed checks');
      strictEqual(report.preflight_summary.gate_status, 'Passed', 'Should evaluate gate status');

      // Validate E2E summary  
      ok(report.e2e_summary, 'Should have E2E summary');
      strictEqual(report.e2e_summary.discovered_suites, 1, 'Should count suites');
      strictEqual(report.e2e_summary.passed, 1, 'Should count passed tests');

      // Validate final verdict
      ok(report.final_verdict, 'Should have final verdict');
      strictEqual(report.final_verdict.status, 'PASS', 'Should determine correct verdict');

      // Validate evidence manifest
      ok(report.evidence_manifest, 'Should have evidence manifest');
      strictEqual(report.evidence_manifest.length, 1, 'Should include evidence entries');

    } finally {
      await env.cleanup();
    }
  });

  test('generates valid YAML output', async () => {
    const env = await createTestEnvironment();
    const reporter = new AuditReporter();

    const minimalReportData = {
      runId: 'yaml-test-123',
      startedAt: '2024-01-01T10:00:00.000Z',
      endedAt: '2024-01-01T10:01:00.000Z',
      executionContext: createMockExecutionContext(),
      preflightResults: [],
      e2eResults: [],
      evidenceManifest: [],
      rootCauseGroups: [],
      defects: [],
      regressions: [],
      coverage: { status: 'Passed', percentage: 0 },
      validationGates: {
        execution_context_resolved: { status: 'Passed', evidence_references: [] },
        preflight_passed: { status: 'Passed', evidence_references: [] },
        e2e_tests_passed: { status: 'Passed', evidence_references: [] },
        coverage_reconciled: { status: 'Passed', evidence_references: [] },
        evidence_complete: { status: 'Passed', evidence_references: [] },
        target_unchanged: { status: 'Passed', evidence_references: [] },
        report_schema_valid: { status: 'Passed', evidence_references: [] },
        overall_validation_run: { status: 'Passed', evidence_references: [] }
      },
      finalVerdict: {
        status: 'PASS',
        preflight_status: 'Passed',
        e2e_status: 'Passed',
        coverage_status: 'Passed',
        evidence_status: 'Complete',
        required_failure_count: 0,
        blocking_defect_ids: [],
        unknown_count: 0,
        verdict_reason: 'No tests executed'
      }
    };

    try {
      const report = reporter.generateReport(minimalReportData);
      const yamlContent = reporter.toYAML(report);

      // Validate YAML syntax
      ok(yamlContent, 'Should generate YAML content');
      ok(yamlContent.includes('run_metadata:'), 'Should contain run metadata section');
      ok(yamlContent.includes('final_verdict:'), 'Should contain final verdict section');

      // Parse YAML to validate structure
      const parsedYaml = yamlParse(yamlContent);
      ok(parsedYaml, 'YAML should be parseable');
      strictEqual(parsedYaml.run_metadata.run_id, 'yaml-test-123', 'Should preserve data in YAML');

    } finally {
      await env.cleanup();
    }
  });

  test('writes report to file correctly', async () => {
    const env = await createTestEnvironment();
    const reporter = new AuditReporter();
    const reportPath = join(env.tempDir, 'test-report.yaml');

    const reportData = {
      runId: 'file-test-123',
      startedAt: '2024-01-01T10:00:00.000Z',
      endedAt: '2024-01-01T10:01:00.000Z',
      executionContext: createMockExecutionContext(),
      preflightResults: [],
      e2eResults: [],
      evidenceManifest: [],
      rootCauseGroups: [],
      defects: [],
      regressions: [],
      coverage: { status: 'Passed', percentage: 0 },
      validationGates: {
        execution_context_resolved: { status: 'Passed', evidence_references: [] },
        preflight_passed: { status: 'Passed', evidence_references: [] },
        e2e_tests_passed: { status: 'Passed', evidence_references: [] },
        coverage_reconciled: { status: 'Passed', evidence_references: [] },
        evidence_complete: { status: 'Passed', evidence_references: [] },
        target_unchanged: { status: 'Passed', evidence_references: [] },
        report_schema_valid: { status: 'Passed', evidence_references: [] },
        overall_validation_run: { status: 'Passed', evidence_references: [] }
      },
      finalVerdict: {
        status: 'PASS',
        preflight_status: 'Passed',
        e2e_status: 'Passed',
        coverage_status: 'Passed',
        evidence_status: 'Complete',
        required_failure_count: 0,
        blocking_defect_ids: [],
        unknown_count: 0,
        verdict_reason: 'No tests executed'
      }
    };

    try {
      const report = reporter.generateReport(reportData);
      await reporter.writeReport(report, reportPath);

      // Verify file was written
      const fileContent = await readFile(reportPath, 'utf8');
      ok(fileContent, 'Report file should have content');
      ok(fileContent.includes('run_metadata:'), 'File should contain YAML report');

      // Verify content is valid YAML
      const parsedReport = yamlParse(fileContent);
      strictEqual(parsedReport.run_metadata.run_id, 'file-test-123', 'File content should match report data');

    } finally {
      await env.cleanup();
    }
  });

  test('creates output directory if it does not exist', async () => {
    const env = await createTestEnvironment();
    const reporter = new AuditReporter();
    const nestedDir = join(env.tempDir, 'nested', 'reports');
    const reportPath = join(nestedDir, 'report.yaml');

    const reportData = {
      runId: 'directory-test-123',
      startedAt: '2024-01-01T10:00:00.000Z',
      endedAt: '2024-01-01T10:01:00.000Z',
      executionContext: createMockExecutionContext(),
      preflightResults: [],
      e2eResults: [],
      evidenceManifest: [],
      rootCauseGroups: [],
      defects: [],
      regressions: [],
      coverage: { status: 'Passed', percentage: 0 },
      validationGates: {
        execution_context_resolved: { status: 'Passed', evidence_references: [] },
        preflight_passed: { status: 'Passed', evidence_references: [] },
        e2e_tests_passed: { status: 'Passed', evidence_references: [] },
        coverage_reconciled: { status: 'Passed', evidence_references: [] },
        evidence_complete: { status: 'Passed', evidence_references: [] },
        target_unchanged: { status: 'Passed', evidence_references: [] },
        report_schema_valid: { status: 'Passed', evidence_references: [] },
        overall_validation_run: { status: 'Passed', evidence_references: [] }
      },
      finalVerdict: {
        status: 'PASS',
        preflight_status: 'Passed',
        e2e_status: 'Passed',
        coverage_status: 'Passed',
        evidence_status: 'Complete',
        required_failure_count: 0,
        blocking_defect_ids: [],
        unknown_count: 0,
        verdict_reason: 'No tests executed'
      }
    };

    try {
      const report = reporter.generateReport(reportData);
      await reporter.writeReport(report, reportPath);

      // Verify directory was created and file written
      const fileContent = await readFile(reportPath, 'utf8');
      ok(fileContent, 'Should create directory and write file');

    } finally {
      await env.cleanup();
    }
  });

  test('evaluates preflight gate status correctly', async () => {
    const env = await createTestEnvironment();
    const reporter = new AuditReporter();

    const testCases = [
      {
        description: 'all blocking checks pass',
        preflightResults: [
          {
            check_id: 'test1',
            blocking: true,
            status: 'Passed',
            check_name: 'Test 1',
            command: 'test',
            working_directory: '/test',
            exit_code: 0,
            termination_signal: null,
            started_at: '2024-01-01T10:00:00.000Z',
            ended_at: '2024-01-01T10:01:00.000Z',
            duration: 60000,
            primary_failure_classification: null,
            contributing_causes: [],
            root_cause_group: null,
            evidence_references: []
          }
        ],
        expectedGateStatus: 'Passed'
      },
      {
        description: 'blocking check fails',
        preflightResults: [
          {
            check_id: 'test1',
            blocking: true,
            status: 'Failed',
            check_name: 'Test 1',
            command: 'test',
            working_directory: '/test',
            exit_code: 1,
            termination_signal: null,
            started_at: '2024-01-01T10:00:00.000Z',
            ended_at: '2024-01-01T10:01:00.000Z',
            duration: 60000,
            primary_failure_classification: 'PreflightFailure',
            contributing_causes: [],
            root_cause_group: null,
            evidence_references: []
          }
        ],
        expectedGateStatus: 'Failed'
      },
      {
        description: 'only non-blocking check fails',
        preflightResults: [
          {
            check_id: 'test1',
            blocking: false,
            status: 'Failed',
            check_name: 'Test 1',
            command: 'test',
            working_directory: '/test',
            exit_code: 1,
            termination_signal: null,
            started_at: '2024-01-01T10:00:00.000Z',
            ended_at: '2024-01-01T10:01:00.000Z',
            duration: 60000,
            primary_failure_classification: 'PreflightFailure',
            contributing_causes: [],
            root_cause_group: null,
            evidence_references: []
          }
        ],
        expectedGateStatus: 'Passed'
      }
    ];

    for (const testCase of testCases) {
      try {
        const reportData = {
          runId: `gate-test-${Date.now()}`,
          startedAt: '2024-01-01T10:00:00.000Z',
          endedAt: '2024-01-01T10:05:00.000Z',
          executionContext: createMockExecutionContext(),
          preflightResults: testCase.preflightResults,
          e2eResults: [],
          evidenceManifest: [],
          rootCauseGroups: [],
          defects: [],
          regressions: [],
          coverage: { status: 'Passed', percentage: 0 },
          validationGates: {
            execution_context_resolved: { status: 'Passed', evidence_references: [] },
            preflight_passed: { status: testCase.expectedGateStatus, evidence_references: [] },
            e2e_tests_passed: { status: 'Passed', evidence_references: [] },
            coverage_reconciled: { status: 'Passed', evidence_references: [] },
            evidence_complete: { status: 'Passed', evidence_references: [] },
            target_unchanged: { status: 'Passed', evidence_references: [] },
            report_schema_valid: { status: 'Passed', evidence_references: [] },
            overall_validation_run: { status: 'Passed', evidence_references: [] }
          },
          finalVerdict: {
            status: testCase.expectedGateStatus === 'Passed' ? 'PASS' : 'FAIL',
            preflight_status: testCase.expectedGateStatus,
            e2e_status: 'Passed',
            coverage_status: 'Passed',
            evidence_status: 'Complete',
            required_failure_count: testCase.expectedGateStatus === 'Failed' ? 1 : 0,
            blocking_defect_ids: [],
            unknown_count: 0,
            verdict_reason: testCase.description
          }
        };

        const report = reporter.generateReport(reportData);
        strictEqual(
          report.preflight_gate.status,
          testCase.expectedGateStatus,
          `Gate status should be ${testCase.expectedGateStatus} when ${testCase.description}`
        );

      } finally {
        // Individual test cleanup handled by outer cleanup
      }
    }

    await env.cleanup();
  });

  test('generates authority sources correctly', async () => {
    const env = await createTestEnvironment();
    const reporter = new AuditReporter();

    const executionContext = createMockExecutionContext({
      configuration_sources: ['package.json', 'tsconfig.json', '.env.example'],
      source_revision: 'commit-abc123'
    });

    const reportData = {
      runId: 'authority-test-123',
      startedAt: '2024-01-01T10:00:00.000Z',
      endedAt: '2024-01-01T10:01:00.000Z',
      executionContext,
      preflightResults: [],
      e2eResults: [],
      evidenceManifest: [],
      rootCauseGroups: [],
      defects: [],
      regressions: [],
      coverage: { status: 'Passed', percentage: 0 },
      validationGates: {
        execution_context_resolved: { status: 'Passed', evidence_references: [] },
        preflight_passed: { status: 'Passed', evidence_references: [] },
        e2e_tests_passed: { status: 'Passed', evidence_references: [] },
        coverage_reconciled: { status: 'Passed', evidence_references: [] },
        evidence_complete: { status: 'Passed', evidence_references: [] },
        target_unchanged: { status: 'Passed', evidence_references: [] },
        report_schema_valid: { status: 'Passed', evidence_references: [] },
        overall_validation_run: { status: 'Passed', evidence_references: [] }
      },
      finalVerdict: {
        status: 'PASS',
        preflight_status: 'Passed',
        e2e_status: 'Passed',
        coverage_status: 'Passed',
        evidence_status: 'Complete',
        required_failure_count: 0,
        blocking_defect_ids: [],
        unknown_count: 0,
        verdict_reason: 'Authority sources test'
      }
    };

    try {
      const report = reporter.generateReport(reportData);

      ok(report.authority_sources, 'Should have authority sources');
      ok(Array.isArray(report.authority_sources), 'Authority sources should be array');
      ok(report.authority_sources.length > 0, 'Should have authority source entries');

      // Check that configuration sources are included
      const packageJsonSource = report.authority_sources.find(s => s.source === 'package.json');
      ok(packageJsonSource, 'Should include package.json as authority source');
      strictEqual(packageJsonSource.revision_or_version, 'commit-abc123', 'Should use source revision');
      strictEqual(packageJsonSource.applicable_scope, 'execution_configuration', 'Should set correct scope');
      ok(packageJsonSource.precedence > 0, 'Should set precedence');

    } finally {
      await env.cleanup();
    }
  });

  test('detects dynamic inventory items correctly', async () => {
    const env = await createTestEnvironment();
    const reporter = new AuditReporter();

    const executionContext = createMockExecutionContext({
      target_environment: 'staging',
      required_services: ['redis', 'postgresql'],
      required_credentials: ['DATABASE_PASSWORD', 'API_KEY']
    });

    const reportData = {
      runId: 'inventory-test-123',
      startedAt: '2024-01-01T10:00:00.000Z',
      endedAt: '2024-01-01T10:01:00.000Z',
      executionContext,
      preflightResults: [],
      e2eResults: [],
      evidenceManifest: [],
      rootCauseGroups: [],
      defects: [],
      regressions: [],
      coverage: { status: 'Passed', percentage: 0 },
      validationGates: {
        execution_context_resolved: { status: 'Passed', evidence_references: [] },
        preflight_passed: { status: 'Passed', evidence_references: [] },
        e2e_tests_passed: { status: 'Passed', evidence_references: [] },
        coverage_reconciled: { status: 'Passed', evidence_references: [] },
        evidence_complete: { status: 'Passed', evidence_references: [] },
        target_unchanged: { status: 'Passed', evidence_references: [] },
        report_schema_valid: { status: 'Passed', evidence_references: [] },
        overall_validation_run: { status: 'Passed', evidence_references: [] }
      },
      finalVerdict: {
        status: 'PASS',
        preflight_status: 'Passed',
        e2e_status: 'Passed',
        coverage_status: 'Passed',
        evidence_status: 'Complete',
        required_failure_count: 0,
        blocking_defect_ids: [],
        unknown_count: 0,
        verdict_reason: 'Dynamic inventory test'
      }
    };

    try {
      const report = reporter.generateReport(reportData);

      const dynamicItems = report.discovery_inventory.dynamic_inventory_items;
      ok(Array.isArray(dynamicItems), 'Dynamic inventory should be array');

      // Should detect environment-specific config
      ok(dynamicItems.some(item => item.includes('environment-specific-config:staging')), 
        'Should detect staging environment config');

      // Should detect service dependencies
      ok(dynamicItems.some(item => item.includes('service-dependency:redis')),
        'Should detect Redis service dependency');
      ok(dynamicItems.some(item => item.includes('service-dependency:postgresql')),
        'Should detect PostgreSQL service dependency');

      // Should detect credential dependencies
      ok(dynamicItems.some(item => item.includes('credential-dependent:DATABASE_PASSWORD')),
        'Should detect database password credential');
      ok(dynamicItems.some(item => item.includes('credential-dependent:API_KEY')),
        'Should detect API key credential');

    } finally {
      await env.cleanup();
    }
  });
});