import { spawnSync } from 'node:child_process';
import { exists, result, writeJsonl, statusFromRows } from './lib.mjs';

const checks = [];

// Check if we can start the preview server
if (exists('dist/index.html')) {
  // Use npm_execpath if available (set by npm), otherwise fallback to PATH
  // Use Node's timeout mechanism instead of external timeout command
  const npmPath = process.env.npm_execpath || 'npm';
  const previewProc = spawnSync(npmPath, ['run', 'preview'], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    timeout: 5000,
    shell: process.platform === 'win32'
  });

  checks.push(result(
    'preview-server-start',
    'server_startup',
    'npm run preview',
    'Preview server starts without immediate errors',
    previewProc.signal === 'SIGTERM' || previewProc.status === null ? 'Server started (timeout reached)' : `Exit code ${previewProc.status}`,
    previewProc.signal === 'SIGTERM' || previewProc.status === null || previewProc.status === 0 ? 'PASS' : 'FAIL',
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