/**
 * A command killed by its timeout must be reported as a Timeout with the
 * terminating signal and no exit status. It used to be reported as exit code
 * 127 ("command not found"), and its status depended on whether the output
 * happened to contain the word "timeout". A process that never started (ENOENT)
 * still reports 127.
 */

import { deepStrictEqual, ok, strictEqual } from "node:assert";
import type { SpawnSyncReturns } from "node:child_process";
import { describe, test } from "node:test";
import { E2EEngine } from "../../src/core/E2EEngine.js";
import { EvidenceCollector } from "../../src/core/EvidenceCollector.js";
import { PreflightEngine, summarizePreflightOutcomes } from "../../src/core/PreflightEngine.js";
import type { E2ETestResult, PreflightCheck } from "../../src/types/index.js";
import { executeCommandSecurely, toCommandResult } from "../../src/utils/secureExecution.js";
import { createTestEnvironment, MockRepositoryAdapter } from "../setup.js";

function spawnError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function spawnResult(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return {
    pid: 0,
    output: [],
    stdout: "",
    stderr: "",
    status: null,
    signal: null,
    ...overrides,
  };
}

type AdapterResult = Awaited<ReturnType<MockRepositoryAdapter["executeCommand"]>> & {
  terminationSignal?: string | null;
  timedOut?: boolean;
};

class FixedResultAdapter extends MockRepositoryAdapter {
  constructor(private readonly fixed: AdapterResult) {
    super();
  }

  override async executeCommand(): Promise<AdapterResult> {
    return this.fixed;
  }
}

const TIMED_OUT: AdapterResult = {
  exitCode: null,
  // Deliberately free of the words "timeout"/"timed out": the status must come
  // from the runner, not from scanning output.
  stdout: "building site...",
  stderr: "spawnSync /bin/sh ETIMEDOUT",
  duration: 300_000,
  terminationSignal: "SIGTERM",
  timedOut: true,
};

function preflightCheck(status: PreflightCheck["status"], id: string): PreflightCheck {
  return {
    check_id: id,
    check_name: id,
    blocking: true,
    command: "true",
    working_directory: ".",
    status,
    exit_code: status === "Passed" ? 0 : null,
    termination_signal: null,
    started_at: "",
    ended_at: "",
    duration: 0,
    primary_failure_classification: null,
    contributing_causes: [],
    root_cause_group: null,
    evidence_references: [],
  };
}

describe("toCommandResult termination evidence", () => {
  test("a timeout kill has no exit status and records the signal", () => {
    const result = toCommandResult(
      spawnResult({
        signal: "SIGTERM",
        error: spawnError("ETIMEDOUT", "spawnSync /bin/sh ETIMEDOUT"),
      }),
      Date.now(),
    );
    strictEqual(result.exitCode, null);
    strictEqual(result.timedOut, true);
    strictEqual(result.terminationSignal, "SIGTERM");
  });

  test("a spawn ENOENT still reports 127", () => {
    const result = toCommandResult(
      spawnResult({ error: spawnError("ENOENT", "spawnSync nope ENOENT") }),
      Date.now(),
    );
    strictEqual(result.exitCode, 127);
    strictEqual(result.timedOut, false);
    strictEqual(result.terminationSignal, null);
  });

  test("a signal kill without a timeout has no exit status", () => {
    const result = toCommandResult(spawnResult({ signal: "SIGKILL" }), Date.now());
    strictEqual(result.exitCode, null);
    strictEqual(result.timedOut, false);
    strictEqual(result.terminationSignal, "SIGKILL");
  });

  test("a normal exit keeps its status", () => {
    const result = toCommandResult(spawnResult({ status: 3 }), Date.now());
    strictEqual(result.exitCode, 3);
    strictEqual(result.timedOut, false);
  });

  test("a real command that outlives its timeout is killed, not reported as 127", () => {
    const result = executeCommandSecurely("sleep 5", { timeout: 300 });
    strictEqual(result.exitCode, null);
    strictEqual(result.timedOut, true);
    strictEqual(result.terminationSignal, "SIGTERM");
    ok(result.duration < 4000, `killed near the limit, took ${result.duration}ms`);
  });

  test("a real missing executable reports 127", () => {
    const result = executeCommandSecurely("definitely-not-an-installed-command-l9");
    strictEqual(result.exitCode, 127);
    strictEqual(result.timedOut, false);
    strictEqual(result.terminationSignal, null);
  });
});

describe("PreflightEngine termination evidence", () => {
  test("a timed-out check is Timeout with null exit code and the signal", async () => {
    const env = await createTestEnvironment();
    try {
      const adapter = new FixedResultAdapter(TIMED_OUT);
      const engine = new PreflightEngine(
        adapter,
        await EvidenceCollector.create(adapter, env.evidenceDir),
      );
      const [check] = await engine.executeAll([preflightCheck("Unknown", "site-test-local")]);
      strictEqual(check.status, "Timeout");
      strictEqual(check.primary_failure_classification, "Timeout");
      strictEqual(check.exit_code, null);
      strictEqual(check.termination_signal, "SIGTERM");
      deepStrictEqual(check.contributing_causes, [
        "Command timed out after 300000ms (terminated by SIGTERM)",
      ]);
    } finally {
      await env.cleanup();
    }
  });

  test("a spawn ENOENT check keeps exit code 127 and is not a Timeout", async () => {
    const env = await createTestEnvironment();
    try {
      const adapter = new FixedResultAdapter({
        exitCode: 127,
        stdout: "",
        stderr: "spawnSync nope ENOENT",
        duration: 5,
        terminationSignal: null,
        timedOut: false,
      });
      const engine = new PreflightEngine(
        adapter,
        await EvidenceCollector.create(adapter, env.evidenceDir),
      );
      const [check] = await engine.executeAll([preflightCheck("Unknown", "missing-tool")]);
      strictEqual(check.status, "Failed");
      strictEqual(check.primary_failure_classification, "DependencyFailure");
      strictEqual(check.exit_code, 127);
      strictEqual(check.termination_signal, null);
    } finally {
      await env.cleanup();
    }
  });

  test("the completion tally counts timeouts", () => {
    deepStrictEqual(
      summarizePreflightOutcomes([
        preflightCheck("Passed", "a"),
        preflightCheck("Timeout", "b"),
        preflightCheck("Failed", "c"),
        preflightCheck("Error", "d"),
      ]),
      { total: 4, passed: 1, failed: 1, errors: 1, timeouts: 1 },
    );
  });
});

describe("E2EEngine termination evidence", () => {
  test("a timed-out test is Timeout with no fabricated exit code", async () => {
    const env = await createTestEnvironment();
    try {
      const adapter = new FixedResultAdapter(TIMED_OUT);
      const engine = new E2EEngine(
        adapter,
        await EvidenceCollector.create(adapter, env.evidenceDir),
      );
      const pending: E2ETestResult = {
        suite_id: "s",
        suite_name: "s",
        test_id: "t",
        test_name: "t",
        attempt: 1,
        command_or_invocation: "true",
        status: "Unknown",
        started_at: "",
        ended_at: "",
        duration: 0,
        assertion_or_error: null,
        exit_code_or_runner_result: null,
        primary_failure_classification: null,
        contributing_causes: [],
        root_cause_group: null,
        evidence_references: [],
      };
      const [result] = await engine.executeAll([pending]);
      strictEqual(result.status, "Timeout");
      strictEqual(result.primary_failure_classification, "Timeout");
      strictEqual(result.exit_code_or_runner_result, null);
    } finally {
      await env.cleanup();
    }
  });
});
