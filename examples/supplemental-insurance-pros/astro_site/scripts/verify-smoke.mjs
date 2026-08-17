import fs from "node:fs";
import path from "node:path";
import { configPath, readJson, result, statusFromRows, writeJsonl } from "./lib.mjs";

const cfg = readJson(configPath);
const rows = [];
const baseUrl = process.env.RUNTIME_BASE_URL;

async function fetchMode() {
  for (const route of cfg.routes) {
    try {
      const res = await fetch(new URL(route, baseUrl));
      rows.push(
        result({
          check_id: `SMOKE-HTTP-${route}`,
          check_class: "runtime_smoke_validation",
          target_artifact: route,
          expected_result: "HTTP 200",
          actual_result: `HTTP ${res.status}`,
          status: res.status === 200 ? "PASS" : "FAIL",
          severity: "critical",
          remediation_if_failed: "Fix route or deployment.",
        }),
      );
    } catch (error) {
      rows.push(
        result({
          check_id: `SMOKE-HTTP-${route}`,
          check_class: "runtime_smoke_validation",
          target_artifact: route,
          expected_result: "fetch succeeds",
          actual_result: error.message,
          status: "FAIL",
          severity: "critical",
          remediation_if_failed: "Start preview server or verify deployed URL.",
        }),
      );
    }
  }
}

function pushDistBlockedCheck() {
  rows.push(
    result({
      check_id: "SMOKE-DIST",
      check_class: "runtime_smoke_validation",
      target_artifact: "dist",
      expected_result: "dist exists for static route check",
      actual_result: "dist missing",
      status: "BLOCKED",
      severity: "critical",
      remediation_if_failed: "Run npm run build first.",
    }),
  );
}

function pushStaticRouteCheck(route) {
  const file = route === "/" ? "dist/index.html" : `dist${route}index.html`;
  rows.push(
    result({
      check_id: `SMOKE-STATIC-${route}`,
      check_class: "runtime_smoke_validation",
      target_artifact: file,
      expected_result: "static HTML exists",
      actual_result: fs.existsSync(file) ? "exists" : "missing",
      status: fs.existsSync(file) ? "PASS" : "FAIL",
      severity: "critical",
      remediation_if_failed: "Fix route generation.",
    }),
  );
}

function collectHtmlFiles(dir) {
  const htmlFiles = [];
  const walk = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else if (full.endsWith(".html")) htmlFiles.push(full);
    }
  };
  walk(dir);
  return htmlFiles;
}

function pushLinkCheck(file, link) {
  const target = link === "/" ? "dist/index.html" : `dist${link.replace(/\/$/, "")}/index.html`;
  rows.push(
    result({
      check_id: `LINK-${path.relative("dist", file)}-${link}`,
      check_class: "broken_link_validation",
      target_artifact: file,
      expected_result: `internal link ${link} resolves`,
      actual_result: fs.existsSync(target) ? "resolved" : `missing ${target}`,
      status: fs.existsSync(target) ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: "Fix internal link target.",
    }),
  );
}

function staticMode() {
  if (!fs.existsSync("dist")) {
    pushDistBlockedCheck();
    return;
  }
  for (const route of cfg.routes) {
    pushStaticRouteCheck(route);
  }
  for (const file of collectHtmlFiles("dist")) {
    const html = fs.readFileSync(file, "utf8");
    const links = [...html.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]);
    for (const link of links) {
      if (link.includes(".")) continue;
      pushLinkCheck(file, link);
    }
  }
}

if (baseUrl) await fetchMode();
else staticMode();
writeJsonl("validation/smoke_checks.jsonl", rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === "FAIL")) process.exit(1);
