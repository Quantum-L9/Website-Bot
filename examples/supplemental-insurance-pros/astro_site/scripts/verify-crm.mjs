import { parseEnvExample, result, statusFromRows, writeJsonl } from "./lib.mjs";

const env = parseEnvExample();
const rows = [];
const provider = env.PUBLIC_CRM_PROVIDER || "unknown";
const mode = env.PUBLIC_CRM_SYNC_MODE || "unknown";
const endpoint = env.PUBLIC_CRM_ENDPOINT || "UNKNOWN";
rows.push(
  result({
    check_id: "CRM-PROVIDER",
    check_class: "crm_validation",
    target_artifact: ".env.example",
    expected_result: "CRM provider declared or Unknown labeled",
    actual_result: provider,
    status: provider === "acculynx" ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Confirm CRM provider.",
  }),
  result({
    check_id: "CRM-PHASE",
    check_class: "crm_validation",
    target_artifact: ".env.example",
    expected_result: "CRM sync remains phase_2 until configured",
    actual_result: mode,
    status: mode === "phase_2" ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: "Set PUBLIC_CRM_SYNC_MODE=phase_2 unless live sync is implemented.",
  }),
  result({
    check_id: "CRM-ENDPOINT",
    check_class: "crm_validation",
    target_artifact: ".env.example",
    expected_result: "CRM endpoint not hardcoded and Unknown labeled if absent",
    actual_result: endpoint.includes("UNKNOWN") ? "UNKNOWN_DECLARED" : "CONFIGURED",
    status: endpoint.includes("UNKNOWN") ? "UNKNOWN" : "PASS",
    severity: "high",
    remediation_if_failed: "Configure PUBLIC_CRM_ENDPOINT and credential storage before live CRM test.",
  }),
);
writeJsonl("validation/crm_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
