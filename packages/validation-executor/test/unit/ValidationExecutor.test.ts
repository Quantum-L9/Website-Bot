/**
 * Unit tests for ValidationExecutor
 * Tests orchestration logic and gate sequencing
 */

import { test, describe } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { ValidationExecutor } from '../../src/core/ValidationExecutor.js';
import { createTestEnvironment, createMockConfig, MockRepositoryAdapter, assertions } from '../setup.js';
import type { FinalVerdict } from '../../src/types/index.js';

describe('ValidationExecutor', () => {
  test('executes complete validation workflow successfully', async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({ evidence_root: env.evidenceDir });
    const adapter = new MockRepositoryAdapter();
    
    // Configure successful command executions
    adapter.setCommandResult('npm run typecheck', '/test/root', {
      exitCode: 0,
      stdout: 'Type checking passed',
      stderr: '',
      duration: 1000
    });
    
    adapter.setCommandResult('npm run test:api', '/test/root', {
      exitCode: 0,
      stdout: 'API tests passed',
      stderr: '',
      duration: 2000
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Validate report structure
      ok(report.run_metadata, 'Report should have run metadata');
      ok(report.run_metadata.run_id, 'Report should have run ID');
      ok(report.execution_context, 'Report should have execution context');
      ok(report.preflight_summary, 'Report should have preflight summary');
      ok(report.e2e_summary, 'Report should have E2E summary');
      ok(report.final_verdict, 'Report should have final verdict');

      // Validate successful execution
      strictEqual(report.final_verdict.status, 'PASS' as FinalVerdict);
      ok(report.preflight_summary.passed > 0, 'Should have passing preflight checks');
      ok(report.e2e_summary.passed > 0, 'Should have passing E2E tests');

      // Validate validation gates
      assertions.gateStatus(report.validation_gates.execution_context_resolved, 'Passed');
      assertions.gateStatus(report.validation_gates.preflight_passed, 'Passed');
      assertions.gateStatus(report.validation_gates.e2e_tests_passed, 'Passed');

    } finally {
      await env.cleanup();
    }
  });

  test('blocks E2E execution when preflight gate fails', async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({ evidence_root: env.evidenceDir });
    const adapter = new MockRepositoryAdapter();
    
    // Configure failing preflight command
    adapter.setCommandResult('npm run typecheck', '/test/root', {
      exitCode: 1,
      stdout: '',
      stderr: 'Type check failed: Found 5 errors',
      duration: 1000
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Should fail overall
      strictEqual(report.final_verdict.status, 'FAIL' as FinalVerdict);
      
      // Preflight should fail
      assertions.gateStatus(report.validation_gates.preflight_passed, 'Failed');
      ok(report.preflight_summary.failed > 0, 'Should have failed preflight checks');

      // E2E should be blocked
      ok(report.e2e_summary.blocked_by_preflight_gate > 0, 'E2E tests should be blocked by preflight gate');
      
      // E2E tests should show as blocked, not executed
      strictEqual(report.e2e_summary.executed_unique_tests, 0, 'No E2E tests should be executed');

    } finally {
      await env.cleanup();
    }
  });

  test('handles execution context validation failure', async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({ 
      evidence_root: env.evidenceDir,
      preflight_commands: [], // No preflight commands
      e2e_commands: [] // No E2E commands - should fail context validation
    });
    const adapter = new MockRepositoryAdapter([], []); // No checks or tests

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Should be incomplete due to context validation failure
      strictEqual(report.final_verdict.status, 'INCOMPLETE' as FinalVerdict);
      
      // Context resolution should fail
      assertions.gateStatus(report.validation_gates.execution_context_resolved, 'Failed');

    } finally {
      await env.cleanup();
    }
  });

  test('generates proper evidence references throughout execution', async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({ evidence_root: env.evidenceDir });
    const adapter = new MockRepositoryAdapter();

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Validate evidence references in gates
      assertions.evidenceReferences(report.validation_gates.execution_context_resolved.evidence_references);
      assertions.evidenceReferences(report.validation_gates.preflight_passed.evidence_references);
      assertions.evidenceReferences(report.validation_gates.e2e_tests_passed.evidence_references);

      // Validate evidence manifest
      ok(report.evidence_manifest, 'Should have evidence manifest');
      ok(Array.isArray(report.evidence_manifest), 'Evidence manifest should be array');
      ok(report.evidence_manifest.length > 0, 'Should have evidence entries');

    } finally {
      await env.cleanup();
    }
  });

  test('properly classifies preflight vs E2E failures', async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({ evidence_root: env.evidenceDir });
    const adapter = new MockRepositoryAdapter();
    
    // Configure mixed results - preflight passes, E2E fails
    adapter.setCommandResult('npm run typecheck', '/test/root', {
      exitCode: 0,
      stdout: 'Types OK',
      stderr: '',
      duration: 500
    });
    
    adapter.setCommandResult('npm run test:api', process.cwd(), {
      exitCode: 1,
      stdout: '',
      stderr: 'API test failed: Connection refused',
      duration: 1000
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Overall should fail due to E2E failure
      strictEqual(report.final_verdict.status, 'FAIL' as FinalVerdict);
      
      // Preflight should pass
      assertions.gateStatus(report.validation_gates.preflight_passed, 'Passed');
      ok(report.preflight_summary.passed > 0, 'Preflight should pass');
      
      // E2E should fail
      assertions.gateStatus(report.validation_gates.e2e_tests_passed, 'Failed');
      ok(report.e2e_summary.failed > 0, 'E2E should fail');
      
      // E2E should be executed (not blocked by preflight)
      ok(report.e2e_summary.executed_unique_tests > 0, 'E2E tests should be executed');

    } finally {
      await env.cleanup();
    }
  });

  test('validates final verdict logic for all status combinations', async () => {
    const testCases = [
      { 
        preflightPass: true, 
        e2ePass: true, 
        expectedVerdict: 'PASS' as FinalVerdict,
        description: 'both pass' 
      },
      { 
        preflightPass: false, 
        e2ePass: true, 
        expectedVerdict: 'FAIL' as FinalVerdict,
        description: 'preflight fails' 
      },
      { 
        preflightPass: true, 
        e2ePass: false, 
        expectedVerdict: 'FAIL' as FinalVerdict,
        description: 'E2E fails' 
      },
      { 
        preflightPass: false, 
        e2ePass: false, 
        expectedVerdict: 'FAIL' as FinalVerdict,
        description: 'both fail' 
      }
    ];

    for (const testCase of testCases) {
      const env = await createTestEnvironment();
      const config = createMockConfig({ evidence_root: env.evidenceDir });
      const adapter = new MockRepositoryAdapter();

      // Configure command results based on test case
      adapter.setCommandResult('npm run typecheck', '/test/root', {
        exitCode: testCase.preflightPass ? 0 : 1,
        stdout: testCase.preflightPass ? 'Success' : '',
        stderr: testCase.preflightPass ? '' : 'Preflight failed',
        duration: 500
      });

      if (testCase.preflightPass) {
        adapter.setCommandResult('npm run test:api', process.cwd(), {
          exitCode: testCase.e2ePass ? 0 : 1,
          stdout: testCase.e2ePass ? 'Success' : '',
          stderr: testCase.e2ePass ? '' : 'E2E failed',
          duration: 1000
        });
      }

      try {
        const executor = new ValidationExecutor(adapter, config);
        const report = await executor.execute();

        strictEqual(
          report.final_verdict.status, 
          testCase.expectedVerdict,
          `Final verdict should be ${testCase.expectedVerdict} when ${testCase.description}`
        );

      } finally {
        await env.cleanup();
      }
    }
  });
});