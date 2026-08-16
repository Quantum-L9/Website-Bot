/**
 * Integration tests for complete validation workflows
 * Tests end-to-end execution scenarios
 */

import { ok, strictEqual } from "node:assert";
import { describe, test } from "node:test";
import { ValidationExecutor } from "../../src/core/ValidationExecutor.js";
import { createMockConfig, createTestEnvironment, MockRepositoryAdapter } from "../setup.js";

describe("Validation Workflow Integration", () => {
  test("complete successful validation workflow", async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({
      evidence_root: env.evidenceDir,
      preflight_commands: ["npm run typecheck", "npm run lint"],
      e2e_commands: ["npm run test:unit", "npm run test:e2e"],
    });

    const adapter = new MockRepositoryAdapter(
      [
        {
          check_id: "typecheck",
          check_name: "TypeScript Check",
          blocking: true,
          command: "npm run typecheck",
          working_directory: "/test/root",
        },
        {
          check_id: "lint",
          check_name: "ESLint Check",
          blocking: false,
          command: "npm run lint",
          working_directory: "/test/root",
        },
      ],
      [
        {
          suite_id: "unit-tests",
          suite_name: "Unit Test Suite",
          test_id: "unit-test-1",
          test_name: "Core Logic Tests",
          attempt: 1,
          command_or_invocation: "npm run test:unit",
        },
        {
          suite_id: "e2e-tests",
          suite_name: "E2E Test Suite",
          test_id: "e2e-test-1",
          test_name: "User Journey Tests",
          attempt: 1,
          command_or_invocation: "npm run test:e2e",
        },
      ],
    );

    // Configure all commands to succeed
    adapter.setCommandResult("npm run typecheck", "/test/root", {
      exitCode: 0,
      stdout: "Found 0 errors",
      stderr: "",
      duration: 2000,
    });

    adapter.setCommandResult("npm run lint", "/test/root", {
      exitCode: 0,
      stdout: "No linting errors found",
      stderr: "",
      duration: 1000,
    });

    adapter.setCommandResult("npm run test:unit", "/test/root", {
      exitCode: 0,
      stdout: "Unit tests: 25 passed, 0 failed",
      stderr: "",
      duration: 5000,
    });

    adapter.setCommandResult("npm run test:e2e", "/test/root", {
      exitCode: 0,
      stdout: "E2E tests: 8 passed, 0 failed",
      stderr: "",
      duration: 15000,
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Validate overall success
      strictEqual(report.final_verdict.status, "PASS", "Overall validation should pass");

      // Validate preflight phase
      strictEqual(report.preflight_summary.discovered, 2, "Should discover both preflight checks");
      strictEqual(report.preflight_summary.passed, 2, "Both preflight checks should pass");
      strictEqual(report.preflight_summary.gate_status, "Passed", "Preflight gate should pass");

      // Validate E2E phase
      strictEqual(report.e2e_summary.discovered_suites, 2, "Should discover both test suites");
      strictEqual(report.e2e_summary.passed, 2, "Both E2E tests should pass");
      strictEqual(report.e2e_summary.blocked_by_preflight_gate, 0, "No tests should be blocked");

      // Validate validation gates
      strictEqual(report.validation_gates.execution_context_resolved.status, "Passed");
      strictEqual(report.validation_gates.preflight_passed.status, "Passed");
      strictEqual(report.validation_gates.e2e_tests_passed.status, "Passed");

      // Validate evidence collection
      ok(report.evidence_manifest.length > 0, "Should collect evidence");

      // Validate timing
      ok(report.run_metadata.duration > 0, "Should record execution duration");
    } finally {
      await env.cleanup();
    }
  });

  test("preflight failure blocks E2E execution", async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({
      evidence_root: env.evidenceDir,
      preflight_commands: ["npm run typecheck"],
      e2e_commands: ["npm run test:e2e"],
    });

    const adapter = new MockRepositoryAdapter(
      [
        {
          check_id: "typecheck",
          check_name: "TypeScript Check",
          blocking: true,
          command: "npm run typecheck",
          working_directory: "/test/root",
        },
      ],
      [
        {
          suite_id: "e2e-tests",
          suite_name: "E2E Test Suite",
          test_id: "blocked-test",
          test_name: "Should Not Run",
          attempt: 1,
          command_or_invocation: "npm run test:e2e",
        },
      ],
    );

    // Configure preflight to fail
    adapter.setCommandResult("npm run typecheck", "/test/root", {
      exitCode: 1,
      stdout: "",
      stderr: "Found 5 type errors",
      duration: 2000,
    });

    // E2E command should not be executed due to preflight failure
    // But if it were executed, it would succeed
    adapter.setCommandResult("npm run test:e2e", "/test/root", {
      exitCode: 0,
      stdout: "This should not run",
      stderr: "",
      duration: 1000,
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Validate overall failure
      strictEqual(report.final_verdict.status, "FAIL", "Overall validation should fail");

      // Validate preflight failure
      strictEqual(report.preflight_summary.failed, 1, "Preflight check should fail");
      strictEqual(report.preflight_summary.gate_status, "Failed", "Preflight gate should fail");

      // Validate E2E blocking
      strictEqual(report.e2e_summary.blocked_by_preflight_gate, 1, "E2E test should be blocked");
      strictEqual(report.e2e_summary.executed_unique_tests, 0, "No E2E tests should execute");

      // Validate E2E tests are marked as blocked
      strictEqual(report.e2e_results.length, 1, "Should have E2E result entry");
      strictEqual(
        report.e2e_results[0].status,
        "BlockedByPreflightGate",
        "E2E test should be blocked",
      );

      // Validate validation gates
      strictEqual(report.validation_gates.preflight_passed.status, "Failed");
      strictEqual(report.validation_gates.e2e_tests_passed.status, "Failed"); // Blocked counts as failed
    } finally {
      await env.cleanup();
    }
  });

  test("mixed preflight results with non-blocking failures", async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({
      evidence_root: env.evidenceDir,
      preflight_commands: ["npm run typecheck", "npm run lint"],
      e2e_commands: ["npm run test:e2e"],
    });

    const adapter = new MockRepositoryAdapter(
      [
        {
          check_id: "typecheck",
          check_name: "TypeScript Check",
          blocking: true, // This passes
          command: "npm run typecheck",
          working_directory: "/test/root",
        },
        {
          check_id: "lint",
          check_name: "ESLint Check",
          blocking: false, // This fails but non-blocking
          command: "npm run lint",
          working_directory: "/test/root",
        },
      ],
      [
        {
          suite_id: "e2e-tests",
          suite_name: "E2E Test Suite",
          test_id: "should-run",
          test_name: "Should Execute",
          attempt: 1,
          command_or_invocation: "npm run test:e2e",
        },
      ],
    );

    // Typecheck passes (blocking)
    adapter.setCommandResult("npm run typecheck", "/test/root", {
      exitCode: 0,
      stdout: "Found 0 errors",
      stderr: "",
      duration: 2000,
    });

    // Lint fails (non-blocking)
    adapter.setCommandResult("npm run lint", "/test/root", {
      exitCode: 1,
      stdout: "",
      stderr: "Found 3 style violations",
      duration: 800,
    });

    // E2E should run and succeed
    adapter.setCommandResult("npm run test:e2e", "/test/root", {
      exitCode: 0,
      stdout: "E2E tests passed",
      stderr: "",
      duration: 10000,
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Overall should pass (non-blocking failures don't block)
      strictEqual(report.final_verdict.status, "PASS", "Should pass despite non-blocking failure");

      // Validate preflight results
      strictEqual(report.preflight_summary.passed, 1, "Should have 1 passed check");
      strictEqual(report.preflight_summary.failed, 1, "Should have 1 failed check");
      strictEqual(
        report.preflight_summary.gate_status,
        "Passed",
        "Gate should pass (only blocking matters)",
      );

      // Validate E2E execution proceeds
      strictEqual(report.e2e_summary.executed_unique_tests, 1, "E2E test should execute");
      strictEqual(report.e2e_summary.passed, 1, "E2E test should pass");
      strictEqual(report.e2e_summary.blocked_by_preflight_gate, 0, "No tests should be blocked");

      // Validate validation gates
      strictEqual(report.validation_gates.preflight_passed.status, "Passed");
      strictEqual(report.validation_gates.e2e_tests_passed.status, "Passed");
    } finally {
      await env.cleanup();
    }
  });

  test("E2E test failures after successful preflight", async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({
      evidence_root: env.evidenceDir,
      preflight_commands: ["npm run typecheck"],
      e2e_commands: ["npm run test:unit", "npm run test:e2e"],
    });

    const adapter = new MockRepositoryAdapter(
      [
        {
          check_id: "typecheck",
          check_name: "TypeScript Check",
          blocking: true,
          command: "npm run typecheck",
          working_directory: "/test/root",
        },
      ],
      [
        {
          suite_id: "unit-tests",
          suite_name: "Unit Tests",
          test_id: "unit-pass",
          test_name: "Unit Test Pass",
          attempt: 1,
          command_or_invocation: "npm run test:unit",
        },
        {
          suite_id: "e2e-tests",
          suite_name: "E2E Tests",
          test_id: "e2e-fail",
          test_name: "E2E Test Fail",
          attempt: 1,
          command_or_invocation: "npm run test:e2e",
        },
      ],
    );

    // Preflight passes
    adapter.setCommandResult("npm run typecheck", "/test/root", {
      exitCode: 0,
      stdout: "Type check passed",
      stderr: "",
      duration: 1500,
    });

    // Unit test passes
    adapter.setCommandResult("npm run test:unit", "/test/root", {
      exitCode: 0,
      stdout: "Unit tests: all passed",
      stderr: "",
      duration: 3000,
    });

    // E2E test fails
    adapter.setCommandResult("npm run test:e2e", "/test/root", {
      exitCode: 1,
      stdout: "",
      stderr: "E2E test failed: Connection timeout",
      duration: 8000,
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Overall should fail due to E2E failure
      strictEqual(report.final_verdict.status, "FAIL", "Should fail due to E2E test failure");

      // Validate preflight success
      strictEqual(report.preflight_summary.gate_status, "Passed", "Preflight should pass");
      strictEqual(report.validation_gates.preflight_passed.status, "Passed");

      // Validate E2E execution and failure
      strictEqual(report.e2e_summary.executed_unique_tests, 2, "Both E2E tests should execute");
      strictEqual(report.e2e_summary.passed, 1, "One E2E test should pass");
      strictEqual(report.e2e_summary.failed, 1, "One E2E test should fail");
      strictEqual(report.e2e_summary.gate_status, "Failed", "E2E gate should fail");

      // Validate validation gates
      strictEqual(report.validation_gates.e2e_tests_passed.status, "Failed");

      // Validate individual test results
      const unitTest = report.e2e_results.find((r) => r.test_id === "unit-pass");
      const e2eTest = report.e2e_results.find((r) => r.test_id === "e2e-fail");

      ok(unitTest, "Should have unit test result");
      strictEqual(unitTest.status, "Passed", "Unit test should pass");

      ok(e2eTest, "Should have E2E test result");
      strictEqual(e2eTest.status, "Failed", "E2E test should fail");
      ok(e2eTest.assertion_or_error?.includes("timeout"), "Should capture error message");
    } finally {
      await env.cleanup();
    }
  });

  test("handles timeout scenarios in validation workflow", async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({
      evidence_root: env.evidenceDir,
      timeout: 1000, // Very short timeout for testing
      preflight_commands: ["npm run typecheck"],
      e2e_commands: [],
    });

    const adapter = new MockRepositoryAdapter(
      [
        {
          check_id: "slow-check",
          check_name: "Slow Check",
          blocking: true,
          command: "npm run typecheck",
          working_directory: "/test/root",
        },
      ],
      [],
    );

    // Configure command to timeout
    adapter.setCommandResult("npm run typecheck", "/test/root", {
      exitCode: 124, // Timeout exit code
      stdout: "",
      stderr: "Command timed out",
      duration: 5000, // Longer than config timeout
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Should fail due to timeout
      strictEqual(report.final_verdict.status, "FAIL", "Should fail due to timeout");

      // Validate timeout classification
      const preflightResult = report.preflight_results[0];
      strictEqual(preflightResult.status, "Timeout", "Should classify as timeout");
      strictEqual(
        preflightResult.primary_failure_classification,
        "Timeout",
        "Should classify failure as timeout",
      );

      // Validate preflight gate failure
      strictEqual(
        report.preflight_summary.gate_status,
        "Failed",
        "Gate should fail due to timeout",
      );
    } finally {
      await env.cleanup();
    }
  });

  test("generates comprehensive evidence throughout workflow", async () => {
    const env = await createTestEnvironment();
    const config = createMockConfig({
      evidence_root: env.evidenceDir,
      preflight_commands: ["npm run typecheck"],
      e2e_commands: ["npm run test:e2e"],
    });

    const adapter = new MockRepositoryAdapter();

    adapter.setCommandResult("npm run typecheck", "/test/root", {
      exitCode: 0,
      stdout: "Types OK",
      stderr: "",
      duration: 1000,
    });

    adapter.setCommandResult("npm run test:e2e", "/test/root", {
      exitCode: 0,
      stdout: "E2E OK",
      stderr: "",
      duration: 2000,
    });

    try {
      const executor = new ValidationExecutor(adapter, config);
      const report = await executor.execute();

      // Validate evidence manifest exists and has entries
      ok(report.evidence_manifest, "Should have evidence manifest");
      ok(report.evidence_manifest.length > 0, "Should have evidence entries");

      // Validate evidence types are present
      const evidenceTypes = new Set(report.evidence_manifest.map((e) => e.evidence_type));
      ok(
        evidenceTypes.has("execution_trace") || evidenceTypes.has("command_execution"),
        "Should have command execution evidence",
      );

      // Validate all evidence has integrity validation
      for (const evidence of report.evidence_manifest) {
        ok(evidence.checksum, "Evidence should have checksum");
        ok(evidence.file_size > 0, "Evidence should have file size");
        strictEqual(evidence.integrity_validated, true, "Evidence should be integrity validated");
      }

      // Validate evidence references in validation gates
      ok(
        report.validation_gates.execution_context_resolved.evidence_references.length > 0,
        "Context gate should have evidence references",
      );
      ok(
        report.validation_gates.preflight_passed.evidence_references.length > 0,
        "Preflight gate should have evidence references",
      );
      ok(
        report.validation_gates.e2e_tests_passed.evidence_references.length > 0,
        "E2E gate should have evidence references",
      );
    } finally {
      await env.cleanup();
    }
  });
});
