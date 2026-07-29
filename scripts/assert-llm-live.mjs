// L9_META: layer=validation, role=llm_live_canary_assertion, status=active, version=1.0.0
// Post-build acceptance check for the credentialed local-proof canary. Proves the real
// @quantum-l9/llm-router produced the site by asserting (a) the deleted stub's sentinel
// string never appears in generated output, and (b) an Astro build materialized. A build
// only succeeds when generated copy clears the 80-word content gate, which the old stub
// (fixed 7-word response) never could — so a green build here is itself evidence the real
// router ran. This is a tripwire, not a substitute for the router's own telemetry.
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const STUB_SENTINEL = 'Stub response - LLM Router not available';
const rootArg = process.argv.find(a => a.startsWith('--root='))?.slice('--root='.length);
const root = resolve(rootArg ?? 'build/sites');

if (!existsSync(root)) {
  console.error(`assert-llm-live: no generated output found at ${root}`);
  process.exit(1);
}

const stubFindings = [];
let distFound = false;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git'].includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'dist' && existsSync(join(p, 'index.html'))) distFound = true;
      walk(p);
    } else if (/\.(astro|ts|tsx|json|html|md)$/.test(name)) {
      if (readFileSync(p, 'utf8').includes(STUB_SENTINEL)) stubFindings.push(p);
    }
  }
}
walk(root);

if (stubFindings.length) {
  console.error(`assert-llm-live: stub sentinel present in generated output:\n${stubFindings.join('\n')}`);
  process.exit(1);
}
if (!distFound) {
  console.error(`assert-llm-live: no Astro dist/index.html found under ${root}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, root, distFound: true, stubSentinelFindings: 0 }));
