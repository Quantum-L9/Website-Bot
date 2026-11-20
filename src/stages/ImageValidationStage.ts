// L9_META: layer=stage, role=image_validation, stage_index=9, status=active, version=2.0.0
//
// Post-assembly, deterministic image QA. Every image the generated site references
// must exist on disk under a safe /images/ path, every required slot must have been
// resolved and delivered, and the delivered images must agree with the persisted
// image_assets evidence (source parity, digest/dimension integrity). A republished
// source-site image must carry a republishable disposition — no unauthorized
// republication of a crawled asset. Provenance warnings are surfaced onto the build
// context for release evidence, and missing alt text is reported as advisory. A
// required slot the planner filled with the built-in static conceptual
// illustration (operator decision D1) has no file: it must instead be the home
// hero and must have reached the delivered siteConfig illustrations. A no-op
// when the site declares no images. Never touches the network.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import {
  illustrationFitsVertical,
  STATIC_ILLUSTRATION_PLACEMENT,
  staticIllustrationAssets,
} from "../pipeline/evidence/ImageAssetPlan.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { isOptimizableRaster, slotRenderProfile } from "../services/images/ImageOptimizer.js";

const logger = createModuleLogger("stage:image-validation");
const SHA256 = /^[a-f0-9]{64}$/;

