// L9_META: layer=stage, role=unknown_resolver, stage_index=2, status=active, version=2.0.0
// Resolves WOM placeholder flags from domain_spec before content generation.
// Blocks on severity=error flags. Applies safe defaults to warning flags.
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:unknown-resolver');

// Template-level WOM placeholder tokens and their safe defaults
const SAFE_DEFAULTS: Record<string, string> = {
  '{{PHONE_PLACEHOLDER}}':                    'Unknown',
  '{{EMAIL_PLACEHOLDER}}':                    'Unknown',
  '{{ADDRESS_PLACEHOLDER}}':                  'Unknown',
  '{{LICENSE_NUMBER_PLACEHOLDER}}':           'Unknown',
  '{{COLOR_TOKENS_PLACEHOLDER}}':             'pending-design-pass',
  '{{TYPOGRAPHY_PLACEHOLDER}}':               'pending-design-pass',
  '{{SPACING_PLACEHOLDER}}':                  'pending-design-pass',
  '{{PUBLIC_ADJUSTER_DISCLAIMER_PLACEHOLDER}}': 'Disclaimer pending legal review.',
  '{{NO_GUARANTEE_DISCLAIMER_PLACEHOLDER}}':  'No guarantee of claim outcome or carrier approval.',
  '{{NOT_LEGAL_ADVICE_PLACEHOLDER}}':         'This is not legal advice.',
};

interface WomFlag {
  key: string;
  value: string;
  severity: 'error' | 'warning' | 'info';
}

export class UnknownResolverStage implements Stage {
  name = 'unknown-resolver';

  async run(ctx: BuildContext): Promise<void> {
    const flags = (ctx.domainSpec as unknown as { wom_flags?: WomFlag[] }).wom_flags ?? [];
    if (!flags.length) {
      logger.info('No WOM flags found — skipping');
      return;
    }

    const errorFlags = flags.filter(f => f.severity === 'error');
    if (errorFlags.length) {
      throw new BuildError(
        'UNKNOWN_RESOLUTION_BLOCKED',
        `${errorFlags.length} error-severity WOM flag(s) must be resolved before build: ${errorFlags.map(f => f.key).join(', ')}`,
      );
    }

    let resolved = 0;
    for (const flag of flags.filter(f => f.severity !== 'error')) {
      const def = SAFE_DEFAULTS[flag.value];
      if (def) {
        flag.value = def;
        resolved++;
        logger.debug({ key: flag.key, resolvedTo: def }, 'WOM flag resolved to safe default');
      } else {
        logger.warn({ key: flag.key, value: flag.value }, 'WOM flag has no safe default — leaving as-is');
      }
    }

    logger.info({ resolved, total: flags.length }, 'Unknown resolution complete');
  }
}
