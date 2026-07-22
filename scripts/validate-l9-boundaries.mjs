// L9_META: layer=validation, role=boundary_validator, status=active, version=1.1.0
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const packRoot = resolve(scriptDir, '../..');

// Layout detection: applied-repository layout keeps BOUNDARY_CLASSIFICATION.yaml at the
// repository root; the paired overlay pack keeps it one level above the Website-Bot subtree.
let contextRoot;
let classificationPath;
if (existsSync(resolve(repoRoot, 'BOUNDARY_CLASSIFICATION.yaml'))) {
  contextRoot = repoRoot;
  classificationPath = resolve(repoRoot, 'BOUNDARY_CLASSIFICATION.yaml');
} else if (existsSync(resolve(packRoot, 'BOUNDARY_CLASSIFICATION.yaml'))) {
  contextRoot = packRoot;
  classificationPath = resolve(packRoot, 'BOUNDARY_CLASSIFICATION.yaml');
} else {
  throw new Error('BOUNDARY_CLASSIFICATION.yaml not found at repository root or pack root');
}

const classificationText = readFileSync(classificationPath, 'utf8')
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');
const classification = JSON.parse(classificationText);
for (const [name, system] of Object.entries(classification.systems ?? {})) {
  if (system.classification !== 'platform_application' || system.runtime_node !== false) {
    throw new Error(`${name} boundary classification is not locked`);
  }
}
const boundary = classification.boundaries?.website_bot_to_seo_bot;
if (boundary?.protocol !== 'l9.website-factory.handoff/3.0' || boundary.gate_required !== false || boundary.transport_packet_required !== false) {
  throw new Error('website_bot_to_seo_bot exception is incomplete');
}

// In pack layout, scan both overlay subtrees; in applied-repository layout, scan the
// repository source itself. Missing roots are skipped rather than fatal so the same
// validator runs in Website-Bot and SEO-Bot checkouts.
const candidateRoots = contextRoot === packRoot
  ? [resolve(packRoot, 'Website-Bot'), resolve(packRoot, 'SEO-Bot')]
  : [repoRoot];
const roots = candidateRoots.filter((root) => existsSync(root));
if (roots.length === 0) throw new Error('no scan roots found for boundary validation');

const violations = [];
const validatorRelPaths = new Set([
  'Website-Bot/scripts/validate-l9-boundaries.mjs',
  'scripts/validate-l9-boundaries.mjs',
]);
const allowedPlatformApiPaths = new Set([
  'Website-Bot/src/stages/HandoffEmitterStage.ts',
  'src/stages/HandoffEmitterStage.ts',
]);
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'build', 'dist', '.astro'].includes(name)) continue;
    const p = resolve(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|js|mjs|md|ya?ml|json)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      const rel = relative(contextRoot, p).replaceAll('\\', '/');
      if (!validatorRelPaths.has(rel) && /PacketEnvelope/.test(text)) violations.push(`${rel}: PacketEnvelope`);
      const inProducerSource = rel.startsWith('Website-Bot/src/') || rel.startsWith('src/');
      if (/SEO_BOT_URL|\/api\/clients\/register/.test(text) && inProducerSource && !allowedPlatformApiPaths.has(rel)) {
        violations.push(`${rel}: unauthorized direct platform API egress`);
      }
    }
  }
}
for (const root of roots) walk(root);
if (violations.length) throw new Error(`forbidden boundary references:\n${violations.join('\n')}`);
console.log(JSON.stringify({ ok: true, classification: 'platform_application', protocol: boundary.protocol, layout: contextRoot === packRoot ? 'pack' : 'repository', packet_envelope_findings: 0, direct_peer_bypass_findings: 0 }, null, 2));
