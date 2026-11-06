// L9_META: layer=stage, role=image_asset_planner, status=active, version=1.0.0
//
// Decides which source fills each declared image slot and stages the resolved
// images for assembly. Provided images and suitable source-site candidates are
// resolved here; slots that can only be generated are left as plan entries for
// the (downstream) generation stage to fill. The whole stage is a no-op when the
// spec declares no image slots, so text-only builds are unaffected.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { VISUAL_ROLES, type VisualRequirement } from "@quantum-l9/bot-interop";
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
import {
  type ImageAssetPlan,
  unresolvedRequiredSlots,
} from "../pipeline/evidence/ImageAssetPlan.js";
import type { IngestedImage } from "../pipeline/evidence/SourceSiteManifest.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import {
  basePlacement,
  isBrandMarkCandidate,
  isFactualSlot,
  type ProvidedCandidate,
  placementRole,
  placementSectionId,
  planImageAssets,
  routeSlugFromPlacement,
  sectionQualifiedPlacement,
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

function dispositionForSource(_source: ResolvedImageAsset["source"]): ReuseDisposition {
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
 * Reuse-first: every blueprint slot tries provided and then authorized
 * source-site assets; a blueprint's provenance only decides whether generation
 * may follow as the last resort — never that it replaces reuse.
 */
export function slotsFromVisualRequirements(requirements: VisualRequirement[]): ImageSlotSpec[] {
  const basePlacementOf = (requirement: VisualRequirement): string =>
    requirement.route_id === "global"
      ? `global:${requirement.role}`
      : `${requirement.route_id}:${requirement.role}`;
  // WB-GLUE-01: several blueprint sections on one route can share a role
  // (golden run #58: "/:service"). Each keeps its own section-qualified
  // placement instead of all but one being dropped; a role that occurs once
  // keeps its existing public key ("/:hero", "global:logo").
  const sectionsByPlacement = new Map<string, Set<string>>();
  for (const requirement of requirements) {
    const base = basePlacementOf(requirement);
    const sections = sectionsByPlacement.get(base) ?? new Set<string>();
    sections.add(requirement.section_id);
    sectionsByPlacement.set(base, sections);
  }
  const slots: ImageSlotSpec[] = requirements.map((requirement) => {
    const base = basePlacementOf(requirement);
    // Factual roles (logo, team, project proof, …) are never generated; the
    // planner enforces that for every slot, so it is not repeated here.
    const allowsGenerated =
      requirement.preferred_provenance.includes("generated") &&
      !isFactualSlot({ id: requirement.slot_id, placement: base });
    const collides = (sectionsByPlacement.get(base)?.size ?? 0) > 1;
    return {
      id: requirement.slot_id,
      placement: collides ? sectionQualifiedPlacement(base, requirement.section_id) : base,
      required: requirement.required,
      preferredSources: allowsGenerated
        ? ["provided", "source-site", "generated"]
        : ["provided", "source-site"],
      altText: requirement.composition_guidance,
    };
  });
  // The manifest's uniqueness key is the placement and the plan's is the slot
  // id. Distinct sections no longer collide; a repeated (section, role) or a
  // repeated slot id keeps one slot, required first.
  const seenPlacements = new Set<string>();
  const seenIds = new Set<string>();
  const deduped: ImageSlotSpec[] = [];
  for (const slot of [...slots].sort((a, b) => Number(b.required) - Number(a.required))) {
    if (seenPlacements.has(slot.placement) || seenIds.has(slot.id)) continue;
    seenPlacements.add(slot.placement);
    seenIds.add(slot.id);
    deduped.push(slot);
  }
  return deduped;
}

/**
 * Merge blueprint-derived slots (the REDESIGN_IMPROVE visual authority, R11)
 * with spec-declared slots. A spec slot is an operator addition only when
 * the blueprint covers neither its id NOR its placement — the manifest's
 * uniqueness key is the placement, so an id-only dedupe lets a blueprint
 * slot and a spec slot with different ids but the same placement both
 * resolve and the manifest validator then rejects the duplicate
 * (golden run #54: "global:logo").
 *
 * WB-GLUE-01: an overlapping spec slot is reconciled into the blueprint slot
 * rather than discarded, so an explicit first-party obligation (e.g. a
 * required real logo) survives: `required` is the union of both.
 */
export function mergeBlueprintAndSpecSlots(
  blueprintSlots: ImageSlotSpec[],
  specSlots: ImageSlotSpec[],
): ImageSlotSpec[] {
  const blueprintIds = new Set(blueprintSlots.map((slot) => slot.id));
  const blueprintPlacements = new Set(blueprintSlots.map((slot) => slot.placement));
  const reconciled = blueprintSlots.map((slot) => {
    const overlap = specSlots.filter(
      (spec) => spec.id === slot.id || spec.placement === slot.placement,
    );
    return overlap.some((spec) => spec.required) && !slot.required
      ? { ...slot, required: true }
      : slot;
  });
  return [
    ...reconciled,
    ...specSlots.filter(
      (slot) => !blueprintIds.has(slot.id) && !blueprintPlacements.has(slot.placement),
    ),
  ];
}

/**
 * Project explicit provided-image placements the slot inventory does not yet
 * contain into it (WB-GLUE-01), so an operator does not have to repeat them
 * under imageSlots. An explicit intendedPlacement is authoritative: it must
 * name a permitted global placement or an existing route (and, when
 * section-qualified, an existing blueprint section of that route) with a
 * known visual role; otherwise planning fails instead of silently dropping or
 * redirecting the asset. A placement already covered by a slot (exactly, or
 * by route + role) is left to normal resolution.
 */
export function projectProvidedPlacements(
  slots: ImageSlotSpec[],
  provided: ReadonlyArray<{ id: string; intendedPlacement?: string; altText?: string }>,
  routeSections: Map<string, Set<string>>,
): ImageSlotSpec[] {
  const covered = new Set(slots.flatMap((slot) => [slot.placement, basePlacement(slot.placement)]));
  const slotPlacements = new Set(slots.map((slot) => slot.placement));
  const projected: ImageSlotSpec[] = [];
  for (const image of provided) {
    const placement = image.intendedPlacement?.trim();
    // Covered exactly, by route + role, or (section-qualified intent) by the
    // route's single slot of that role: normal resolution assigns it there.
    if (!placement || covered.has(placement) || slotPlacements.has(basePlacement(placement))) {
      continue;
    }
    const role = placementRole(placement);
    const route = routeSlugFromPlacement(placement);
    const sectionId = placementSectionId(placement);
    const permitted =
      route === undefined
        ? (placement === "global:logo" || placement === "global:og-image") && !sectionId
        : (VISUAL_ROLES as readonly string[]).includes(role) &&
          routeSections.has(route) &&
          (sectionId === undefined || (routeSections.get(route)?.has(sectionId) ?? false));
    if (!permitted) {
      throw new BuildError(
        "VALIDATION_FAILED",
        `provided-image-placement: ${image.id} intends ${JSON.stringify(placement)}, which names no permitted placement on an existing route or section (use "global:logo", "global:og-image", or "<route>:<role>[#<section_id>]" with a role of ${VISUAL_ROLES.join(", ")})`,
      );
    }
    projected.push({
      id: `provided:${image.id}`,
      placement,
      required: false,
      preferredSources: ["provided"],
      altText: image.altText,
    });
    covered.add(placement);
  }
  return [...slots, ...projected];
}

/**
 * The one supplied image that is unambiguously the company logo without an
 * explicit placement: no image claims global:logo explicitly, and exactly one
 * unplaced image names "logo" in its id or alt text. Ambiguity identifies none
 * (an operator places it explicitly instead); a supplied logo is never guessed.
 */
function identifiedLogo<T extends { id: string; path: string; intendedPlacement?: string }>(
  provided: ReadonlyArray<T>,
): T | undefined {
  if (provided.some((image) => image.intendedPlacement?.trim() === "global:logo")) return undefined;
  // Only the asset's own name (id or file name) can say it is the logo: alt
  // text describing a photo that merely shows a logo is not evidence.
  const named = provided.filter(
    (image) =>
      !image.intendedPlacement?.trim() &&
      /(^|[^a-z0-9])logo($|[^a-z0-9])/i.test(`${image.id} ${basename(image.path)}`),
  );
  return named.length === 1 ? named[0] : undefined;
}

/**
 * The supplied images with the one unambiguous logo assigned explicitly to
 * global:logo, so it is bound to that slot as an assigned asset — never left
 * to compete with other images on size.
 */
export function withIdentifiedLogo(
  provided: ReadonlyArray<ProvidedImageSpec>,
): ProvidedImageSpec[] {
  const logo = identifiedLogo(provided);
  return provided.map((image) =>
    image === logo ? { ...image, intendedPlacement: "global:logo" } : image,
  );
}

export class ImageAssetPlanningStage implements Stage {
  name = "image-asset-planning";
  version = "2.1.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    // Persist the plan and the (provided + source-site) delivered manifest whenever
    // slots are authored. Image generation later overwrites image_assets with the
    // complete set; writing it here guarantees the evidence exists even for a
    // build with no generated slots. Text-only builds declare no output.
    // Declared exactly when run() produced a plan (it then always writes both),
    // so a spec whose images resolve to no slot never claims missing evidence.
    outputs: (ctx: BuildContext): EvidenceKind[] =>
      ctx.dryRun || !ctx.imageAssetPlan ? [] : ["image_plan", "image_assets"],
    resumable: false,
    externalMutation: false,
  };

  async run(ctx: BuildContext): Promise<void> {
    const assets = ctx.domainSpec.assets;
    const redesign = ctx.buildIntent === "REDESIGN_IMPROVE";
    const providedSpecs = withIdentifiedLogo(assets?.providedImages ?? []);
    const slots = this.resolveSlots(ctx, assets, providedSpecs, redesign);
    if ((!assets && !redesign) || slots.length === 0) {
      logger.info("No image slots declared; skipping image asset planning");
      return;
    }

    ctx.resolvedImages ??= new Map();
    const provided = this.inspectProvided(providedSpecs, ctx.dryRun);
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
    const missingLogo = missing.find((asset) => asset.placement === "global:logo");
    if (missingLogo) {
      throw new BuildError(
        "VISUAL_ASSET_REQUIREMENT_UNSATISFIED",
        `missing-logo: ${missingLogo.slotId} requires a real logo, but no provided logo or authorized source-site logo exists; Website-Bot never synthesizes a logo — supply one under assets.providedImages`,
      );
    }
    if (missing.length > 0) {
      const factual = missing.filter((asset) =>
        isFactualSlot({ id: asset.slotId, placement: asset.placement }),
      );
      const illustrative = missing.filter((asset) => !factual.includes(asset));
      throw new BuildError(
        redesign ? "VISUAL_ASSET_REQUIREMENT_UNSATISFIED" : "VALIDATION_FAILED",
        `Required image slots could not be resolved: ${missing.map((asset) => asset.slotId).join(", ")}` +
          (factual.length > 0
            ? `; ${factual.map((asset) => asset.slotId).join(", ")} depict real identity or work and are never generated — supply them under assets.providedImages`
            : "") +
          (illustrative.length > 0
            ? `; for ${illustrative.map((asset) => asset.slotId).join(", ")}, assign a client image by intendedPlacement or slot id, or enable assets.generation`
            : ""),
      );
    }
    this.reportUnusedPlacedImages(providedSpecs, plan);

    const stagingRoot = clientAssetRoot(ctx);
    const resolved = this.resolvePlannedAssets(
      ctx,
      plan,
      slots,
      provided,
      sourceCandidates,
      stagingRoot,
    );
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
    providedSpecs: ProvidedImageSpec[],
    redesign: boolean,
  ): ImageSlotSpec[] {
    const slots = assets?.imageSlots ?? [];
    if (!redesign) {
      // One asset-selection rule for every build: explicitly placed (or the one
      // unambiguous) client images enter the slot inventory without being
      // repeated under imageSlots. COPY routes carry no blueprint sections.
      return projectProvidedPlacements(
        slots,
        providedSpecs,
        new Map(ctx.domainSpec.routes.map((route) => [route.slug, new Set<string>()])),
      );
    }
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
    const routeSections = new Map(
      blueprint.payload.routes.map((route) => [
        route.route_id,
        new Set(route.sections.map((section) => section.section_id)),
      ]),
    );
    return projectProvidedPlacements(
      mergeBlueprintAndSpecSlots(blueprintSlots, slots),
      providedSpecs,
      routeSections,
    );
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
          reason:
            "brand mark (logo/favicon/OG card) not required by any unfilled blueprint visual slot",
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

  /**
   * A client image placed explicitly but not used (another image filled that
   * placement) is never moved to a different section; it is reported so it is
   * not lost silently, and stays in the client's asset inventory.
   */
  private reportUnusedPlacedImages(specs: ProvidedImageSpec[], plan: ImageAssetPlan): void {
    const used = new Set(
      plan.assets.flatMap((asset) =>
        asset.resolution.source === "provided" && asset.resolution.candidateId
          ? [asset.resolution.candidateId]
          : [],
      ),
    );
    for (const spec of specs) {
      const placement = spec.intendedPlacement?.trim();
      if (!placement || used.has(spec.id)) continue;
      const winner = plan.assets.find(
        (asset) => asset.placement === placement || basePlacement(asset.placement) === placement,
      );
      logger.warn(
        {
          image: spec.id,
          intendedPlacement: placement,
          filledBy:
            winner && "candidateId" in winner.resolution
              ? winner.resolution.candidateId
              : undefined,
        },
        "Provided image not placed: its intended placement was filled by another asset; it is kept in the asset inventory, not moved elsewhere",
      );
    }
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

  private inspectProvided(specs: ProvidedImageSpec[], dryRun: boolean): InspectedProvided[] {
    const results: InspectedProvided[] = [];
    for (const spec of specs) {
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
