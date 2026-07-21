// L9_META: layer=stage, role=client_source_publisher, stage_index=9, status=active, version=2.0.0
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import { writeStageCheckpoint } from '../pipeline/StageCheckpoint.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { PublicationEvidence } from '../pipeline/evidence/PublicationEvidence.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { recordToReference } from '../pipeline/evidence/EvidenceReference.js';
import {
  canonicalJson,
  collectRegularFiles,
  digestDirectory,
  gitBlobSha,
  isPublicationExcluded,
  isSourceDigestExcluded,
  normalizeRelativePath,
  sha256Text,
} from '../services/hashing.js';
import { normalizeManagedPath } from '../validation/validate-generated-site.js';
import { resolveEnvRef } from '../provisioning/secret-ref.js';

const logger = createModuleLogger('stage:client-source-publish');
const API = 'https://api.github.com';
const MANIFEST_PATH = '.l9/generated-manifest.json';
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Headers = Record<string, string>;
type TreeEntry = { path: string; mode: '100644'; type: 'blob'; sha: string | null };

interface GeneratedManifest {
  schema: 'website-bot.generated-manifest/v1';
  clientId: string;
  sourceDigest: string;
  paths: string[];
}

interface GitTreeItem {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
}

interface GitTreeResponse {
  sha: string;
  truncated?: boolean;
  tree?: GitTreeItem[];
}

