import { exists, readText, result, writeJsonl, statusFromRows } from './lib.mjs';
const rows = [];
const runbookExists = exists('docs/DEPLOYMENT_RUNBOOK.md');
const text = runbookExists ? readText('docs/DEPLOYMENT_RUNBOOK.md') : '';
const rollbackMarkers = ['vercel rollback', 'previous deployment', 'rollback validation'];
for (const marker of rollbackMarkers) {
  const found = text.toLowerCase().includes(marker);
  rows.push(result(`ROLLBACK-${marker}`, 'rollback_validation', 'docs/DEPLOYMENT_RUNBOOK.md', `runbook documents ${marker}`, found ? 'found' : 'missing', found ? 'PASS' : 'FAIL', 'medium', `Add rollback instruction covering ${marker}.`));
}
writeJsonl('validation/rollback_checks.jsonl', rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === 'FAIL')) process.exit(1);
