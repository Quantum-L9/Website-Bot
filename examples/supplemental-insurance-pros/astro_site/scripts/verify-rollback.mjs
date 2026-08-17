import { exists, readText, result, statusFromRows, writeJsonl } from "./lib.mjs";

const rows = [];
const runbookExists = exists("docs/DEPLOYMENT_RUNBOOK.md");
const text = runbookExists ? readText("docs/DEPLOYMENT_RUNBOOK.md") : "";
const rollbackMarkers = ["vercel rollback", "previous deployment", "rollback validation"];
for (const marker of rollbackMarkers) {
  const found = text.toLowerCase().includes(marker);
  rows.push(
    result({
      check_id: `ROLLBACK-${marker}`,
      check_class: "rollback_validation",
      target_artifact: "docs/DEPLOYMENT_RUNBOOK.md",
      expected_result: `runbook documents ${marker}`,
      actual_result: found ? "found" : "missing",
      status: found ? "PASS" : "FAIL",
      severity: "medium",
      remediation_if_failed: `Add rollback instruction covering ${marker}.`,
    }),
  );
}
writeJsonl("validation/rollback_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
