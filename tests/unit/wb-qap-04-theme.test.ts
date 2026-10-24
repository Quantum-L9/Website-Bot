// L9_META: layer=test, role=design_direction_layout_tokens, status=active, version=1.0.0
//
// WB-QAP-04: approved design direction controls typography, spacing, width,
// radius and surfaces through derived designTokens, without becoming a second
// palette authority and without changing unconfigured or legacy sites.
// The dark/violet values below are synthetic test fixtures, not QAP brand values.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import {
  DesignIntelligenceStage,
  deriveLayoutTokens,
  deriveOnPrimaryToken,
} from "../../src/stages/DesignIntelligenceStage.js";
import { makeLandscape, makeWebsiteBlueprint } from "./redesign-fixtures.js";

const DARK_VIOLET = {
  primary: "#7c5cff",
  secondary: "#1a1626",
  accent: "#a78bfa",
  background: "#0d0b14",
  text: "#ece9f5",
};
const OLD_CYAN = {
  primary: "#00c2ff",
  secondary: "#0a2a33",
  accent: "#00e5ff",
  background: "#04161c",
  text: "#e6fbff",
};
const LIGHT_ROOFING = {
  primary: "#1a365d",
  secondary: "#2b6cb0",
  accent: "#1a365d",
  background: "#ffffff",
  text: "#17212b",
};
const LLM_TOKENS = {
  primary: "#3b2f8f",
  secondary: "#221c3d",
  accent: "#8f7cff",
  background: "#0f0d17",
  text: "#f2f0fa",
  font_heading: "Inter",
  font_body: "Inter",
};

function redesignCtx(
  authority: { source: "none" | "client_vision"; tokens: Record<string, string> },
  direction: { principles?: string[]; desired?: string[]; rejected?: string[] },
  prompts: string[] = [],
): BuildContext {
  const base = makeWebsiteBlueprint(makeLandscape());
  const websiteBlueprint = {
    ...base,
    payload: {
      ...base.payload,
      design_direction: {
        ...base.payload.design_direction,
        principles: direction.principles ?? [],
        desired_attributes: direction.desired ?? [],
        rejected_attributes: direction.rejected ?? [],
        palette_authority: {
          ...authority,
          observed_characteristics: ["cyan-accented", "dark-dominant"],
        },
      },
    },
  };
  return {
    buildId: "wb-qap-04-build",
    clientId: "wb-qap-04-client",
    dryRun: false,
    mode: "local-proof",
    buildIntent: "REDESIGN_IMPROVE",
    domainSpec: {
      client_id: "wb-qap-04-client",
      business_name: "Fixture Studio",
      vertical: "ai_consulting",
      geography: { states: ["XX"], primary_state: "XX" },
      design: { status: "pending" },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
    },
    // A donor/source palette observed on the old site: never an authority here.
    sourceSiteManifest: { palette: { ...OLD_CYAN } },
    websiteBlueprint,
    llm: {
      async designReasoning(prompt: string) {
        prompts.push(prompt);
        return JSON.stringify(LLM_TOKENS);
      },
    },
  } as unknown as BuildContext;
}

function roofingCtx(): BuildContext {
  return {
    buildId: "wb-qap-04-roofing",
    clientId: "roofing-client",
    dryRun: false,
    mode: "local-proof",
    buildIntent: "COPY",
    domainSpec: {
      client_id: "roofing-client",
      business_name: "Roofing Co",
      vertical: "roofing",
      geography: { states: ["XX"], primary_state: "XX" },
      design: {
        status: "resolved",
        palette: { ...LIGHT_ROOFING },
        fonts: { heading: "Inter", body: "Inter" },
      },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
    },
    llm: {
      designReasoning: async () => assert.fail("a resolved legacy palette must not call the LLM"),
    },
  } as unknown as BuildContext;
}

const layoutKeys = (tokens: Record<string, string> | undefined) =>
  Object.keys(tokens ?? {}).filter((key) => key.startsWith("layout_"));
const QAP_DIRECTION = {
  principles: ["Editorial clarity over decoration"],
  desired: ["spacious", "precise", "layered depth", "cinematic"],
};

