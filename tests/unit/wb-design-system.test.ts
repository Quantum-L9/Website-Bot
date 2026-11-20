// L9_META: layer=test, role=design_system_tokens, status=active, version=1.0.0
//
// Design system v2 (lane wb-design-system): self-hosted fonts bound to a
// catalog, WCAG AA colour roles derived from any palette, and a deterministic
// mapping from approved design direction to section variants and scale.
// Palettes below are synthetic test fixtures, not client brand values.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  FONT_CATALOG,
  findCatalogFont,
  fontFaceCss,
} from "../../astro_template/src/styles/fontCatalog.js";
import {
  SECTION_VARIANT_OPTIONS,
  sectionVariant,
} from "../../astro_template/src/styles/variants.js";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import {
  CONTRAST_PAIRS,
  contrastRatio,
  DesignIntelligenceStage,
  deriveContrastTokens,
  deriveDesignSystem,
  normalizeDesignTokens,
  PERSONALITIES,
  SUPPORTED_FONT_FAMILIES,
} from "../../src/stages/DesignIntelligenceStage.js";

const PALETTES: Record<string, Record<string, string>> = {
  templateDefault: {
    primary: "#17324d",
    secondary: "#eef4f8",
    background: "#ffffff",
    text: "#17212b",
  },
  darkViolet: { primary: "#7c5cff", secondary: "#1a1626", background: "#0d0b14", text: "#ece9f5" },
  lightAmberPrimary: {
    primary: "#f2b134",
    secondary: "#1d2a35",
    background: "#fbfaf7",
    text: "#1b1f24",
  },
  // Declared text fails on its own background: the role must not inherit the failure.
  lowContrastText: {
    primary: "#3a7bd5",
    secondary: "#eeeeee",
    background: "#ffffff",
    text: "#9a9a9a",
  },
  midGreyPrimary: {
    primary: "#777777",
    secondary: "#f0f0f0",
    background: "#f7f7f7",
    text: "#222222",
  },
  namedColours: {
    primary: "rebeccapurple",
    secondary: "lavender",
    background: "ivory",
    text: "black",
  },
  functionalFormats: {
    primary: "hsl(150, 60%, 35%)",
    secondary: "rgb(240 240 240)",
    background: "rgb(18, 22, 28)",
    text: "hsl(0, 0%, 92%)",
  },
};

void test("every derived text/background pairing meets WCAG AA for every palette", () => {
  for (const [name, palette] of Object.entries(PALETTES)) {
    const tokens = { ...palette, ...deriveContrastTokens(palette) };
    assert.ok(tokens.ds_text, `${name}: contrast roles derived`);
    for (const [foreground, background, minimum] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(tokens[foreground], tokens[background]);
      assert.ok(
        ratio !== undefined && ratio >= minimum,
        `${name}: ${foreground} ${tokens[foreground]} on ${background} ${tokens[background]} = ${ratio?.toFixed(2)} < ${minimum}`,
      );
    }
  }
});

void test("palette colours are kept wherever they already pass; only failing roles move", () => {
  const legacy = deriveContrastTokens(PALETTES.templateDefault);
  assert.equal(legacy.ds_text, "#17212b", "a passing text colour is the palette's own");
  assert.equal(legacy.ds_ink, "#17324d", "a legible primary stays the brand ink");
  assert.equal(legacy.ds_on_primary, "#ffffff");
  const amber = deriveContrastTokens(PALETTES.lightAmberPrimary);
  assert.equal(amber.ds_on_primary, "#000000", "white fails on a light primary, so text goes dark");
  assert.notEqual(amber.ds_ink, "#f2b134", "a light primary is not used as text on a light page");
  const grey = deriveContrastTokens(PALETTES.lowContrastText);
  assert.equal(grey.ds_text, "#000000", "failing declared text is replaced, not inherited");
  // A palette that cannot be resolved statically derives nothing; CSS keeps its fallbacks.
  assert.deepEqual(deriveContrastTokens({ primary: "rgba(0,0,0,0.5)", background: "#fff" }), {});
  assert.deepEqual(deriveContrastTokens({ primary: "#123456", background: "transparent" }), {});
});

