import fs from "node:fs";
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
for (const pub of cfg.seo.requiredPublicFiles) {
  rows.push(
    result({
      check_id: `SEO-PUBLIC-${pub}`,
      check_class: "seo_runtime_validation",
      target_artifact: `public/${pub}`,
      expected_result: `${pub} exists`,
      actual_result: exists(`public/${pub}`) ? "exists" : "missing",
      status: exists(`public/${pub}`) ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: `Add public/${pub}.`,
    }),
  );
}
const layout = readText("src/layouts/BaseLayout.astro");
for (const marker of cfg.seo.requiredHeadMarkers) {
  const found =
    layout.includes(marker) ||
    (fs.existsSync("dist/index.html") &&
      fs.readFileSync("dist/index.html", "utf8").includes(marker));
  rows.push(
    result({
      check_id: `SEO-HEAD-${marker}`,
      check_class: "seo_runtime_validation",
      target_artifact: "src/layouts/BaseLayout.astro",
      expected_result: `head includes ${marker}`,
      actual_result: found ? "found" : "missing",
      status: found ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: `Add ${marker} support to BaseLayout.`,
    }),
  );
}
const pages = listFiles("src/pages", (rel) => rel.endsWith(".astro"));
for (const page of pages) {
  const text = readText(page);
  const hasTitle = /<BaseLayout[^>]*title=/.test(text);
  const hasDescription = /<BaseLayout[^>]*description=/.test(text);
  rows.push(
    result({
      check_id: `SEO-META-${page}`,
      check_class: "seo_runtime_validation",
      target_artifact: page,
      expected_result: "page passes title and description",
      actual_result: hasTitle && hasDescription ? "title+description" : "missing title or description",
      status: hasTitle && hasDescription ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: "Pass title and description into BaseLayout.",
    }),
  );
}
writeJsonl("validation/seo_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
