// L9_META: layer=stage, role=placeholder_gate, stage_index=6, status=active, version=1.0.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import { scanText, type PlaceholderFinding } from '../validation/placeholderPatterns.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:placeholder-scan');

/**
 * PlaceholderScanStage — quality gate between generation and assembly.
 *
 * Scans every generated content section and every generated JSON-LD schema
 * for placeholder text, unrendered template variables, filler copy, test
 * endpoints, and empty structured-data values. Runs after
 * ContentGenerationStage + SchemaGeneratorStage and before
 * SiteAssemblerStage so defects are caught before any file is written.
 *
 * Severity contract:
 *  - `error` findings fail the build with PLACEHOLDER_CONTENT_DETECTED and
 *    a full finding list in the error context (source, pattern, excerpt).
 *  - `warning` findings are logged and preserved but never block.
 */
export class PlaceholderScanStage implements Stage {
  name = 'placeholder-scan';
  version = '1.0.0';
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    resumable: true,
    externalMutation: false,
  };

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) {
      logger.info('[dry-run] Would scan generated content and schemas for placeholder text');
      return;
    }
    const findings = this.collectFindings(ctx);
    const errors = findings.filter(finding => finding.severity === 'error');
    const warnings = findings.filter(finding => finding.severity === 'warning');

    for (const warning of warnings) {
      logger.warn(
        { source: warning.source, pattern: warning.patternId, match: warning.match },
        `Placeholder warning: ${warning.description}`,
      );
    }

    if (errors.length > 0) {
      const summary = errors
        .map(finding => `${finding.source} → ${finding.patternId} ("${finding.match}")`)
        .join('; ');
      throw new BuildError(
        'PLACEHOLDER_CONTENT_DETECTED',
        `Generated output contains ${errors.length} placeholder defect(s): ${summary}`,
        false,
        { findings: errors },
      );
    }

    logger.info(
      { sections: ctx.generatedContent.size, schemas: ctx.generatedSchemas.size, warnings: warnings.length },
      'Placeholder scan passed',
    );
  }

  private collectFindings(ctx: BuildContext): PlaceholderFinding[] {
    const findings: PlaceholderFinding[] = [];
    for (const [key, content] of ctx.generatedContent) {
      findings.push(...scanText(`content:${key}`, content));
    }
    for (const [name, schema] of ctx.generatedSchemas) {
      findings.push(...scanText(`schema:${name}`, JSON.stringify(schema)));
    }
    return findings;
  }
}
