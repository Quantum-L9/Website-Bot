// L9_META: layer=evidence, role=redesign_integrity_receipt, status=active, version=1.0.0
//
// Campaign 7 §16: machine-readable proof that the redesign authority graph
// actually executed. Every field maps to runtime evidence gathered during
// the build; a missing field is a FAIL, never a default.

import type { BuildContext } from "../BuildContext.js";
import { BuildError } from "../BuildError.js";
import type { EvidenceGateStatus } from "./ReleaseReceipt.js";

export const REDESIGN_INTEGRITY_RECEIPT_SCHEMA =
  "website-bot.redesign-execution-integrity-receipt/v1" as const;

export interface RedesignExecutionIntegrityReceipt {
  schema: typeof REDESIGN_INTEGRITY_RECEIPT_SCHEMA;
  build_id: string;
  client_id: string;
  mode: string;
  build_intent: "REDESIGN_IMPROVE";
  executed_stages: string[];
  competitive_landscape: { artifact_id: string; payload_digest: string };
  qualified_donor_count: number;
  donors: Array<{
    domain: string;
    pages: number;
    screenshots: number;
    evidence_digest: string;
    crawl_manifest_path: string;
    disposition: "DONOR_REFERENCE_ONLY";
  }>;
  seo_content_blueprint: { artifact_id: string; payload_digest: string };
  page_content_contract: { artifact_id: string; payload_digest: string };
  structured_content_package: { artifact_id: string; payload_digest: string };
  counters: {
    page_content_contract_llm_calls: number;
    legacy_content_generation_calls: number;
    redesign_schema_llm_calls: number;
  };
  visual: {
    required_slots: number;
    required_slots_filled: number;
    required_visual_slots_filled_pct: number;
    source_assets_discovered: number;
    source_assets_selected: number;
    source_assets_rejected: number;
    unexplained_asset_loss: number;
  };
  visual_qa: { status: EvidenceGateStatus };
  emitted_at: string;
}

function require<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null) {
    throw new BuildError(
      "REDESIGN_PIPELINE_INCOMPLETE",
      `redesign integrity receipt: missing evidence for ${field} (missing evidence is FAIL, not default)`,
    );
  }
  return value;
}

export function emitRedesignExecutionIntegrityReceipt(
  ctx: BuildContext,
): RedesignExecutionIntegrityReceipt {
  if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
    throw new BuildError(
      "REDESIGN_PIPELINE_INCOMPLETE",
      "redesign integrity receipt is only defined for REDESIGN_IMPROVE builds",
    );
  }
  const landscape = require(ctx.competitiveLandscape, "competitive_landscape");
  const donors = require(ctx.acceptedDonors, "accepted_donors");
  const seoBlueprint = require(ctx.seoContentBlueprint, "seo_content_blueprint");
  const contract = require(ctx.pageContentContract, "page_content_contract");
  const contentPackage = require(ctx.structuredContentPackage, "structured_content_package");
  const counters = require(ctx.redesignCounters, "redesign_counters");
  const decisions = require(ctx.sourceAssetDecisions, "source_asset_decisions");
  const plan = require(ctx.imageAssetPlan, "image_asset_plan");

  const requiredSlots = plan.assets.filter((asset) => asset.required);
  const requiredFilled = requiredSlots.filter(
    (asset) => asset.resolution.source !== "unresolved",
  );
  const discovered = ctx.sourceSiteManifest?.images?.length ?? 0;
  const selected = decisions.filter((entry) => entry.decision === "SELECTED").length;
  const rejected = decisions.filter((entry) => entry.decision === "REJECTED").length;

  return {
    schema: REDESIGN_INTEGRITY_RECEIPT_SCHEMA,
    build_id: ctx.buildId,
    client_id: ctx.clientId,
    mode: ctx.mode,
    build_intent: "REDESIGN_IMPROVE",
    executed_stages: [...ctx.stageResults.entries()]
      .filter(([, result]) => result.ok)
      .map(([stage]) => stage),
    competitive_landscape: {
      artifact_id: landscape.artifact_id,
      payload_digest: landscape.integrity.payload_digest,
    },
    qualified_donor_count: donors.length,
    donors: donors.map((donor) => ({
      domain: donor.domain,
      pages: donor.pages.length,
      screenshots: donor.screenshot_paths.length,
      evidence_digest: donor.evidence_digest,
      crawl_manifest_path: donor.crawl_manifest_path,
      disposition: donor.disposition,
    })),
    seo_content_blueprint: {
      artifact_id: seoBlueprint.artifact_id,
      payload_digest: seoBlueprint.integrity.payload_digest,
    },
    page_content_contract: {
      artifact_id: contract.artifact_id,
      payload_digest: contract.integrity.payload_digest,
    },
    structured_content_package: {
      artifact_id: contentPackage.artifact_id,
      payload_digest: contentPackage.integrity.payload_digest,
    },
    counters: {
      page_content_contract_llm_calls: counters.pageContentContractLlmCalls,
      legacy_content_generation_calls: counters.legacyContentGenerationCalls,
      redesign_schema_llm_calls: counters.redesignSchemaLlmCalls,
    },
    visual: {
      required_slots: requiredSlots.length,
      required_slots_filled: requiredFilled.length,
      required_visual_slots_filled_pct:
        requiredSlots.length === 0
          ? 100
          : Math.round((requiredFilled.length / requiredSlots.length) * 100),
      source_assets_discovered: discovered,
      source_assets_selected: selected,
      source_assets_rejected: rejected,
      unexplained_asset_loss: Math.max(0, discovered - decisions.length),
    },
    visual_qa: { status: ctx.qualityEvidence.visualQa },
    emitted_at: new Date().toISOString(),
  };
}