void test("fonts are bound to the self-hosted catalog and anything else fails closed", () => {
  for (const font of FONT_CATALOG) {
    for (const face of font.faces) {
      const file = resolve("astro_template/public", face.file.slice(1));
      assert.ok(existsSync(file) && statSync(file).size > 10_000, `${font.family}: ${face.file}`);
      assert.equal(readFileSync(file).subarray(0, 4).toString("latin1"), "wOF2", face.file);
    }
    const license = readFileSync(resolve("astro_template/public", font.license.slice(1)), "utf8");
    assert.match(license, /SIL Open Font License, Version 1\.1/, `${font.family} is OFL-1.1`);
  }
  assert.deepEqual(
    SUPPORTED_FONT_FAMILIES,
    FONT_CATALOG.map((font) => font.family),
  );
  for (const family of ["Roboto", "Comic Sans MS", "Helvetica Neue", "Open Sans"]) {
    assert.throws(
      () =>
        normalizeDesignTokens(
          { primary: "#123456", secondary: "#eeeeee" },
          { heading: family, body: "Inter" },
        ),
      /not in the self-hosted font catalog/,
      family,
    );
  }
  // Names resolve to the catalog spelling; declared aliases resolve to their face.
  const tokens = normalizeDesignTokens(
    { primary: "#123456", secondary: "#eeeeee" },
    { heading: "space grotesk", body: "Source Serif" },
  );
  assert.equal(tokens.font_heading, "Space Grotesk");
  assert.equal(tokens.font_body, "Source Serif 4");
  assert.equal(
    findCatalogFont("Arial")?.family,
    "Arimo",
    "Arial resolves to its metric-compatible OFL face",
  );
  const inter = findCatalogFont("Inter");
  assert.ok(inter);
  const css = fontFaceCss([inter, inter]);
  assert.equal((css.match(/@font-face/g) ?? []).length, 1, "deduplicated");
  assert.match(
    css,
    /font-display:swap;src:url\('\/fonts\/inter-latin-wght\.woff2'\) format\('woff2'\)/,
  );
});

void test("the layout loads fonts only from the catalog and preloads what the site uses", () => {
  const layout = readFileSync(resolve("astro_template/src/layouts/BaseLayout.astro"), "utf8");
  assert.match(layout, /findCatalogFont\(designTokens\.font_heading\)/);
  assert.match(
    layout,
    /<link rel="preload" href=\{href\} as="font" type="font\/woff2" crossorigin \/>/,
  );
  assert.match(layout, /<style is:inline set:html=\{fontFaces\} \/>/);
  assert.doesNotMatch(layout, /fonts\.googleapis|fonts\.gstatic|use\.typekit/);
});

