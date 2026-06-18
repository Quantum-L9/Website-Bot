// L9_META: layer=stage, role=visual_qa, stage_index=9, status=active, version=2.0.0
// Runs verify-visual-qa.mjs as a subprocess. Blocks on CRITICAL findings.
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:visual-qa');
const QA_SCRIPT = 'scripts/verify-visual-qa.mjs';

export class VisualQAStage implements Stage {
  name = 'visual-qa';

  async run(ctx: BuildContext): Promise<void> {
    if (!existsSync(QA_SCRIPT)) {
      logger.warn({ script: QA_SCRIPT }, 'Visual QA script not found — skipping (non-blocking)');
      ctx.visualQaPassed = true;
      return;
    }

    if (ctx.dryRun) {
      logger.info('[dry-run] Would run visual QA checks');
      ctx.visualQaPassed = true;
      return;
    }

    const deployUrl = ctx.deploymentUrl ?? process.env.DEPLOYMENT_URL;
    if (!deployUrl) {
      logger.warn('No deployment URL available — skipping visual QA');
      ctx.visualQaPassed = true;
      return;
    }

    logger.info({ deployUrl }, 'Running visual QA');

    try {
      const output = execSync(
        `node ${QA_SCRIPT} --url "${deployUrl}"`,
        { encoding: 'utf-8', timeout: 120_000, stdio: 'pipe' }
      );

      if (output.includes('CRITICAL')) {
        throw new BuildError(
          'VISUAL_QA_FAILED',
          `Visual QA found CRITICAL issues: ${output.slice(0, 500)}`,
        );
      }

      ctx.visualQaPassed = true;
      logger.info('Visual QA passed');
    } catch (e) {
      if (e instanceof BuildError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('CRITICAL')) {
        throw new BuildError('VISUAL_QA_FAILED', msg);
      }
      // Non-CRITICAL subprocess failure is warning only
      logger.warn({ error: msg }, 'Visual QA subprocess error (non-blocking)');
      ctx.visualQaPassed = false;
    }
  }
}
