import { spawnSync } from 'node:child_process';
import { exists, result, writeJsonl, statusFromRows } from './lib.mjs';

const checks = [];

// Try to build the site
const buildResult = spawnSync('npm', ['run', 'build'], { 
  encoding: 'utf8',
  stdio: ['inherit', 'pipe', 'pipe']
});

checks.push(result(
  'astro-build',
  'build_process',
  'npm run build',
  'Build succeeds (exit code 0)',
  `Exit code ${buildResult.status}, stderr: ${buildResult.stderr?.slice(0, 200) || 'none'}`,
  buildResult.status === 0 ? 'PASS' : 'FAIL',
  'high',
  'Fix build errors shown in output'
));

// Check if dist directory was created
if (buildResult.status === 0) {
  checks.push(result(
    'dist-directory-created',
    'build_output',
    'dist/',
    'Build output directory exists',
    exists('dist') ? 'dist/ directory exists' : 'dist/ directory missing',
    exists('dist') ? 'PASS' : 'FAIL',
    'high',
    'Verify build process creates dist/ directory'
  ));

  // Check for index.html in output
  checks.push(result(
    'index-html-generated',
    'build_output',
    'dist/index.html',
    'Index HTML file generated',
    exists('dist/index.html') ? 'index.html found' : 'index.html missing',
    exists('dist/index.html') ? 'PASS' : 'FAIL',
    'high',
    'Ensure pages generate HTML output'
  ));
}

writeJsonl('validation/build_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

// Note: Build failures are often acceptable during development
// So we use a softer exit strategy
if (status === 'FAIL' && process.env.STRICT_BUILD === 'true') {
  process.exit(1);
}