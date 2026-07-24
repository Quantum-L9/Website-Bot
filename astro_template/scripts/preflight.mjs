import { exists, result, writeJsonl, statusFromRows } from './lib.mjs';

const checks = [];

// Check essential files exist
checks.push(result(
  'package-json-exists',
  'file_existence',
  'package.json',
  'File exists',
  exists('package.json') ? 'File exists' : 'File missing',
  exists('package.json') ? 'PASS' : 'FAIL',
  'high',
  'Create package.json file'
));

checks.push(result(
  'astro-config-exists', 
  'file_existence',
  'astro.config.mjs',
  'File exists',
  exists('astro.config.mjs') ? 'File exists' : 'File missing',
  exists('astro.config.mjs') ? 'PASS' : 'FAIL',
  'high',
  'Create astro.config.mjs file'
));

checks.push(result(
  'src-directory-exists',
  'directory_existence', 
  'src/',
  'Directory exists',
  exists('src') ? 'Directory exists' : 'Directory missing',
  exists('src') ? 'PASS' : 'FAIL',
  'high',
  'Create src/ directory'
));

// Check Node.js version compatibility
const nodeVersion = process.version;
const requiredNodeVersion = '20.3.0';
const nodeVersionOk = nodeVersion >= `v${requiredNodeVersion}`;

checks.push(result(
  'node-version-compatibility',
  'version_check',
  'Node.js version',
  `>= ${requiredNodeVersion}`,
  nodeVersion,
  nodeVersionOk ? 'PASS' : 'FAIL', 
  'high',
  `Update Node.js to version ${requiredNodeVersion} or higher`
));

writeJsonl('validation/preflight_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === 'FAIL') process.exit(1);