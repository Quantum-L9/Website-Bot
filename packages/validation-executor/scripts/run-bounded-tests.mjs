#!/usr/bin/env node
/**
 * Run the package test suite and fail if it does not EXIT within a deadline.
 *
 * `node --test` waits for every test process to exit, so a leaked handle that
 * keeps an event loop alive hangs the run after every test has passed. This
 * runner turns that hang into a bounded, explicit failure instead of a stalled
 * CI job. It does not pass --test-force-exit: a suite that only finishes when
 * forced is the defect this check exists to catch.
 *
 * Usage: node scripts/run-bounded-tests.mjs [--timeout-ms <ms>] [test dir ...]
 * Defaults: --timeout-ms 120000, test dir test/unit.
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  let timeoutMs = 120_000;
  const dirs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--timeout-ms") {
      timeoutMs = Number(argv[i + 1]);
      i += 1;
    } else {
      dirs.push(arg);
    }
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`--timeout-ms must be a positive integer, got ${String(timeoutMs)}`);
  }
  return { timeoutMs, dirs: dirs.length > 0 ? dirs : ["test/unit"] };
}

function collectTestFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    const absolute = resolve(packageRoot, dir);
    for (const name of readdirSync(absolute).sort()) {
      if (name.endsWith(".test.ts")) {
        files.push(relative(packageRoot, join(absolute, name)));
      }
    }
  }
  if (files.length === 0) {
    throw new Error(`no *.test.ts files found in ${dirs.join(", ")}`);
  }
  return files;
}

const { timeoutMs, dirs } = parseArgs(process.argv.slice(2));
const files = collectTestFiles(dirs);
const startedAt = Date.now();

// detached: the runner and its per-file test processes share a new process
// group, so a hang can be killed as a whole rather than leaving orphans.
const child = spawn(process.execPath, ["--test", "--import=tsx", ...files], {
  cwd: packageRoot,
  stdio: "inherit",
  detached: true,
});

let timedOut = false;
const deadline = setTimeout(() => {
  timedOut = true;
  console.error(
    `\n[run-bounded-tests] FAIL: the suite did not exit within ${timeoutMs}ms. ` +
      "A handle (timer, socket, worker thread, message port) is keeping a test " +
      "process's event loop alive after its tests finished.",
  );
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}, timeoutMs);

child.on("exit", (code, signal) => {
  clearTimeout(deadline);
  const elapsed = Date.now() - startedAt;
  if (timedOut) {
    process.exit(1);
  }
  console.error(`[run-bounded-tests] suite exited in ${elapsed}ms (bound ${timeoutMs}ms)`);
  process.exit(code ?? (signal ? 1 : 0));
});
