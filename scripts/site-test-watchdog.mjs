// L9_META: layer=script, role=site_test_watchdog, status=active, version=1.0.0
//
// Per-file wall-clock watchdog for the offline site-factory test scopes.
//
// `node --test` runs every test file in its own child process. A child whose
// event loop is held open by a handle that never settles (and never times out)
// keeps the whole run alive until an outer kill, with nothing naming the file.
// `--test-timeout` cannot see that case when the hang sits outside a test (a
// worker or loader port held open after the tests finish). This watchdog
// watches the per-file children instead: a child alive longer than the limit
// gets a Node diagnostic report (libuv handles, workers, JS stack) written to
// a known directory, is then killed, and the run fails naming the file.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPORT_SIGNAL = "SIGUSR2";

/** Parses `ps` etime ([[dd-]hh:]mm:ss) into seconds. */
export function parseEtime(etime) {
  const [days, clock] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = clock.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts;
  return Number(days) * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

/** `ps` from a fixed system directory, never resolved through PATH. */
const PS = ["/bin/ps", "/usr/bin/ps"].find((candidate) => existsSync(candidate));

/** Direct children of `parentPid` that run one of `files`, with their age. */
export function testChildren(parentPid, files) {
  if (!PS) return [];
  const listing = spawnSync(PS, ["-A", "-o", "pid=,ppid=,etime=,args="], { encoding: "utf8" });
  if (listing.status !== 0) return [];
  const children = [];
  for (const line of listing.stdout.split("\n")) {
    const [pid, ppid, etime, ...args] = line.trim().split(/\s+/);
    if (Number(ppid) !== parentPid || args.length === 0) continue;
    const file = files.find((candidate) => args.at(-1) === candidate);
    if (file) children.push({ pid: Number(pid), ageSeconds: parseEtime(etime), file });
  }
  return children;
}

function newReport(reportDir, pid, before) {
  if (!existsSync(reportDir)) return undefined;
  const name = readdirSync(reportDir).find(
    (entry) => entry.includes(`.${pid}.`) && entry.endsWith(".json") && !before.has(entry),
  );
  return name ? join(reportDir, name) : undefined;
}

/** Resolves the report `pid` writes into `reportDir`, or undefined after `timeoutMs`. */
function waitForReport(reportDir, pid, before, timeoutMs = 10_000) {
  return new Promise((done) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const report = newReport(reportDir, pid, before);
      if (report || Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        done(report);
      }
    }, 250);
  });
}

/** Captures a diagnostic report from a stalled child, then kills it. */
async function stopStalledChild(entry, directory, limitMs, log) {
  const before = new Set(existsSync(directory) ? readdirSync(directory) : []);
  try {
    process.kill(entry.pid, REPORT_SIGNAL);
  } catch {
    return undefined;
  }
  const report = await waitForReport(directory, entry.pid, before);
  try {
    process.kill(entry.pid, "SIGKILL");
  } catch {
    // already gone
  }
  log(
    `site-test watchdog: ${entry.file} (pid ${entry.pid}) was still running after ${entry.ageSeconds}s, over the ${limitMs / 1_000}s per-file limit; killed.`,
  );
  log(
    report
      ? `diagnostic report: ${report}\n${summarizeReport(report)}`
      : "diagnostic report: not written",
  );
  return { file: entry.file, pid: entry.pid, ageSeconds: entry.ageSeconds, report };
}

/** The parts of a diagnostic report that say what held the process open. */
export function summarizeReport(path) {
  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    const handles = {};
    for (const handle of report.libuv ?? []) {
      if (!handle.is_active) continue;
      const key = `${handle.type}${handle.is_referenced ? "" : " (unref)"}`;
      handles[key] = (handles[key] ?? 0) + 1;
    }
    const stack = report.javascriptStack?.stack?.slice(0, 5) ?? [];
    return [
      `active libuv handles: ${JSON.stringify(handles)}`,
      `worker threads: ${(report.workers ?? []).length}`,
      `javascript stack: ${stack.length ? stack.join(" | ") : "(idle: no JS frame)"}`,
    ].join("\n");
  } catch (error) {
    return `report unreadable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Runs `node --test` over `files`, killing any per-file child that outlives
 * `limitMs` after capturing its diagnostic report into `reportDir`.
 * Resolves `{ status, stalled, maxFileSeconds }`; status is non-zero when the
 * test run failed or any file was stopped by the watchdog.
 */
export async function runWithWatchdog({
  files,
  nodeArgs = [],
  env = process.env,
  limitMs,
  reportDir,
  pollMs = 5_000,
  log = (line) => console.error(line),
}) {
  const directory = resolve(reportDir);
  mkdirSync(directory, { recursive: true });
  const reportOptions = `--report-on-signal --report-signal=${REPORT_SIGNAL} --report-directory=${directory}`;
  // NODE_TEST_CONTEXT marks a process as a node:test child; inherited, it
  // would make this `node --test` behave as one instead of running the files.
  const baseEnv = { ...env };
  delete baseEnv.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [...nodeArgs, "--test", ...files], {
    stdio: "inherit",
    env: { ...baseEnv, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} ${reportOptions}`.trim() },
  });
  const stalled = [];
  const handled = new Set();
  let maxFileSeconds = 0;
  let polling = false;
  const poll = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const due = [];
      for (const entry of testChildren(child.pid, files)) {
        maxFileSeconds = Math.max(maxFileSeconds, entry.ageSeconds);
        if (handled.has(entry.pid) || entry.ageSeconds * 1_000 < limitMs) continue;
        handled.add(entry.pid);
        due.push(entry);
      }
      const stopped = await Promise.all(
        due.map((entry) => stopStalledChild(entry, directory, limitMs, log)),
      );
      stalled.push(...stopped.filter(Boolean));
    } finally {
      polling = false;
    }
  }, pollMs);
  const status = await new Promise((done) => child.on("exit", (code) => done(code ?? 1)));
  clearInterval(poll);
  for (const entry of stalled) {
    const where = entry.report ? ` (report ${entry.report})` : "";
    log(`site-test watchdog: FAILED ${entry.file}: stalled past ${limitMs / 1_000}s${where}`);
  }
  return { status: stalled.length > 0 && status === 0 ? 1 : status, stalled, maxFileSeconds };
}
