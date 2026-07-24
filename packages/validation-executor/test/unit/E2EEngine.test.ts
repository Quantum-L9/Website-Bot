/**
 * Unit tests for E2EEngine  
 * Tests E2E execution and blocking logic
 */

import { test, describe } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { E2EEngine } from '../../src/core/E2EEngine.js';
import { EvidenceCollector } from '../../src/core/EvidenceCollector.js';
import { createTestEnvironment, createMockE2ETests, MockRepositoryAdapter, assertions } from '../setup.js';
import type { E2ETestResult } from '../../src/types/index.js';

describe('E2EEngine', () => {
  test('executes E2E tests successfully and evaluates results', async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new E2EEngine(adapter, evidenceCollector);

    // Configure successful test executions
    adapter.setCommandResult('npm run test:api', process.cwd(), {
      exitCode: 0,
      stdout: 'API tests: 5 passed',
      stderr: '',
      duration: 2000
    });

    adapter.setCommandResult('npm run test:e2e', process.cwd(), {
      exitCode: 0,
      stdout: 'E2E tests: 3 passed',
      stderr: '',
      duration: 5000
    });

    const testDefinitions = createMockE2ETests();

    try {
      const results = await engine.executeAll(testDefinitions.map(def => ({
        ...def,
        status: 'NotExecuted',
        started_at: '',
        ended_at: '',
        duration: 0,
        assertion_or_error: null,
        exit_code_or_runner_result: null,
        primary_failure_classification: null,
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: []
      })));

      strictEqual(results.length, 2, 'Should execute all tests');

      // Validate API test result
      const apiTest = results.find(r => r.test_id === 'api-test');
      ok(apiTest, 'Should have API test result');
      strictEqual(apiTest.status, 'Passed', 'API test should pass');
      strictEqual(apiTest.exit_code_or_runner_result, 0, 'Should record exit code');
      ok(apiTest.duration > 0, 'Should record duration');

      // Validate E2E test result  
      const e2eTest = results.find(r => r.test_id === 'user-flow');
      ok(e2eTest, 'Should have E2E test result');
      strictEqual(e2eTest.status, 'Passed', 'E2E test should pass');

      // Evaluate overall results
      const evaluation = engine.evaluateResults(results);
      assertions.gateStatus(evaluation, 'Passed');

    } finally {
      await env.cleanup();
    }
  });

  test('properly classifies test failures vs assertion failures', async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new E2EEngine(adapter, evidenceCollector);

    // Configure assertion failure
    adapter.setCommandResult('npm run test:api', process.cwd(), {
      exitCode: 1,
      stdout: '',
      stderr: 'AssertionError: Expected 200, got 404\n    at test.js:15:5',
      duration: 1000
    });

    // Configure runtime failure
    adapter.setCommandResult('npm run test:e2e', process.cwd(), {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: ECONNREFUSED localhost:3000',
      duration: 500
    });

    const testDefinitions = createMockE2ETests();

    try {
      const results = await engine.executeAll(testDefinitions.map(def => ({
        ...def,
        status: 'NotExecuted',
        started_at: '',
        ended_at: '',
        duration: 0,
        assertion_or_error: null,
        exit_code_or_runner_result: null,
        primary_failure_classification: null,
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: []
      })));

      // Find assertion failure
      const apiTest = results.find(r => r.test_id === 'api-test');
      ok(apiTest, 'Should have API test result');
      strictEqual(apiTest.status, 'Failed', 'Should classify as failed');
      strictEqual(apiTest.primary_failure_classification, 'AssertionFailure', 'Should classify as assertion failure');
      ok(apiTest.assertion_or_error?.includes('AssertionError'), 'Should capture assertion error');

      // Find runtime failure
      const e2eTest = results.find(r => r.test_id === 'user-flow');
      ok(e2eTest, 'Should have E2E test result');
      strictEqual(e2eTest.status, 'Failed', 'Should classify as failed');
      strictEqual(e2eTest.primary_failure_classification, 'ApplicationRuntimeFailure', 'Should classify as runtime failure');
      ok(e2eTest.assertion_or_error?.includes('ECONNREFUSED'), 'Should capture connection error');

    } finally {
      await env.cleanup();
    }
  });

  test('marks tests as blocked by preflight gate correctly', async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new E2EEngine(adapter, evidenceCollector);

    const testDefinitions = createMockE2ETests();
    const tests: E2ETestResult[] = testDefinitions.map(def => ({
      ...def,
      status: 'NotExecuted',
      started_at: '',
      ended_at: '',
      duration: 0,
      assertion_or_error: null,
      exit_code_or_runner_result: null,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: []
    }));

    try {
      const blockedTests = engine.markBlockedByPreflightGate(tests);

      strictEqual(blockedTests.length, 2, 'Should block all tests');

      for (const test of blockedTests) {
        strictEqual(test.status, 'BlockedByPreflightGate', 'Should mark as blocked by preflight gate');
        strictEqual(test.primary_failure_classification, 'Blocked', 'Should classify as blocked');
        ok(test.assertion_or_error?.includes('blocked by failed preflight gate'), 'Should explain blocking reason');
        strictEqual(test.root_cause_group, 'preflight_gate_failure', 'Should group by preflight failure');
        ok(test.started_at, 'Should have timestamp');
        ok(test.ended_at, 'Should have end timestamp');
        strictEqual(test.duration, 0, 'Should have zero duration');
      }

    } finally {
      await env.cleanup();
    }
  });

  test('evaluates E2E gate as Failed when tests fail', async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new E2EEngine(adapter, evidenceCollector);

    const tests: E2ETestResult[] = [
      {
        suite_id: 'test-suite',
        suite_name: 'Test Suite',
        test_id: 'pass-test',
        test_name: 'Passing Test',
        attempt: 1,
        command_or_invocation: 'test pass',
        status: 'Passed',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 100,
        assertion_or_error: null,
        exit_code_or_runner_result: 0,
        primary_failure_classification: null,
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: ['pass_evidence']
      },
      {
        suite_id: 'test-suite',
        suite_name: 'Test Suite',
        test_id: 'fail-test',
        test_name: 'Failing Test',
        attempt: 1,
        command_or_invocation: 'test fail',
        status: 'Failed',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 50,
        assertion_or_error: 'Test assertion failed',
        exit_code_or_runner_result: 1,
        primary_failure_classification: 'AssertionFailure',
        contributing_causes: ['Logic error'],
        root_cause_group: 'test_failure',
        evidence_references: ['fail_evidence']
      }
    ];

    try {
      const evaluation = engine.evaluateResults(tests);
      
      assertions.gateStatus(evaluation, 'Failed');
      assertions.evidenceReferences(evaluation.evidence_references);

    } finally {
      await env.cleanup();
    }
  });

  test('evaluates E2E gate as Passed when all tests pass', async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new E2EEngine(adapter, evidenceCollector);

    const tests: E2ETestResult[] = [
      {
        suite_id: 'test-suite',
        suite_name: 'Test Suite',
        test_id: 'test1',
        test_name: 'Test 1',
        attempt: 1,
        command_or_invocation: 'test1',
        status: 'Passed',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 100,
        assertion_or_error: null,
        exit_code_or_runner_result: 0,
        primary_failure_classification: null,
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: ['test1_evidence']
      },
      {
        suite_id: 'test-suite',
        suite_name: 'Test Suite', 
        test_id: 'test2',
        test_name: 'Test 2',
        attempt: 1,
        command_or_invocation: 'test2',
        status: 'Passed',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 200,
        assertion_or_error: null,
        exit_code_or_runner_result: 0,
        primary_failure_classification: null,
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: ['test2_evidence']
      }
    ];

    try {
      const evaluation = engine.evaluateResults(tests);
      
      assertions.gateStatus(evaluation, 'Passed');
      assertions.evidenceReferences(evaluation.evidence_references);

    } finally {
      await env.cleanup();
    }
  });

  test('generates comprehensive summary with correct metrics', async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new E2EEngine(adapter, evidenceCollector);

    const tests: E2ETestResult[] = [
      // Passed test
      {
        suite_id: 'suite1',
        suite_name: 'Suite 1',
        test_id: 'pass1',
        test_name: 'Pass 1',
        attempt: 1,
        command_or_invocation: 'pass1',
        status: 'Passed',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 100,
        assertion_or_error: null,
        exit_code_or_runner_result: 0,
        primary_failure_classification: null,
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: ['pass1_evidence']
      },
      // Failed test
      {
        suite_id: 'suite1',
        suite_name: 'Suite 1',
        test_id: 'fail1',
        test_name: 'Fail 1',
        attempt: 1,
        command_or_invocation: 'fail1',
        status: 'Failed',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 50,
        assertion_or_error: 'Assertion failed',
        exit_code_or_runner_result: 1,
        primary_failure_classification: 'AssertionFailure',
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: ['fail1_evidence']
      },
      // Blocked test
      {
        suite_id: 'suite2',
        suite_name: 'Suite 2', 
        test_id: 'blocked1',
        test_name: 'Blocked 1',
        attempt: 1,
        command_or_invocation: 'blocked1',
        status: 'BlockedByPreflightGate',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 0,
        assertion_or_error: 'Blocked by preflight',
        exit_code_or_runner_result: null,
        primary_failure_classification: 'Blocked',
        contributing_causes: [],
        root_cause_group: 'preflight_gate_failure',
        evidence_references: ['blocked1_evidence']
      }
    ];

    try {
      const summary = engine.generateSummary(tests);

      strictEqual(summary.discovered_suites, 2, 'Should count unique suites');
      strictEqual(summary.discovered_required_tests, 3, 'Should count unique tests');
      strictEqual(summary.executed_unique_tests, 2, 'Should count only actually executed tests (not blocked)');
      strictEqual(summary.execution_attempts, 3, 'Should count execution attempts');
      strictEqual(summary.passed, 1, 'Should count passed tests');
      strictEqual(summary.failed, 1, 'Should count failed tests');
      strictEqual(summary.blocked_by_preflight_gate, 1, 'Should count blocked tests');
      strictEqual(summary.gate_status, 'Failed', 'Gate should fail due to failed test');

    } finally {
      await env.cleanup();
    }
  });
});