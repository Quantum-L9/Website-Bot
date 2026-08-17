// L9_META: layer=stage, role=image_asset_planner, status=active, version=1.0.0
//
// Decides which source fills each declared image slot and stages the resolved
// images for assembly. Provided images and suitable source-site candidates are
// resolved here; slots that can only be generated are left as plan entries for
// the (downstream) generation stage to fill. The whole stage is a no-op when the
// spec declares no image slots, so text-only builds are unaffected.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import type {
  AssetSpec,
  BuildContext,
  ImageSlotSpec,
  ProvidedImageSpec,
} from "../pipeline/BuildContext.js";
import { clientAssetRoot } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { EvidenceKind } from "../pipeline/evidence/EvidenceReference.js";
import {
  buildImageAssetManifest,
  type ResolvedImageAsset,
  type ReuseDisposition,
} from "../pipeline/evidence/ImageAssetManifest.js";
import { unresolvedRequiredSlots, type ImageAssetPlan } from "../pipeline/evidence/ImageAssetPlan.js";
import type { IngestedImage } from "../pipeline/evidence/SourceSiteManifest.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import type { VisualRequirement } from "@quantum-l9/bot-interop";
import {
  isBrandMarkCandidate,
  type ProvidedCandidate,
  planImageAssets,
} from "../services/images/ImageAssetPlanner.js";
import {
  EXTENSION_BY_MIME,
  type InspectedImage,
  inspectImage,
} from "../services/images/ImageInspector.js";

const logger = createModuleLogger("stage:image-asset-planning");

interface InspectedProvided {
  spec: ProvidedImageSpec;
  absolutePath: string;
  inspected: InspectedImage;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "image"
  );
}

function dispositionForSource(source: ResolvedImageAsset["source"]): ReuseDisposition {
  // Operator-supplied and generated assets are client-owned by construction.
  // Source-site reuse is approved for the build but flagged for rights review;
  // PR5 tightens this to a domain-ownership check.
  return "approved-client-owned";
}

/**
 * Campaign 7 R11: under REDESIGN_IMPROVE the WebsiteBuildBlueprint owns
 * visual requirement intent. This projects blueprint visual requirements into
 * planner slots — the planner selects WHICH eligible asset satisfies each
 * requirement, never WHETHER the site needs it.
 *
 * Asset precedence (R12): authorized source/client assets outrank generation.
 */
export function slotsFromVisualRequirements(requirements: VisualRequirement[]): ImageSlotSpec[] {
  const provenanceToSources: Record<string, Array<"provided" | "source-site" | "generated">> = {
    source: ["provided", "source-site"],
    licensed: ["provided"],
    generated: ["generated"],
  };
  return requirements.map((requirement) => {
    const sources: Array<"provided" | "source-site" | "generated"> = [];
    for (const provenance of requirement.preferred_provenance) {
      for (const source of provenanceToSources[provenance] ?? []) {
        if (!sources.includes(source)) sources.push(source);
      }
    }
    return {
      id: requirement.slot_id,
      placement:
        requirement.route_id === "global"
          ? `global:${requirement.role}`
          : `${requirement.route_id}:${requirement.role}`,
      required: requirement.required,
      preferredSources: sources.length > 0 ? sources : ["provided", "source-site", "generated"],
      altText: requirement.composition_guidance,
    };
  });
}

