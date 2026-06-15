import fs from 'node:fs';
import path from 'node:path';

export const root = process.cwd();
export const configPath = path.join(root, 'config', 'runtime-verification.config.json');

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

export function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

export function listFiles(dir, matcher = () => true) {
  const base = path.join(root, dir);
  const out = [];
  if (!fs.existsSync(base)) return out;
  const walk = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else {
        const rel = path.relative(root, full).replaceAll(path.sep, '/');
        if (matcher(rel)) out.push(rel);
      }
    }
  };
  walk(base);
  return out.sort();
}

export function parseEnvExample() {
  const text = fs.existsSync(path.join(root, '.env.example')) ? readText('.env.example') : '';
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    values[key.trim()] = rest.join('=').trim();
  }
  return values;
}

export function result(check_id, check_class, target_artifact, expected_result, actual_result, status, severity = 'medium', remediation_if_failed = '') {
  return { check_id, check_class, target_artifact, command_or_inspection_method: 'node script inspection', expected_result, actual_result, status, severity, remediation_if_failed, evidence: target_artifact };
}

export function writeJsonl(relativePath, rows) {
  fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  fs.writeFileSync(path.join(root, relativePath), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

export function statusFromRows(rows) {
  if (rows.some((row) => row.status === 'FAIL')) return 'FAIL';
  if (rows.some((row) => row.status === 'BLOCKED')) return 'BLOCKED';
  if (rows.some((row) => row.status === 'UNKNOWN')) return 'PASS_WITH_UNKNOWNS';
  return 'PASS';
}
