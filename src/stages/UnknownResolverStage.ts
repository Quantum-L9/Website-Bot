// L9_META: layer=stage, role=unknown_resolver, stage_index=2, status=active, version=2.0.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:unknown-resolver');
const SAFE_DEFAULTS: Record<string, string> = {
  '{{PHONE_PLACEHOLDER}}': 'Unknown',
  '{{EMAIL_PLACEHOLDER}}': 'Unknown',
  '{{ADDRESS_PLACEHOLDER}}': 'Unknown',
  '{{LICENSE_NUMBER_PLACEHOLDER}}': 'Unknown',
  '{{COLOR_TOKENS_PLACEHOLDER}}': 'pending-design-pass',
  '{{TYPOGRAPHY_PLACEHOLDER}}': 'pending-design-pass',
  '{{SPACING_PLACEHOLDER}}': 'pending-design-pass',
};

export class UnknownResolverStage implements Stage {
  name = 'unknown-resolver';
  version = '2.0.0';

  async run(ctx: BuildContext): Promise<void> {
    const flags = ctx.domainSpec.wom_flags ?? [];
    const errors = flags.filter(flag => flag.severity === 'error');
    if (errors.length > 0) {
      throw new BuildError('UNKNOWN_RESOLUTION_BLOCKED', `${errors.length} error-severity WOM flag(s) require operator resolution: ${errors.map(flag => flag.key).join(', ')}`);
    }
    let resolved = 0;
    for (const flag of flags.filter(flag => flag.severity !== 'error')) {
      const replacement = SAFE_DEFAULTS[flag.value];
      if (replacement) { flag.value = replacement; resolved += 1; }
      else logger.warn({ key: flag.key, value: flag.value }, 'WOM flag has no safe default');
    }
    logger.info({ resolved, total: flags.length }, 'Unknown resolution complete');
  }
}
