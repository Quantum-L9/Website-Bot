import fs from "node:fs";
import path from "node:path";
import {
  configPath,
  parseEnvExample,
  readJson,
  result,
  statusFromRows,
  writeJsonl,
} from "./lib.mjs";

const cfg = readJson(configPath);
const env = parseEnvExample();
const rows = [];

for (const key of cfg.requiredPublicEnv) {
  const value = env[key];
  const isPresent = typeof value === "string" && value.length > 0;
  const isUnknown = isPresent && value.includes("UNKNOWN");
  const presenceLabel = isUnknown ? "UNKNOWN_DECLARED" : "DECLARED";
  let envStatus = "FAIL";
  if (isPresent) envStatus = isUnknown ? "UNKNOWN" : "PASS";
  rows.push(
    result({
      check_id: `ENV-${key}`,
      check_class: "operator_configuration",
      target_artifact: ".env.example",
      expected_result: `${key} declared and not hardcoded as a secret`,
      actual_result: isPresent ? `${key}=${presenceLabel}` : "MISSING",
      status: envStatus,
      severity: isUnknown ? "high" : "critical",
      remediation_if_failed: `Set ${key} before production launch.`,
    }),
  );
}

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const requiredScripts = [
  "verify:preflight",
  "verify:source",
  "verify:build",
  "verify:smoke",
  "verify:form",
  "verify:analytics",
  "verify:crm",
  "verify:seo",
  "verify:rollback",
  "verify:all",
];
for (const scriptName of requiredScripts) {
  rows.push(
    result({
      check_id: `SCRIPT-${scriptName}`,
      check_class: "command_wiring",
      target_artifact: "package.json",
      expected_result: `${scriptName} command wired`,
      actual_result: packageJson.scripts?.[scriptName]
        ? packageJson.scripts[scriptName]
        : "MISSING",
      status: packageJson.scripts?.[scriptName] ? "PASS" : "FAIL",
      severity: "critical",
      remediation_if_failed: `Add package.json script ${scriptName}.`,
    }),
  );
}

writeJsonl("validation/preflight_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