export class ImageValidationStage implements Stage {
  name = "image-validation";
  version = "2.2.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    resumable: false,
    externalMutation: false,
  };

  async run(ctx: BuildContext): Promise<void> {
    const slots = ctx.domainSpec.assets?.imageSlots ?? [];
    const images = ctx.siteConfig?.images ?? {};
    const placements = Object.keys(images);
    const illustrated = staticIllustrationAssets(ctx.imageAssetPlan);
    // Delivered illustrations count too: an illustration-only delivery must
    // still reach checkIllustrations, which rejects one that was never planned.
    const deliveredIllustrations = Object.keys(ctx.siteConfig?.illustrations ?? {});

    this.assertRequiredSlotsResolved(ctx);

    if (
      placements.length === 0 &&
      slots.length === 0 &&
      illustrated.length === 0 &&
      deliveredIllustrations.length === 0
    ) {
      logger.info("No site images to validate");
      return;
    }
    if (ctx.dryRun) {
      logger.info({ images: placements.length }, "[dry-run] Would validate image references");
      return;
    }

    const critical = this.collectCriticalIssues(ctx, slots, images);
    this.checkIllustrations(ctx, illustrated, critical);
    this.checkShippedSizes(ctx, critical);
    const stored = await ctx.evidenceStore.readImageAssets();
    this.checkEvidenceParity(slots, images, stored, critical);

    if (critical.length > 0) {
      throw new BuildError(
        "VALIDATION_FAILED",
        `Image QA found ${critical.length} issue(s): ${critical.join("; ")}`,
      );
    }

    const warnings = this.surfaceProvenanceWarnings(ctx);
    this.surfaceAltAdvisories(slots, images);

    logger.info(
      { images: placements.length, evidence: Boolean(stored), warnings: warnings.length },
      "Image references validated",
    );
  }

  private assertRequiredSlotsResolved(ctx: BuildContext): void {
    // Required slots must be resolved (defense in depth; planning also enforces).
    const unresolvedRequired = (ctx.imageAssetPlan?.assets ?? [])
      .filter((asset) => asset.required && asset.resolution.source === "unresolved")
      .map((asset) => asset.slotId);
    if (unresolvedRequired.length > 0) {
      throw new BuildError(
        "VALIDATION_FAILED",
        `Required image slots unresolved at validation: ${unresolvedRequired.join(", ")}`,
      );
    }
  }

  private collectCriticalIssues(
    ctx: BuildContext,
    slots: NonNullable<NonNullable<BuildContext["domainSpec"]["assets"]>["imageSlots"]>,
    images: NonNullable<NonNullable<BuildContext["siteConfig"]>["images"]>,
  ): string[] {
    const critical: string[] = [];

    // Every required slot must have reached the delivered site config, as an
    // image file or (home hero only) as a planned static illustration.
    const illustrations = ctx.siteConfig?.illustrations ?? {};
    const illustratedPlacements = new Set(
      staticIllustrationAssets(ctx.imageAssetPlan).map((asset) => asset.placement),
    );
    for (const slot of slots) {
      const delivered =
        images[slot.placement] !== undefined ||
        (illustratedPlacements.has(slot.placement) && illustrations[slot.placement] !== undefined);
      if (slot.required && !delivered)
        critical.push(`required slot not delivered: ${slot.id} (${slot.placement})`);
    }

    // Path hygiene + delivered-file existence.
    for (const [placement, entry] of Object.entries(images)) {
      if (!entry.src.startsWith("/images/") || entry.src.split("/").includes("..")) {
        critical.push(`unsafe delivered path: ${placement} -> ${entry.src}`);
      } else if (!existsSync(join(ctx.outputDir, "public", entry.src.replace(/^\//, "")))) {
        critical.push(`broken image reference: ${placement} -> ${entry.src}`);
      }
    }

    return critical;
  }

  /**
   * A static illustration is valid only for the home hero, only where no image
   * file was delivered for that placement, and only once assembly delivered it
   * into siteConfig with the planned illustration id. It has no file, so no
   * file or digest check applies.
   */
  private checkIllustrations(
    ctx: BuildContext,
    illustrated: ReturnType<typeof staticIllustrationAssets>,
    critical: string[],
  ): void {
    const delivered = ctx.siteConfig?.illustrations ?? {};
    const images = ctx.siteConfig?.images ?? {};
    for (const asset of illustrated) {
      if (asset.placement !== STATIC_ILLUSTRATION_PLACEMENT) {
        critical.push(
          `static illustration outside the home hero: ${asset.slotId} (${asset.placement})`,
        );
        continue;
      }
      if (!illustrationFitsVertical(asset.resolution.illustrationId, ctx.domainSpec.vertical)) {
        critical.push(
          `static illustration ${asset.resolution.illustrationId} does not fit vertical ${ctx.domainSpec.vertical ?? "(undeclared)"}; the slot must stay unresolved`,
        );
      }
      if (images[asset.placement]) {
        critical.push(
          `static illustration ${asset.placement} also delivered an image file; a slot has one source`,
        );
      }
      const entry = delivered[asset.placement];
      if (!entry) {
        critical.push(`static illustration not delivered: ${asset.slotId} (${asset.placement})`);
      } else if (
        entry.illustrationId !== asset.resolution.illustrationId ||
        entry.source !== "static-illustration"
      ) {
        critical.push(
          `static illustration mismatch for ${asset.placement}: plan ${asset.resolution.illustrationId} vs site ${entry.illustrationId}`,
        );
      }
    }
    for (const placement of Object.keys(delivered)) {
      if (!illustrated.some((asset) => asset.placement === placement))
        critical.push(`delivered static illustration ${placement} was never planned`);
    }
  }

  /**
   * Every shipped raster must be the optimised output for its slot: within the
   * slot's byte cap and render width. An oversized or unoptimised file fails
   * closed here even if a stage upstream was bypassed.
   */
  private checkShippedSizes(ctx: BuildContext, critical: string[]): void {
    for (const asset of ctx.imageAssetManifest?.assets ?? []) {
      if (!isOptimizableRaster(asset.mimeType)) continue;
      const profile = slotRenderProfile({ id: asset.slotId, placement: asset.placement });
      if (asset.byteLength > profile.maxBytes)
        critical.push(
          `oversized image ${asset.placement}: ${asset.byteLength} bytes exceeds the ${profile.kind} cap of ${profile.maxBytes}`,
        );
      if (asset.width > profile.maxWidth)
        critical.push(
          `unoptimised image ${asset.placement}: ${asset.width}px wide exceeds the ${profile.kind} render width ${profile.maxWidth}`,
        );
    }
  }

  private checkEvidenceParity(
    slots: NonNullable<NonNullable<BuildContext["domainSpec"]["assets"]>["imageSlots"]>,
    images: NonNullable<NonNullable<BuildContext["siteConfig"]>["images"]>,
    stored: Awaited<ReturnType<BuildContext["evidenceStore"]["readImageAssets"]>>,
    critical: string[],
  ): void {
    // Evidence/assembly parity + integrity + republication governance.
    if (slots.length > 0 && !stored) {
      critical.push("image slots declared but no image_assets evidence was persisted");
    }
    if (stored) {
      const byPlacement = new Map(stored.value.assets.map((asset) => [asset.placement, asset]));
      for (const [placement, entry] of Object.entries(images)) {
        const asset = byPlacement.get(placement);
        if (!asset) {
          critical.push(`delivered image ${placement} has no image_assets evidence`);
          continue;
        }
        if (asset.source !== entry.source)
          critical.push(
            `source mismatch for ${placement}: evidence ${asset.source} vs site ${entry.source}`,
          );
        if (!SHA256.test(asset.sha256)) critical.push(`invalid digest for ${placement}`);
        if (asset.byteLength <= 0 || asset.width <= 0 || asset.height <= 0)
          critical.push(`degenerate image metrics for ${placement}`);
        // A crawled image may only be republished when its disposition clears it.
        if (asset.source === "source-site" && asset.disposition !== "approved-client-owned") {
          critical.push(
            `unauthorized republication of source-site asset ${placement} (disposition=${asset.disposition})`,
          );
        }
      }
    }
  }

  private surfaceProvenanceWarnings(ctx: BuildContext): string[] {
    const warnings = (ctx.imageAssetManifest?.assets ?? []).flatMap((asset) =>
      asset.provenanceWarnings.map((warning) => `${asset.placement}: ${warning}`),
    );
    if (warnings.length > 0) {
      ctx.imageProvenanceWarnings = warnings;
      logger.warn({ warnings }, "Image provenance warnings surfaced for release evidence");
    }
    return warnings;
  }

  private surfaceAltAdvisories(
    slots: NonNullable<NonNullable<BuildContext["domainSpec"]["assets"]>["imageSlots"]>,
    images: NonNullable<NonNullable<BuildContext["siteConfig"]>["images"]>,
  ): void {
    const altAdvisories = slots
      .filter((slot) => images[slot.placement] && !images[slot.placement].alt?.trim())
      .map((slot) => `${slot.placement} has no alt text`);
    if (altAdvisories.length > 0) logger.warn({ altAdvisories }, "Image alt-text advisories");
  }
}
