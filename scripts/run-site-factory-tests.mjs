// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runWithWatchdog } from "./site-test-watchdog.mjs";

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
const env = { ...process.env };
if (
  (scope === "local" || scope === "evidence" || scope === "provisioning") &&
  !env.L9_MEMORY_MODE
) {
  env.L9_MEMORY_MODE = "disabled";
}
// Offline scopes run with two guards:
// - a per-test default timeout, so a test whose promise never settles fails by
//   name. 240 s is five times the slowest offline test without its own
//   timeout (47.8 s, measured locally on a full local run). Tests that declare
//   their own `timeout` keep it.
// - a per-file wall-clock watchdog (scripts/site-test-watchdog.mjs), for a
//   file whose process stays open with no test running (a handle held open
//   after the tests finish), which --test-timeout cannot see. It writes a
//   diagnostic report to build/test-watchdog/, kills the file's process and
//   fails the run naming it. FILE_LIMIT_MS is documented with its measurement
//   in the PR that introduced it.
// The credentialed scopes (github, vercel, e2e, all) get neither: their tests
// wait on live services by design, e.g. a Vercel deployment may poll for up
// to VERCEL_MAX_POLLS x VERCEL_POLL_INTERVAL_MS (10 minutes by default).
const OFFLINE_SCOPES = new Set(["local", "evidence", "provisioning"]);
const TEST_TIMEOUT_MS = 240_000;
const FILE_LIMIT_MS = Number(process.env.SITE_TEST_FILE_LIMIT_MS ?? 480_000);
const WATCHDOG_REPORT_DIR = "build/test-watchdog";

if (OFFLINE_SCOPES.has(scope)) {
  const { maxFileSeconds, status } = await runWithWatchdog({
    files,
    nodeArgs: ["--import", "tsx", `--test-timeout=${TEST_TIMEOUT_MS}`],
    env,
    limitMs: FILE_LIMIT_MS,
    reportDir: WATCHDOG_REPORT_DIR,
  });
  console.error(
    `site-test watchdog: longest test file ran ${maxFileSeconds}s (limit ${FILE_LIMIT_MS / 1_000}s)`,
  );
  process.exit(status);
}
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
