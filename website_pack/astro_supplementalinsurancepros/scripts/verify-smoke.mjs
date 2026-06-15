import fs from 'node:fs';
import path from 'node:path';
import { readJson, configPath, result, writeJsonl, statusFromRows } from './lib.mjs';
const cfg = readJson(configPath);
const rows = [];
const baseUrl = process.env.RUNTIME_BASE_URL;

async function fetchMode() {
  for (const route of cfg.routes) {
    try {
      const res = await fetch(new URL(route, baseUrl));
      rows.push(result(`SMOKE-HTTP-${route}`, 'runtime_smoke_validation', route, 'HTTP 200', `HTTP ${res.status}`, res.status === 200 ? 'PASS' : 'FAIL', 'critical', 'Fix route or deployment.'));
    } catch (error) {
      rows.push(result(`SMOKE-HTTP-${route}`, 'runtime_smoke_validation', route, 'fetch succeeds', error.message, 'FAIL', 'critical', 'Start preview server or verify deployed URL.'));
    }
  }
}

function staticMode() {
  if (!fs.existsSync('dist')) {
    rows.push(result('SMOKE-DIST', 'runtime_smoke_validation', 'dist', 'dist exists for static route check', 'dist missing', 'BLOCKED', 'critical', 'Run npm run build first.'));
    return;
  }
  for (const route of cfg.routes) {
    const file = route === '/' ? 'dist/index.html' : `dist${route}index.html`;
    rows.push(result(`SMOKE-STATIC-${route}`, 'runtime_smoke_validation', file, 'static HTML exists', fs.existsSync(file) ? 'exists' : 'missing', fs.existsSync(file) ? 'PASS' : 'FAIL', 'critical', 'Fix route generation.'));
  }
  const htmlFiles = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (full.endsWith('.html')) htmlFiles.push(full);
    }
  };
  walk('dist');
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const links = [...html.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]);
    for (const link of links) {
      if (link.includes('.')) continue;
      const target = link === '/' ? 'dist/index.html' : `dist${link.replace(/\/$/, '')}/index.html`;
      rows.push(result(`LINK-${path.relative('dist', file)}-${link}`, 'broken_link_validation', file, `internal link ${link} resolves`, fs.existsSync(target) ? 'resolved' : `missing ${target}`, fs.existsSync(target) ? 'PASS' : 'FAIL', 'high', 'Fix internal link target.'));
    }
  }
}

if (baseUrl) await fetchMode(); else staticMode();
writeJsonl('validation/smoke_checks.jsonl', rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === 'FAIL')) process.exit(1);
