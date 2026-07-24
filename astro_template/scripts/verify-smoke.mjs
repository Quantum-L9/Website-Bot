import { spawnSync } from 'node:child_process';
import { exists, result, writeJsonl, statusFromRows } from './lib.mjs';

const checks = [];

// Check if we can start the preview server
if (exists('dist/index.html')) {
  // Try to start preview server for smoke test
  const previewProc = spawnSync('timeout', ['5', 'npm', 'run', 'preview'], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe']
  });

  checks.push(result(
    'preview-server-start',
    'server_startup',
    'npm run preview',
    'Preview server starts without immediate errors',
    previewProc.status === 124 ? 'Server started (timeout reached)' : `Exit code ${previewProc.status}`,
    previewProc.status === 124 || previewProc.status === 0 ? 'PASS' : 'FAIL',
    'medium',
    'Fix server startup issues'
  ));
} else {
  checks.push(result(
    'build-required-for-smoke',
    'prerequisite',
    'dist/',
    'Build output exists for smoke testing',
    'Build output missing',
    'BLOCKED',
    'medium',
    'Run npm run build first'
  ));
}

// Basic static file checks
if (exists('dist')) {
  const staticFiles = ['favicon.ico', 'robots.txt'].filter(file => exists(`dist/${file}`));
  checks.push(result(
    'static-files-present',
    'static_assets',
    'dist/ static files',
    'Common static files present',
    staticFiles.length > 0 ? `Found: ${staticFiles.join(', ')}` : 'No common static files found',
    staticFiles.length > 0 ? 'PASS' : 'UNKNOWN',
    'low',
    'Consider adding favicon.ico, robots.txt'
  ));
}

writeJsonl('validation/smoke_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === 'FAIL') process.exit(1);