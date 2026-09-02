// L9_META: layer=test, role=memory_credentials, status=active, version=1.0.0
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGraphitiMachineAliases,
  DEFAULT_L9_MEMORY_MODE,
  parseGraphitiMachineAliases,
  resolveMemoryCredentials,
  resolveMemoryMode,
} from "../../src/services/memory-credentials.ts";

void test("memory defaults to required", () => {
  assert.equal(DEFAULT_L9_MEMORY_MODE, "required");
  assert.equal(resolveMemoryMode({}), "required");
});

void test("required mode fails closed without a token", () => {
  assert.throws(
    () => resolveMemoryCredentials({ L9_MEMORY_MODE: "required" }),
    /L9_MEMORY_TOKEN or GRAPHITI_MCP_TOKEN/,
  );
});

void test("GRAPHITI_MCP_TOKEN aliases into required credentials", () => {
  const resolved = resolveMemoryCredentials({
    GRAPHITI_MCP_TOKEN: "machine-token",
    GRAPHITI_MCP_URL: "http://127.0.0.1:8100/mcp/",
  });
  assert.deepEqual(resolved, {
    baseUrl: "http://127.0.0.1:8100/mcp/",
    bearerToken: "machine-token",
  });
});

void test("explicit L9_MEMORY_* wins over Graphiti aliases", () => {
  const resolved = resolveMemoryCredentials({
    L9_MEMORY_TOKEN: "bot-token",
    L9_MEMORY_URL: "http://memory.example:8200",
    GRAPHITI_MCP_TOKEN: "machine-token",
    GRAPHITI_MCP_URL: "http://127.0.0.1:8100/mcp/",
  });
  assert.deepEqual(resolved, {
    baseUrl: "http://memory.example:8200",
    bearerToken: "bot-token",
  });
});

void test("blank L9_MEMORY_* placeholders fall through to Graphiti aliases", () => {
  const resolved = resolveMemoryCredentials({
    L9_MEMORY_TOKEN: "",
    L9_MEMORY_URL: "   ",
    GRAPHITI_MCP_TOKEN: "machine-token",
    GRAPHITI_MCP_URL: "http://127.0.0.1:8100/mcp/",
  });
  assert.deepEqual(resolved, {
    baseUrl: "http://127.0.0.1:8100/mcp/",
    bearerToken: "machine-token",
  });
});

void test("optional mode still degrades when no token exists", () => {
  assert.equal(resolveMemoryCredentials({ L9_MEMORY_MODE: "optional" }), null);
});

void test("disabled mode never requires a token", () => {
  assert.equal(resolveMemoryCredentials({ L9_MEMORY_MODE: "disabled" }), null);
});

void test("machine env parser copies only Graphiti alias keys", () => {
  const parsed = parseGraphitiMachineAliases(
    [
      "# comment",
      "GRAPHITI_MCP_TOKEN=secret-value",
      "GRAPHITI_MCP_URL=http://127.0.0.1:8100/mcp/",
      "OPENAI_API_KEY=must-not-copy",
      "L9_MEMORY_TOKEN=ignore",
    ].join("\n"),
  );
  assert.deepEqual(parsed, {
    GRAPHITI_MCP_TOKEN: "secret-value",
    GRAPHITI_MCP_URL: "http://127.0.0.1:8100/mcp/",
  });
});

void test("machine overlay fills blank Graphiti aliases only", () => {
  const env: NodeJS.ProcessEnv = {
    HOME: "/tmp/memory-test-home",
    GRAPHITI_MCP_URL: "",
  };
  const applied = applyGraphitiMachineAliases(env, "/tmp/memory-test-home", () =>
    ["GRAPHITI_MCP_TOKEN=from-file", "GRAPHITI_MCP_URL=http://127.0.0.1:8100/mcp/"].join("\n"),
  );
  assert.deepEqual(applied.sort(), ["GRAPHITI_MCP_TOKEN", "GRAPHITI_MCP_URL"]);
  assert.equal(env.GRAPHITI_MCP_TOKEN, "from-file");
  assert.equal(env.GRAPHITI_MCP_URL, "http://127.0.0.1:8100/mcp/");
});
