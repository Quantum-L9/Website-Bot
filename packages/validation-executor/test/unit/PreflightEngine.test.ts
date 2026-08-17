/**
 * Unit tests for PreflightEngine
 * Tests gate evaluation edge cases and preflight execution logic
 */

import { ok, strictEqual } from "node:assert";
import { describe, test } from "node:test";
import { EvidenceCollector } from "../../src/core/EvidenceCollector.js";
import { PreflightEngine } from "../../src/core/PreflightEngine.js";
import type { PreflightCheck, ValidationGateStatus } from "../../src/types/index.js";
import {
  assertions,
  createMockPreflightChecks,
  createTestEnvironment,
  MockRepositoryAdapter,
} from "../setup.js";

describe("PreflightEngine", () => {
  test("evaluates gate as Passed when all blocking checks pass", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new PreflightEngine(adapter, evidenceCollector);

    // Create checks with all blocking checks passing
    const checks: PreflightCheck[] = createMockPreflightChecks().map((def) => ({
      ...def,
      status: def.check_id === "typecheck" ? "Passed" : "Passed", // All pass
      exit_code: 0,
      termination_signal: null,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration: 1000,
      primary_failure_classification: null,
      contributing_causes: [],
      root_cause_group: null,
      evidence_references: [`preflight_${def.check_id}_evidence`],
    }));

    try {
      const gate = engine.evaluateGate(checks);

      assertions.gateStatus(gate, "Passed");
      strictEqual(gate.e2e_authorized, true, "E2E should be authorized when gate passes");
      strictEqual(gate.blocking_failures.length, 0, "Should have no blocking failures");
      strictEqual(gate.blocking_unknowns.length, 0, "Should have no blocking unknowns");
      assertions.evidenceReferences(gate.decision_evidence);
    } finally {
      await env.cleanup();
    }
  });

  test("evaluates gate as Failed when blocking check fails", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new PreflightEngine(adapter, evidenceCollector);

    const checks: PreflightCheck[] = createMockPreflightChecks().map((def) => ({
      ...def,
      status: def.check_id === "typecheck" ? "Failed" : "Passed", // Blocking check fails
      exit_code: def.check_id === "typecheck" ? 1 : 0,
      termination_signal: null,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration: 1000,
      primary_failure_classification: def.check_id === "typecheck" ? "PreflightFailure" : null,
      contributing_causes: def.check_id === "typecheck" ? ["Type errors"] : [],
      root_cause_group: def.check_id === "typecheck" ? "build_failure" : null,
      evidence_references: [`preflight_${def.check_id}_evidence`],
    }));

    try {
      const gate = engine.evaluateGate(checks);

      assertions.gateStatus(gate, "Failed");
      strictEqual(gate.e2e_authorized, false, "E2E should not be authorized when gate fails");
      ok(gate.blocking_failures.length > 0, "Should have blocking failures");
      ok(gate.blocking_failures.includes("typecheck"), "Should include failed blocking check ID");
    } finally {
      await env.cleanup();
    }
  });

  test("evaluates gate as Passed when non-blocking checks fail", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new PreflightEngine(adapter, evidenceCollector);

    const checks: PreflightCheck[] = createMockPreflightChecks().map((def) => ({
      ...def,
      status: def.check_id === "lint" ? "Failed" : "Passed", // Non-blocking check fails
      exit_code: def.check_id === "lint" ? 1 : 0,
      termination_signal: null,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration: 1000,
      primary_failure_classification: def.check_id === "lint" ? "PreflightFailure" : null,
      contributing_causes: def.check_id === "lint" ? ["Style violations"] : [],
      root_cause_group: def.check_id === "lint" ? "code_quality" : null,
      evidence_references: [`preflight_${def.check_id}_evidence`],
    }));

    try {
      const gate = engine.evaluateGate(checks);

      assertions.gateStatus(gate, "Passed");
      strictEqual(
        gate.e2e_authorized,
        true,
        "E2E should be authorized when only non-blocking checks fail",
      );
      strictEqual(gate.blocking_failures.length, 0, "Should have no blocking failures");
    } finally {
      await env.cleanup();
    }
  });

  test("evaluates gate as Failed when blocking check has Unknown status", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new PreflightEngine(adapter, evidenceCollector);

    const checks: PreflightCheck[] = createMockPreflightChecks().map((def) => ({
      ...def,
      status: def.check_id === "typecheck" ? "Unknown" : "Passed", // Blocking check unknown
      exit_code: null,
      termination_signal: null,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration: 0,
      primary_failure_classification: "Unknown",
      contributing_causes: ["Could not determine result"],
      root_cause_group: null,
      evidence_references: [`preflight_${def.check_id}_evidence`],
    }));

    try {
      const gate = engine.evaluateGate(checks);

      assertions.gateStatus(gate, "Failed");
      strictEqual(
        gate.e2e_authorized,
        false,
        "E2E should not be authorized when blocking check is unknown",
      );
      strictEqual(gate.blocking_failures.length, 0, "Should have no blocking failures");
      ok(gate.blocking_unknowns.length > 0, "Should have blocking unknowns");
      ok(gate.blocking_unknowns.includes("typecheck"), "Should include unknown blocking check ID");
    } finally {
      await env.cleanup();
    }
  });

  test("executes preflight checks and classifies results correctly", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new PreflightEngine(adapter, evidenceCollector);

    // Configure different command results
    adapter.setCommandResult("npm run typecheck", "/test/root", {
      exitCode: 0,
      stdout: "Found 0 errors",
      stderr: "",
      duration: 1500,
    });

    adapter.setCommandResult("npm run lint", "/test/root", {
      exitCode: 1,
      stdout: "",
      stderr: "Found 3 style violations",
      duration: 800,
    });

    const checkDefinitions = createMockPreflightChecks();

    try {
      const results = await engine.executeAll(
        checkDefinitions.map((def) => ({
          ...def,
          status: "NotExecuted",
          exit_code: null,
          termination_signal: null,
          started_at: "",
          ended_at: "",
          duration: 0,
          primary_failure_classification: null,
          contributing_causes: [],
          root_cause_group: null,
          evidence_references: [],
        })),
      );

      strictEqual(results.length, 2, "Should execute all checks");

      // Find typecheck result
      const typecheckResult = results.find((r) => r.check_id === "typecheck");
      ok(typecheckResult, "Should have typecheck result");
      strictEqual(typecheckResult.status, "Passed", "Typecheck should pass");
      strictEqual(typecheckResult.exit_code, 0, "Should record exit code");
      ok(typecheckResult.duration > 0, "Should record duration");

      // Find lint result
      const lintResult = results.find((r) => r.check_id === "lint");
      ok(lintResult, "Should have lint result");
      strictEqual(lintResult.status, "Failed", "Lint should fail");
      strictEqual(lintResult.exit_code, 1, "Should record exit code");
      strictEqual(
        lintResult.primary_failure_classification,
        "PreflightFailure",
        "Should classify as preflight failure",
      );
    } finally {
      await env.cleanup();
    }
  });

  test("handles timeout scenarios correctly", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new PreflightEngine(adapter, evidenceCollector);

    // Configure long-running command that would timeout
    adapter.setCommandResult("npm run typecheck", "/test/root", {
      exitCode: 124, // Standard timeout exit code
      stdout: "",
      stderr: "Command timed out after 5 seconds",
      duration: 5000,
    });

    const checkDefinitions = [
      {
        check_id: "timeout-test",
        check_name: "Timeout Test",
        blocking: true,
        command: "npm run typecheck",
        working_directory: "/test/root",
      },
    ];

    try {
      const results = await engine.executeAll([
        {
          ...checkDefinitions[0],
          status: "NotExecuted",
          exit_code: null,
          termination_signal: null,
          started_at: "",
          ended_at: "",
          duration: 0,
          primary_failure_classification: null,
          contributing_causes: [],
          root_cause_group: null,
          evidence_references: [],
        },
      ]);

      const result = results[0];
      strictEqual(result.status, "Timeout", "Should classify as timeout");
      strictEqual(
        result.primary_failure_classification,
        "Timeout",
        "Should classify failure as timeout",
      );
    } finally {
      await env.cleanup();
    }
  });

  test("generates comprehensive summary with correct counts", async () => {
    const env = await createTestEnvironment();
    const adapter = new MockRepositoryAdapter();
    const evidenceCollector = new EvidenceCollector(adapter, env.evidenceDir);
    const engine = new PreflightEngine(adapter, evidenceCollector);

    const checks: PreflightCheck[] = [
      {
        check_id: "pass1",
        check_name: "Passing Check 1",
        blocking: true,
        command: "echo pass",
        working_directory: "/test",
        status: "Passed",
        exit_code: 0,
        termination_signal: null,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 100,
        primary_failure_classification: null,
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: ["pass1_evidence"],
      },
      {
        check_id: "fail1",
        check_name: "Failing Check 1",
        blocking: false,
        command: "exit 1",
        working_directory: "/test",
        status: "Failed",
        exit_code: 1,
        termination_signal: null,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 50,
        primary_failure_classification: "PreflightFailure",
        contributing_causes: ["Test failure"],
        root_cause_group: "test_group",
        evidence_references: ["fail1_evidence"],
      },
      {
        check_id: "unknown1",
        check_name: "Unknown Check 1",
        blocking: true,
        command: "unknown",
        working_directory: "/test",
        status: "Unknown",
        exit_code: null,
        termination_signal: null,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration: 0,
        primary_failure_classification: "Unknown",
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: ["unknown1_evidence"],
      },
    ];

    try {
      const summary = engine.generateSummary(checks);

      strictEqual(summary.discovered, 3, "Should count all checks as discovered");
      strictEqual(summary.executable, 3, "Should count all checks as executable");
      strictEqual(summary.executed, 3, "Should count all checks as executed");
      strictEqual(summary.passed, 1, "Should count passing checks");
      strictEqual(summary.failed, 1, "Should count failed checks");
      strictEqual(summary.unknown, 1, "Should count unknown checks");
      strictEqual(summary.blocking_total, 2, "Should count blocking checks");
      strictEqual(summary.blocking_passed, 1, "Should count passing blocking checks");
      strictEqual(summary.gate_status, "Failed", "Gate should fail due to unknown blocking check");
    } finally {
      await env.cleanup();
    }
  });
});
