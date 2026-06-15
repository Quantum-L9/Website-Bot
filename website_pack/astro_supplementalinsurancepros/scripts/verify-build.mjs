import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { exists, result, writeJsonl, statusFromRows } from './lib.mjs';
const rows = [];
const hasNodeModules = fs.existsSync('node_modules/.bin/astro');
if (!hasNodeModules) {
  rows.push(result('BUILD-NODE-MODULES', 'execution_validation', 'node_modules/.bin/astro', 'Astro dependency installed before build execution', 'node_modules missing in current environment', 'BLOCKED', 'critical', 'Run npm install or npm ci, then rerun npm run verify:build.'));
} else {
  const run = spawnSync('npm', ['run', 'build'], { encoding: 'utf8' });
  fs.mkdirSync('validation', { recursive: true });
  fs.writeFileSync('validation/build_output.txt', `${run.stdout}\n${run.stderr}`);
  rows.push(result('BUILD-COMMAND', 'execution_validation', 'npm run build', 'exit code 0', `exit code ${run.status}`, run.status === 0 ? 'PASS' : 'FAIL', 'critical', 'Fix build errors shown in validation/build_output.txt.'));
  rows.push(result('BUILD-DIST', 'execution_validation', 'dist', 'dist directory exists after build', exists('dist') ? 'exists' : 'missing', exists('dist') ? 'PASS' : 'FAIL', 'critical', 'Fix Astro build output.'));
}
writeJsonl('validation/build_checks.jsonl', rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === 'FAIL')) process.exit(1);
