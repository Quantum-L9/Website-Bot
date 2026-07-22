// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildContext, DomainSpec } from '../../src/pipeline/BuildContext.js';
import { FileEvidenceStore } from '../../src/pipeline/evidence/FileEvidenceStore.js';
import { computeAssemblySourceDigest, type AssemblyManifest } from '../../src/pipeline/evidence/AssemblyManifest.js';
import type { BuildProof } from '../../src/pipeline/evidence/BuildProof.js';
import type { PublicationEvidence } from '../../src/pipeline/evidence/PublicationEvidence.js';
import type { DeploymentEvidence } from '../../src/pipeline/evidence/DeploymentEvidence.js';

export function fixtureSpec(overrides: Partial<DomainSpec> = {}): DomainSpec {
  return {
    client_id: 'ci-test-client',
    business_name: 'CI Test Business',
    vertical: 'example_services',
    geography: { states: ['XX', 'YY'], primary_state: 'XX' },
    design: {
      status: 'resolved',
      palette: { primary: '#1a365d', secondary: '#2b6cb0' },
      fonts: { heading: 'Inter', body: 'Inter' },
    },
    routes: [
      { slug: '/', title: 'Home', components: ['hero', 'services-overview', 'trust-signals'] },
      { slug: '/services', title: 'Services', components: ['service-list', 'cta'] },
      { slug: '/contact', title: 'Contact', components: ['contact-form', 'map'] },
    ],
    seo_contract: { site_url: 'ci-test.example.com' },
    ...overrides,
  };
}

export function fixtureContext(overrides: Partial<DomainSpec> = {}): BuildContext {
  const spec = fixtureSpec(overrides);
  const outputDir = mkdtempSync(join(tmpdir(), 'website-bot-site-'));
  const buildId = `${spec.client_id}-fixture-build`;
  const evidenceStore = new FileEvidenceStore({
    rootDir: `${outputDir}.evidence`,
    clientId: spec.client_id,
    buildId,
    mode: 'local-proof',
    now: () => new Date('2026-07-20T00:00:00.000Z'),
  });
  const generatedContent = new Map<string, string>();
  for (const route of spec.routes) {
    for (const component of route.components) {
      generatedContent.set(
        `${route.slug}:${component}`,
        `${route.title} ${component} fixture content. The materializer must retain this exact generated content without treating hyphens as a separate component identity.`,
      );
    }
  }
  return {
    buildId,
    clientId: spec.client_id,
    domainSpec: spec,
    dryRun: false,
    mode: 'local-proof',
    autoRegisterSeoBot: false,
    llm: { flushUsage: () => [] } as unknown as BuildContext['llm'],
    outputDir,
    designTokens: {
      primary: '#1a365d',
      secondary: '#2b6cb0',
      accent: '#1a365d',
      background: '#ffffff',
      text: '#17212b',
      font_heading: 'Inter',
      font_body: 'Inter',
    },
    evidenceStore,
    evidenceIndex: {
      schema: 'website-bot.evidence-index/v2',
      build_id: buildId,
      client_id: spec.client_id,
      mode: 'local-proof',
      revision: 1,
      artifacts: {},
      failure_history: [],
      chain_status: 'empty',
      created_at: '2026-07-20T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
    },
    resume: false,
    qualityEvidence: { seoBaseline: 'pending', visualQa: 'pending' },
    generatedContent,
    generatedSchemas: new Map([
      ['Organization', { '@context': 'https://schema.org', '@type': 'Organization', name: spec.business_name }],
    ]),
    visualQaPassed: false,
    stageResults: new Map(),
    startedAt: new Date('2026-07-20T00:00:00.000Z'),
  };
}

export function fixtureAssemblyManifest(ctx: BuildContext): AssemblyManifest {
  const files = [{ path: 'src/pages/index.astro', sha256: 'a'.repeat(64), owner: 'website-bot' as const, bytes: 1 }];
  return {
    schema: 'website-bot.assembly-manifest/v2',
    buildId: ctx.buildId,
    clientId: ctx.clientId,
    generatorVersion: 'test',
    templateVersion: '1.0.0',
    templateDigest: 'f'.repeat(64),
    routes: ctx.domainSpec.routes.map(route => route.slug),
    files,
    sourceDigest: computeAssemblySourceDigest(files),
    generatedAt: '2026-07-20T00:00:00.000Z',
    outputDir: ctx.outputDir,
  };
}

