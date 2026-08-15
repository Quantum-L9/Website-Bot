// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
// Test runner for the recursive engineering module. Collects the recursive
// test trees and spawns the node built-in runner with the tsx loader, exactly
// mirroring scripts/run-site-factory-tests.mjs.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['tests/unit/recursive', 'tests/integration/recursive'];
const files = [];
for (const root of roots) {
  const absolute = resolve(root);
  if (!existsSync(absolute)) continue;
  for (const name of readdirSync(absolute).sort()) {
    if (!name.endsWith('.test.ts')) continue;
    files.push(join(root, name));
  }
}
if (files.length === 0) {
  console.error('No recursive tests found');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