void test("approved direction selects one coherent personality deterministically", () => {
  assert.equal(deriveDesignSystem([]).ds_personality, "classic");
  assert.equal(deriveDesignSystem(["trustworthy local service"]).ds_personality, "warm");
  assert.equal(deriveDesignSystem(["Editorial clarity", "timeless"]).ds_personality, "editorial");
  assert.equal(deriveDesignSystem(["bold", "industrial"]).ds_hero_variant, "statement");
  // A rejected attribute excludes its personality.
  assert.equal(deriveDesignSystem(["bold", "minimal"], ["bold"]).ds_personality, "minimal");
  // Ties go to declaration order; repeat calls are identical.
  assert.equal(deriveDesignSystem(["editorial", "bold"]).ds_personality, PERSONALITIES[0].name);
  assert.deepEqual(
    deriveDesignSystem(["premium", "layered"]),
    deriveDesignSystem(["layered", "premium"]),
  );
  for (const personality of [...PERSONALITIES.map((entry) => entry.words[0]), "nothing"]) {
    const tokens = deriveDesignSystem([personality]);
    for (const kind of Object.keys(SECTION_VARIANT_OPTIONS) as Array<
      keyof typeof SECTION_VARIANT_OPTIONS
    >) {
      const value = tokens[`ds_${kind}_variant`];
      assert.ok(
        (SECTION_VARIANT_OPTIONS[kind] as readonly string[]).includes(value),
        `${kind}=${value}`,
      );
    }
    assert.match(tokens.ds_fs_h1, /^clamp\(/);
    assert.match(tokens.ds_section_space, /^clamp\(/);
  }
  const variants = new Set(
    PERSONALITIES.map((entry) => `${entry.hero}/${entry.services}/${entry.cta}/${entry.gallery}`),
  );
  assert.equal(variants.size, PERSONALITIES.length, "each personality is a distinct variant set");
  // Unknown or absent variant tokens fall back to the first option, never an arbitrary string.
  assert.equal(sectionVariant("hero", { ds_hero_variant: "<script>" }), "split");
  assert.equal(sectionVariant("gallery", undefined), "grid");
  assert.equal(sectionVariant("cta", { ds_cta_variant: "panel" }), "panel");
});

void test("the stage records variants, scale and contrast roles in the generated design tokens", async () => {
  const ctx = {
    buildId: "wb-ds-build",
    clientId: "wb-ds-client",
    dryRun: false,
    mode: "local-proof",
    buildIntent: "COPY",
    domainSpec: {
      client_id: "wb-ds-client",
      business_name: "Fixture Co",
      vertical: "roofing",
      geography: { states: ["XX"], primary_state: "XX" },
      client_vision: { brand_attributes: ["rugged", "industrial"], visual_preferences: [] },
      design: {
        status: "resolved",
        palette: { ...PALETTES.lightAmberPrimary },
        fonts: { heading: "Archivo", body: "Inter" },
      },
      routes: [{ slug: "/", title: "Home", components: ["hero"] }],
    },
    llm: { designReasoning: async () => assert.fail("a resolved palette must not call the LLM") },
  } as unknown as BuildContext;
  await new DesignIntelligenceStage().run(ctx);
  const tokens = ctx.designTokens ?? {};
  assert.equal(tokens.ds_personality, "bold");
  assert.equal(tokens.ds_hero_variant, "statement");
  assert.equal(tokens.ds_cta_variant, "band");
  assert.equal(tokens.ds_on_primary, "#000000");
  assert.equal(
    tokens.primary,
    PALETTES.lightAmberPrimary.primary,
    "the palette itself is untouched",
  );
  assert.equal(tokens.font_heading, "Archivo");
});

void test("global.css keeps the ghost button legible on primary bands and buttons in the body font", () => {
  const css = readFileSync(resolve("astro_template/src/styles/global.css"), "utf8");
  // The defect: ghost text was var(--color-primary) on the primary CTA banner.
  assert.match(
    css,
    /:is\(\.band, \.cta-banner, \.hero\[data-variant="statement"\]\) \.btn--ghost \{ color: var\(--ds-on-primary\); \}/,
  );
  assert.match(
    css,
    /:is\(\.band, \.cta-banner, \.hero\[data-variant="statement"\]\) \.btn:not\(\.btn--ghost\) \{[^}]*background: var\(--ds-on-primary\);[^}]*color: var\(--color-primary\);/,
  );
  assert.match(css, /\.btn \{[^}]*font: inherit;/);
  assert.match(css, /button, input, select, textarea \{ font: inherit; color: inherit; \}/);
  // A quote's footer is not styled as the site footer.
  assert.match(css, /blockquote footer \{[^}]*border: 0;/);
  assert.doesNotMatch(css, /^footer \{/m);
  for (const selector of [
    ".hero__subheading",
    ".prose__subheading",
    ".services-grid__intro",
    ".page-title",
    ".lead-form__unavailable",
    "blockquote {",
    "figcaption",
  ])
    assert.ok(css.includes(selector), `global.css styles ${selector}`);
  for (const kind of Object.keys(SECTION_VARIANT_OPTIONS) as Array<
    keyof typeof SECTION_VARIANT_OPTIONS
  >) {
    const block = {
      hero: ".hero",
      services: ".services-grid",
      cta: ".cta-banner",
      gallery: ".gallery",
    }[kind];
    for (const variant of SECTION_VARIANT_OPTIONS[kind].slice(1)) {
      const styled =
        css.includes(`${block}[data-variant="${variant}"]`) ||
        (kind === "hero" && variant === "backdrop");
      assert.ok(styled, `${block} variant ${variant} is styled`);
    }
  }
});
