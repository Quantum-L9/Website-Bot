// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { SpawnCommandRunner } from "../../src/stages/SiteBuildStage.js";

interface SpawnCall {
  command: string;
  args: string[];
  options: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean; stdio: unknown };
}

/** A controllable child + spawn seam: records spawn options and every kill signal. */
function makeSpawn() {
  const kills: string[] = [];
  const calls: SpawnCall[] = [];
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal = "SIGTERM") => {
    kills.push(signal);
    return true;
  };
  const spawnImpl = ((command: string, args: string[], options: SpawnCall["options"]) => {
    calls.push({ command, args, options });
    return child;
  }) as unknown as typeof spawn;
  return { spawnImpl, child, kills, calls };
}

const ENV = { PATH: "/usr/bin" } as NodeJS.ProcessEnv;

void test("spawns with shell:false and the ignore/pipe/pipe stdio contract", async () => {
  const { spawnImpl, child, calls } = makeSpawn();
  const p = new SpawnCommandRunner(spawnImpl).run("npm", ["ci", "--no-audit"], {
    cwd: "/work",
    timeoutMs: 1_000,
    env: ENV,
  });
  child.emit("close", 0, null);
  await p;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "npm");
  assert.deepEqual(calls[0].args, ["ci", "--no-audit"]);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(calls[0].options.cwd, "/work");
  assert.equal(calls[0].options.env, ENV);
});

void test("resolves with captured stdout, stderr, and a duration on a zero exit", async () => {
  const { spawnImpl, child } = makeSpawn();
  const p = new SpawnCommandRunner(spawnImpl).run("cmd", [], {
    cwd: "/work",
    timeoutMs: 1_000,
    env: ENV,
  });
  child.stdout.emit("data", Buffer.from("build output"));
  child.stderr.emit("data", Buffer.from("a warning"));
  child.emit("close", 0, null);
  const result = await p;
  assert.equal(result.stdout, "build output");
  assert.equal(result.stderr, "a warning");
  assert.equal(typeof result.durationMs, "number");
  assert.ok(result.durationMs >= 0);
});

void test("times out with SIGTERM and escalates to SIGKILL after the grace period", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { spawnImpl, child, kills } = makeSpawn();
  const p = new SpawnCommandRunner(spawnImpl).run("sleep", [], {
    cwd: "/work",
    timeoutMs: 1_000,
    env: ENV,
  });
  t.mock.timers.tick(1_000);
  assert.deepEqual(kills, ["SIGTERM"]);
  t.mock.timers.tick(5_000);
  assert.deepEqual(kills, ["SIGTERM", "SIGKILL"]);
  child.emit("close", null, "SIGKILL");
  await assert.rejects(
    p,
    (error: unknown) =>
      error instanceof BuildError &&
      error.code === "BUILD_FAILED" &&
      /signal=SIGKILL/.test(error.message),
  );
});

void test("clears the timeout timer when the process closes successfully", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { spawnImpl, child, kills } = makeSpawn();
  const p = new SpawnCommandRunner(spawnImpl).run("cmd", [], {
    cwd: "/work",
    timeoutMs: 1_000,
    env: ENV,
  });
  child.emit("close", 0, null);
  await p;
  t.mock.timers.tick(10_000); // the primary timer must have been cleared — no signal is ever sent
  assert.deepEqual(kills, []);
});

void test("clears the timeout timer when the child fails to start", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { spawnImpl, child, kills } = makeSpawn();
  const p = new SpawnCommandRunner(spawnImpl).run("cmd", [], {
    cwd: "/work",
    timeoutMs: 1_000,
    env: ENV,
  });
  child.emit("error", new Error("spawn ENOENT"));
  await assert.rejects(
    p,
    (error: unknown) =>
      error instanceof BuildError &&
      error.code === "BUILD_FAILED" &&
      /failed to start/.test(error.message),
  );
  t.mock.timers.tick(10_000);
  assert.deepEqual(kills, []);
});

// ── Real-subprocess wiring proofs (default spawn) ──

void test("real subprocess: arguments are passed literally without a shell", async () => {
  const runner = new SpawnCommandRunner();
  const result = await runner.run(
    process.execPath,
    ["-e", "process.stdout.write(process.argv[1])", "$HOME"],
    { cwd: process.cwd(), timeoutMs: 30_000, env: process.env },
  );
  // With shell:false the '$HOME' token reaches the child verbatim instead of being expanded.
  assert.equal(result.stdout, "$HOME");
});

void test("real subprocess: an overrunning command is terminated with SIGTERM", async () => {
  const runner = new SpawnCommandRunner();
  await assert.rejects(
    () =>
      runner.run(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
        cwd: process.cwd(),
        timeoutMs: 200,
        env: process.env,
      }),
    (error: unknown) =>
      error instanceof BuildError &&
      error.code === "BUILD_FAILED" &&
      /signal=SIGTERM/.test(error.message),
  );
});

void test("real subprocess: a missing executable rejects as a start failure", async () => {
  const runner = new SpawnCommandRunner();
  await assert.rejects(
    () =>
      runner.run("this-command-does-not-exist-website-bot", [], {
        cwd: process.cwd(),
        timeoutMs: 5_000,
        env: process.env,
      }),
    (error: unknown) =>
      error instanceof BuildError &&
      error.code === "BUILD_FAILED" &&
      /failed to start/.test(error.message),
  );
});
