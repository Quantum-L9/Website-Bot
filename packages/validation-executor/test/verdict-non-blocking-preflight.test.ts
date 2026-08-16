// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// Regression test for PLAN-06 / PLAN-03 bounded correction: a preflight check
// explicitly marked non-blocking must be surfaced in the report but must not
// flip the aggregate final_verdict.status to FAIL. Before this fix,
// ValidationExecutor.determineFinalVerdict() counted every preflight result
// (blocking or not) toward required_failure_count, which meant activating
// this CLI as a required CI gate (build-and-validate.yml) would permanently
// fail-close on Website-Bot's intentionally non-blocking
// `launch-env-validation` check (RC-2 in the remediation plan), defeating the
// purpose of promoting the validation-executor into CI.

import assert from "node:assert/strict";
import test from "node:test";
import { ValidationExecutor } from "../src/core/ValidationExecutor.js";
import type {
  E2ETestDefinition,
  ExecutionContext,
  PreflightCheckDefinition,
  RepositoryAdapter,
  ValidationConfig,
} from "../src/types/index.js";

class FakeAdapter implements RepositoryAdapter {
  async resolveExecutionContext(config: ValidationConfig): Promise<ExecutionContext> {
    return {
      target_roots: [process.cwd()],
      source_revision: "test-revision",
      running_revision: null,
      target_environment: config.environment || "test",
      environment_type: "test",
      active_identity: "test-runner",
      preflight_commands: [],
      e2e_commands: [],
      test_runner: "node:test",
      test_runner_version: process.version,
      configuration_sources: [],
      required_services: [],
      target_endpoints: [],
      required_dependencies: [],
      required_credentials: [],
      evidence_root: config.evidence_root || "validation",
    };
  }

  async discoverPreflightChecks(): Promise<PreflightCheckDefinition[]> {
    return [
      {
        check_id: "blocking-check-ok",
        check_name: "Blocking check that passes",
        blocking: true,
        command: "true",
        working_directory: process.cwd(),
      },
      {
        check_id: "non-blocking-check-fails",
        check_name: "Non-blocking check that fails",
        blocking: false,
        command: "false",
        working_directory: process.cwd(),
      },
    ];
  }

  async discoverE2ETests(): Promise<E2ETestDefinition[]> {
    return [
      {
        suite_id: "suite",
        suite_name: "Suite",
        test_id: "e2e-ok",
        test_name: "E2E test that passes",
        attempt: 1,
        command_or_invocation: "true",
      },
    ];
  }

  async executeCommand(command: string, workingDir: string) {
    const { spawnSync } = await import("node:child_process");
    const startTime = Date.now();
    const result = spawnSync("sh", ["-c", command], {
      cwd: workingDir,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    });
    return {
      exitCode: result.status || 0,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      duration: Date.now() - startTime,
    };
  }

  async storeEvidence(evidenceId: string, data: unknown): Promise<string> {
    return `evidence/${evidenceId}.json`;
  }
}

void test("final verdict is PASS when only a non-blocking preflight check fails", async () => {
  const adapter = new FakeAdapter();
  const executor = new ValidationExecutor(adapter, {
    environment: "test",
    profile: "ci",
    evidence_root: "validation",
    timeout: 30000,
    fail_fast: false,
  });

  const report = await executor.execute();

  assert.equal(report.final_verdict.status, "PASS");
  assert.equal(report.final_verdict.required_failure_count, 0);
  assert.match(report.final_verdict.verdict_reason, /non-blocking-check-fails/);
});

void test("final verdict is FAIL when a blocking preflight check fails", async () => {
  class FailingBlockingAdapter extends FakeAdapter {
    async discoverPreflightChecks(): Promise<PreflightCheckDefinition[]> {
      return [
        {
          check_id: "blocking-check-fails",
          check_name: "Blocking check that fails",
          blocking: true,
          command: "false",
          working_directory: process.cwd(),
        },
      ];
    }

    async discoverE2ETests(): Promise<E2ETestDefinition[]> {
      return [
        {
          suite_id: "suite",
          suite_name: "Suite",
          test_id: "e2e-blocked",
          test_name: "E2E test blocked by preflight gate",
          attempt: 1,
          command_or_invocation: "true",
        },
      ];
    }
  }

  const executor = new ValidationExecutor(new FailingBlockingAdapter(), {
    environment: "test",
    profile: "ci",
    evidence_root: "validation",
    timeout: 30000,
    fail_fast: false,
  });

  const report = await executor.execute();

  assert.equal(report.final_verdict.status, "FAIL");
  assert.ok(report.final_verdict.required_failure_count >= 1);
});
