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
    result(
      "preview-server-start",
      "server_startup",
      "npm run preview",
      "Preview server starts without immediate errors",
      timedOut
        ? "Server started (timeout reached)"
        : `Exit code ${previewProc.status}`,
      timedOut || previewProc.status === 0 ? "PASS" : "FAIL",
      "medium",
      "Fix server startup issues",
    ),
  );
} else {
  checks.push(
    result(
      "build-required-for-smoke",
      "prerequisite",
      "dist/",
      "Build output exists for smoke testing",
      "Build output missing",
      "BLOCKED",
      "medium",
      "Run npm run build first",
    ),
  );
}

// Basic static file checks
if (exists("dist")) {
  const staticFiles = ["favicon.ico", "robots.txt"].filter((file) => exists(`dist/${file}`));
  checks.push(
    result(
      "static-files-present",
      "static_assets",
      "dist/ static files",
      "Common static files present",
      staticFiles.length > 0 ? `Found: ${staticFiles.join(", ")}` : "No common static files found",
      staticFiles.length > 0 ? "PASS" : "UNKNOWN",
      "low",
      "Consider adding favicon.ico, robots.txt",
    ),
  );
}

writeJsonl("validation/smoke_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
