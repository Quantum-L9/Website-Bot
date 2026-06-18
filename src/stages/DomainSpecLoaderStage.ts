// L9_META: layer=stage, role=spec_loader, stage_index=1, status=active, version=2.0.0
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext, DomainSpec } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:domain-spec-loader');

export class DomainSpecLoaderStage implements Stage {
  name = 'domain-spec-loader';

  constructor(private readonly specPath: string) {}

  async run(ctx: BuildContext): Promise<void> {
    logger.info({ specPath: this.specPath }, 'Loading domain spec');

    let raw: string;
    try { raw = readFileSync(this.specPath, 'utf-8'); }
    catch (e) { throw new BuildError('SPEC_LOAD_FAILED', `Cannot read spec at ${this.specPath}: ${e}`); }

    let parsed: unknown;
    try { parsed = parse(raw); }
    catch (e) { throw new BuildError('VALIDATION_FAILED', `YAML parse error: ${e}`); }

    // Support both flat format and nested { domain_spec: { ... } } wrapper
    const spec = (
      parsed && typeof parsed === 'object' && 'domain_spec' in parsed
        ? (parsed as Record<string, unknown>).domain_spec
        : parsed
    ) as DomainSpec;

    const required: Array<keyof DomainSpec> = ['client_id', 'business_name', 'vertical', 'geography', 'routes'];
    for (const key of required) {
      if (!spec[key]) throw new BuildError('MISSING_INPUT', `domain_spec.${key} is required but absent`);
    }
    if (!spec.geography.states?.length) {
      throw new BuildError('MISSING_INPUT', 'domain_spec.geography.states must contain at least one state');
    }
    if (!spec.geography.primary_state) {
      throw new BuildError('MISSING_INPUT', 'domain_spec.geography.primary_state is required');
    }
    if (!spec.routes?.length) {
      throw new BuildError('MISSING_INPUT', 'domain_spec.routes must contain at least one route');
    }

    ctx.domainSpec = spec;
    ctx.clientId = spec.client_id;
    logger.info({ clientId: spec.client_id, routes: spec.routes.length, vertical: spec.vertical }, 'Domain spec loaded');
  }
}
