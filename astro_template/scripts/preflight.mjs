import { existenceCheckResult, result, statusFromRows, writeJsonl } from "./lib.mjs";

const checks = [];

// Check essential files/directories exist. Each row uses the shared
// existenceCheckResult() helper to avoid the duplicated block that
// SonarCloud (S4144) previously flagged as new-code duplication.
checks.push(
  existenceCheckResult({
    checkId: "package-json-exists",
    checkClass: "file_existence",
    targetArtifact: "package.json",
    expectedResult: "File exists",
    foundText: "File exists",
    missingText: "File missing",
    remediationIfFailed: "Create package.json file",
  }),
  existenceCheckResult({
    checkId: "astro-config-exists",
    checkClass: "file_existence",
    targetArtifact: "astro.config.mjs",
    expectedResult: "File exists",
    foundText: "File exists",
    missingText: "File missing",
    remediationIfFailed: "Create astro.config.mjs file",
  }),
  existenceCheckResult({
    checkId: "src-directory-exists",
    checkClass: "directory_existence",
    targetArtifact: "src",
    expectedResult: "Directory exists",
    foundText: "Directory exists",
    missingText: "Directory missing",
    remediationIfFailed: "Create src/ directory",
  }),
);

// Check Node.js version compatibility
const nodeVersion = process.version;
const requiredNodeVersion = "20.3.0";
const nodeVersionOk = nodeVersion >= `v${requiredNodeVersion}`;

checks.push(
  result({
    check_id: "node-version-compatibility",
    check_class: "version_check",
    target_artifact: "Node.js version",
    expected_result: `>= ${requiredNodeVersion}`,
    actual_result: nodeVersion,
    status: nodeVersionOk ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: `Update Node.js to version ${requiredNodeVersion} or higher`,
  }),
);

writeJsonl("validation/preflight_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
