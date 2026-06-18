// L9_META: layer=stage, role=handoff_emitter, stage_index=10, status=active, version=2.0.0
// Assembles and writes website_factory_integration.yaml v2.0.
// Optionally POSTs to SEO-Bot /api/clients/register + calls llm.initClient.
import { writeFileSync } from 'fs';
import { stringify } from 'yaml';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:handoff-emitter');
const OUTPUT_PATH = 'contracts/website_factory_integration.yaml';

export class HandoffEmitterStage implements Stage {
  name = 'handoff-emitter';

  async run(ctx: BuildContext): Promise<void> {
    const deployUrl = ctx.deploymentUrl ?? process.env.DEPLOYMENT_URL;
    if (!deployUrl && !ctx.dryRun) {
      throw new BuildError('HANDOFF_EMIT_FAILED', 'ctx.deploymentUrl is undefined — VercelDeployStage must run before HandoffEmitterStage');
    }

    const contract = {
      schema_version: '2.0.0',
      emitted_at: new Date().toISOString(),
      build_id: ctx.buildId,
      client: {
        id: ctx.clientId,
        business_name: ctx.domainSpec.business_name,
        vertical: ctx.domainSpec.vertical,
        geography: ctx.domainSpec.geography,
      },
      deployment: {
        vercel_url: deployUrl ?? 'dry-run',
        visual_qa_passed: ctx.visualQaPassed,
      },
      seo: {
        baseline_ranks: ctx.baselineRanks ?? {},
        schemas_generated: [...ctx.generatedSchemas.keys()],
        pages_with_content: ctx.domainSpec.routes.map(r => r.slug),
      },
      analytics: {
        posthog_key: process.env.POSTHOG_KEY ?? null,
        events_instrumented: ['cta_click', 'form_submit'],
      },
      stage_results: Object.fromEntries(ctx.stageResults),
    };

    if (!ctx.dryRun) {
      writeFileSync(OUTPUT_PATH, stringify(contract), 'utf-8');
      logger.info({ path: OUTPUT_PATH }, 'Handoff contract written');
    } else {
      logger.info({ path: OUTPUT_PATH }, '[dry-run] Would write handoff contract');
    }

    // ── SEO-Bot registration ────────────────────────────────────────────
    if (ctx.autoRegisterSeoBot && !ctx.dryRun) {
      const seoBotUrl = process.env.SEO_BOT_URL;
      const seoBotKey = process.env.SEO_BOT_API_KEY;
      if (!seoBotUrl || !seoBotKey) {
        logger.warn('SEO_BOT_URL or SEO_BOT_API_KEY not set — skipping SEO-Bot registration');
        return;
      }

      const normalizedUrl = seoBotUrl.replace(/\/+$/, '');
      try {
        const res = await fetch(`${normalizedUrl}/api/clients/register`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${seoBotKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            clientId: ctx.clientId,
            deploymentUrl: deployUrl,
            handoffContract: contract,
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          logger.error({ status: res.status, body: err }, 'SEO-Bot registration failed (non-blocking)');
          return;
        }

        logger.info({ clientId: ctx.clientId, seoBotUrl }, 'SEO-Bot registration successful');
      } catch (e) {
        logger.error({ error: String(e) }, 'SEO-Bot registration network error (non-blocking)');
      }
    }
  }
}
