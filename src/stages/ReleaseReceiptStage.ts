// L9_META: layer=stage, role=release_receipt_emitter, stage_index=12, status=active, version=2.2.0
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import { sha256Text } from "../pipeline/evidence/EvidenceCanonicalizer.js";
import { recordToReference } from "../pipeline/evidence/EvidenceReference.js";
import { buildReadinessLadder } from "../pipeline/evidence/ReadinessLadder.js";
import type {
  LeadCaptureReceipt,
  ReleaseGate,
  ReleaseReceipt,
} from "../pipeline/evidence/ReleaseReceipt.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:release-receipt");

export class ReleaseReceiptStage implements Stage {
  name = "release-receipt";
  version = "2.3.0";
  evidence = {
    inputs: (ctx: BuildContext) => {
      if (ctx.mode === "end-to-end")
        return [
          "assembly" as const,
          "build" as const,
          "publication" as const,
          "deployment" as const,
        ];
      if (ctx.mode === "publish-proof")
        // A preview deployment is optional in publish-proof; when it ran, the
        // receipt must bind to it rather than report it missing.
        return ctx.deploymentEvidence
          ? ["assembly" as const, "build" as const, "publication" as const, "deployment" as const]
          : ["assembly" as const, "build" as const, "publication" as const];
      if (ctx.mode === "local-proof") return ["assembly" as const, "build" as const];
      return [];
    },
    outputs: (ctx: BuildContext) => (ctx.mode === "plan" ? [] : ["release" as const]),
    resumable: true,
    externalMutation: false,
  };

  constructor(private readonly now: () => Date = () => new Date()) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.mode === "plan" || ctx.dryRun) {
      logger.info("[plan] Release receipt is not persisted because no release evidence exists");
      return;
    }

    const assembly = await ctx.evidenceStore.readAssembly();
    if (!assembly)
      throw new BuildError(
        "EVIDENCE_REFERENCE_MISSING",
        "Release receipt requires assembly evidence",
      );
    const build = await ctx.evidenceStore.readBuild();
    const publication = await ctx.evidenceStore.readPublication();
    const deployment = await ctx.evidenceStore.readDeployment();

    // Gates are derived from persisted evidence, never from the mode alone: a
    // publish-proof run that published and reached a READY preview satisfies
    // github_publication and vercel_deployment.
    const leadCapture = leadCaptureReceipt(ctx);
    const missingGates: ReleaseGate[] = [];
    if (!build) missingGates.push("local_build");
    if (!publication) missingGates.push("github_publication");
    if (!deployment) missingGates.push("vercel_deployment");
    if (ctx.mode === "publish-proof" || ctx.mode === "end-to-end") missingGates.push("visual_qa");
    if (leadCaptureGateMissing(ctx, leadCapture)) missingGates.push("lead_capture");

    const identitiesMatch = Boolean(
      build?.value.buildId === assembly.value.buildId &&
        build.value.clientId === assembly.value.clientId &&
        build.value.sourceDigest === assembly.value.sourceDigest &&
        build.value.assemblyManifestSha256 === assembly.record.sha256 &&
        (!publication ||
          (publication.value.buildProofId === build.value.proofId &&
            publication.value.buildProofSha256 === build.record.sha256 &&
            publication.value.sourceDigest === build.value.sourceDigest)) &&
        (!deployment ||
          (publication &&
            deployment.value.publicationId === publication?.value.publicationId &&
            deployment.value.publicationSha256 === publication.record.sha256 &&
            deployment.value.requestedCommitSha === publication?.value.commitSha &&
            deployment.value.observedCommitSha === publication?.value.commitSha)),
    );

    const seed = [
      ctx.buildId,
      assembly.value.sourceDigest,
      publication?.value.commitSha ?? "",
      deployment?.value.deploymentId ?? "",
    ].join("\0");
    const createdAt = this.now().toISOString();
    const receipt: ReleaseReceipt = {
      schema: "website-bot.release-receipt/v2",
      receipt_id: `receipt_${sha256Text(seed).slice(0, 32)}`,
      build_id: ctx.buildId,
      client_id: ctx.clientId,
      mode: ctx.mode,
      status: "partial",
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
      lead_capture: leadCapture,
      // Every level this build did not observe is NOT_RUN, never inferred.
      readiness: buildReadinessLadder(ctx.readiness),
      created_at: createdAt,
    };

    const record = await ctx.evidenceStore.writeReleaseReceipt(receipt);
    ctx.releaseReceipt = receipt;
    ctx.releaseReceiptPath = `${ctx.evidenceStore.rootDir}/${record.relativePath}`;
    logger.info(
      {
        receiptId: receipt.receipt_id,
        missingGates: receipt.missing_gates,
        leadCapture: leadCapture.status,
      },
      "Partial release receipt persisted",
    );
  }
}

/** Projects this build's lead-capture verification evidence into the receipt. */
export function leadCaptureReceipt(ctx: BuildContext): LeadCaptureReceipt {
  const verification = ctx.leadCaptureVerification;
  const configured = Boolean(ctx.domainSpec.seo_contract?.lead_form_action?.trim());
  // The assembled config is authoritative; without it (resume), assume the
  // configured action rendered so an unproven form is never under-reported.
  const ctaRendered = ctx.siteConfig ? Boolean(ctx.siteConfig.leadFormAction) : configured;
  if (!verification) {
    return {
      status: configured ? "unverified" : "not_configured",
      method: "none",
      cta_rendered: ctaRendered,
    };
  }
  return {
    status: verification.status,
    method: verification.method,
    // Only an HTTPS origin is a receivable endpoint; a rejected http:// action
    // stays in the verification evidence, not the receipt.
    ...(verification.endpointOrigin?.startsWith("https://")
      ? { endpoint_origin: verification.endpointOrigin }
      : {}),
    ...(verification.httpStatus !== undefined ? { http_status: verification.httpStatus } : {}),
    evidence_sha256: verification.digest,
    checked_at: verification.checkedAt,
    cta_rendered: ctaRendered,
  };
}

/**
 * lead_capture is missing when the site exposes a live form it never proved,
 * or when the spec asks for a primary action that cannot be served yet.
 */
function leadCaptureGateMissing(ctx: BuildContext, lead: LeadCaptureReceipt): boolean {
  if (lead.status === "verified") return false;
  if (lead.cta_rendered) return true;
  return Boolean(ctx.domainSpec.conversion_authority?.primary_action?.trim());
}
