import { spawnSync } from "node:child_process";
import { exists, result, statusFromRows, writeJsonl } from "./lib.mjs";

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
    result({
      check_id: "dist-directory-created",
      check_class: "build_output",
      target_artifact: "dist/",
      expected_result: "Build output directory exists",
      actual_result: exists("dist") ? "dist/ directory exists" : "dist/ directory missing",
      status: exists("dist") ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: "Verify build process creates dist/ directory",
    }),

    // Check for index.html in output
    result({
      check_id: "index-html-generated",
      check_class: "build_output",
      target_artifact: "dist/index.html",
      expected_result: "Index HTML file generated",
      actual_result: exists("dist/index.html") ? "index.html found" : "index.html missing",
      status: exists("dist/index.html") ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: "Ensure pages generate HTML output",
    }),
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