void test("approved direction changes typography, spacing, width, radius and surfaces, not only colour", () => {
  const tokens = deriveLayoutTokens([...QAP_DIRECTION.principles, ...QAP_DIRECTION.desired]);
  assert.deepEqual(tokens, {
    layout_fs_h1: "clamp(2.273rem, 3.947vw, 3.157rem)",
    layout_fs_h2: "clamp(1.705rem, 2.961vw, 2.369rem)",
    layout_fs_h3: "clamp(1.279rem, 2.221vw, 1.777rem)",
    layout_type_scale: "1.333",
    layout_section_space: "3.75rem",
    layout_flow_gap: "1.875rem",
    layout_content_width: "1240px",
    layout_radius: "0.25rem",
    layout_surface: "layered",
  });
});

void test("unmatched, conflicting or rejected evidence derives no layout token", () => {
  assert.deepEqual(deriveLayoutTokens(["trustworthy", "local"]), {});
  // Spacious and compact both claimed: the space group has no single answer.
  assert.deepEqual(layoutKeys(deriveLayoutTokens(["spacious", "compact"])), []);
  // A rejected attribute vetoes its preset.
  assert.deepEqual(deriveLayoutTokens(["bold layout"], ["bold"]), {});
  assert.equal(
    deriveLayoutTokens(["spacious", "compact"], ["compact"]).layout_section_space,
    "3.75rem",
  );
});

void test("dark/violet client palette authority is kept exactly and never recoloured from the old cyan site", async () => {
  const ctx = redesignCtx({ source: "client_vision", tokens: { ...DARK_VIOLET } }, QAP_DIRECTION);
  await new DesignIntelligenceStage().run(ctx);
  for (const [key, value] of Object.entries(DARK_VIOLET))
    assert.equal(ctx.designTokens?.[key], value);
  const serialized = JSON.stringify(ctx.designTokens).toLowerCase();
  for (const cyan of Object.values(OLD_CYAN))
    assert.ok(!serialized.includes(cyan), `${cyan} leaked`);
  assert.equal(ctx.designTokens?.layout_surface, "layered");
  assert.equal(ctx.designTokens?.layout_content_width, "1240px");
});

void test("negative control: an unspecified client palette does not inherit the donor palette", async () => {
  const prompts: string[] = [];
  const ctx = redesignCtx({ source: "none", tokens: {} }, QAP_DIRECTION, prompts);
  await new DesignIntelligenceStage().run(ctx);
  for (const key of ["primary", "secondary", "accent", "background", "text"])
    assert.equal(ctx.designTokens?.[key], LLM_TOKENS[key as keyof typeof LLM_TOKENS]);
  // The donor's concrete values never reach the model, nor the resolved tokens.
  for (const cyan of Object.values(OLD_CYAN)) {
    assert.ok(!prompts.join(" ").toLowerCase().includes(cyan), `${cyan} reached the prompt`);
    assert.ok(!JSON.stringify(ctx.designTokens).toLowerCase().includes(cyan), `${cyan} leaked`);
  }
  // Layout direction is still derived from the sealed direction, not the observation.
  assert.equal(ctx.designTokens?.layout_type_scale, "1.333");
});

void test("negative control: the dark theme never leaks into the legacy light roofing fixture", async () => {
  const stage = new DesignIntelligenceStage();
  await stage.run(
    redesignCtx({ source: "client_vision", tokens: { ...DARK_VIOLET } }, QAP_DIRECTION),
  );
  const roofing = roofingCtx();
  await stage.run(roofing);
  for (const [key, value] of Object.entries(LIGHT_ROOFING))
    assert.equal(roofing.designTokens?.[key], value);
  assert.deepEqual(layoutKeys(roofing.designTokens), []);
  for (const violet of Object.values(DARK_VIOLET))
    assert.ok(
      !JSON.stringify(roofing.designTokens).toLowerCase().includes(violet),
      `${violet} leaked`,
    );
});

void test("COPY builds read only the client's own first-party vision for layout direction", async () => {
  const ctx = roofingCtx();
  ctx.domainSpec.client_vision = {
    brand_attributes: ["friendly"],
    visual_preferences: ["airy layouts"],
  };
  await new DesignIntelligenceStage().run(ctx);
  assert.equal(ctx.designTokens?.layout_radius, "1rem");
  assert.equal(ctx.designTokens?.layout_section_space, "3.75rem");
  assert.equal(ctx.designTokens?.primary, LIGHT_ROOFING.primary);
});

