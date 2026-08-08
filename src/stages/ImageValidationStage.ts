// L9_META: layer=stage, role=image_validation, stage_index=9, status=active, version=2.0.0
//
// Post-assembly, deterministic image QA. Every image the generated site references
// must exist on disk under a safe /images/ path, every required slot must have been
// resolved and delivered, and the delivered images must agree with the persisted
// image_assets evidence (source parity, digest/dimension integrity). A republished
// source-site image must carry a republishable disposition — no unauthorized
// republication of a crawled asset. Provenance warnings are surfaced onto the build
// context for release evidence, and missing alt text is reported as advisory. A
// no-op when the site declares no images. Never touches the network.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:image-validation');
const SHA256 = /^[a-f0-9]{64}$/;

export class ImageValidationStage implements Stage {
  name = 'image-validation';
  version = '2.0.0';
  evidence = { inputs: (_ctx: BuildContext) => [], outputs: (_ctx: BuildContext) => [], resumable: false, externalMutation: false };

  async run(ctx: BuildContext): Promise<void> {
    const slots = ctx.domainSpec.assets?.imageSlots ?? [];
    const images = ctx.siteConfig?.images ?? {};
    const placements = Object.keys(images);

    // Required slots must be resolved (defense in depth; planning also enforces).
    const unresolvedRequired = (ctx.imageAssetPlan?.assets ?? [])
      .filter(asset => asset.required && asset.resolution.source === 'unresolved')
      .map(asset => asset.slotId);
    if (unresolvedRequired.length > 0) {
      throw new BuildError('VALIDATION_FAILED', `Required image slots unresolved at validation: ${unresolvedRequired.join(', ')}`);
    }

    if (placements.length === 0 && slots.length === 0) {
      logger.info('No site images to validate');
      return;
    }
    if (ctx.dryRun) {
      logger.info({ images: placements.length }, '[dry-run] Would validate image references');
      return;
    }

    const critical: string[] = [];

    // Every required slot must have reached the delivered site config.
    for (const slot of slots) {
      if (slot.required && !images[slot.placement]) critical.push(`required slot not delivered: ${slot.id} (${slot.placement})`);
    }

    // Path hygiene + delivered-file existence.
    for (const [placement, entry] of Object.entries(images)) {
      if (!entry.src.startsWith('/images/') || entry.src.split('/').includes('..')) {
        critical.push(`unsafe delivered path: ${placement} -> ${entry.src}`);
      } else if (!existsSync(join(ctx.outputDir, 'public', entry.src.replace(/^\//, '')))) {
        critical.push(`broken image reference: ${placement} -> ${entry.src}`);
      }
    }

    // Evidence/assembly parity + integrity + republication governance.
    const stored = await ctx.evidenceStore.readImageAssets();
    if (slots.length > 0 && !stored) {
      critical.push('image slots declared but no image_assets evidence was persisted');
    }
    if (stored) {
      const byPlacement = new Map(stored.value.assets.map(asset => [asset.placement, asset]));
      for (const [placement, entry] of Object.entries(images)) {
        const asset = byPlacement.get(placement);
        if (!asset) { critical.push(`delivered image ${placement} has no image_assets evidence`); continue; }
        if (asset.source !== entry.source) critical.push(`source mismatch for ${placement}: evidence ${asset.source} vs site ${entry.source}`);
        if (!SHA256.test(asset.sha256)) critical.push(`invalid digest for ${placement}`);
        if (!(asset.byteLength > 0) || !(asset.width > 0) || !(asset.height > 0)) critical.push(`degenerate image metrics for ${placement}`);
        // A crawled image may only be republished when its disposition clears it.
        if (asset.source === 'source-site' && asset.disposition !== 'approved-client-owned') {
          critical.push(`unauthorized republication of source-site asset ${placement} (disposition=${asset.disposition})`);
        }
      }
    }

    if (critical.length > 0) {
      throw new BuildError('VALIDATION_FAILED', `Image QA found ${critical.length} issue(s): ${critical.join('; ')}`);
    }

    const warnings = (ctx.imageAssetManifest?.assets ?? [])
      .flatMap(asset => asset.provenanceWarnings.map(warning => `${asset.placement}: ${warning}`));
    if (warnings.length > 0) {
      ctx.imageProvenanceWarnings = warnings;
      logger.warn({ warnings }, 'Image provenance warnings surfaced for release evidence');
    }

    const altAdvisories = slots
      .filter(slot => images[slot.placement] && !images[slot.placement].alt?.trim())
      .map(slot => `${slot.placement} has no alt text`);
    if (altAdvisories.length > 0) logger.warn({ altAdvisories }, 'Image alt-text advisories');

    logger.info({ images: placements.length, evidence: Boolean(stored), warnings: warnings.length }, 'Image references validated');
  }
}
