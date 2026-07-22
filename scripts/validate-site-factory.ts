// L9_META: layer=script, role=site_factory_structural_validator, status=active, version=1.0.0
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { SiteAssemblerStage } from '../src/stages/SiteAssemblerStage.js';
import type { BuildContext, DomainSpec } from '../src/pipeline/BuildContext.js';
import { validateDomainSpec } from '../src/pipeline/validateDomainSpec.js';
import { validateGeneratedSite } from '../src/validation/validate-generated-site.js';
import { FileEvidenceStore } from '../src/pipeline/evidence/FileEvidenceStore.js';

const specPath = process.argv.find(argument => argument.startsWith('--spec='))?.slice('--spec='.length) ?? 'fixtures/ci-test-spec.yaml';
const parsed = parse(readFileSync(specPath, 'utf-8')) as unknown;
const spec = validateDomainSpec(parsed, specPath);
const buildId = `structural-${Date.now()}`;
const outputDir = resolve('build', 'validation', spec.client_id);
const generatedContent = new Map<string, string>();
for (const route of spec.routes) {
  for (const component of route.components) {
    generatedContent.set(`${route.slug}:${component}`, `Validated fixture content for ${route.title} ${component}. This content is deterministic and exists only for the structural validation command.`);
  }
}
const evidenceStore = new FileEvidenceStore({ rootDir: resolve('build', 'validation-evidence', spec.client_id, buildId), clientId: spec.client_id, buildId, mode: 'local-proof' });
const evidenceIndex = await evidenceStore.initialize();
const ctx: BuildContext = {
  buildId,
  clientId: spec.client_id,
  domainSpec: spec,
  dryRun: false,
  mode: 'local-proof',
  autoRegisterSeoBot: false,
  llm: { flushUsage: () => [] } as unknown as BuildContext['llm'],
  outputDir,
  evidenceStore,
  evidenceIndex,
  resume: false,
  designTokens: {
    primary: '#1a365d',
    secondary: '#2b6cb0',
    accent: '#1677ff',
    background: '#ffffff',
    text: '#17212b',
    font_heading: 'Inter',
    font_body: 'Inter',
  },
  qualityEvidence: { seoBaseline: 'pending', visualQa: 'pending' },
  generatedContent,
  generatedSchemas: new Map([['Organization', { '@context': 'https://schema.org', '@type': 'Organization', name: spec.business_name }]]),
  visualQaPassed: false,
  stageResults: new Map(),
  startedAt: new Date(),
};
try {
  await new SiteAssemblerStage().run(ctx);
  validateGeneratedSite(ctx.outputDir, spec.routes);
  if (!ctx.assemblyManifest?.sourceDigest) throw new Error('Assembly manifest source digest was not produced');
  console.log(JSON.stringify({ status: 'passed', outputDir: ctx.outputDir, routes: spec.routes.length, sourceDigest: ctx.assemblyManifest.sourceDigest }, null, 2));
} finally {
  if (process.env.KEEP_SITE_FACTORY_VALIDATION_OUTPUT !== 'true') rmSync(resolve('build', 'validation'), { recursive: true, force: true });
  rmSync(resolve('build', 'validation-evidence'), { recursive: true, force: true });
}
