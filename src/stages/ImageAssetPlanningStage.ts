// L9_META: layer=stage, role=image_asset_planner, status=active, version=1.0.0
//
// Decides which source fills each declared image slot and stages the resolved
// images for assembly. Provided images and suitable source-site candidates are
// resolved here; slots that can only be generated are left as plan entries for
// the (downstream) generation stage to fill. The whole stage is a no-op when the
// spec declares no image slots, so text-only builds are unaffected.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { AssetSpec, BuildContext, ImageSlotSpec, ProvidedImageSpec } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { EXTENSION_BY_MIME, inspectImage, type InspectedImage } from '../services/images/ImageInspector.js';
import {
  planImageAssets,
  type ProvidedCandidate,
} from '../services/images/ImageAssetPlanner.js';
import type { IngestedImage } from '../pipeline/evidence/SourceSiteManifest.js';
import {
  buildImageAssetManifest,
  type ReuseDisposition,
  type ResolvedImageAsset,
} from '../pipeline/evidence/ImageAssetManifest.js';
import { unresolvedRequiredSlots } from '../pipeline/evidence/ImageAssetPlan.js';

const logger = createModuleLogger('stage:image-asset-planning');

interface InspectedProvided {
  spec: ProvidedImageSpec;
  absolutePath: string;
  inspected: InspectedImage;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
}

function dispositionForSource(source: ResolvedImageAsset['source']): ReuseDisposition {
  // Operator-supplied and generated assets are client-owned by construction.
  // Source-site reuse is approved for the build but flagged for rights review;
  // PR5 tightens this to a domain-ownership check.
  return 'approved-client-owned';
}

export class ImageAssetPlanningStage implements Stage {
  name = 'image-asset-planning';
  version = '1.0.0';
  evidence = { inputs: (_ctx: BuildContext) => [], outputs: (_ctx: BuildContext) => [], resumable: false, externalMutation: false };

  async run(ctx: BuildContext): Promise<void> {
    const assets = ctx.domainSpec.assets;
    const slots = assets?.imageSlots ?? [];
    if (!assets || slots.length === 0) {
      logger.info('No image slots declared; skipping image asset planning');
      return;
    }

    ctx.resolvedImages ??= new Map();
    const provided = this.inspectProvided(assets, ctx.dryRun);
    const sourceCandidates: IngestedImage[] = ctx.sourceSiteManifest?.images ?? [];
    const generationEnabled = assets.generation?.enabled !== false;

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
        'VALIDATION_FAILED',
        `Required image slots could not be resolved: ${missing.map(asset => asset.slotId).join(', ')}`,
      );
    }

    const stagingRoot = resolve('build', 'assets', ctx.clientId);
    const resolved: ResolvedImageAsset[] = [];
    for (const planned of plan.assets) {
      const slot = slots.find(candidate => candidate.id === planned.slotId);
      if (!slot) continue;
      const resolution = planned.resolution;
      if (resolution.source === 'provided') {
        const match = provided.find(entry => entry.spec.id === resolution.candidateId);
        if (!match) continue;
        resolved.push(this.stageAsset(ctx, stagingRoot, slot, 'provided', match.absolutePath, match.inspected, {
          altText: slot.altText ?? match.spec.altText,
          originalPath: match.absolutePath,
        }));
      } else if (resolution.source === 'source-site') {
        const candidate = sourceCandidates.find(entry => entry.id === resolution.candidateId);
        if (!candidate || !existsSync(candidate.localPath)) continue;
        const inspected = ctx.dryRun
          ? { mimeType: candidate.mimeType, width: candidate.width, height: candidate.height, byteLength: candidate.byteLength, sha256: candidate.sha256 }
          : inspectImage(readFileSync(candidate.localPath));
        resolved.push(this.stageAsset(ctx, stagingRoot, slot, 'source-site', candidate.localPath, inspected, {
          altText: slot.altText ?? candidate.altText,
          sourceUrl: candidate.sourceUrl,
          provenanceWarnings: ['source-site asset reused; verify client ownership before publication'],
        }));
      }
      // 'generated' resolutions are filled by the generation stage; 'unresolved'
      // non-required slots are simply left empty.
    }

    ctx.imageAssetManifest = buildImageAssetManifest(
      ctx.buildId,
      ctx.clientId,
      ctx.startedAt.toISOString(),
      resolved,
    );

    if (!ctx.dryRun) {
      const manifestDir = resolve(stagingRoot, 'manifests');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(resolve(manifestDir, 'image-asset-manifest.json'), `${JSON.stringify(ctx.imageAssetManifest, null, 2)}\n`, 'utf-8');
    }

    logger.info(
      { slots: slots.length, resolved: resolved.length, generated: plan.assets.filter(a => a.resolution.source === 'generated').length },
      'Image asset plan resolved',
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
        throw new BuildError('MISSING_INPUT', `Provided image not found: ${spec.path} (resolved ${absolutePath})`);
      }
      try {
        results.push({ spec, absolutePath, inspected: inspectImage(readFileSync(absolutePath)) });
      } catch (error) {
        throw new BuildError('VALIDATION_FAILED', `Provided image ${spec.id} is not a decodable image: ${String(error)}`);
      }
    }
    return results;
  }

  private stageAsset(
    ctx: BuildContext,
    stagingRoot: string,
    slot: ImageSlotSpec,
    source: ResolvedImageAsset['source'],
    sourcePath: string,
    inspected: InspectedImage,
    extra: { altText?: string; sourceUrl?: string; originalPath?: string; provenanceWarnings?: string[] },
  ): ResolvedImageAsset {
    const extension = EXTENSION_BY_MIME[inspected.mimeType] ?? basename(sourcePath).split('.').pop() ?? 'img';
    const outputFileName = `${slugify(slot.id)}.${extension}`;
    const subdir = source === 'source-site' ? 'source-site' : 'provided';
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