/**
 * Campaign 7 §16/§17: receipt validation. A receipt that fails ANY invariant
 * is a failed redesign run regardless of how healthy the site looks.
 */
function receiptFail(message: string): never {
  throw new BuildError("REDESIGN_PIPELINE_INCOMPLETE", `integrity receipt invalid: ${message}`);
}

function validateDonorEvidence(receipt: RedesignExecutionIntegrityReceipt): void {
  for (const donor of receipt.donors) {
    if (donor.pages < 1) receiptFail(`donor ${donor.domain} lacks crawl evidence`);
    if (donor.screenshots < 1) receiptFail(`donor ${donor.domain} lacks screenshot evidence`);
    if (donor.disposition !== "DONOR_REFERENCE_ONLY")
      receiptFail(`donor ${donor.domain} has illegal disposition ${donor.disposition}`);
    if (!donor.evidence_digest) receiptFail(`donor ${donor.domain} lacks an evidence digest`);
  }
}

function validateZeroLlmCalls(receipt: RedesignExecutionIntegrityReceipt): void {
  if (receipt.counters.page_content_contract_llm_calls !== 0)
    receiptFail("page_content_contract_llm_calls must be 0");
  if (receipt.counters.legacy_content_generation_calls !== 0)
    receiptFail("legacy_content_generation_calls must be 0");
  if (receipt.counters.redesign_schema_llm_calls !== 0)
    receiptFail("redesign_schema_llm_calls must be 0");
}

function validateArtifactRefs(receipt: RedesignExecutionIntegrityReceipt): void {
  for (const [field, ref] of [
    ["competitive_landscape", receipt.competitive_landscape],
    ["seo_content_blueprint", receipt.seo_content_blueprint],
    ["page_content_contract", receipt.page_content_contract],
    ["structured_content_package", receipt.structured_content_package],
  ] as const) {
    if (!ref.artifact_id || !ref.payload_digest) receiptFail(`${field} identity is incomplete`);
  }
}

function validateVisualState(
  receipt: RedesignExecutionIntegrityReceipt,
  requireVisualQa: boolean,
): void {
  if (receipt.visual.required_visual_slots_filled_pct !== 100)
    receiptFail(
      `required_visual_slots_filled must be 100%, got ${receipt.visual.required_visual_slots_filled_pct}%`,
    );
  if (receipt.visual.unexplained_asset_loss !== 0)
    receiptFail(`unexplained_asset_loss must be 0, got ${receipt.visual.unexplained_asset_loss}`);
  // "passed" is the canonical EvidenceGateStatus success value emitted by
  // VisualQAStage and required by the release receipt; nothing ever produces
  // "verified", so demanding it here failed every end-to-end redesign run.
  if (requireVisualQa && receipt.visual_qa.status !== "passed")
    receiptFail(
      `visual_qa must be passed for end-to-end convergence, got ${receipt.visual_qa.status}`,
    );
}

export function validateRedesignExecutionIntegrityReceipt(
  receipt: RedesignExecutionIntegrityReceipt,
  options: { requireVisualQa: boolean },
): void {
  if (receipt.build_intent !== "REDESIGN_IMPROVE")
    receiptFail("build_intent must be REDESIGN_IMPROVE");
  if (receipt.qualified_donor_count !== 10)
    receiptFail(`qualified_donor_count must be exactly 10, got ${receipt.qualified_donor_count}`);
  if (receipt.donors.length !== 10) receiptFail(`donor evidence list must carry 10 donors`);
  validateDonorEvidence(receipt);
  validateZeroLlmCalls(receipt);
  validateArtifactRefs(receipt);
  validateVisualState(receipt, options.requireVisualQa);
}
