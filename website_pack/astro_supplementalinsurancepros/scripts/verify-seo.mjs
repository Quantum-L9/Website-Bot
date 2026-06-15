import fs from 'node:fs';
import { readJson, configPath, exists, readText, listFiles, result, writeJsonl, statusFromRows } from './lib.mjs';
const cfg = readJson(configPath);
const rows = [];
for (const pub of cfg.seo.requiredPublicFiles) {
  rows.push(result(`SEO-PUBLIC-${pub}`, 'seo_runtime_validation', `public/${pub}`, `${pub} exists`, exists(`public/${pub}`) ? 'exists' : 'missing', exists(`public/${pub}`) ? 'PASS' : 'FAIL', 'high', `Add public/${pub}.`));
}
const layout = readText('src/layouts/BaseLayout.astro');
for (const marker of cfg.seo.requiredHeadMarkers) {
  const found = layout.includes(marker) || (fs.existsSync('dist/index.html') && fs.readFileSync('dist/index.html','utf8').includes(marker));
  rows.push(result(`SEO-HEAD-${marker}`, 'seo_runtime_validation', 'src/layouts/BaseLayout.astro', `head includes ${marker}`, found ? 'found' : 'missing', found ? 'PASS' : 'FAIL', 'high', `Add ${marker} support to BaseLayout.`));
}
const pages = listFiles('src/pages', (rel) => rel.endsWith('.astro'));
for (const page of pages) {
  const text = readText(page);
  const hasTitle = /<BaseLayout[^>]*title=/.test(text);
  const hasDescription = /<BaseLayout[^>]*description=/.test(text);
  rows.push(result(`SEO-META-${page}`, 'seo_runtime_validation', page, 'page passes title and description', hasTitle && hasDescription ? 'title+description' : 'missing title or description', hasTitle && hasDescription ? 'PASS' : 'FAIL', 'high', 'Pass title and description into BaseLayout.'));
}
writeJsonl('validation/seo_checks.jsonl', rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === 'FAIL')) process.exit(1);
