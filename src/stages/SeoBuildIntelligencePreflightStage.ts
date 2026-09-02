// L9_META: layer=stage, role=seo_build_intelligence_preflight, status=active, version=1.0.0
//
// Campaign 7: the machine-authenticated SEO-Bot readiness proof is a TOPOLOGY
// invariant, not a courtesy call inside whichever stage happens to need it
// first. It runs before competitive-intelligence — the first stage that spends
// money against SEO-Bot — and persists its snapshot on the BuildContext so
// downstream stages can prove the proof exists instead of repeating it.

import { createModuleLogger } from "../core/logger.js";
import { SeoBuildIntelligenceHttpClient } from "../intelligence/SeoBuildIntelligenceHttpClient.js";
import {
  SeoBotPreflightError,
  type SeoBuildIntelligencePort,
} from "../intelligence/SeoBuildIntelligencePort.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:seo-build-intelligence-preflight");

export class SeoBuildIntelligencePreflightStage implements Stage {
  name = "seo-build-intelligence-preflight";
  version = "1.0.0";
  evidence = {
    inputs: (_ctx: BuildContext) => [],
    outputs: (_ctx: BuildContext) => [],
    resumable: false,
    externalMutation: false,
  };

  constructor(
    private readonly portFactory: (ctx: BuildContext) => SeoBuildIntelligencePort = defaultPort,
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      logger.info({ intent: ctx.buildIntent }, "not a redesign build; preflight not required");
      return;
    }

    // Plan mode documents "no generated files, runtime evidence files, or
    // external mutations" — but redesign intelligence is inherently live:
    // paid SERP evidence, donor crawls, and real LLM work, and the downstream
    // redesign stages fail closed without real artifacts. Failing closed here
    // makes that contract explicit instead of silently spending money during
    // what the operator asked to be a dry-run.
    if (ctx.dryRun) {
      throw new BuildError(
        "PLAN_MODE_UNSUPPORTED_FOR_REDESIGN",
        "REDESIGN_IMPROVE has no network-free plan mode: competitive intelligence and content authority require live SEO-Bot and donor evidence. Run --mode=local-proof or higher.",
      );
    }

    // Fails closed with a mapped SEO_BOT_* BuildError code BEFORE the first
    // paid build-intelligence call (createCompetitiveLandscape) can be made.
    try {
      ctx.seoBuildIntelligencePreflight = await this.portFactory(ctx).preflight();
    } catch (error) {
      if (error instanceof SeoBotPreflightError) {
        throw new BuildError(error.code, `REDESIGN preflight failed: ${error.message}`);
      }
      throw error;
    }

    logger.info({ clientId: ctx.clientId }, "SEO-Bot build-intelligence preflight passed");
  }
}

function defaultPort(_ctx: BuildContext): SeoBuildIntelligencePort {
  const url = process.env.SEO_BOT_URL?.trim();
  const key = process.env.SEO_BOT_API_KEY?.trim();

  if (!url) {
    throw new SeoBotPreflightError(
      "SEO_BOT_UNREACHABLE",
      "SEO_BOT_URL is required before REDESIGN build intelligence",
    );
  }

  if (!key) {
    throw new SeoBotPreflightError(
      "SEO_BOT_AUTH_FAILED",
      "SEO_BOT_API_KEY is required before REDESIGN build intelligence",
    );
  }

  return new SeoBuildIntelligenceHttpClient(url, key);
}
