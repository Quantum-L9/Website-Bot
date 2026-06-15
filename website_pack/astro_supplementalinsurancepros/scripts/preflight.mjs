import fs from 'node:fs';
import path from 'node:path';
import { readJson, configPath, parseEnvExample, result, writeJsonl, statusFromRows } from './lib.mjs';

const cfg = readJson(configPath);
const env = parseEnvExample();
const rows = [];

for (const key of cfg.requiredPublicEnv) {
  const value = env[key];
  const isPresent = typeof value === 'string' && value.length > 0;
  const isUnknown = isPresent && value.includes('UNKNOWN');
  rows.push(result(
    `ENV-${key}`,
    'operator_configuration',
    '.env.example',
    `${key} declared and not hardcoded as a secret`,
    isPresent ? `${key}=${isUnknown ? 'UNKNOWN_DECLARED' : 'DECLARED'}` : 'MISSING',
    isPresent ? (isUnknown ? 'UNKNOWN' : 'PASS') : 'FAIL',
    isUnknown ? 'high' : 'critical',
    `Set ${key} before production launch.`
  ));
}

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const requiredScripts = ['verify:preflight','verify:source','verify:build','verify:smoke','verify:form','verify:analytics','verify:crm','verify:seo','verify:rollback','verify:all'];
for (const scriptName of requiredScripts) {
  rows.push(result(
    `SCRIPT-${scriptName}`,
    'command_wiring',
    'package.json',
    `${scriptName} command wired`,
    packageJson.scripts?.[scriptName] ? packageJson.scripts[scriptName] : 'MISSING',
    packageJson.scripts?.[scriptName] ? 'PASS' : 'FAIL',
    'critical',
    `Add package.json script ${scriptName}.`
  ));
}

writeJsonl('validation/preflight_checks.jsonl', rows);
console.log(JSON.stringify({ status: statusFromRows(rows), checks: rows.length }, null, 2));
if (rows.some((r) => r.status === 'FAIL')) process.exit(1);
