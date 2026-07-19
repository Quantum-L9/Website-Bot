import { readJson, configPath, exists, listFiles, readText, result, writeJsonl, statusFromRows } from './lib.mjs';
const cfg = readJson(configPath);
const rows = [];

for (const route of cfg.routes) {
  const page = route === '/' ? 'src/pages/index.astro' : `src/pages${route.replace(/\/$/, '')}.astro`;
  rows.push(result(`ROUTE-SOURCE-${route}`, 'structural_validation', page, 'route source exists', exists(page) ? 'exists' : 'missing', exists(page) ? 'PASS' : 'FAIL', 'critical', 'Create or restore the route source file.'));
}
for (const file of ['src/layouts/BaseLayout.astro','src/components/LeadForm.astro','astro.config.mjs','package.json','public/robots.txt','public/llms.txt']) {
  rows.push(result(`FILE-${file}`, 'structural_validation', file, 'required file exists', exists(file) ? 'exists' : 'missing', exists(file) ? 'PASS' : 'FAIL', 'critical', 'Restore required project file.'));
}
const files = listFiles('.', (rel) => !rel.includes('node_modules') && !rel.includes('.git') && !rel.startsWith('validation/') && rel !== 'scripts/verify-source.mjs');
for (const rel of files) {
  const text = readText(rel);
  const bad = /FIXME|stub-only|pass-only|throw new Error\(['\"]not implemented/i.test(text);
  rows.push(result(`NOSTUB-${rel}`, 'no_stub_validation', rel, 'no empty implementation or not-implemented markers', bad ? 'disallowed implementation marker found' : 'clean', bad ? 'FAIL' : 'PASS', bad ? 'high' : 'low', 'Replace disallowed marker with complete implementation or documented Unknown.'));
}
writeJsonl('validation/source_checks.jsonl', rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === 'FAIL')) process.exit(1);
