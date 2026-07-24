// L9_META: layer=stage, role=vercel_deploy, stage_index=10, status=active, version=3.0.0
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { DeploymentEvidence } from '../pipeline/evidence/DeploymentEvidence.js';
import type { Stage, StageRunResult } from '../pipeline/PipelineRunner.js';
import { sha256Text } from '../pipeline/evidence/EvidenceCanonicalizer.js';

const logger = createModuleLogger('stage:vercel-deploy');
const VERCEL_API = 'https://api.vercel.com';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface VercelDeploymentResponse {
  id?: string;
  uid?: string;
  url?: string;
  readyState?: string;
  state?: string;
  alias?: string[];
  aliases?: string[];
  createdAt?: number | string;
  ready?: number | string;
  projectId?: string;
  meta?: Record<string, unknown>;
  gitSource?: { sha?: string; ref?: string; repoId?: string | number };
}

interface VercelDeploymentList {
  deployments?: VercelDeploymentResponse[];
}

export class VercelDeployStage implements Stage {
  name = 'vercel-deploy';
  version = '4.0.0';
  evidence = { inputs: (_ctx: BuildContext) => ['publication' as const], outputs: (_ctx: BuildContext) => ['deployment' as const], resumable: true, externalMutation: true };

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds)),
    private readonly now: () => Date = () => new Date(),
    private readonly pollIntervalMs = Number(process.env.VERCEL_POLL_INTERVAL_MS ?? 10_000),
    private readonly maxPolls = Number(process.env.VERCEL_MAX_POLLS ?? 60),
  ) {}

  async run(ctx: BuildContext): Promise<void | StageRunResult> {
    const target = ctx.deployTarget;
    if (!target) throw new BuildError('VERCEL_DEPLOY_FAILED', 'Per-client deploy target is missing');
    if (ctx.dryRun) {
      logger.info({ projectId: target.vercelProjectId, branch: target.sourceBranch }, '[dry-run] Would deploy published client commit to Vercel');
      return;
    }
    const storedPublication = await ctx.evidenceStore.readPublication();
    if (!storedPublication) throw new BuildError('RELEASE_EVIDENCE_INCOMPLETE', 'Persisted publication evidence is required before Vercel deployment');
    const publication = storedPublication.value;
    ctx.publicationEvidence = publication;
    ctx.sourceCommitSha = publication.commitSha;

    const deploymentTarget = this.resolveTarget();
    const token = process.env.VERCEL_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    let triggerMode: 'api' | 'deploy_hook';
    let deployment: VercelDeploymentResponse;

    if (target.vercelDeployHook) {
      triggerMode = 'deploy_hook';
      deployment = await this.triggerHookAndCorrelate(
        target.vercelDeployHook,
        ctx.sourceCommitSha,
        target.vercelProjectId,
        token,
        teamId,
      );
    } else {
      triggerMode = 'api';
      if (!token || !target.vercelProjectId || !target.githubRepoId) {
        throw new BuildError('VERCEL_DEPLOY_FAILED', 'VERCEL_TOKEN, deploy.vercel_project_id, and deploy.github_repo_id are required for API deployment');
      }
      deployment = await this.createApiDeployment(ctx, token, teamId, deploymentTarget);
    }

    const deploymentId = this.deploymentId(deployment);
    const finalState = await this.pollDeployment(deploymentId, token, teamId, target.vercelProjectId);
    const state = finalState.readyState ?? finalState.state;
    if (state !== 'READY') throw new BuildError('VERCEL_DEPLOY_FAILED', `Deployment ${deploymentId} did not reach READY`);
    const observedCommitSha = this.extractCommitSha(finalState);
    if (!observedCommitSha) {
      throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'Vercel deployment did not report the deployed Git commit');
    }
    if (observedCommitSha !== ctx.sourceCommitSha) {
      throw new BuildError('DEPLOYMENT_COMMIT_MISMATCH', 'Vercel deployed a different commit than Website-Bot published', false, {
        requestedCommitSha: ctx.sourceCommitSha,
        observedCommitSha,
      });
    }
    if (finalState.projectId && target.vercelProjectId && finalState.projectId !== target.vercelProjectId) {
      throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'Vercel deployment project does not match configured project', false, {
        configuredProjectId: target.vercelProjectId,
        observedProjectId: finalState.projectId,
      });
    }

    const aliases = [...new Set([...(finalState.alias ?? []), ...(finalState.aliases ?? [])].map(value => this.normalizeUrl(value)))];
    const deploymentUrl = aliases[0] ?? this.normalizeUrl(finalState.url ?? '');
    if (!deploymentUrl) throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'Vercel deployment did not report a URL');
    const projectId = target.vercelProjectId ?? finalState.projectId;
    if (!projectId) throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'Vercel deployment did not report a project ID');
    const evidence: DeploymentEvidence = {
      schema: 'website-bot.deployment-evidence/v2',
      deploymentEvidenceId: `dpl_${sha256Text(`${ctx.buildId}\0${deploymentId}\0${ctx.sourceCommitSha}`).slice(0, 32)}`,
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      publicationId: publication.publicationId,
      publicationSha256: storedPublication.record.sha256,
      provider: 'vercel',
      projectId,
      deploymentId,
      requestedCommitSha: ctx.sourceCommitSha,
      observedCommitSha,
      state: 'READY',
      deploymentUrl,
      aliases,
      sourceRepository: publication.repository,
      sourceBranch: publication.branch,
      createdAt: this.timestamp(finalState.createdAt),
      readyAt: this.timestamp(finalState.ready) ?? this.now().toISOString(),
      triggerMode,
      target: deploymentTarget,
      status: 'passed',
    };
    const evidencePath = resolve(ctx.outputDir, '.l9/deployment-evidence.json');
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf-8');
    await ctx.evidenceStore.writeDeployment(evidence);
    ctx.deploymentEvidence = evidence;
    ctx.deploymentUrl = evidence.deploymentUrl;
    logger.info({ deploymentId, projectId: target.vercelProjectId, deploymentUrl, commitSha: ctx.sourceCommitSha, target: deploymentTarget }, 'Vercel deployment READY');
    return { externalId: deploymentId };
  }

  async canResume(ctx: BuildContext): Promise<boolean> {
    const stored = await ctx.evidenceStore.readDeployment();
    const token = process.env.VERCEL_TOKEN;
    if (!stored || !token) return false;
    try {
      const status = await this.requestJson<VercelDeploymentResponse>(`${VERCEL_API}/v13/deployments/${encodeURIComponent(stored.value.deploymentId)}${this.teamQuery(process.env.VERCEL_TEAM_ID)}`, { headers: { Authorization: `Bearer ${token}` } }, 'Vercel resume verification failed');
      return (status.readyState ?? status.state) === 'READY' && this.extractCommitSha(status) === stored.value.observedCommitSha;
    } catch { return false; }
  }

  private resolveTarget(): 'preview' | 'production' {
    const value = process.env.VERCEL_TARGET ?? 'preview';
    if (value !== 'preview' && value !== 'production') throw new BuildError('VERCEL_DEPLOY_FAILED', `VERCEL_TARGET must be preview or production, received ${value}`);
    if (value === 'production' && process.env.WEBSITE_BOT_ALLOW_PRODUCTION !== 'true') {
      throw new BuildError('VERCEL_DEPLOY_FAILED', 'Production deployment requires WEBSITE_BOT_ALLOW_PRODUCTION=true');
    }
    return value;
  }

  private async createApiDeployment(
    ctx: BuildContext,
    token: string,
    teamId: string | undefined,
    target: 'preview' | 'production',
  ): Promise<VercelDeploymentResponse> {
    const deployTarget = ctx.deployTarget;
    if (!deployTarget?.vercelProjectId || !deployTarget.githubRepoId || !ctx.sourceCommitSha) {
      throw new BuildError('VERCEL_DEPLOY_FAILED', 'API deployment target is incomplete');
    }
    const query = this.teamQuery(teamId);
    const body: Record<string, unknown> = {
      name: deployTarget.vercelProjectId,
      project: deployTarget.vercelProjectId,
      gitSource: {
        type: 'github',
        repoId: deployTarget.githubRepoId,
        ref: deployTarget.sourceBranch,
        sha: ctx.sourceCommitSha,
      },
      meta: {
        websiteBotBuildId: ctx.buildId,
        websiteBotSourceDigest: ctx.buildProof?.sourceDigest,
        githubCommitSha: ctx.sourceCommitSha,
      },
    };
    if (target === 'production') body.target = 'production';
    return await this.requestJson<VercelDeploymentResponse>(
      `${VERCEL_API}/v13/deployments${query}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'Vercel deployment creation failed',
    );
  }

  private async triggerHookAndCorrelate(
    hook: string,
    commitSha: string,
    projectId: string | undefined,
    token: string | undefined,
    teamId: string | undefined,
  ): Promise<VercelDeploymentResponse> {
    let parsed: URL;
    try { parsed = new URL(hook); }
    catch { throw new BuildError('VERCEL_DEPLOY_FAILED', 'Vercel deploy hook is not a valid URL'); }
    if (parsed.protocol !== 'https:') throw new BuildError('VERCEL_DEPLOY_FAILED', 'Vercel deploy hook must use HTTPS');
    const response = await this.fetchImpl(parsed, { method: 'POST' });
    if (!response.ok) throw new BuildError('VERCEL_DEPLOY_FAILED', `Vercel deploy hook failed: ${response.status}`);
    const payload = await response.json() as { job?: { id?: unknown; state?: unknown } };
    const jobId = typeof payload.job?.id === 'string' ? payload.job.id : undefined;
    if (!jobId) throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'Vercel deploy hook response did not include a job ID');
    if (!token || !projectId) {
      throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'Deploy hook acceptance is not release proof; VERCEL_TOKEN and project ID are required to correlate the resulting deployment', false, { jobId });
    }

    for (let attempt = 1; attempt <= this.maxPolls; attempt++) {
      const list = await this.requestJson<VercelDeploymentList>(
        `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=20${this.teamQuery(teamId, true)}`,
        { headers: { Authorization: `Bearer ${token}` } },
        'Vercel deployment correlation query failed',
      );
      const match = (list.deployments ?? []).find(candidate => this.extractCommitSha(candidate) === commitSha);
      if (match) return match;
      await this.sleep(this.pollIntervalMs);
    }
    throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'Deploy hook was accepted but no deployment matching the published commit was observed', false, { jobId, commitSha });
  }

  private async pollDeployment(
    deploymentId: string,
    token: string | undefined,
    teamId: string | undefined,
    projectId: string | undefined,
  ): Promise<VercelDeploymentResponse> {
    if (!token) throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'VERCEL_TOKEN is required to observe terminal deployment state');
    for (let attempt = 1; attempt <= this.maxPolls; attempt++) {
      const status = await this.requestJson<VercelDeploymentResponse>(
        `${VERCEL_API}/v13/deployments/${encodeURIComponent(deploymentId)}${this.teamQuery(teamId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
        'Vercel deployment poll failed',
      );
      const state = status.readyState ?? status.state;
      if (state === 'READY') return status;
      if (state === 'ERROR' || state === 'CANCELED') {
        throw new BuildError('VERCEL_DEPLOY_FAILED', `Deployment ${deploymentId} entered ${state}`, false, { projectId });
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new BuildError('VERCEL_POLL_TIMEOUT', `Deployment ${deploymentId} did not become READY after ${this.maxPolls} polls`);
  }

  private extractCommitSha(value: VercelDeploymentResponse): string | undefined {
    const candidates = [
      value.gitSource?.sha,
      value.meta?.githubCommitSha,
      value.meta?.githubCommitRef,
      value.meta?.gitCommitSha,
    ];
    return candidates.find(candidate => typeof candidate === 'string' && /^[0-9a-f]{40}$/i.test(candidate as string)) as string | undefined;
  }

  private deploymentId(value: VercelDeploymentResponse): string {
    const id = value.id ?? value.uid;
    if (!id || typeof id !== 'string') throw new BuildError('DEPLOYMENT_CORRELATION_FAILED', 'Vercel response did not include a deployment ID');
    return id;
  }

  private normalizeUrl(value: string): string {
    const candidate = value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
    let parsed: URL;
    try { parsed = new URL(candidate); }
    catch { throw new BuildError('VERCEL_DEPLOY_FAILED', `Vercel returned a malformed deployment URL`); }
    if (parsed.protocol !== 'https:') throw new BuildError('VERCEL_DEPLOY_FAILED', 'Vercel deployment URL must use HTTPS');
    return parsed.toString().replace(/\/$/, '');
  }

  private timestamp(value: number | string | undefined): string | undefined {
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
    return undefined;
  }

  private teamQuery(teamId: string | undefined, append = false): string {
    if (!teamId) return '';
    return `${append ? '&' : '?'}teamId=${encodeURIComponent(teamId)}`;
  }

  private async requestJson<T>(url: string, init: RequestInit, message: string): Promise<T> {
    let status = 0;
    let body = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await this.fetchImpl(url, init);
      status = response.status;
      if (response.ok) return await response.json() as T;
      body = await response.text();
      if (!(response.status === 429 || response.status >= 500) || attempt === 3) break;
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      await this.sleep(retryAfter > 0 ? retryAfter * 1_000 : attempt * 500);
    }
    throw new BuildError('VERCEL_DEPLOY_FAILED', `${message}: ${status} ${body.slice(0, 1_000)}`);
  }
}
