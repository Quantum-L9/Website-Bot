import { spawnSync } from "node:child_process";
import {
  envVarsMatching,
  exists,
  parseEnvExample,
  readText,
  result,
  statusFromRows,
  writeJsonl,
} from "./lib.mjs";

const checks = [];

// Check for deployment configuration that enables rollback
const envVars = parseEnvExample();
const deploymentEnvVars = envVarsMatching("vercel", "deploy", "github");

const deploymentSuffix = deploymentEnvVars.length > 3 ? "..." : "";
checks.push(
  result({
    check_id: "deployment-config-present",
    check_class: "deployment_config",
    target_artifact: ".env.example",
    expected_result: "Deployment configuration variables defined",
    actual_result:
      deploymentEnvVars.length > 0
        ? `Found: ${deploymentEnvVars.slice(0, 3).join(", ")}${deploymentSuffix}`
        : "No deployment variables found",
    status: deploymentEnvVars.length > 0 ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Define deployment configuration for rollback capability",
  }),
);

// Template dirs often lack a nested .git; accept any git worktree (parent repo counts).
const gitProbe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  encoding: "utf8",
  cwd: process.cwd(),
});
const insideGitWorktree = gitProbe.status === 0 && String(gitProbe.stdout).trim() === "true";
checks.push(
  result({
    check_id: "version-control-present",
    check_class: "rollback_capability",
    target_artifact: "git worktree",
    expected_result: "Git worktree available for rollback",
    actual_result: insideGitWorktree ? "Inside git worktree" : "Not inside a git worktree",
    status: insideGitWorktree ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: "Run from a git checkout (template may live under the factory repo)",
  }),
);

// Check for package.json scripts that support rollback
let hasRollbackScripts = false;
if (exists("package.json")) {
  try {
    const packageJson = JSON.parse(readText("package.json"));
    const scripts = packageJson.scripts || {};

    // Look for deployment-related scripts
    const deployScripts = Object.keys(scripts).filter(
      (script) =>
        script.includes("deploy") || script.includes("build") || script.includes("preview"),
    );

    hasRollbackScripts = deployScripts.length > 0;

    checks.push(
      result({
        check_id: "deployment-scripts-present",
        check_class: "rollback_scripts",
        target_artifact: "package.json scripts",
        expected_result: "Deployment scripts available",
        actual_result: hasRollbackScripts
          ? `Scripts: ${deployScripts.join(", ")}`
          : "No deployment scripts found",
        status: hasRollbackScripts ? "PASS" : "UNKNOWN",
        severity: "medium",
        remediation_if_failed: "Add deployment scripts to package.json",
      }),
    );
  } catch (error) {
    checks.push(
      result({
        check_id: "package-json-readable",
        check_class: "file_access",
        target_artifact: "package.json",
        expected_result: "Package.json is readable",
        actual_result: `Error: ${error.message}`,
        status: "FAIL",
        severity: "medium",
        remediation_if_failed: "Fix package.json syntax",
      }),
    );
  }
}

// Check for backup/rollback documentation
const docFiles = ["README.md", "DEPLOYMENT.md", "ROLLBACK.md"].filter((file) => exists(file));
let hasRollbackDocs = false;

for (const docFile of docFiles) {
  try {
    const content = readText(docFile);
    if (content.toLowerCase().includes("rollback") || content.toLowerCase().includes("revert")) {
      hasRollbackDocs = true;
      break;
    }
  } catch (error) {
    console.warn(
      `[verify-rollback] Unable to read documentation file ${docFile}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

checks.push(
  result({
    check_id: "rollback-documentation",
    check_class: "rollback_docs",
    target_artifact: "Documentation files",
    expected_result: "Rollback procedure documented",
    actual_result: hasRollbackDocs
      ? "Rollback documentation found"
      : "No rollback documentation found",
    status: hasRollbackDocs ? "PASS" : "UNKNOWN",
    severity: "low",
    remediation_if_failed: "Document rollback procedures in README.md or DEPLOYMENT.md",
  }),
);

// Check for environment safety (test mode configurations)
const testModeVars = Object.keys(envVars).filter(
  (key) =>
    key.toLowerCase().includes("test") ||
    key.toLowerCase().includes("staging") ||
    key.toLowerCase().includes("development"),
);

const testModeSuffix = testModeVars.length > 2 ? "..." : "";
checks.push(
  result({
    check_id: "test-mode-config",
    check_class: "rollback_safety",
    target_artifact: "Test mode configuration",
    expected_result: "Test/staging environment variables defined",
    actual_result:
      testModeVars.length > 0
        ? `Test vars: ${testModeVars.slice(0, 2).join(", ")}${testModeSuffix}`
        : "No test mode configuration found",
    status: testModeVars.length > 0 ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed:
      "Define test/staging environment configuration for safe rollback testing",
  }),
);

writeJsonl("validation/rollback_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
