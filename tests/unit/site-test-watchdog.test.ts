// L9_META: layer=test, role=site_test_watchdog, status=active, version=1.0.0
//
// The per-file watchdog (scripts/site-test-watchdog.mjs): a test file whose
// process never exits is killed after the limit, leaves a diagnostic report
// naming what held it open, and fails the run by file name; a well-behaved
// file is untouched.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error -- plain .mjs script without type declarations
import { parseEtime, runWithWatchdog } from "../../scripts/site-test-watchdog.mjs";

const IDLE = "tests/fixtures/site-test-watchdog/idle-forever.fixture.mjs";
const QUICK = "tests/fixtures/site-test-watchdog/quick.fixture.mjs";

interface Stalled {
  file: string;
  ageSeconds: number;
  report?: string;
}

test("ps etime parses every form", () => {
  assert.equal(parseEtime("05"), 5);
  assert.equal(parseEtime("01:05"), 65);
  assert.equal(parseEtime("02:01:05"), 7_265);
  assert.equal(parseEtime("1-02:01:05"), 93_665);
});

test("a file that never exits is killed after the limit, reported, and fails by name", async () => {
  const reportDir = mkdtempSync(join(tmpdir(), "site-test-watchdog-"));
  const lines: string[] = [];
  const started = Date.now();
  try {
    const result = (await runWithWatchdog({
      files: [QUICK, IDLE],
      limitMs: 3_000,
      pollMs: 500,
      reportDir,
      env: { ...process.env, NODE_OPTIONS: "" },
      log: (line: string) => lines.push(line),
    })) as { status: number; stalled: Stalled[] };
    const elapsed = Date.now() - started;

    assert.notEqual(result.status, 0, "the run fails");
    assert.deepEqual(
      result.stalled.map((entry) => entry.file),
      [IDLE],
      "only the idle file is stopped",
    );
    assert.ok(elapsed < 30_000, `stopped within the limit plus capture time (${elapsed}ms)`);
    assert.ok(
      lines.some((line) => line.includes(`FAILED ${IDLE}`)),
      lines.join("\n"),
    );

    const report = result.stalled[0]?.report;
    assert.ok(report && existsSync(report), "a diagnostic report was written");
    const parsed = JSON.parse(readFileSync(report, "utf8")) as { libuv?: unknown[] };
    assert.ok(Array.isArray(parsed.libuv), "the report lists libuv handles");
    assert.ok(
      lines.some((line) => line.includes("active libuv handles:")),
      "the log summarizes what held the process open",
    );
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
});

test("a run whose files all exit is untouched", async () => {
  const reportDir = mkdtempSync(join(tmpdir(), "site-test-watchdog-"));
  try {
    const result = (await runWithWatchdog({
      files: [QUICK],
      limitMs: 3_000,
      pollMs: 500,
      reportDir,
      env: { ...process.env, NODE_OPTIONS: "" },
      log: () => {},
    })) as { status: number; stalled: Stalled[] };
    assert.equal(result.status, 0);
    assert.deepEqual(result.stalled, []);
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
});
