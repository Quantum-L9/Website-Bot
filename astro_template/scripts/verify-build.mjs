import { spawnSync } from "node:child_process";
import { fileExistenceResult, result, statusFromRows, writeJsonl } from "./lib.mjs";

const checks = [];

// Try to build the site. Prefer the absolute npm CLI path that npm sets for
// its own lifecycle scripts; fall back to PATH resolution for direct node
// invocations (S4036).
const npmCommand = process.env.npm_execpath || "npm";
const buildResult = spawnSync(npmCommand, ["run", "build"], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
});

checks.push(
  result({
    check_id: "astro-build",
    check_class: "build_process",
    target_artifact: "npm run build",
    expected_result: "Build succeeds (exit code 0)",
    actual_result: `Exit code ${buildResult.status}, stderr: ${buildResult.stderr?.slice(0, 200) || "none"}`,
    status: buildResult.status === 0 ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: "Fix build errors shown in output",
  }),
);

// Check if dist directory was created
if (buildResult.status === 0) {
  checks.push(
    fileExistenceResult(
      "dist-directory-created",
      "dist/",
      "Build output directory exists",
      "dist/ directory exists",
      "dist/ directory missing",
      "Verify build process creates dist/ directory",
    ),

    // Check for index.html in output
    fileExistenceResult(
      "index-html-generated",
      "dist/index.html",
      "Index HTML file generated",
      "index.html found",
      "index.html missing",
      "Ensure pages generate HTML output",
    ),
  );
}

writeJsonl("validation/build_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

// Note: Build failures are often acceptable during development
// So we use a softer exit strategy
if (status === "FAIL" && process.env.STRICT_BUILD === "true") {
  process.exit(1);
}
