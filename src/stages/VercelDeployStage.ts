// L9_META: layer=stage, role=vercel_deploy, stage_index=7, status=active, version=2.0.0
// Deploys to Vercel via API. Polls until ready (max 10 min). Sets ctx.deploymentUrl.
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:vercel-deploy');
const VERCEL_API = 'https://api.vercel.com';
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 60; // 10 minutes

interface VercelDeploymentResponse {
  id: string;
  url: string;
  readyState: string;
  alias?: string[];
}

export class VercelDeployStage implements Stage {
  name = 'vercel-deploy';

  async run(ctx: BuildContext): Promise<void> {
    const token = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    const teamId = process.env.VERCEL_TEAM_ID;

    if (!token || !projectId) {
      if (ctx.dryRun) {
        logger.info('[dry-run] Would deploy to Vercel (VERCEL_TOKEN/PROJECT_ID not set — dry-run skip)');
        return;
      }
      throw new BuildError('VERCEL_DEPLOY_FAILED', 'VERCEL_TOKEN and VERCEL_PROJECT_ID must be set');
    }

    if (ctx.dryRun) {
      logger.info('[dry-run] Would trigger Vercel deployment');
      ctx.deploymentUrl = 'https://dry-run.example.com';
      return;
    }

    logger.info({ projectId }, 'Triggering Vercel deployment');

    const teamQuery = teamId ? `?teamId=${teamId}` : '';
    const createRes = await fetch(`${VERCEL_API}/v13/deployments${teamQuery}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectId,
        project: projectId,
        target: 'production',
        gitSource: {
          type: 'github',
          repoId: process.env.GITHUB_REPO_ID ?? '',
          ref: process.env.GITHUB_REF ?? 'main',
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new BuildError('VERCEL_DEPLOY_FAILED', `Vercel create deployment ${createRes.status}: ${err}`);
    }

    const deployment = (await createRes.json()) as VercelDeploymentResponse;
    logger.info({ deploymentId: deployment.id, url: deployment.url }, 'Deployment created — polling');

    // Poll until ready
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const statusRes = await fetch(`${VERCEL_API}/v13/deployments/${deployment.id}${teamQuery}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!statusRes.ok) {
        logger.warn({ status: statusRes.status, poll: i + 1 }, 'Vercel poll returned non-ok — retrying');
        continue;
      }
      const status = (await statusRes.json()) as VercelDeploymentResponse;

      logger.debug({ readyState: status.readyState, poll: i + 1 }, 'Polling deployment status');

      if (status.readyState === 'READY') {
        ctx.deploymentUrl = `https://${status.alias?.[0] ?? status.url}`;
        logger.info({ deploymentUrl: ctx.deploymentUrl }, 'Deployment READY');
        return;
      }
      if (status.readyState === 'ERROR' || status.readyState === 'CANCELED') {
        throw new BuildError('VERCEL_DEPLOY_FAILED', `Deployment ${deployment.id} entered state: ${status.readyState}`);
      }
    }

    throw new BuildError('VERCEL_POLL_TIMEOUT', `Deployment ${deployment.id} did not become READY within ${MAX_POLLS * POLL_INTERVAL_MS / 60000} minutes`);
  }
}