void test("the template applies layout tokens only behind opt-in gates and honours reduced motion", () => {
  const css = readFileSync(resolve("astro_template/src/styles/global.css"), "utf8");
  const layout = readFileSync(resolve("astro_template/src/layouts/BaseLayout.astro"), "utf8");
  const tail = css.slice(css.indexOf("Design-direction layout tokens (WB-QAP-04)"));
  // Every new rule that uses a layout variable sits behind its data-design group.
  for (const variable of [
    "--content-width",
    "--section-space",
    "--flow-gap",
    "--fs-h1",
    "--radius",
  ]) {
    assert.ok(tail.includes(`var(${variable})`), variable);
    assert.ok(
      !css.slice(0, css.indexOf("Design-direction layout tokens")).includes(`var(${variable})`),
    );
  }
  for (const group of ["width", "space", "type", "radius", "surface"])
    assert.match(tail, new RegExp(`:where\\(:root\\[data-design~="${group}"\\]\\)`));
  // Reduced motion removes the template's only transition, without !important.
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.service-card \{ transition: none; \}\s*\.service-card:hover \{ transform: none; \}\s*\}/,
  );
  assert.doesNotMatch(css, /!important\s*[;}]/);
  // Every transition the template declares is one the reduced-motion block covers.
  assert.deepEqual(
    [...css.matchAll(/^\s*([^{}]+)\{[^}]*\btransition:(?! none)/gm)].map((match) =>
      match[1].trim(),
    ),
    [".service-card"],
  );
  // An unconfigured site renders <html lang="en"> with no attribute or inline style.
  assert.match(
    layout,
    /<html lang="en" data-design=\{designGroups\.join\(" "\) \|\| undefined\} style=\{designVars\.join\(";"\) \|\| undefined\}>/,
  );
  assert.match(layout, /const SAFE_CSS_VALUE = \/\^\[#a-z0-9\.,\(\)% \+-\]\+\$\/i;/);
});

void test("a dark foreground is derived only where white text on the primary fails WCAG AA", async () => {
  // White on the violet fixture is ~4.35:1 (< 4.5); black is ~4.8:1.
  assert.deepEqual(deriveOnPrimaryToken(DARK_VIOLET.primary), { layout_on_primary: "#000000" });
  // White on the legacy navy passes, so legacy buttons keep their rendering.
  assert.deepEqual(deriveOnPrimaryToken(LIGHT_ROOFING.primary), {});
  assert.deepEqual(deriveOnPrimaryToken("rebeccapurple"), {});
  const ctx = redesignCtx({ source: "client_vision", tokens: { ...DARK_VIOLET } }, QAP_DIRECTION);
  await new DesignIntelligenceStage().run(ctx);
  assert.equal(ctx.designTokens?.layout_on_primary, "#000000");
});

void test("hero, prose and lead-form link colouring no longer overrides button text", () => {
  const css = readFileSync(resolve("astro_template/src/styles/global.css"), "utf8");
  assert.doesNotMatch(css, /\.hero__content a \{ color: var\(--color-primary\); \}/);
  assert.match(
    css,
    /:is\(\.prose, \.lead-form, \.hero__content\) a:not\(\.btn\) \{ color: var\(--color-primary\); \}/,
  );
  assert.match(css, /:where\(:root\[data-design~="contrast"\]\)/);
});

void test("every colour format the palette accepts is parsed before choosing the on-primary foreground", () => {
  // Light yellow primary in each accepted format: white fails AA, so a dark foreground is derived.
  for (const yellow of [
    "yellow",
    "#ff0",
    "#ffff00",
    "#ffff00ff",
    "rgb(255, 255, 0)",
    "rgb(255 255 0)",
    "rgba(255,255,0,1)",
    "rgb(100%, 100%, 0%)",
    "hsl(60, 100%, 50%)",
    "hsla(60 100% 50% / 1)",
  ])
    assert.deepEqual(deriveOnPrimaryToken(yellow), { layout_on_primary: "#000000" }, yellow);
  // Dark primaries keep white text in every format.
  for (const dark of ["navy", "#1a365d", "rgb(26, 54, 93)", "hsl(215, 56%, 23%)", "rebeccapurple"])
    assert.deepEqual(deriveOnPrimaryToken(dark), {}, dark);
  // A translucent primary depends on what lies beneath it: no guess is made.
  for (const translucent of ["rgba(255,255,0,0.5)", "#ffff0080", "#ff08", "transparent"])
    assert.deepEqual(deriveOnPrimaryToken(translucent), {}, translucent);
});