export function fixtureBuildProof(
  ctx: BuildContext,
  assemblyManifestSha256: string,
  sourceDigest = '1'.repeat(64),
): BuildProof {
  return {
    schema: 'website-bot.build-proof/v2',
    proofId: `${ctx.buildId}:build-proof`,
    buildId: ctx.buildId,
    clientId: ctx.clientId,
    assemblyManifestSha256,
    sourceDir: ctx.outputDir,
    distDir: `${ctx.outputDir}/dist`,
    sourceDigest,
    distDigest: '2'.repeat(64),
    packageManager: 'npm',
    packageManagerVersion: '10.9.2',
    installCommand: ['npm', 'ci'],
    checkCommand: ['npm', 'run', 'check'],
    buildCommand: ['npm', 'run', 'build'],
    checks: [
      { name: 'install', status: 'passed', durationMs: 1 },
      { name: 'astro-check', status: 'passed', durationMs: 1 },
      { name: 'astro-build', status: 'passed', durationMs: 1 },
      { name: 'route-assertion', status: 'passed', durationMs: 1 },
      { name: 'sitemap-assertion', status: 'passed', durationMs: 1 },
    ],
    builtRoutes: ctx.domainSpec.routes.map(route => route.slug),
    startedAt: '2026-07-20T00:00:00.000Z',
    completedAt: '2026-07-20T00:00:01.000Z',
    status: 'passed',
  };
}

export function fixturePublicationEvidence(
  ctx: BuildContext,
  buildProof: BuildProof,
  buildProofSha256: string,
  commitSha = 'e'.repeat(40),
): PublicationEvidence {
  return {
    schema: 'website-bot.publication-evidence/v2',
    publicationId: `${ctx.buildId}:publication`,
    buildId: ctx.buildId,
    clientId: ctx.clientId,
    buildProofId: buildProof.proofId,
    buildProofSha256,
    repository: 'example/disposable-site',
    repositoryId: '123',
    branch: 'main',
    previousHeadSha: 'a'.repeat(40),
    commitSha,
    treeSha: 'b'.repeat(40),
    verifiedBranchHeadSha: commitSha,
    sourceDigest: buildProof.sourceDigest,
    managedManifestDigest: '3'.repeat(64),
    changedPaths: ['src/pages/index.astro'],
    deletedPaths: [],
    noOp: false,
    publishedAt: '2026-07-20T00:00:02.000Z',
    status: 'passed',
  };
}

export function fixtureDeploymentEvidence(
  ctx: BuildContext,
  publication: PublicationEvidence,
  publicationSha256: string,
): DeploymentEvidence {
  return {
    schema: 'website-bot.deployment-evidence/v2',
    deploymentEvidenceId: `${ctx.buildId}:deployment`,
    buildId: ctx.buildId,
    clientId: ctx.clientId,
    publicationId: publication.publicationId,
    publicationSha256,
    provider: 'vercel',
    projectId: 'prj_1',
    deploymentId: 'dpl_1',
    requestedCommitSha: publication.commitSha,
    observedCommitSha: publication.commitSha,
    state: 'READY',
    deploymentUrl: 'https://preview.example.com',
    aliases: [],
    sourceRepository: publication.repository,
    sourceBranch: publication.branch,
    readyAt: '2026-07-20T00:00:03.000Z',
    triggerMode: 'api',
    target: 'preview',
    status: 'passed',
  };
}

export function cleanupContext(ctx: BuildContext): void {
  rmSync(ctx.outputDir, { recursive: true, force: true });
  if (!ctx.evidenceStore.rootDir.startsWith('memory://')) rmSync(ctx.evidenceStore.rootDir, { recursive: true, force: true });
}

export function withEnv(values: Record<string, string | undefined>, action: () => Promise<void> | void): Promise<void> | void {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = action();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

export async function persistFixtureBuildProof(
  ctx: BuildContext,
  sourceDigest?: string,
): Promise<{ proof: BuildProof; sha256: string }> {
  const assembly = await ctx.evidenceStore.readAssembly();
  if (!assembly) throw new Error('fixture assembly evidence is required');
  const proof = fixtureBuildProof(ctx, assembly.record.sha256, sourceDigest ?? assembly.value.sourceDigest);
  const record = await ctx.evidenceStore.writeBuild(proof);
  ctx.buildProof = proof;
  return { proof, sha256: record.sha256 };
}

export async function persistFixturePublicationEvidence(
  ctx: BuildContext,
  commitSha = 'e'.repeat(40),
): Promise<{ publication: PublicationEvidence; sha256: string }> {
  const build = await ctx.evidenceStore.readBuild();
  if (!build) throw new Error('fixture build evidence is required');
  const publication = fixturePublicationEvidence(ctx, build.value, build.record.sha256, commitSha);
  const record = await ctx.evidenceStore.writePublication(publication);
  ctx.publicationEvidence = publication;
  ctx.sourceCommitSha = publication.commitSha;
  return { publication, sha256: record.sha256 };
}

export async function persistFixtureDeploymentEvidence(
  ctx: BuildContext,
): Promise<{ deployment: DeploymentEvidence; sha256: string }> {
  const publication = await ctx.evidenceStore.readPublication();
  if (!publication) throw new Error('fixture publication evidence is required');
  const deployment = fixtureDeploymentEvidence(ctx, publication.value, publication.record.sha256);
  const record = await ctx.evidenceStore.writeDeployment(deployment);
  ctx.deploymentEvidence = deployment;
  ctx.deploymentUrl = deployment.deploymentUrl;
  return { deployment, sha256: record.sha256 };
}
