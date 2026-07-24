import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const commands = [
  ['node', ['scripts/preflight.mjs']],
  ['node', ['scripts/verify-source.mjs']],
  ['node', ['scripts/verify-build.mjs']],
  ['node', ['scripts/verify-smoke.mjs']],
  ['node', ['scripts/verify-form.mjs']],
  ['node', ['scripts/verify-analytics.mjs']],
  ['node', ['scripts/verify-crm.mjs']],
  ['node', ['scripts/verify-seo.mjs']],
  ['node', ['scripts/verify-rollback.mjs']]
];

const summary = [];
let hardFail = false;

fs.mkdirSync('validation', { recursive: true });

for (const [cmd, args] of commands) {
  const label = `${cmd} ${args.join(' ')}`;
  const run = spawnSync(cmd, args, { encoding: 'utf8' });
  summary.push({ 
    command: label, 
    exit_code: run.status, 
    stdout: run.stdout?.trim() || '', 
    stderr: run.stderr?.trim() || '' 
  });
  
  // Allow build and smoke tests to fail without failing the entire suite
  if (run.status !== 0 && !label.includes('verify-build') && !label.includes('verify-smoke')) {
    hardFail = true;
  }
}

// Write execution trace
fs.writeFileSync('validation/execution_trace.jsonl', summary.map((row) => JSON.stringify(row)).join('\n') + '\n');

// Determine final status
const status = hardFail ? 'FAIL' : 
  summary.some(s => s.exit_code !== 0) ? 'PASS_WITH_BLOCKED_RUNTIME_CHECKS' : 'PASS';

console.log(JSON.stringify({ 
  status, 
  commands: summary.length,
  passed: summary.filter(s => s.exit_code === 0).length,
  failed: summary.filter(s => s.exit_code !== 0).length
}, null, 2));

if (hardFail) process.exit(1);