import { exists, parseEnvExample, readText, result, statusFromRows, writeJsonl } from "./lib.mjs";

const env = parseEnvExample();
const rows = [];
const layout = readText("src/layouts/BaseLayout.astro");
const hasAttribution =
  exists("src/scripts/attribution.js") || /utm_source|sessionStorage|localStorage/i.test(layout);
rows.push(
  result({
    check_id: "ATTRIBUTION-PERSISTENCE",
    check_class: "analytics_validation",
    target_artifact: "src/scripts/attribution.js",
    expected_result: "UTM/source attribution persistence exists",
    actual_result: hasAttribution ? "present" : "missing",
    status: hasAttribution ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: "Add attribution persistence script.",
  }),
);
const provider = env.PUBLIC_ANALYTICS_PROVIDER || "unknown";
const id = env.PUBLIC_ANALYTICS_ID || "UNKNOWN";
const configured = provider !== "unknown" && !id.includes("UNKNOWN");
rows.push(
  result({
    check_id: "ANALYTICS-CONFIG",
    check_class: "analytics_validation",
    target_artifact: ".env.example",
    expected_result: "analytics config declared",
    actual_result: configured ? `${provider} configured` : `provider=${provider}, id=UNKNOWN`,
    status: configured ? "PASS" : "UNKNOWN",
    severity: "medium",
    remediation_if_failed: "Set PUBLIC_ANALYTICS_PROVIDER and PUBLIC_ANALYTICS_ID before analytics verification.",
  }),
);
const conversionMarker = /trackConversion|lead_submit|claim_review_request|data-conversion/i.test(
  layout + "\n" + readText("src/components/LeadForm.astro"),
);
rows.push(
  result({
    check_id: "ANALYTICS-CONVERSION-MARKER",
    check_class: "analytics_validation",
    target_artifact: "LeadForm/BaseLayout",
    expected_result: "conversion tracking hook exists",
    actual_result: conversionMarker ? "present" : "missing",
    status: conversionMarker ? "PASS" : "FAIL",
    severity: "high",
    remediation_if_failed: "Add data-conversion marker or event hook to LeadForm.",
  }),
);
writeJsonl("validation/analytics_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
