// L9_META: layer=test, role=palette_non_authority, status=active, version=1.0.0
//
// WBV2-007 at the stage level: the behavior change, not just the pure function.
//
// Before ADR-0018, DesignIntelligenceStage read sourceSiteManifest.palette and
// wrote those exact values into designTokens for EVERY build intent. A redesign
// that inherits the source site's colors is a recolored copy. These tests pin
// the new behavior on both sides of the intent boundary.
import assert from "node:assert/strict";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { DesignIntelligenceStage } from "../../src/stages/DesignIntelligenceStage.js";
import { makeLandscape, makeWebsiteBlueprint } from "./redesign-fixtures.js";

const SOURCE_PALETTE = {
  primary: "#0b5fff",
  secondary: "#334455",
  accent: "#0b5fff",
  background: "#0b0b0b",
  text: "#f5f5f5",
};

function makeCtx(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    buildId: "palette-test-build",
    clientId: "palette-test-client",
    dryRun: false,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    domainSpec: {
      client_id: "palette-test-client",
      business_name: "Test Biz",
      vertical: "roofing",
      geography: { states: ["NC"], primary_state: "NC" },
      design: { status: "pending" },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
    },
    sourceSiteManifest: { palette: { ...SOURCE_PALETTE } },
    llm: {
      async designReasoning() {
        return JSON.stringify({
          primary: "#7a2f1d",
          secondary: "#2b2b2b",
          accent: "#c96f4a",
          background: "#faf7f2",
          text: "#1a1a1a",
          font_heading: "Inter",
          font_body: "Inter",
        });
      },
    },
    ...overrides,
  } as unknown as BuildContext;
}

function blueprintWithPalette(authority: {
  source: "none" | "client_vision" | "first_party_design_spec";
  tokens: Record<string, string>;
}) {
  const landscape = makeLandscape();
  const base = makeWebsiteBlueprint(landscape);
  return {
    ...base,
    payload: {
      ...base.payload,
      design_direction: {
        ...base.payload.design_direction,
        palette_authority: {
          source: authority.source,
          tokens: authority.tokens,
          observed_characteristics: ["dark-dominant", "high-contrast"],
        },
      },
    },
  } as typeof base;
}

void test("WBV2-007: a REDESIGN does NOT inherit the source-site palette", async () => {
  const ctx = makeCtx({
    websiteBlueprint: blueprintWithPalette({ source: "none", tokens: {} }),
  });
  await new DesignIntelligenceStage().run(ctx);

  // The regression this test exists for: every observed source color must be
  // absent from the resolved theme.
  const resolved = Object.values(ctx.designTokens ?? {}).map((value) => value.toLowerCase());
  for (const [key, observed] of Object.entries(SOURCE_PALETTE)) {
    assert.ok(
      !resolved.includes(observed.toLowerCase()),
      `source ${key} ${observed} must not become a redesign token`,
    );
  }
  assert.ok(ctx.designTokens?.primary, "a redesign still resolves a full token set");
});

void test("WBV2-007: explicit client palette intent IS honored under REDESIGN", async () => {
  const ctx = makeCtx({
    websiteBlueprint: blueprintWithPalette({
      source: "client_vision",
      tokens: { primary: "#7a2f1d", secondary: "#2b2b2b", accent: "#c96f4a" },
    }),
  });
  await new DesignIntelligenceStage().run(ctx);
  assert.equal(ctx.designTokens?.primary, "#7a2f1d");
  assert.equal(ctx.designTokens?.accent, "#c96f4a");
  assert.notEqual(ctx.designTokens?.primary, SOURCE_PALETTE.primary);
});

void test("WBV2-007: a first-party design spec IS honored under REDESIGN", async () => {
  const ctx = makeCtx({
    websiteBlueprint: blueprintWithPalette({
      source: "first_party_design_spec",
      tokens: { primary: "#111111", secondary: "#222222", accent: "#333333" },
    }),
  });
  await new DesignIntelligenceStage().run(ctx);
  assert.equal(ctx.designTokens?.primary, "#111111");
});

void test("WBV2-020: a REDESIGN without the sealed blueprint fails closed", async () => {
  const ctx = makeCtx({ websiteBlueprint: undefined });
  await assert.rejects(
    () => new DesignIntelligenceStage().run(ctx),
    (error: unknown) => {
      const failure = error as { code?: string; message?: string };
      assert.equal(failure.code, "DESIGN_REASONING_FAILED");
      assert.match(String(failure.message), /sealed WebsiteBuildBlueprint/);
      return true;
    },
  );
});

void test("COPY reconstruction still preserves the source palette exactly", async () => {
  // Palette non-authority is a REDESIGN invariant. Under COPY, faithful
  // reconstruction is the declared contract and inheriting the palette is
  // correct — ADR-0018 §6.
  const ctx = makeCtx({ buildIntent: "COPY", websiteBlueprint: undefined });
  await new DesignIntelligenceStage().run(ctx);
  assert.equal(ctx.designTokens?.primary, SOURCE_PALETTE.primary);
  assert.equal(ctx.designTokens?.background, SOURCE_PALETTE.background);
  assert.equal(ctx.designTokens?.text, SOURCE_PALETTE.text);
});

void test("COPY behavior is unchanged when no source palette was crawled", async () => {
  const ctx = makeCtx({
    buildIntent: "COPY",
    websiteBlueprint: undefined,
    sourceSiteManifest: undefined,
  });
  await new DesignIntelligenceStage().run(ctx);
  // Falls through to generation, exactly as before this migration.
  assert.equal(ctx.designTokens?.primary, "#7a2f1d");
});
