// L9_META: layer=stage, role=image_validation, stage_index=9, status=active, version=1.0.0
//
// Post-assembly image QA: every image the generated site references must exist
// on disk, and every required slot must have been resolved. Provenance warnings
// (e.g. reused source-site assets pending rights review) are surfaced onto the
// build context for release evidence. A no-op when the site has no images.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:image-validation');

export class ImageValidationStage implements Stage {
  name = 'image-validation';
  version = '1.0.0';
  evidence = { inputs: (_ctx: BuildContext) => [], outputs: (_ctx: BuildContext) => [], resumable: false, externalMutation: false };

  async run(ctx: BuildContext): Promise<void> {
    const images = ctx.siteConfig?.images ?? {};
    const placements = Object.keys(images);

    // Required slots must be resolved (defense in depth; planning also enforces).
    const unresolvedRequired = (ctx.imageAssetPlan?.assets ?? [])
      .filter(asset => asset.required && asset.resolution.source === 'unresolved')
      .map(asset => asset.slotId);
    if (unresolvedRequired.length > 0) {
      throw new BuildError('VALIDATION_FAILED', `Required image slots unresolved at validation: ${unresolvedRequired.join(', ')}`);
    }

    if (placements.length === 0) {
      logger.info('No site images to validate');
      return;
    }
    if (ctx.dryRun) {
      logger.info({ images: placements.length }, '[dry-run] Would validate image references');
      return;
    }

    const missing: string[] = [];
    for (const [placement, entry] of Object.entries(images)) {
      const relative = entry.src.replace(/^\//, '');
      if (!existsSync(join(ctx.outputDir, 'public', relative))) missing.push(`${placement} -> ${entry.src}`);
    }
    if (missing.length > 0) {
      throw new BuildError('VALIDATION_FAILED', `Broken image references in generated site: ${missing.join(', ')}`);
    }

    const warnings = (ctx.imageAssetManifest?.assets ?? [])
      .flatMap(asset => asset.provenanceWarnings.map(warning => `${asset.placement}: ${warning}`));
    if (warnings.length > 0) {
      ctx.imageProvenanceWarnings = warnings;
      logger.warn({ warnings }, 'Image provenance warnings surfaced for release evidence');
    }

    logger.info({ images: placements.length, warnings: warnings.length }, 'Image references validated');
  }
}
