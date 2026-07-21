// L9_META: layer=stage, role=release_receipt_finalizer, stage_index=15, status=active, version=1.1.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import type { ReleaseReceipt } from '../pipeline/evidence/ReleaseReceipt.js';

const logger = createModuleLogger('stage:release-receipt-finalizer');

export class ReleaseReceiptFinalizerStage implements Stage {
  name = 'release-receipt-finalizer';
  version = '1.1.0';
  evidence = {
    inputs: (_ctx: BuildContext) => [
      'assembly' as const,
      'build' as const,
      'publication' as const,
      'deployment' as const,
      'release' as const,
    ],
    outputs: (_ctx: BuildContext) => ['release' as const],
    resumable: true,
    externalMutation: false,
  };

  async run(ctx: BuildContext): Promise<void> {
    const bundle = await ctx.evidenceStore.loadValidatedReleaseBundle({ requireMode: 'end-to-end' });
    const receipt = bundle.releaseReceipt;
    if (ctx.qualityEvidence.visualQa !== 'passed') {
      throw new BuildError('RELEASE_EVIDENCE_INCOMPLETE', `Release cannot finalize because visual QA is ${ctx.qualityEvidence.visualQa}`);
    }
    if (!receipt.correlation.all_required_identities_match) {
      throw new BuildError('EVIDENCE_IDENTITY_MISMATCH', 'Release cannot finalize because evidence identities do not match');
    }

    const finalized: ReleaseReceipt = {
      ...receipt,
      status: 'succeeded',
      missing_gates: [],
      qa: {
        seo_baseline: ctx.qualityEvidence.seoBaseline,
        visual_qa: 'passed',
      },
      finalized_at: new Date().toISOString(),
    };
    await ctx.evidenceStore.writeReleaseReceipt(finalized);
    ctx.releaseReceipt = finalized;
    await ctx.evidenceStore.loadValidatedReleaseBundle({ requireStatus: 'succeeded', requireMode: 'end-to-end' });
    logger.info({ receiptId: finalized.receipt_id, qa: finalized.qa }, 'Release receipt finalized and chain revalidated');
  }
}
