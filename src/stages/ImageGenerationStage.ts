// L9_META: layer=stage, role=image_generation, stage_index=7, status=active, version=1.0.0
//
// Fills ONLY the image slots the planner marked `generated`. Provided and
// source-site slots are already resolved by ImageAssetPlanningStage. Generation
// is cached by a stable request fingerprint, so an identical rerun makes no
// provider call; every call is charged against the build budget; and each output
// is inspected and recorded in the image asset manifest. A no-op when the plan
// has no generated slots.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import {
  type AssetSpec,
  type BuildContext,
  clientAssetRoot,
  clientPersistentAssetRoot,
  type ImageSlotSpec,
} from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { EvidenceKind } from "../pipeline/evidence/EvidenceReference.js";
import {
  buildImageAssetManifest,
  type ResolvedImageAsset,
} from "../pipeline/evidence/ImageAssetManifest.js";
import type { ImageGenerationBrief } from "../pipeline/evidence/ImageAssetPlan.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import { createImageGenerator } from "../services/images/GeminiImageGenerator.js";
import { ImageBudget, ImageBudgetExceededError } from "../services/images/ImageBudget.js";
import type { ImageGenerator } from "../services/images/ImageGenerator.js";
import { EXTENSION_BY_MIME, inspectImage } from "../services/images/ImageInspector.js";
import { compileImagePrompt } from "../services/images/ImagePromptCompiler.js";

const logger = createModuleLogger("stage:image-generation");

interface CacheMetadata {
  mimeType: string;
  model: string;
  prompt: string;
  estimatedCostUsd: number;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "image"
  );
}

type ResolveAssetParams = {
  generator: ImageGenerator;
  budget: ImageBudget;
  cacheRoot: string;
  slot: ImageSlotSpec;
  brief: ImageGenerationBrief;
  prompt: string;
  fingerprint: string;
};