export class ClientSourcePublishStage implements Stage {
  name = 'client-source-publish';
  version = '3.0.0';
  evidence = { inputs: (_ctx: BuildContext) => ['build' as const], outputs: (_ctx: BuildContext) => ['publication' as const], resumable: true, externalMutation: true };

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds)),
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    if (!ctx.deployTarget) throw new BuildError('SOURCE_PUBLISH_FAILED', 'Per-client deploy target is missing');
    if (ctx.dryRun) {
      logger.info({ repository: ctx.deployTarget.githubRepo, branch: ctx.deployTarget.sourceBranch }, '[dry-run] Would publish locally proven generated source');
      return;
    }
    const storedBuild = await ctx.evidenceStore.readBuild();
    if (!storedBuild || storedBuild.value.status !== 'passed') throw new BuildError('SOURCE_PUBLISH_NO_PROOF', 'Persisted local build proof is required before source publication');
    ctx.buildProof = storedBuild.value;
    const currentSource = digestDirectory(ctx.outputDir, { exclude: isSourceDigestExcluded });
    if (currentSource.digest !== ctx.buildProof.sourceDigest) {
      throw new BuildError('BUILD_PROOF_STALE', 'Generated source changed after local proof; rebuild before publication', false, {
        proven: ctx.buildProof.sourceDigest,
        current: currentSource.digest,
      });
    }

    const publishCredentialRef = ctx.deployTarget.publishCredentialRef ?? 'env://GITHUB_SITE_TOKEN';
    let token: string;
    try {
      token = resolveEnvRef(publishCredentialRef, 'deploy.publish_credential_ref');
    } catch (error) {
      throw new BuildError('SOURCE_PUBLISH_FAILED', error instanceof Error ? error.message : String(error));
    }
    const headers: Headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
    const { githubRepo, sourceBranch } = ctx.deployTarget;
    this.validateTarget(githubRepo, sourceBranch);

    const filesBeforeManifest = collectRegularFiles(ctx.outputDir, {
      exclude: isPublicationExcluded,
      maxFiles: MAX_FILES,
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    });
    const paths = filesBeforeManifest
      .map(path => normalizeManagedPath(normalizeRelativePath(relative(ctx.outputDir, path))))
      .filter(path => path !== MANIFEST_PATH)
      .sort();
    paths.push(MANIFEST_PATH);
    paths.sort();
    const generatedManifest: GeneratedManifest = {
      schema: 'website-bot.generated-manifest/v1',
      clientId: ctx.clientId,
      sourceDigest: currentSource.digest,
      paths,
    };
    const manifestText = `${JSON.stringify(generatedManifest, null, 2)}\n`;
    const manifestPath = resolve(ctx.outputDir, MANIFEST_PATH);
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, manifestText, 'utf-8');
    const managedManifestDigest = sha256Text(canonicalJson(generatedManifest));

    const refUrl = `${API}/repos/${githubRepo}/git/ref/heads/${encodeURIComponent(sourceBranch)}`;
    const ref = await this.requestJson<{ object?: { sha?: string } }>(refUrl, { headers }, 'Cannot read target branch');
    const previousHeadSha = this.requireSha(ref.object?.sha, 'GitHub branch head');
    const parent = await this.requestJson<{ tree?: { sha?: string } }>(
      `${API}/repos/${githubRepo}/git/commits/${previousHeadSha}`,
      { headers },
      'Cannot read target branch commit',
    );
    const baseTreeSha = this.requireSha(parent.tree?.sha, 'GitHub base tree');
    const remoteTree = await this.requestJson<GitTreeResponse>(
      `${API}/repos/${githubRepo}/git/trees/${baseTreeSha}?recursive=1`,
      { headers },
      'Cannot read target repository tree',
    );
    if (remoteTree.truncated) throw new BuildError('SOURCE_PUBLISH_FAILED', 'GitHub returned a truncated repository tree; publication cannot safely diff');
    const remoteBlobs = new Map(
      (remoteTree.tree ?? [])
        .filter(item => item.type === 'blob' && typeof item.path === 'string' && typeof item.sha === 'string')
        .map(item => [normalizeManagedPath(item.path as string), item.sha as string]),
    );
    const previousManifest = await this.readPreviousManifest(githubRepo, sourceBranch, headers);
    if (previousManifest.clientId && previousManifest.clientId !== ctx.clientId) {
      throw new BuildError(
        'SOURCE_PUBLISH_FAILED',
        `Target repository is already owned by generated client ${previousManifest.clientId}; refusing cross-client overwrite for ${ctx.clientId}`,
      );
    }

    const allFiles = collectRegularFiles(ctx.outputDir, {
      exclude: isPublicationExcluded,
      maxFiles: MAX_FILES,
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    });
    const localFiles = new Map<string, Buffer>();
    for (const absolutePath of allFiles) {
      localFiles.set(normalizeManagedPath(normalizeRelativePath(relative(ctx.outputDir, absolutePath))), readFileSync(absolutePath));
    }
    if (!localFiles.has(MANIFEST_PATH)) localFiles.set(MANIFEST_PATH, Buffer.from(manifestText, 'utf-8'));

    const changedPaths = [...localFiles.entries()]
      .filter(([path, content]) => remoteBlobs.get(path) !== gitBlobSha(content))
      .map(([path]) => path)
      .sort();
    const currentPathSet = new Set(localFiles.keys());
    const deletedPaths = [...new Set(previousManifest.paths)]
      .filter(path => !currentPathSet.has(path) && remoteBlobs.has(path))
      .sort();

    if (changedPaths.length === 0 && deletedPaths.length === 0) {
      const evidence: PublicationEvidence = {
        schema: 'website-bot.publication-evidence/v1',
        publicationId: `pub_${sha256Text(`${ctx.buildId}\0${previousHeadSha}\0${currentSource.digest}`).slice(0, 32)}`,
        buildId: ctx.buildId, clientId: ctx.clientId, buildProofId: storedBuild.value.proofId, buildProofSha256: storedBuild.record.sha256,
        repository: githubRepo, repositoryId: ctx.deployTarget.githubRepoId,
        branch: sourceBranch,
        previousHeadSha,
        commitSha: previousHeadSha,
        treeSha: baseTreeSha,
        verifiedBranchHeadSha: previousHeadSha,
        sourceDigest: currentSource.digest,
        managedManifestDigest,
        changedPaths: [],
        deletedPaths: [],
        noOp: true,
        publishedAt: this.now().toISOString(), status: 'passed',
      };
      await this.recordEvidence(ctx, evidence, storedBuild.record.sha256);
      logger.info({ repository: githubRepo, branch: sourceBranch, commitSha: previousHeadSha }, 'Generated source already matches target; no commit created');
      return;
    }

    const entries: TreeEntry[] = [];
    for (const path of changedPaths) {
      const content = localFiles.get(path);
      if (!content) throw new BuildError('SOURCE_PUBLISH_FAILED', `Changed path is missing local content: ${path}`);
      const blob = await this.requestJson<{ sha?: string }>(
        `${API}/repos/${githubRepo}/git/blobs`,
        { method: 'POST', headers, body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }) },
        `Blob upload failed for ${path}`,
      );
      entries.push({ path, mode: '100644', type: 'blob', sha: this.requireSha(blob.sha, `blob ${path}`) });
    }
    for (const path of deletedPaths) entries.push({ path, mode: '100644', type: 'blob', sha: null });

    const tree = await this.requestJson<{ sha?: string }>(
      `${API}/repos/${githubRepo}/git/trees`,
      { method: 'POST', headers, body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }) },
      'Git tree creation failed',
    );
    const treeSha = this.requireSha(tree.sha, 'new Git tree');
    const message = `chore(site): publish generated site for ${ctx.clientId}\n\nBuild-ID: ${ctx.buildId}\nSource-Digest: ${currentSource.digest}\nGenerator: Website-Bot`;
    const commit = await this.requestJson<{ sha?: string }>(
      `${API}/repos/${githubRepo}/git/commits`,
      { method: 'POST', headers, body: JSON.stringify({ message, tree: treeSha, parents: [previousHeadSha] }) },
      'Git commit creation failed',
    );
    const commitSha = this.requireSha(commit.sha, 'new Git commit');

    const latestRef = await this.requestJson<{ object?: { sha?: string } }>(refUrl, { headers }, 'Cannot re-read target branch');
    const latestHeadSha = this.requireSha(latestRef.object?.sha, 'latest GitHub branch head');
    if (latestHeadSha !== previousHeadSha) {
      throw new BuildError('SOURCE_PUBLISH_CONFLICT', 'Target branch changed during publication; refusing non-fast-forward update', false, {
        expectedHeadSha: previousHeadSha,
        actualHeadSha: latestHeadSha,
      });
    }
    await this.requestJson<unknown>(
      `${API}/repos/${githubRepo}/git/refs/heads/${encodeURIComponent(sourceBranch)}`,
      { method: 'PATCH', headers, body: JSON.stringify({ sha: commitSha, force: false }) },
      'Branch update failed',
    );

    const evidence: PublicationEvidence = {
      schema: 'website-bot.publication-evidence/v1',
      publicationId: `pub_${sha256Text(`${ctx.buildId}\0${commitSha}\0${currentSource.digest}`).slice(0, 32)}`,
      buildId: ctx.buildId, clientId: ctx.clientId, buildProofId: storedBuild.value.proofId, buildProofSha256: storedBuild.record.sha256,
      repository: githubRepo, repositoryId: ctx.deployTarget.githubRepoId,
      branch: sourceBranch,
      previousHeadSha,
      commitSha,
      treeSha,
      verifiedBranchHeadSha: commitSha,
      sourceDigest: currentSource.digest,
      managedManifestDigest,
      changedPaths,
      deletedPaths,
      noOp: false,
      publishedAt: this.now().toISOString(), status: 'passed',
    };
    await this.recordEvidence(ctx, evidence, storedBuild.record.sha256);
    logger.info({ repository: githubRepo, branch: sourceBranch, commitSha, changed: changedPaths.length, deleted: deletedPaths.length }, 'Generated source published');
  }

  private validateTarget(repository: string, branch: string): void {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new BuildError('SOURCE_PUBLISH_FAILED', `Invalid GitHub repository: ${repository}`);
    if (!/^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,255}$/.test(branch)) throw new BuildError('SOURCE_PUBLISH_FAILED', `Invalid GitHub branch: ${branch}`);
  }

  async canResume(ctx: BuildContext): Promise<boolean> {
    const stored = await ctx.evidenceStore.readPublication();
    if (!stored || !ctx.deployTarget) return false;
    let token: string;
    try { token = resolveEnvRef(ctx.deployTarget.publishCredentialRef ?? 'env://GITHUB_SITE_TOKEN', 'deploy.publish_credential_ref'); } catch { return false; }
    const response = await this.fetchImpl(`${API}/repos/${stored.value.repository}/git/ref/heads/${encodeURIComponent(stored.value.branch)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) return false;
    const payload = await response.json() as { object?: { sha?: string } };
    return payload.object?.sha === stored.value.commitSha;
  }

  private async recordEvidence(ctx: BuildContext, evidence: PublicationEvidence, inputDigest: string): Promise<void> {
    const path = resolve(ctx.outputDir, '.l9/publication-evidence.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(evidence, null, 2)}
`, 'utf-8');
    const publicationRecord = await ctx.evidenceStore.writePublication(evidence);
    const buildRecord = (await ctx.evidenceStore.readBuild())!.record;
    ctx.publicationEvidence = evidence;
    ctx.sourceCommitSha = evidence.commitSha;
    await writeStageCheckpoint(ctx, { stage: this.name, inputEvidence: [recordToReference(buildRecord)], outputEvidence: [recordToReference(publicationRecord)], inputDigest, outputDigest: publicationRecord.sha256, externalId: evidence.commitSha, status: 'passed', attempt: 1, startedAt: evidence.publishedAt, completedAt: new Date().toISOString() });
  }

  private async readPreviousManifest(repository: string, branch: string, headers: Headers): Promise<GeneratedManifest> {
    const response = await this.fetchImpl(`${API}/repos/${repository}/contents/${MANIFEST_PATH}?ref=${encodeURIComponent(branch)}`, { headers });
    if (response.status === 404) return { schema: 'website-bot.generated-manifest/v1', clientId: '', sourceDigest: '', paths: [] };
    if (!response.ok) throw new BuildError('SOURCE_PUBLISH_FAILED', `Cannot read previous generated manifest: ${response.status} ${await response.text()}`);
    const payload = await response.json() as { content?: unknown; encoding?: unknown };
    if (payload.encoding !== 'base64' || typeof payload.content !== 'string') throw new BuildError('SOURCE_PUBLISH_FAILED', 'Previous generated manifest has unsupported encoding');
    try {
      const parsed = JSON.parse(Buffer.from(payload.content.replaceAll('\n', ''), 'base64').toString('utf-8')) as Partial<GeneratedManifest>;
      if (parsed.schema !== 'website-bot.generated-manifest/v1' || !Array.isArray(parsed.paths) || !parsed.paths.every(path => typeof path === 'string')) {
        throw new Error('invalid generated manifest shape');
      }
      return {
        schema: parsed.schema,
        clientId: typeof parsed.clientId === 'string' ? parsed.clientId : '',
        sourceDigest: typeof parsed.sourceDigest === 'string' ? parsed.sourceDigest : '',
        paths: parsed.paths.map(normalizeManagedPath),
      };
    } catch (error) {
      throw new BuildError('SOURCE_PUBLISH_FAILED', `Previous generated manifest is invalid: ${String(error)}`);
    }
  }

  private requireSha(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) throw new BuildError('SOURCE_PUBLISH_FAILED', `${label} did not return a full commit/blob SHA`);
    return value;
  }

  private async requestJson<T>(url: string, init: RequestInit, message: string): Promise<T> {
    let lastStatus = 0;
    let lastBody = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await this.fetchImpl(url, init);
      lastStatus = response.status;
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
      }
      lastBody = await response.text();
      if (!(response.status === 429 || response.status >= 500) || attempt === 3) break;
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      await this.sleep(retryAfter > 0 ? retryAfter * 1_000 : attempt * 500);
    }
    throw new BuildError('SOURCE_PUBLISH_FAILED', `${message}: ${lastStatus} ${lastBody.slice(0, 1_000)}`);
  }
}
