// L9_META: layer=test, role=seo_build_intelligence_preflight, status=active, version=1.0.0
//
// The readiness proof is a topology invariant: it must run as its own stage
// before the first PAID SEO-Bot call, and the stages that spend money must
// fail closed when its evidence is absent.

import assert from "node:assert/strict";
import test from "node:test";
import {
  SeoBotPreflightError,
  type SeoBotPreflightResult,
  type SeoBuildIntelligencePort,
} from "../../src/intelligence/SeoBuildIntelligencePort.js";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { CompetitiveIntelligenceStage } from "../../src/stages/CompetitiveIntelligenceStage.js";
import { SeoBuildIntelligencePreflightStage } from "../../src/stages/SeoBuildIntelligencePreflightStage.js";

function makePreflightSnapshot(): SeoBotPreflightResult {
  return {
    status: "ready",
    service: "SEO-Bot",
    version: "2.1.0",
    bot_interop_version: "1.1.0",
    llm_router_version: "1.3.0",
    capabilities: {
      competitive_landscape: true,
      seo_content_blueprint: true,
      structured_content: true,
    },
    configuration: { dataforseo_configured: true, llm_provider_configured: true },
  };
}

function makeCtx(overrides?: Partial<BuildContext>): BuildContext {
  return {
    buildId: "build-preflight",
    clientId: "client-preflight",
    dryRun: false,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    domainSpec: {
      client_id: "client-preflight",
      business_name: "Test Biz",
      vertical: "test_service",
      geography: { states: ["TN"], primary_state: "TN" },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
      seo_contract: { site_url: "test.example.com", target_keywords: ["scrap metal"] },
    },
    stageResults: new Map(),
    ...overrides,
  } as unknown as BuildContext;
}

class PreflightOnlyPort implements SeoBuildIntelligencePort {
  calls: string[] = [];
  constructor(
    private readonly impl: () => Promise<SeoBotPreflightResult> = async () =>
      makePreflightSnapshot(),
  ) {}
  async preflight(): Promise<SeoBotPreflightResult> {
    this.calls.push("preflight");
    return this.impl();
  }
  async createCompetitiveLandscape(): Promise<never> {
    this.calls.push("createCompetitiveLandscape");
    throw new Error("createCompetitiveLandscape must not be reached in this test");
  }
  async createSEOContentBlueprint(): Promise<never> {
    this.calls.push("createSEOContentBlueprint");
    throw new Error("createSEOContentBlueprint must not be reached in this test");
  }
  async createStructuredContent(): Promise<never> {
    this.calls.push("createStructuredContent");
    throw new Error("createStructuredContent must not be reached in this test");
  }
}

void test("a successful preflight persists its readiness snapshot on the context", async () => {
  const ctx = makeCtx();
  const port = new PreflightOnlyPort();
  await new SeoBuildIntelligencePreflightStage(() => port).run(ctx);
  assert.deepEqual(port.calls, ["preflight"]);
  assert.equal(ctx.seoBuildIntelligencePreflight?.status, "ready");
  assert.equal(ctx.seoBuildIntelligencePreflight?.capabilities.competitive_landscape, true);
});

void test("COPY builds skip the preflight and record no evidence", async () => {
  const ctx = makeCtx({ buildIntent: "COPY" });
  const port = new PreflightOnlyPort();
  await new SeoBuildIntelligencePreflightStage(() => port).run(ctx);
  assert.deepEqual(port.calls, []);
  assert.equal(ctx.seoBuildIntelligencePreflight, undefined);
});

void test("plan mode fails closed on REDESIGN_IMPROVE before any SEO-Bot contact", async () => {
  const ctx = makeCtx({ dryRun: true });
  const port = new PreflightOnlyPort();
  await assert.rejects(
    () => new SeoBuildIntelligencePreflightStage(() => port).run(ctx),
    (error: unknown) =>
      error instanceof BuildError && error.code === "PLAN_MODE_UNSUPPORTED_FOR_REDESIGN",
  );
  assert.deepEqual(port.calls, [], "plan mode must not touch SEO-Bot");
});

for (const code of [
  "SEO_BOT_UNREACHABLE",
  "SEO_BOT_AUTH_FAILED",
  "SEO_BOT_CAPABILITY_MISMATCH",
  "SEO_BOT_ROUTER_VERSION_MISMATCH",
] as const) {
  void test(`preflight failure ${code} fails the build closed with that code`, async () => {
    const ctx = makeCtx();
    const port = new PreflightOnlyPort(async () => {
      throw new SeoBotPreflightError(code, `simulated ${code}`);
    });
    const stage = new SeoBuildIntelligencePreflightStage(() => port);
    await assert.rejects(
      () => stage.run(ctx),
      (error: unknown) => error instanceof BuildError && error.code === code,
    );
    assert.equal(ctx.seoBuildIntelligencePreflight, undefined);
  });
}

void test("competitive intelligence never makes a paid call without preflight evidence", async () => {
  const previousUrl = process.env.SEO_BOT_URL;
  const previousKey = process.env.SEO_BOT_API_KEY;
  // Credentials present: the ONLY thing missing is the preflight proof, so a
  // pass here would mean the bypass is real, not an env-var accident.
  process.env.SEO_BOT_URL = "https://seo-bot.example.com";
  process.env.SEO_BOT_API_KEY = "test-key";
  try {
    const ctx = makeCtx();
    const port = new PreflightOnlyPort();
    const stage = new CompetitiveIntelligenceStage(() => port);
    await assert.rejects(
      () => stage.run(ctx),
      (error: unknown) =>
        error instanceof BuildError && error.code === "REDESIGN_PIPELINE_INCOMPLETE",
    );
    assert.deepEqual(port.calls, [], "no SEO-Bot call may be made without preflight evidence");
  } finally {
    if (previousUrl === undefined) delete process.env.SEO_BOT_URL;
    else process.env.SEO_BOT_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SEO_BOT_API_KEY;
    else process.env.SEO_BOT_API_KEY = previousKey;
  }
});
