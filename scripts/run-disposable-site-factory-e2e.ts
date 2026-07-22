// L9_META: layer=script, role=disposable_end_to_end_proof, status=active, version=1.0.0
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { makeBuildId, type BuildContext } from '../src/pipeline/BuildContext.js';
import { validateDomainSpec } from '../src/pipeline/validateDomainSpec.js';
import { DesignIntelligenceStage } from '../src/stages/DesignIntelligenceStage.js';
import { SiteAssemblerStage } from '../src/stages/SiteAssemblerStage.js';
import { PostHogSnippetStage } from '../src/stages/PostHogSnippetStage.js';
import { SiteBuildStage } from '../src/stages/SiteBuildStage.js';
import { ClientSourcePublishStage } from '../src/stages/ClientSourcePublishStage.js';
import { VercelDeployStage } from '../src/stages/VercelDeployStage.js';
import { ReleaseReceiptStage } from '../src/stages/ReleaseReceiptStage.js';
import { VisualQAStage } from '../src/stages/VisualQAStage.js';
import { ReleaseReceiptFinalizerStage } from '../src/stages/ReleaseReceiptFinalizerStage.js';
import { FileEvidenceStore } from '../src/pipeline/evidence/FileEvidenceStore.js';

const argument = (name: string): string | undefined => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string, value: string | undefined): string => {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
};
const disposable = (label: string, value: string): string => {
  if (!/(?:disposable|throwaway|test)/i.test(value)) throw new Error(`${label} must visibly identify a disposable/test target: ${value}`);
  return value;
};

const specPath = argument('spec') ?? 'fixtures/ci-test-spec.yaml';
const repository = disposable('WEBSITE_BOT_TEST_GITHUB_REPO', required('WEBSITE_BOT_TEST_GITHUB_REPO', process.env.WEBSITE_BOT_TEST_GITHUB_REPO));
const repositoryId = required('WEBSITE_BOT_TEST_GITHUB_REPO_ID', process.env.WEBSITE_BOT_TEST_GITHUB_REPO_ID);
const projectId = disposable('WEBSITE_BOT_TEST_VERCEL_PROJECT_ID', required('WEBSITE_BOT_TEST_VERCEL_PROJECT_ID', process.env.WEBSITE_BOT_TEST_VERCEL_PROJECT_ID));
required('GITHUB_SITE_TOKEN', process.env.GITHUB_SITE_TOKEN);
required('VERCEL_TOKEN', process.env.VERCEL_TOKEN);
const branch = process.env.WEBSITE_BOT_TEST_GITHUB_BRANCH ?? `website-bot-e2e-${Date.now()}`;
const parsed = parse(readFileSync(specPath, 'utf-8')) as unknown;
const spec = validateDomainSpec(parsed, specPath);
spec.deploy = {
  github_repo: repository,
  github_repo_id: repositoryId,
  source_branch: branch,
  vercel_project_id: projectId,
};
const buildId = makeBuildId(spec.client_id);
const generatedContent = new Map<string, string>();
for (const route of spec.routes) {
  for (const component of route.components) {
    generatedContent.set(
      `${route.slug}:${component}`,
      `Disposable end-to-end verification content for ${route.title} and ${component}. This deterministic text proves the assembly, local build, publication, deployment, and receipt chain without invoking an LLM or making product claims.`,
    );
  }
}
const evidenceStore = new FileEvidenceStore({ rootDir: resolve('build', 'disposable-e2e-evidence', spec.client_id, buildId), clientId: spec.client_id, buildId, mode: 'end-to-end' });
const evidenceIndex = await evidenceStore.initialize();
const ctx: BuildContext = {
  buildId,
  clientId: spec.client_id,
  domainSpec: spec,
  dryRun: false,
  mode: 'end-to-end',
  autoRegisterSeoBot: false,
  llm: { flushUsage: () => [] } as unknown as BuildContext['llm'],
  outputDir: resolve('build', 'disposable-e2e', spec.client_id, buildId),
  evidenceStore,
  evidenceIndex,
  resume: false,
  qualityEvidence: { seoBaseline: 'skipped', visualQa: 'pending' },
  generatedContent,
  generatedSchemas: new Map([
    ['Organization', { '@context': 'https://schema.org', '@type': 'Organization', name: spec.business_name }],
  ]),
  visualQaPassed: false,
  stageResults: new Map(),
  startedAt: new Date(),
};

await new DesignIntelligenceStage().run(ctx);
await new SiteAssemblerStage().run(ctx);
await new PostHogSnippetStage().run(ctx);
await new SiteBuildStage().run(ctx);
await new ClientSourcePublishStage().run(ctx);
await new VercelDeployStage().run(ctx);
await new ReleaseReceiptStage().run(ctx);
await new VisualQAStage().run(ctx);
await new ReleaseReceiptFinalizerStage().run(ctx);

if (!ctx.releaseReceipt || ctx.releaseReceipt.status !== 'succeeded') {
  throw new Error(`Disposable proof did not converge: ${JSON.stringify(ctx.releaseReceipt)}`);
}
console.log(JSON.stringify({
  status: 'passed',
  buildId,
  repository,
  branch,
  commitSha: ctx.sourceCommitSha,
  deploymentId: ctx.deploymentEvidence?.deploymentId,
  deploymentUrl: ctx.deploymentUrl,
  receiptPath: ctx.releaseReceiptPath,
  receiptId: ctx.releaseReceipt.receipt_id,
}, null, 2));
