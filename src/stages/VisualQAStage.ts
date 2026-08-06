// L9_META: layer=stage, role=visual_qa, stage_index=13, status=active, version=3.0.0
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:visual-qa');
const QA_SCRIPT = 'scripts/verify-visual-qa.mjs';
const QA_TIMEOUT_MS = 120_000;

/** Injectable seam over `execFileSync` for the QA verifier subprocess (deterministic unit tests). */
export type VisualQaExec = (
  command: string,
  args: string[],
  options: { encoding: 'utf-8'; timeout: number; stdio: 'pipe' },
) => string;

export class VisualQAStage implements Stage {
  name = 'visual-qa';
  version = '3.1.0';
  evidence = { inputs: (_ctx: BuildContext) => ['deployment' as const], outputs: (_ctx: BuildContext) => [], resumable: false, externalMutation: true };

  constructor(
    private readonly exec: VisualQaExec = (command, args, options) => execFileSync(command, args, options),
    private readonly scriptPath: string = QA_SCRIPT,
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    ctx.visualQaPassed = false;
    if (!existsSync(this.scriptPath)) {
      ctx.qualityEvidence.visualQa = 'skipped';
      logger.warn({ script: this.scriptPath }, 'Visual QA script not found; gate marked skipped');
      return;
    }
    if (ctx.dryRun) {
      ctx.qualityEvidence.visualQa = 'skipped';
      logger.info('[dry-run] Would run visual QA checks');
      return;
    }
    const deployment = await ctx.evidenceStore.requireDeploymentEvidence();
    const deployUrl = deployment.value.deploymentUrl;
    if (!deployUrl) {
      ctx.qualityEvidence.visualQa = 'skipped';
      logger.warn('No deployment URL available; visual QA gate marked skipped');
      return;
    }

    try {
      const output = this.exec(process.execPath, [this.scriptPath, '--url', deployUrl], {
        encoding: 'utf-8',
        timeout: QA_TIMEOUT_MS,
        stdio: 'pipe',
      });
      if (output.includes('CRITICAL')) throw new BuildError('VISUAL_QA_FAILED', `Visual QA found CRITICAL issues: ${output.slice(0, 500)}`);
      ctx.visualQaPassed = true;
      ctx.qualityEvidence.visualQa = 'passed';
      logger.info({ deployUrl }, 'Visual QA passed');
    } catch (error) {
      ctx.qualityEvidence.visualQa = 'failed';
      if (error instanceof BuildError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('CRITICAL')) throw new BuildError('VISUAL_QA_FAILED', message);
      logger.warn({ error: message }, 'Visual QA execution failed; gate marked failed');
    }
  }
}
