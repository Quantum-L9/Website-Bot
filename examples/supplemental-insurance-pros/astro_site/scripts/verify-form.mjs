import {
  configPath,
  parseEnvExample,
  readJson,
  readText,
  result,
  statusFromRows,
  writeJsonl,
} from "./lib.mjs";

const cfg = readJson(configPath);
const env = parseEnvExample();
const form = readText(cfg.form.component);
const rows = [];
rows.push(
  result({
    check_id: "FORM-TAG",
    check_class: "form_validation",
    target_artifact: cfg.form.component,
    expected_result: "form tag exists",
    actual_result: /<form\b/i.test(form) ? "found" : "missing",
    status: /<form\b/i.test(form) ? "PASS" : "FAIL",
    severity: "critical",
    remediation_if_failed: "Restore LeadForm form tag.",
  }),
);
for (const field of cfg.form.requiredFields) {
  const found = new RegExp(`name=["']${field}["']`).test(form);
  rows.push(
    result({
      check_id: `FORM-FIELD-${field}`,
      check_class: "form_validation",
      target_artifact: cfg.form.component,
      expected_result: `field ${field} exists`,
      actual_result: found ? "found" : "missing",
      status: found ? "PASS" : "FAIL",
      severity: "critical",
      remediation_if_failed: `Add required field ${field}.`,
    }),
  );
}
const hasEndpoint = env.PUBLIC_FORM_ENDPOINT && !env.PUBLIC_FORM_ENDPOINT.includes("UNKNOWN");
const hasEnvDrivenAction = /PUBLIC_FORM_ENDPOINT|formEndpoint|data-form-endpoint/i.test(form);
let destinationDetail = "no destination";
if (hasEndpoint) destinationDetail = "endpoint configured";
else if (hasEnvDrivenAction) destinationDetail = "env-driven endpoint present";
let destinationStatus = "FAIL";
if (hasEndpoint) destinationStatus = "PASS";
else if (hasEnvDrivenAction) destinationStatus = "UNKNOWN";
rows.push(
  result({
    check_id: "FORM-DESTINATION",
    check_class: "form_delivery_validation",
    target_artifact: cfg.form.component,
    expected_result: "delivery path env-driven or configured",
    actual_result: destinationDetail,
    status: destinationStatus,
    severity: "critical",
    remediation_if_failed: "Wire LeadForm action to PUBLIC_FORM_ENDPOINT or configure delivery provider.",
  }),
);
writeJsonl("validation/form_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
