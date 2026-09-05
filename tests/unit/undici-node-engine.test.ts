// L9_META: layer=test, role=undici_node_engine_contract, status=active, version=1.0.0
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

void test("undici 8 is paired with engines.node >=22.19.0", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    engines?: { node?: string };
  };
  assert.match(pkg.dependencies?.undici ?? "", /^(?:\^|~|>=)?8(?:\.|$)/);
  assert.equal(pkg.engines?.node, ">=22.19.0");
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    packages?: Record<string, { engines?: { node?: string } }>;
  };
  assert.equal(lock.packages?.[""]?.engines?.node, ">=22.19.0");
});

void test("CI workflows that still pin Node 20 would reload undici 8 on an unsupported runtime", () => {
  const dir = ".github/workflows";
  const pinned20: string[] = [];
  const node20 = /(?:node-version|NODE_VERSION):\s*['"]?20(?:['".]|\.x|\s|$)/;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".yml")) continue;
    const text = readFileSync(join(dir, name), "utf8");
    if (node20.test(text)) {
      pinned20.push(name);
    }
  }
  assert.deepEqual(pinned20, []);
});
