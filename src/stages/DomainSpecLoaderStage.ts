// L9_META: layer=stage, role=spec_loader, stage_index=1, status=active, version=2.0.0
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import { validateDomainSpec } from '../pipeline/validateDomainSpec.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:domain-spec-loader');

export class DomainSpecLoaderStage implements Stage {
  name = 'domain-spec-loader';

  constructor(private readonly specPath: string) {}

  async run(ctx: BuildContext): Promise<void> {
    logger.info({ specPath: this.specPath }, 'Loading domain spec');

    let raw: string;
    try { raw = readFileSync(this.specPath, 'utf-8'); }
    catch (e) {
      throw new BuildError('SPEC_LOAD_FAILED',
        `Cannot read spec at ${this.specPath}: ${(e as Error).message ?? e}. ` +
        `Pass --spec=<path> to a flat DomainSpec (see fixtures/ci-test-spec.yaml).`);
    }

    let parsed: unknown;
    try { parsed = parse(raw); }
    catch (e) { throw new BuildError('VALIDATION_FAILED', `YAML parse error in ${this.specPath}: ${(e as Error).message ?? e}`); }

    // Validate against the flat DomainSpec contract (precise errors; detects the
    // rich nested authoring format and points at the flat schema / normalizer).
    const spec = validateDomainSpec(parsed, this.specPath);

    ctx.domainSpec = spec;
    ctx.clientId = spec.client_id;
    logger.info({ clientId: spec.client_id, routes: spec.routes.length, vertical: spec.vertical }, 'Domain spec loaded');
  }
}
