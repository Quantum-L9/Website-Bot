import { spawnSync } from "node:child_process";
import { buildRequiredResult, exists, result, statusFromRows, writeJsonl } from "./lib.mjs";

const checks = [];

// Check if we can start the preview server
if (exists("dist/index.html")) {
  // Try to start preview server for smoke test. Use Node's built-in timeout
  // option instead of the external `timeout` binary, and prefer the absolute
  // npm CLI path npm sets for its own lifecycle scripts so no command is
  // resolved from PATH (S4036). A server that is still running after 5s is
  // killed by Node with code ETIMEDOUT, which is the success signal here.
  const npmCommand = process.env.npm_execpath || "npm";
  const previewProc = spawnSync(npmCommand, ["run", "preview"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    timeout: 5000,
  });
  const timedOut = previewProc.error?.code === "ETIMEDOUT";

  checks.push(
    result({
      check_id: "preview-server-start",
      check_class: "server_startup",
      target_artifact: "npm run preview",
      expected_result: "Preview server starts without immediate errors",
      actual_result: timedOut
        ? "Server started (timeout reached)"
        : `Exit code ${previewProc.status}`,
      status: timedOut || previewProc.status === 0 ? "PASS" : "FAIL",
      severity: "medium",
      remediation_if_failed: "Fix server startup issues",
    }),
  );
} else {
  checks.push(
    buildRequiredResult(
      "build-required-for-smoke",
      "Build output exists for smoke testing",
      "Build output missing",
    ),
  );
}

// Basic static file checks
if (exists("dist")) {
  const staticFiles = ["favicon.ico", "robots.txt"].filter((file) => exists(`dist/${file}`));
  checks.push(
    result({
      check_id: "static-files-present",
      check_class: "static_assets",
      target_artifact: "dist/ static files",
      expected_result: "Common static files present",
      actual_result:
        staticFiles.length > 0
          ? `Found: ${staticFiles.join(", ")}`
          : "No common static files found",
      status: staticFiles.length > 0 ? "PASS" : "UNKNOWN",
      severity: "low",
      remediation_if_failed: "Consider adding favicon.ico, robots.txt",
    }),
  );
}

writeJsonl("validation/smoke_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
