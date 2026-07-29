// L9_META: layer=stage, role=unknown_resolver, stage_index=2, status=active, version=2.1.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:unknown-resolver');

// Testing escape hatch. When WEBSITE_BOT_ALLOW_UNRESOLVED_UNKNOWNS=true, error-severity
// WOM flags are downgraded to advisory: they are logged loudly but do NOT block the pipeline.
// Default (unset/anything else) preserves the fail-closed gate. This is intended for local
// testing of downstream stages only — a build produced with unresolved error flags is NOT
// safe to publish (it may lack a verified license, approved disclaimers, or a real form endpoint).
const ADVISORY_ENV = 'WEBSITE_BOT_ALLOW_UNRESOLVED_UNKNOWNS';
const unknownsAreAdvisory = (): boolean => process.env[ADVISORY_ENV] === 'true';
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
  version = '2.1.0';

  async run(ctx: BuildContext): Promise<void> {
    const flags = ctx.domainSpec.wom_flags ?? [];
    const errors = flags.filter(flag => flag.severity === 'error');
    if (errors.length > 0) {
      const keys = errors.map(flag => flag.key).join(', ');
      const message = `${errors.length} error-severity WOM flag(s) require operator resolution: ${keys}`;
      if (!unknownsAreAdvisory()) {
        throw new BuildError('UNKNOWN_RESOLUTION_BLOCKED', message);
      }
      ctx.unresolvedErrorFlags = errors.map(flag => flag.key);
      logger.warn(
        { unresolvedErrorFlags: ctx.unresolvedErrorFlags, advisory: true, gate: ADVISORY_ENV },
        `ADVISORY (${ADVISORY_ENV}=true): ${message}. Proceeding WITHOUT resolution — testing only; the resulting build is NOT safe to publish.`,
      );
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
