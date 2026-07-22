// L9_META: layer=stage, role=spec_loader, stage_index=1, status=active, version=2.1.0
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { validateDomainSpec } from '../pipeline/validateDomainSpec.js';

const logger = createModuleLogger('stage:domain-spec-loader');

export class DomainSpecLoaderStage implements Stage {
  name = 'domain-spec-loader';
  version = '2.1.0';

  constructor(private readonly specPath: string) {}

  async run(ctx: BuildContext): Promise<void> {
    logger.info({ specPath: this.specPath }, 'Loading domain spec');
    let raw: string;
    try { raw = readFileSync(this.specPath, 'utf-8'); }
    catch (error) {
      throw new BuildError('SPEC_LOAD_FAILED', `Cannot read spec at ${this.specPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let parsed: unknown;
    try { parsed = parse(raw); }
    catch (error) { throw new BuildError('VALIDATION_FAILED', `YAML parse error in ${this.specPath}: ${error instanceof Error ? error.message : String(error)}`); }
    const spec = validateDomainSpec(parsed, this.specPath);
    if (ctx.clientId && ctx.clientId !== spec.client_id) {
      throw new BuildError('EVIDENCE_IDENTITY_MISMATCH', `BuildContext clientId (${ctx.clientId}) differs from DomainSpec (${spec.client_id})`);
    }
    ctx.domainSpec = spec;
    ctx.clientId = spec.client_id;
    logger.info({ clientId: spec.client_id, routes: spec.routes.length, vertical: spec.vertical }, 'Domain spec loaded');
  }
}
