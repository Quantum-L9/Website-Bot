import { exists, result, statusFromRows, writeJsonl } from "./lib.mjs";

const checks = [];

// Check essential files exist
checks.push(
  result({
    check_id: "package-json-exists",
    check_class: "file_existence",
    target_artifact: "package.json",
    expected_result: "File exists",
    actual_result: exists("package.json") ? "File exists" : "File missing",
    status: exists("package.json") ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: "Create package.json file",
  }),
  result({
    check_id: "astro-config-exists",
    check_class: "file_existence",
    target_artifact: "astro.config.mjs",
    expected_result: "File exists",
    actual_result: exists("astro.config.mjs") ? "File exists" : "File missing",
    status: exists("astro.config.mjs") ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: "Create astro.config.mjs file",
  }),
  result({
    check_id: "src-directory-exists",
    check_class: "directory_existence",
    target_artifact: "src/",
    expected_result: "Directory exists",
    actual_result: exists("src") ? "Directory exists" : "Directory missing",
    status: exists("src") ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: "Create src/ directory",
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
