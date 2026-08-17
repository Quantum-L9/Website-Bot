// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const scopeArg = process.argv.find((argument) => argument.startsWith("--scope="));
const scope = scopeArg?.slice("--scope=".length) ?? "all";
const ROOTS_BY_SCOPE = {
  evidence: ["tests/unit", "tests/integration/local"],
  provisioning: ["tests/unit"],
  local: ["tests/unit", "tests/integration/local"],
  github: ["tests/integration/github"],
  vercel: ["tests/integration/vercel"],
  e2e: ["tests/integration/github", "tests/integration/vercel"],
  all: [
    "tests/unit",
    "tests/integration/local",
    "tests/integration/github",
    "tests/integration/vercel",
  ],
};
const roots = ROOTS_BY_SCOPE[scope] ?? ROOTS_BY_SCOPE.all;

const files = [];
for (const root of roots) {
  const absolute = resolve(root);
  if (!existsSync(absolute)) continue;
  for (const name of readdirSync(absolute).sort()) {
    if (!name.endsWith(".test.ts")) continue;
    if (scope === "provisioning" && !name.includes("provision")) continue;
    if (
      scope === "evidence" &&
      !/(evidence|release-receipt|checkpoint|failure|process-boundary|handoff-emitter)/.test(name)
    )
      continue;
    files.push(join(root, name));
  }
}
if (files.length === 0) {
  console.error(`No tests found for scope: ${scope}`);
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
