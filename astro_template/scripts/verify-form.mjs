import {
  envVarsMatching,
  exists,
  listFiles,
  readText,
  result,
  statusFromRows,
  writeJsonl,
} from "./lib.mjs";

const checks = [];

// Check for form-related environment variables
const formEnvVars = envVarsMatching("form", "webhook", "lead");

checks.push(
  result({
    check_id: "form-env-vars-defined",
    check_class: "environment_config",
    target_artifact: ".env.example",
    expected_result: "Form-related environment variables defined",
    actual_result:
      formEnvVars.length > 0
        ? `Found: ${formEnvVars.join(", ")}`
        : "No form environment variables found",
    status: formEnvVars.length > 0 ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Define form endpoint and webhook configuration in .env.example",
  }),
);

// Look for form components or pages
const formFiles = listFiles(
  "src",
  (file) =>
    file.toLowerCase().includes("form") ||
    file.toLowerCase().includes("contact") ||
    file.toLowerCase().includes("lead"),
);

const formSuffix = formFiles.length > 3 ? "..." : "";
checks.push(
  result({
    check_id: "form-files-exist",
    check_class: "file_structure",
    target_artifact: "src/ form files",
    expected_result: "Form-related files exist",
    actual_result:
      formFiles.length > 0
        ? `Found: ${formFiles.slice(0, 3).join(", ")}${formSuffix}`
        : "No form files found",
    status: formFiles.length > 0 ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Create form components or contact pages",
  }),
);

// Check for form validation in built files (if dist exists)
if (exists("dist")) {
  let hasFormValidation = false;
  try {
    const indexHtml = exists("dist/index.html") ? readText("dist/index.html") : "";
    hasFormValidation = indexHtml.includes("required") || indexHtml.includes("validation");
  } catch (error) {
    console.warn(
      `[verify-form] Unable to read form validation from dist/index.html:`,
      error instanceof Error ? error.message : String(error),
    );
  }

  checks.push(
    result({
      check_id: "form-validation-present",
      check_class: "form_validation",
      target_artifact: "dist/index.html",
      expected_result: "HTML form validation attributes present",
      actual_result: hasFormValidation
        ? "Validation attributes found"
        : "No validation attributes found",
      status: hasFormValidation ? "PASS" : "UNKNOWN",
      severity: "low",
      remediation_if_failed: "Add required and validation attributes to form fields",
    }),
  );
}

writeJsonl("validation/form_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
