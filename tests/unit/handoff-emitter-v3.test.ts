// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { FileEvidenceStore } from '../../src/pipeline/evidence/FileEvidenceStore.js';
import { ReleaseReceiptStage } from '../../src/stages/ReleaseReceiptStage.js';
import { ReleaseReceiptFinalizerStage } from '../../src/stages/ReleaseReceiptFinalizerStage.js';
import { HandoffEmitterStage } from '../../src/stages/HandoffEmitterStage.js';
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureBuildProof,
  fixtureContext,
  fixtureDeploymentEvidence,
  fixturePublicationEvidence,
} from '../helpers/siteFactoryFixture.js';

async function prepareSucceededRelease(ctx: ReturnType<typeof fixtureContext>) {
  ctx.mode = 'end-to-end';
  ctx.deployTarget = {
    githubRepo: 'example/disposable-site',
    githubRepoId: '123',
    sourceBranch: 'main',
    vercelProjectId: 'prj_1',
    seoBotGithubCredentialRef: 'env://SEO_BOT_SITE_GITHUB_TOKEN',
    seoBotVercelDeployHookRef: 'env://SEO_BOT_SITE_VERCEL_DEPLOY_HOOK',
  };
  ctx.evidenceStore = new FileEvidenceStore({
    rootDir: ctx.evidenceStore.rootDir,
    clientId: ctx.clientId,
    buildId: ctx.buildId,
    mode: 'end-to-end',
    now: () => new Date('2026-07-20T00:00:03.000Z'),
  });
  ctx.evidenceIndex = await ctx.evidenceStore.initialize();
  const assembly = fixtureAssemblyManifest(ctx);
  const assemblyRecord = await ctx.evidenceStore.writeAssembly(assembly);
  const build = fixtureBuildProof(ctx, assemblyRecord.sha256, assembly.sourceDigest);
  const buildRecord = await ctx.evidenceStore.writeBuild(build);
  const publication = fixturePublicationEvidence(ctx, build, buildRecord.sha256);
  const publicationRecord = await ctx.evidenceStore.writePublication(publication);
  const deployment = fixtureDeploymentEvidence(ctx, publication, publicationRecord.sha256);
  await ctx.evidenceStore.writeDeployment(deployment);
  ctx.qualityEvidence = { seoBaseline: 'skipped', visualQa: 'passed' };
  ctx.visualQaPassed = true;
  await new ReleaseReceiptStage(() => new Date('2026-07-20T00:00:03.000Z')).run(ctx);
  await new ReleaseReceiptFinalizerStage().run(ctx);
  return { publication, deployment };
}

void test('emits handoff only from a succeeded persisted release bundle', async () => {
  const ctx = fixtureContext();
  const outputRoot = mkdtempSync(join(tmpdir(), 'handoff-output-'));
  try {
    const { publication } = await prepareSucceededRelease(ctx);
    await new HandoffEmitterStage(fetch, join(outputRoot, 'handoff.yaml'), join(outputRoot, 'ack.json')).run(ctx);
    const stored = await ctx.evidenceStore.readHandoff();
    assert.ok(stored);
    assert.equal(stored?.site.repository.commit_sha, publication.commitSha);
    assert.equal(stored?.proof.receipt_id, (await ctx.evidenceStore.readReleaseReceipt())?.value.receipt_id);
    assert.ok(existsSync(join(outputRoot, 'handoff.yaml')));
    const yaml = parse(readFileSync(join(outputRoot, 'handoff.yaml'), 'utf-8')) as { contract_id?: string };
    assert.equal(yaml.contract_id, stored?.contract_id);
  } finally {
    cleanupContext(ctx);
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

void test('persists only an identity-matching SEO-Bot maintenance acknowledgement', async () => {
  const ctx = fixtureContext();
  const outputRoot = mkdtempSync(join(tmpdir(), 'handoff-output-'));
  try {
    const { publication } = await prepareSucceededRelease(ctx);
    ctx.autoRegisterSeoBot = true;
    process.env.SEO_BOT_URL = 'https://seo-bot.example.com';
    process.env.SEO_BOT_API_KEY = 'shared-test-key';
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const contract = JSON.parse(String(init?.body)) as {
        client: { id: string };
        contract_id: string;
        integrity: { payload_digest: string };
        proof: { receipt_id: string };
        site: { repository: { full_name: string; branch: string; commit_sha: string } };
      };
      return Response.json({
        schema: 'seo-bot.website-factory-registration-ack/v1',
        registered: true,
        maintenance_ready: true,
        client_id: contract.client.id,
        contract_id: contract.contract_id,
        contract_digest: contract.integrity.payload_digest,
        release_receipt_id: contract.proof.receipt_id,
        verified_repository: contract.site.repository.full_name,
        verified_branch: contract.site.repository.branch,
        verified_commit_sha: contract.site.repository.commit_sha,
        probes: [
          { name: 'repository', ok: true },
          { name: 'branch', ok: true },
          { name: 'manifest', ok: true },
          { name: 'home-page', ok: true },
        ],
        acknowledged_at: '2026-07-20T00:00:04.000Z',
      });
    };
    await new HandoffEmitterStage(fakeFetch, join(outputRoot, 'handoff.yaml'), join(outputRoot, 'ack.json')).run(ctx);
    const acknowledgement = await ctx.evidenceStore.readRegistrationAck();
    assert.equal(acknowledgement?.verified_commit_sha, publication.commitSha);
    assert.equal((await ctx.evidenceStore.readIndex()).chain_status, 'handed_off');
  } finally {
    delete process.env.SEO_BOT_URL;
    delete process.env.SEO_BOT_API_KEY;
    cleanupContext(ctx);
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

void test('rejects an acknowledgement for a different commit', async () => {
  const ctx = fixtureContext();
  const outputRoot = mkdtempSync(join(tmpdir(), 'handoff-output-'));
  try {
    await prepareSucceededRelease(ctx);
    ctx.autoRegisterSeoBot = true;
    process.env.SEO_BOT_URL = 'https://seo-bot.example.com';
    process.env.SEO_BOT_API_KEY = 'shared-test-key';
    const fakeFetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const contract = JSON.parse(String(init?.body)) as any;
      return Response.json({
        schema: 'seo-bot.website-factory-registration-ack/v1', registered: true, maintenance_ready: true,
        client_id: contract.client.id, contract_id: contract.contract_id, contract_digest: contract.integrity.payload_digest,
        release_receipt_id: contract.proof.receipt_id, verified_repository: contract.site.repository.full_name,
        verified_branch: contract.site.repository.branch, verified_commit_sha: 'f'.repeat(40),
        probes: [{name:'a',ok:true},{name:'b',ok:true},{name:'c',ok:true},{name:'d',ok:true}],
        acknowledged_at: '2026-07-20T00:00:04.000Z',
      });
    };
    await assert.rejects(
      () => new HandoffEmitterStage(fakeFetch, join(outputRoot, 'handoff.yaml'), join(outputRoot, 'ack.json')).run(ctx),
      /different commit/,
    );
    assert.equal(await ctx.evidenceStore.readRegistrationAck(), undefined);
  } finally {
    delete process.env.SEO_BOT_URL;
    delete process.env.SEO_BOT_API_KEY;
    cleanupContext(ctx);
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
