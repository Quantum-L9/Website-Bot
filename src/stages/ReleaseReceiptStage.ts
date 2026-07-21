// L9_META: layer=stage, role=release_receipt_emitter, stage_index=12, status=active, version=2.1.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { sha256Text } from '../pipeline/evidence/EvidenceCanonicalizer.js';
import { recordToReference } from '../pipeline/evidence/EvidenceReference.js';
import type { ReleaseGate, ReleaseReceipt } from '../pipeline/evidence/ReleaseReceipt.js';

const logger = createModuleLogger('stage:release-receipt');

export class ReleaseReceiptStage implements Stage {
  name = 'release-receipt';
  version = '2.1.0';
  evidence = {
    inputs: (ctx: BuildContext) => ctx.mode === 'end-to-end'
      ? ['assembly' as const, 'build' as const, 'publication' as const, 'deployment' as const]
      : ctx.mode === 'publish-proof'
        ? ['assembly' as const, 'build' as const, 'publication' as const]
        : ctx.mode === 'local-proof'
          ? ['assembly' as const, 'build' as const]
          : [],
    outputs: (ctx: BuildContext) => ctx.mode === 'plan' ? [] : ['release' as const],
    resumable: true,
    externalMutation: false,
  };

  constructor(private readonly now: () => Date = () => new Date()) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.mode === 'plan' || ctx.dryRun) {
      logger.info('[plan] Release receipt is not persisted because no release evidence exists');
      return;
    }

    const assembly = await ctx.evidenceStore.readAssembly();
    if (!assembly) throw new BuildError('EVIDENCE_REFERENCE_MISSING', 'Release receipt requires assembly evidence');
    const build = await ctx.evidenceStore.readBuild();
    const publication = await ctx.evidenceStore.readPublication();
    const deployment = await ctx.evidenceStore.readDeployment();

    const missingGates: ReleaseGate[] = [];
    if (!build) missingGates.push('local_build');
    if (ctx.mode === 'local-proof') missingGates.push('github_publication', 'vercel_deployment');
    if (ctx.mode === 'publish-proof') missingGates.push('vercel_deployment');
    if (ctx.mode === 'end-to-end') missingGates.push('visual_qa');

    const identitiesMatch = Boolean(
      build
      && build.value.buildId === assembly.value.buildId
      && build.value.clientId === assembly.value.clientId
      && build.value.sourceDigest === assembly.value.sourceDigest
      && build.value.assemblyManifestSha256 === assembly.record.sha256
      && (!publication || (
        publication.value.buildProofId === build.value.proofId
        && publication.value.buildProofSha256 === build.record.sha256
        && publication.value.sourceDigest === build.value.sourceDigest
      ))
      && (!deployment || (
        publication
        && deployment.value.publicationId === publication.value.publicationId
        && deployment.value.publicationSha256 === publication.record.sha256
        && deployment.value.requestedCommitSha === publication.value.commitSha
        && deployment.value.observedCommitSha === publication.value.commitSha
      )),
    );

    const seed = [ctx.buildId, assembly.value.sourceDigest, publication?.value.commitSha ?? '', deployment?.value.deploymentId ?? ''].join('\0');
    const createdAt = this.now().toISOString();
    const receipt: ReleaseReceipt = {
      schema: 'website-bot.release-receipt/v1',
      receipt_id: `receipt_${sha256Text(seed).slice(0, 32)}`,
      build_id: ctx.buildId,
      client_id: ctx.clientId,
      mode: ctx.mode,
      status: 'partial',
      missing_gates: [...new Set(missingGates)],
      evidence: {
        assembly: recordToReference(assembly.record),
        ...(build ? { build: recordToReference(build.record) } : {}),
        ...(publication ? { publication: recordToReference(publication.record) } : {}),
        ...(deployment ? { deployment: recordToReference(deployment.record) } : {}),
      },
      correlation: {
        source_digest: assembly.value.sourceDigest,
        ...(build ? { dist_digest: build.value.distDigest } : {}),
        ...(publication ? { commit_sha: publication.value.commitSha } : {}),
        ...(deployment ? { deployment_id: deployment.value.deploymentId } : {}),
        all_required_identities_match: identitiesMatch,
      },
      qa: {
        seo_baseline: ctx.qualityEvidence.seoBaseline,
        visual_qa: ctx.qualityEvidence.visualQa,
      },
      created_at: createdAt,
    };

    const record = await ctx.evidenceStore.writeReleaseReceipt(receipt);
    ctx.releaseReceipt = receipt;
    ctx.releaseReceiptPath = `${ctx.evidenceStore.rootDir}/${record.relativePath}`;
    logger.info({ receiptId: receipt.receipt_id, missingGates: receipt.missing_gates }, 'Partial release receipt persisted');
  }
}
