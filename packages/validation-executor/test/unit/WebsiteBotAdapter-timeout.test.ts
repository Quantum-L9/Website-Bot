/**
 * The per-command timeout comes from the run configuration (CLI --timeout).
 * It used to be hard-coded to 300000ms in WebsiteBotAdapter.executeCommand, so
 * --timeout had no effect and site:test:local (~260s on hosted runners) timed
 * out in CI once it crossed 300s.
 */

import { ok, strictEqual } from "node:assert";
import { describe, test } from "node:test";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  WebsiteBotAdapter,
} from "../../src/adapters/WebsiteBotAdapter.js";
import { ContextResolver } from "../../src/core/ContextResolver.js";

describe("WebsiteBotAdapter command timeout", () => {
  test("defaults to the CLI default when no timeout is configured", () => {
    strictEqual(DEFAULT_COMMAND_TIMEOUT_MS, 300_000);
  });

  test("a configured timeout stops a command that outlives it", async () => {
    const adapter = new WebsiteBotAdapter();
    await adapter.resolveExecutionContext({ timeout: 500 });
    const result = await adapter.executeCommand("sleep 5 && true", process.cwd());
    ok(result.exitCode !== 0, "a command killed by the timeout does not succeed");
    ok(result.duration < 4000, `stopped near the 500ms limit, took ${result.duration}ms`);
  });

  test("a configured timeout longer than the command lets it finish", async () => {
    const adapter = new WebsiteBotAdapter();
    await adapter.resolveExecutionContext({ timeout: 10_000 });
    const result = await adapter.executeCommand("sleep 1 && true", process.cwd());
    strictEqual(result.exitCode, 0);
  });

  test("ContextResolver applies the configured command timeout", async () => {
    const adapter = new WebsiteBotAdapter();
    await new ContextResolver(adapter).resolve({ timeout: 500 });
    const result = await adapter.executeCommand("sleep 5 && true", process.cwd());
    ok(result.exitCode !== 0, "a command killed by the timeout does not succeed");
    ok(result.duration < 4000, `stopped near the 500ms limit, took ${result.duration}ms`);
  });
});
