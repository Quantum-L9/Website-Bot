// L9_META: layer=validation, role=llm_wiring_guard, status=active, version=1.0.0
//
// Regression guard: the content-generation path MUST be bound to the real
// @quantum-l9/llm-router, never a local stub. A stub silently ships placeholder
// copy on a triggered deploy (it ignores credentials and returns a canned
// string), so this guard fails closed if the wiring ever regresses.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));

// Support both the applied-repository layout (repo root) and the overlay-pack
// layout (Website-Bot/ subtree), mirroring the other L9 validators.
const candidates = [resolve(scriptDir, '..'), resolve(scriptDir, '../Website-Bot')];
const repoRoot = candidates.find((root) => existsSync(resolve(root, 'src/services/llm.ts')));
if (!repoRoot) {
  throw new Error('validate-llm-wiring: src/services/llm.ts not found in any known layout');
}

const REAL_PACKAGE = '@quantum-l9/llm-router';
const violations = [];

// 1. The real router must be a declared dependency.
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
if (!deps[REAL_PACKAGE]) {
  violations.push(`package.json does not declare ${REAL_PACKAGE}`);
}

// 2. The LLM adapter must import the real router and must not import a stub.
const adapterPath = resolve(repoRoot, 'src/services/llm.ts');
const adapter = readFileSync(adapterPath, 'utf8');
if (!new RegExp(`from ['"]${REAL_PACKAGE}['"]`).test(adapter)) {
  violations.push(`src/services/llm.ts does not import from ${REAL_PACKAGE}`);
}
if (/from ['"][^'"]*llm-stub[^'"]*['"]/.test(adapter)) {
  violations.push('src/services/llm.ts imports a stub module (llm-stub)');
}

// 3. No stub module may exist in the services directory.
const servicesDir = resolve(repoRoot, 'src/services');
if (existsSync(servicesDir)) {
  for (const name of readdirSync(servicesDir)) {
    if (/^llm-stub\.(ts|js|mjs)$/.test(name)) {
      violations.push(`stub module present: src/services/${name}`);
    }
  }
}

if (violations.length) {
  throw new Error(`LLM wiring regression detected:\n- ${violations.join('\n- ')}`);
}

console.log(JSON.stringify({ ok: true, package: REAL_PACKAGE, declared: deps[REAL_PACKAGE], adapter: 'src/services/llm.ts', stub_present: false }, null, 2));
