import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { exists, resolveNodeTool, result, statusFromRows, writeJsonl } from "./lib.mjs";

const rows = [];
const hasNodeModules = fs.existsSync("node_modules/.bin/astro");
if (!hasNodeModules) {
  rows.push(
    result({
      check_id: "BUILD-NODE-MODULES",
      check_class: "execution_validation",
      target_artifact: "node_modules/.bin/astro",
      expected_result: "Astro dependency installed before build execution",
      actual_result: "node_modules missing in current environment",
      status: "BLOCKED",
      severity: "critical",
      remediation_if_failed: "Run npm install or npm ci, then rerun npm run verify:build.",
    }),
  );
} else {
  const run = spawnSync(resolveNodeTool("npm"), ["run", "build"], { encoding: "utf8" });
  fs.mkdirSync("validation", { recursive: true });
  fs.writeFileSync("validation/build_output.txt", `${run.stdout}\n${run.stderr}`);
  rows.push(
    result({
      check_id: "BUILD-COMMAND",
      check_class: "execution_validation",
      target_artifact: "npm run build",
      expected_result: "exit code 0",
      actual_result: `exit code ${run.status}`,
      status: run.status === 0 ? "PASS" : "FAIL",
      severity: "critical",
      remediation_if_failed: "Fix build errors shown in validation/build_output.txt.",
    }),
    result({
      check_id: "BUILD-DIST",
      check_class: "execution_validation",
      target_artifact: "dist",
      expected_result: "dist directory exists after build",
      actual_result: exists("dist") ? "exists" : "missing",
      status: exists("dist") ? "PASS" : "FAIL",
      severity: "critical",
      remediation_if_failed: "Fix Astro build output.",
    }),
  );
}
writeJsonl("validation/build_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
