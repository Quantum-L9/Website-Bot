import { spawnSync } from "node:child_process";
import { exists, result, statusFromRows, writeJsonl } from "./lib.mjs";

const checks = [];

// Check if we can start the preview server
if (exists("dist/index.html")) {
  // Try to start preview server for smoke test. Use Node's built-in timeout
  // option instead of the external `timeout` binary so no command is resolved
  // from PATH (S4036): a server that is still running after 5s is killed by
  // Node with code ETIMEDOUT, which is the success signal here.
  const previewProc = spawnSync("npm", ["run", "preview"], {
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
    result({
      check_id: "build-required-for-smoke",
      check_class: "prerequisite",
      target_artifact: "dist/",
      expected_result: "Build output exists for smoke testing",
      actual_result: "Build output missing",
      status: "BLOCKED",
      severity: "medium",
      remediation_if_failed: "Run npm run build first",
    }),
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
      actual_result: staticFiles.length > 0 ? `Found: ${staticFiles.join(", ")}` : "No common static files found",
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