function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort(compareKeys)
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export class ImageGenerationStage implements Stage {
  name = "image-generation";
  version = "2.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    // Overwrite image_assets with the complete (provided + source-site + generated)
    // manifest only when there are generated slots to fill. With none, the stage
    // no-ops and planning's image_assets evidence stands.
    outputs: (ctx: BuildContext): EvidenceKind[] => {
      const generated = ctx.imageAssetPlan?.assets.some(
        (asset) => asset.resolution.source === "generated",
      );
      return ctx.dryRun || !generated ? [] : ["image_assets"];
    },
    resumable: false,
    externalMutation: false,
  };

  constructor(private readonly generatorOverride?: ImageGenerator) {}

  async run(ctx: BuildContext): Promise<void> {
    const plan = ctx.imageAssetPlan;
    const generatedSlots =
      plan?.assets.filter((asset) => asset.resolution.source === "generated") ?? [];
    if (!plan || generatedSlots.length === 0) {
      logger.info("No generated image slots; skipping image generation");
      return;
    }
    if (ctx.dryRun) {
      logger.info({ count: generatedSlots.length }, "[dry-run] Would generate missing images");
      return;
    }

    const assets = ctx.domainSpec.assets as AssetSpec;
    ctx.resolvedImages ??= new Map();
    const generator =
      this.generatorOverride ?? createImageGenerator({ model: assets.generation?.model });
    if (!generator) {
      throw new BuildError(
        "MISSING_INPUT",
        "Image generation is required by the plan but no image provider is configured (set GEMINI_API_KEY)",
      );
    }
    const budget = new ImageBudget(assets.generation?.budgetUsd);
    const compiler = assets.generation?.promptCompiler ?? "default";
    const model = assets.generation?.model ?? "gemini-2.5-flash-image";
    const cacheRoot = resolve(clientPersistentAssetRoot(ctx), "generated");
    mkdirSync(cacheRoot, { recursive: true });

    for (const planned of generatedSlots) {
      if (planned.resolution.source !== "generated") continue;
      const slot = assets.imageSlots?.find((candidate) => candidate.id === planned.slotId);
      if (!slot) continue;
      const brief = planned.resolution.compiledBrief;
      const compiled = compileImagePrompt(brief, { compiler, designTokens: ctx.designTokens });
      const fingerprint = createHash("sha256")
        .update(
          canonicalJson({
            slotId: brief.slotId,
            brief,
            prompt: compiled.prompt,
            compiler: compiled.compiler,
            compilerVersion: compiled.compilerVersion,
            model,
            aspectRatio: brief.aspectRatio,
            imageSize: brief.imageSize,
          }),
        )
        .digest("hex");

      const resolved = await this.resolveAsset(ctx, {
        generator,
        budget,
        cacheRoot,
        slot,
        brief,
        prompt: compiled.prompt,
        fingerprint,
      });
      ctx.resolvedImages.set(slot.placement, resolved);
    }

    // Rebuild the manifest so it covers provided + source-site + generated assets.
    ctx.imageAssetManifest = buildImageAssetManifest(
      ctx.buildId,
      ctx.clientId,
      ctx.startedAt.toISOString(),
      [...ctx.resolvedImages.values()],
    );
    const manifestDir = resolve(clientAssetRoot(ctx), "manifests");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      resolve(manifestDir, "image-asset-manifest.json"),
      `${JSON.stringify(ctx.imageAssetManifest, null, 2)}\n`,
      "utf-8",
    );
    await ctx.evidenceStore.writeImageAssets(ctx.imageAssetManifest);

    logger.info(
      { generated: generatedSlots.length, spentUsd: Number(budget.spent.toFixed(4)) },
      "Image generation complete",
    );
  }

  private async resolveAsset(
    ctx: BuildContext,
    params: ResolveAssetParams,
  ): Promise<ResolvedImageAsset> {
    const { cacheRoot, slot, fingerprint } = params;
    const metaPath = resolve(cacheRoot, `${fingerprint}.json`);
    const cached = this.readCache(cacheRoot, fingerprint, metaPath);
    const materialized = cached ?? (await this.generateAndCache(params));
    const { bytes, model: usedModel, estimatedCostUsd: cost } = materialized;

    const inspected = inspectImage(bytes);
    const extension = EXTENSION_BY_MIME[inspected.mimeType] ?? "png";
    const absolutePath = resolve(cacheRoot, `${fingerprint}.${extension}`);
    return {
      slotId: slot.id,
      placement: slot.placement,
      source: "generated",
      absolutePath,
      outputFileName: `${slugify(slot.id)}.${extension}`,
      altText: slot.altText ?? params.brief.subject ?? slot.id,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
      byteLength: inspected.byteLength,
      sha256: inspected.sha256,
      promptHash: fingerprint,
      model: usedModel,
      estimatedCostUsd: cost,
      disposition: "approved-client-owned",
      provenanceWarnings: [],
    };
  }

  private async generateAndCache(params: ResolveAssetParams): Promise<CacheMetadata & { bytes: Buffer }> {
    const { generator, budget, cacheRoot, slot, brief, prompt, fingerprint } = params;
    const metaPath = resolve(cacheRoot, `${fingerprint}.json`);
    let result: Awaited<ReturnType<typeof generator.generate>> | undefined;
    try {
      result = await generator.generate({
        prompt,
        aspectRatio: brief.aspectRatio,
        imageSize: brief.imageSize,
      });
    } catch (error) {
      throw new BuildError(
        "CONTENT_GENERATION_FAILED",
        `Image generation failed for slot ${slot.id}: ${String(error)}`,
      );
    }
    const cost = result.estimatedCostUsd ?? 0;
    try {
      budget.charge(cost);
    } catch (error) {
      if (error instanceof ImageBudgetExceededError)
        throw new BuildError("VALIDATION_FAILED", error.message);
      throw error;
    }
    const bytes = result.bytes;
    const mimeType = result.mimeType;
    const usedModel = result.model;
    const extension = EXTENSION_BY_MIME[mimeType] ?? "png";
    writeFileSync(resolve(cacheRoot, `${fingerprint}.${extension}`), bytes);
    const metadata: CacheMetadata = {
      mimeType,
      model: usedModel,
      prompt,
      estimatedCostUsd: cost,
    };
    writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
    return { bytes, mimeType, model: usedModel, estimatedCostUsd: cost, prompt };
  }

  private readCache(
    cacheRoot: string,
    fingerprint: string,
    metaPath: string,
  ): (CacheMetadata & { bytes: Buffer }) | undefined {
    if (!existsSync(metaPath)) return undefined;
    try {
      const metadata = JSON.parse(readFileSync(metaPath, "utf-8")) as CacheMetadata;
      const extension = EXTENSION_BY_MIME[metadata.mimeType] ?? "png";
      const imagePath = resolve(cacheRoot, `${fingerprint}.${extension}`);
      if (!existsSync(imagePath)) return undefined;
      return { ...metadata, bytes: readFileSync(imagePath) };
    } catch {
      return undefined;
    }
  }
}