export class ImageAssetPlanningStage implements Stage {
  name = "image-asset-planning";
  version = "2.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    // Persist the plan and the (provided + source-site) delivered manifest whenever
    // slots are authored. Image generation later overwrites image_assets with the
    // complete set; writing it here guarantees the evidence exists even for a
    // build with no generated slots. Text-only builds declare no output.
    outputs: (ctx: BuildContext): EvidenceKind[] =>
      ctx.dryRun || (ctx.domainSpec.assets?.imageSlots ?? []).length === 0
        ? []
        : ["image_plan", "image_assets"],
    resumable: false,
    externalMutation: false,
  };

  async run(ctx: BuildContext): Promise<void> {
    const assets = ctx.domainSpec.assets;
    const redesign = ctx.buildIntent === "REDESIGN_IMPROVE";
    const slots = this.resolveSlots(ctx, assets, redesign);
    if ((!assets && !redesign) || slots.length === 0) {
      logger.info("No image slots declared; skipping image asset planning");
      return;
    }

    ctx.resolvedImages ??= new Map();
    const provided = assets ? this.inspectProvided(assets, ctx.dryRun) : [];
    const sourceCandidates: IngestedImage[] = ctx.sourceSiteManifest?.images ?? [];
    const generationEnabled = assets?.generation?.enabled !== false;

    const plan = planImageAssets({
      slots,
      provided: provided.map(this.toCandidate),
      sourceCandidates,
      generationEnabled,
    });
    ctx.imageAssetPlan = plan;

    const missing = unresolvedRequiredSlots(plan);
    if (missing.length > 0) {
      throw new BuildError(
        redesign ? "VISUAL_ASSET_REQUIREMENT_UNSATISFIED" : "VALIDATION_FAILED",
        `Required image slots could not be resolved: ${missing.map((asset) => asset.slotId).join(", ")}`,
      );
    }

    const stagingRoot = clientAssetRoot(ctx);
    const resolved = this.resolvePlannedAssets(ctx, plan, slots, provided, sourceCandidates, stagingRoot);
    ctx.imageAssetManifest = buildImageAssetManifest(
      ctx.buildId,
      ctx.clientId,
      ctx.startedAt.toISOString(),
      resolved,
    );

    if (!ctx.dryRun) {
      const manifestDir = resolve(stagingRoot, "manifests");
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(
        resolve(manifestDir, "image-asset-manifest.json"),
        `${JSON.stringify(ctx.imageAssetManifest, null, 2)}\n`,
        "utf-8",
      );
      await ctx.evidenceStore.writeImagePlan(plan);
      await ctx.evidenceStore.writeImageAssets(ctx.imageAssetManifest);
    }

    if (redesign) this.recordSourceAssetDecisions(ctx, plan, sourceCandidates);

    logger.info(
      {
        slots: slots.length,
        resolved: resolved.length,
        generated: plan.assets.filter((a) => a.resolution.source === "generated").length,
      },
      "Image asset plan resolved",
    );
  }

  private resolveSlots(
    ctx: BuildContext,
    assets: BuildContext["domainSpec"]["assets"],
    redesign: boolean,
  ): ImageSlotSpec[] {
    const slots = assets?.imageSlots ?? [];
    if (!redesign) return slots;
    // R11: the blueprint is the visual requirement authority. Spec-declared
    // slots are merged in only where the blueprint has no slot of that id
    // (operator additions), never as a replacement for blueprint intent.
    const blueprint = ctx.websiteBlueprint;
    if (!blueprint) {
      throw new BuildError(
        "REDESIGN_PIPELINE_INCOMPLETE",
        "REDESIGN_IMPROVE image planning requires the sealed WebsiteBuildBlueprint",
      );
    }
    const blueprintSlots = slotsFromVisualRequirements(blueprint.payload.visual_requirements);
    const blueprintIds = new Set(blueprintSlots.map((slot) => slot.id));
    return [...blueprintSlots, ...slots.filter((slot) => !blueprintIds.has(slot.id))];
  }

  private resolvePlannedAssets(
    ctx: BuildContext,
    plan: ImageAssetPlan,
    slots: ImageSlotSpec[],
    provided: InspectedProvided[],
    sourceCandidates: IngestedImage[],
    stagingRoot: string,
  ): ResolvedImageAsset[] {
    const resolved: ResolvedImageAsset[] = [];
    for (const planned of plan.assets) {
      const slot = slots.find((candidate) => candidate.id === planned.slotId);
      if (!slot) continue;
      const resolution = planned.resolution;
      if (resolution.source === "provided") {
        const match = provided.find((entry) => entry.spec.id === resolution.candidateId);
        if (!match) continue;
        resolved.push(
          this.stageAsset(ctx, stagingRoot, slot, "provided", match.absolutePath, match.inspected, {
            altText: slot.altText ?? match.spec.altText,
            originalPath: match.absolutePath,
          }),
        );
      } else if (resolution.source === "source-site") {
        const candidate = sourceCandidates.find((entry) => entry.id === resolution.candidateId);
        if (!candidate || !existsSync(candidate.localPath)) continue;
        const inspected = ctx.dryRun
          ? {
              mimeType: candidate.mimeType,
              width: candidate.width,
              height: candidate.height,
              byteLength: candidate.byteLength,
              sha256: candidate.sha256,
            }
          : inspectImage(readFileSync(candidate.localPath));
        resolved.push(
          this.stageAsset(ctx, stagingRoot, slot, "source-site", candidate.localPath, inspected, {
            altText: slot.altText ?? candidate.altText,
            sourceUrl: candidate.sourceUrl,
            provenanceWarnings: [
              "source-site asset reused; verify client ownership before publication",
            ],
          }),
        );
      }
      // 'generated' resolutions are filled by the generation stage; 'unresolved'
      // non-required slots are simply left empty.
    }
    return resolved;
  }

  private recordSourceAssetDecisions(
    ctx: BuildContext,
    plan: ImageAssetPlan,
    sourceCandidates: IngestedImage[],
  ): void {
    // Campaign 7 R12: every discovered source asset gets an explicit
    // SELECTED / REJECTED-with-reason decision. Silent loss is a defect.
    const selectedByAssetId = new Map<string, string>();
    for (const planned of plan.assets) {
      if (planned.resolution.source === "source-site" && planned.resolution.candidateId) {
        selectedByAssetId.set(planned.resolution.candidateId, planned.slotId);
      }
    }
    const decisions: NonNullable<BuildContext["sourceAssetDecisions"]> = [];
    for (const image of sourceCandidates) {
      const slotId = selectedByAssetId.get(image.id);
      if (slotId) {
        decisions.push({
          assetPath: image.localPath,
          decision: "SELECTED",
          reason: `selected for blueprint visual slot ${slotId} (authorized source asset outranks generation)`,
          slotId,
        });
      } else if (!existsSync(image.localPath)) {
        decisions.push({
          assetPath: image.localPath,
          decision: "REJECTED",
          reason: "source file missing on disk at planning time",
        });
      } else if (isBrandMarkCandidate(image)) {
        decisions.push({
          assetPath: image.localPath,
          decision: "REJECTED",
          reason: "brand mark (logo/favicon/OG card) not required by any unfilled blueprint visual slot",
        });
      } else {
        decisions.push({
          assetPath: image.localPath,
          decision: "SELECTED",
          reason: "reused in project gallery (no dedicated blueprint slot required it)",
          slotId: "gallery",
        });
      }
    }
    if (decisions.length !== sourceCandidates.length) {
      throw new BuildError(
        "SOURCE_ASSET_REUSE_UNEXPLAINED",
        `source asset ledger covers ${decisions.length} of ${sourceCandidates.length} discovered assets`,
      );
    }
    ctx.sourceAssetDecisions = decisions;
    logger.info(
      {
        discovered: sourceCandidates.length,
        selected: decisions.filter((entry) => entry.decision === "SELECTED").length,
        rejected: decisions.filter((entry) => entry.decision === "REJECTED").length,
      },
      "Source asset reuse ledger complete (no unexplained loss)",
    );
  }

  private toCandidate(entry: InspectedProvided): ProvidedCandidate {
    return {
      id: entry.spec.id,
      intendedPlacement: entry.spec.intendedPlacement,
      altText: entry.spec.altText,
      width: entry.inspected.width,
      height: entry.inspected.height,
      mimeType: entry.inspected.mimeType,
    };
  }

  private inspectProvided(assets: AssetSpec, dryRun: boolean): InspectedProvided[] {
    const results: InspectedProvided[] = [];
    for (const spec of assets.providedImages ?? []) {
      const absolutePath = isAbsolute(spec.path) ? spec.path : resolve(process.cwd(), spec.path);
      if (!existsSync(absolutePath)) {
        if (dryRun) continue;
        throw new BuildError(
          "MISSING_INPUT",
          `Provided image not found: ${spec.path} (resolved ${absolutePath})`,
        );
      }
      try {
        results.push({ spec, absolutePath, inspected: inspectImage(readFileSync(absolutePath)) });
      } catch (error) {
        throw new BuildError(
          "VALIDATION_FAILED",
          `Provided image ${spec.id} is not a decodable image: ${String(error)}`,
        );
      }
    }
    return results;
  }

  private stageAsset(
    ctx: BuildContext,
    stagingRoot: string,
    slot: ImageSlotSpec,
    source: ResolvedImageAsset["source"],
    sourcePath: string,
    inspected: InspectedImage,
    extra: {
      altText?: string;
      sourceUrl?: string;
      originalPath?: string;
      provenanceWarnings?: string[];
    },
  ): ResolvedImageAsset {
    const extension =
      EXTENSION_BY_MIME[inspected.mimeType] ?? basename(sourcePath).split(".").pop() ?? "img";
    const outputFileName = `${slugify(slot.id)}.${extension}`;
    const subdir = source === "source-site" ? "source-site" : "provided";
    let absolutePath = sourcePath;
    if (!ctx.dryRun) {
      const stagedDir = resolve(stagingRoot, subdir);
      mkdirSync(stagedDir, { recursive: true });
      absolutePath = resolve(stagedDir, `${inspected.sha256}.${extension}`);
      copyFileSync(sourcePath, absolutePath);
    }
    const asset: ResolvedImageAsset = {
      slotId: slot.id,
      placement: slot.placement,
      source,
      absolutePath,
      outputFileName,
      altText: extra.altText ?? slot.altText ?? slot.id,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
      byteLength: inspected.byteLength,
      sha256: inspected.sha256,
      sourceUrl: extra.sourceUrl,
      originalPath: extra.originalPath,
      disposition: dispositionForSource(source),
      provenanceWarnings: extra.provenanceWarnings ?? [],
    };
    ctx.resolvedImages?.set(slot.placement, asset);
    return asset;
  }
}
