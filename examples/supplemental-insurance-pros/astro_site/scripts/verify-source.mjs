import {
  configPath,
  exists,
  listFiles,
  readJson,
  readText,
  result,
  statusFromRows,
  writeJsonl,
} from "./lib.mjs";

const cfg = readJson(configPath);
const rows = [];

for (const route of cfg.routes) {
  const page =
    route === "/" ? "src/pages/index.astro" : `src/pages${route.replace(/\/$/, "")}.astro`;
  rows.push(
    result({
      check_id: `ROUTE-SOURCE-${route}`,
      check_class: "structural_validation",
      target_artifact: page,
      expected_result: "route source exists",
      actual_result: exists(page) ? "exists" : "missing",
      status: exists(page) ? "PASS" : "FAIL",
      severity: "critical",
      remediation_if_failed: "Create or restore the route source file.",
    }),
  );
}
for (const file of [
  "src/layouts/BaseLayout.astro",
  "src/components/LeadForm.astro",
  "astro.config.mjs",
  "package.json",
  "public/robots.txt",
  "public/llms.txt",
]) {
  rows.push(
    result({
      check_id: `FILE-${file}`,
      check_class: "structural_validation",
      target_artifact: file,
      expected_result: "required file exists",
      actual_result: exists(file) ? "exists" : "missing",
      status: exists(file) ? "PASS" : "FAIL",
      severity: "critical",
      remediation_if_failed: "Restore required project file.",
    }),
  );
}
const files = listFiles(
  ".",
  (rel) =>
    !rel.includes("node_modules") &&
    !rel.includes(".git") &&
    !rel.startsWith("validation/") &&
    rel !== "scripts/verify-source.mjs",
);
for (const rel of files) {
  const text = readText(rel);
  const bad = /FIXME|stub-only|pass-only|throw new Error\(['"]not implemented/i.test(text);
  rows.push(
    result({
      check_id: `NOSTUB-${rel}`,
      check_class: "no_stub_validation",
      target_artifact: rel,
      expected_result: "no empty implementation or not-implemented markers",
      actual_result: bad ? "disallowed implementation marker found" : "clean",
      status: bad ? "FAIL" : "PASS",
      severity: bad ? "high" : "low",
      remediation_if_failed: "Replace disallowed marker with complete implementation or documented Unknown.",
    }),
  );
}
writeJsonl("validation/source_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
