// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const scopeArg = process.argv.find(argument => argument.startsWith('--scope='));
const scope = scopeArg?.slice('--scope='.length) ?? 'all';
const roots = scope === 'evidence'
  ? ['tests/unit', 'tests/integration/local']
  : scope === 'provisioning'
  ? ['tests/unit']
  : scope === 'local'
    ? ['tests/unit', 'tests/integration/local']
  : scope === 'github'
    ? ['tests/integration/github']
    : scope === 'vercel'
      ? ['tests/integration/vercel']
      : scope === 'e2e'
        ? ['tests/integration/github', 'tests/integration/vercel']
        : ['tests/unit', 'tests/integration/local', 'tests/integration/github', 'tests/integration/vercel'];

const files = [];
for (const root of roots) {
  const absolute = resolve(root);
  if (!existsSync(absolute)) continue;
  for (const name of readdirSync(absolute).sort()) {
    if (!name.endsWith('.test.ts')) continue;
    if (scope === 'provisioning' && !name.includes('provision')) continue;
    if (scope === 'evidence' && !/(evidence|release-receipt|checkpoint|failure|process-boundary|handoff-emitter)/.test(name)) continue;
    files.push(join(root, name));
  }
}
if (files.length === 0) {
  console.error(`No tests found for scope: ${scope}`);
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
