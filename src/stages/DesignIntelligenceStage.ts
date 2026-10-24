// L9_META: layer=stage, role=design_intelligence, stage_index=3, status=active, version=3.0.0
import { createModuleLogger } from "../core/logger.js";
import type { BuildContext } from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { Stage } from "../pipeline/PipelineRunner.js";

const logger = createModuleLogger("stage:design-intelligence");

const COLOR_KEYS = ["primary", "secondary", "accent", "background", "text"] as const;
const FONT_KEYS = ["font_heading", "font_body"] as const;

function isColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ||
      /^rgba?\([\d.,\s%/]+\)$/i.test(value) ||
      /^hsla?\([\d.,\s%/]+\)$/i.test(value) ||
      /^[a-zA-Z]+$/.test(value))
  );
}

function isFont(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]+(?:[ ._-][A-Za-z0-9]+)*$/.test(value);
}

export function normalizeDesignTokens(
  palette: Record<string, string> = {},
  fonts: Record<string, string> = {},
): Record<string, string> {
  const tokens: Record<string, string> = {
    ...palette,
    ...fonts,
  };
  tokens.font_heading ??= fonts.heading ?? fonts.fontHeading;
  tokens.font_body ??= fonts.body ?? fonts.fontBody;
  tokens.accent ??= palette.primary;

  for (const key of ["primary", "secondary", "accent"] as const) {
    if (!isColor(tokens[key]))
      throw new BuildError("VALIDATION_FAILED", `Design token '${key}' must be a valid CSS color`);
  }
  for (const key of ["background", "text"] as const) {
    if (tokens[key] !== undefined && !isColor(tokens[key])) {
      throw new BuildError("VALIDATION_FAILED", `Design token '${key}' must be a valid CSS color`);
    }
  }
  for (const key of FONT_KEYS) {
    if (!isFont(tokens[key]))
      throw new BuildError("VALIDATION_FAILED", `Design token '${key}' must be a valid font name`);
  }
  for (const key of COLOR_KEYS) if (tokens[key] !== undefined) tokens[key] = tokens[key].trim();
  for (const key of FONT_KEYS) tokens[key] = tokens[key].trim();
  return tokens;
}

/**
 * Layout direction (WB-QAP-04): a fixed vocabulary that maps approved design
 * attributes to layout presets. Only these words count; a rejected attribute
 * vetoes its preset, and a group with conflicting evidence gets no token.
 */
const LAYOUT_PRESETS = {
  type: [
    {
      ratio: 1.333,
      words: ["editorial", "expressive", "bold", "dramatic", "confident", "striking"],
    },
    {
      ratio: 1.2,
      words: ["minimal", "minimalist", "restrained", "understated", "quiet", "subtle"],
    },
  ],
  space: [
    { scale: 1.25, words: ["spacious", "airy", "generous", "open", "calm", "breathing"] },
    { scale: 0.85, words: ["compact", "dense", "efficient", "utilitarian"] },
  ],
  width: [
    { width: "1240px", words: ["wide", "expansive", "immersive", "cinematic"] },
    { width: "960px", words: ["focused", "narrow", "intimate", "readable"] },
  ],
  radius: [
    {
      radius: "0.25rem",
      words: ["sharp", "precise", "technical", "engineered", "geometric", "angular"],
    },
    { radius: "1rem", words: ["soft", "friendly", "approachable", "warm", "rounded", "playful"] },
  ],
  surface: [
    {
      surface: "layered",
      words: ["layered", "depth", "premium", "luxurious", "sophisticated", "dimensional"],
    },
  ],
} as const;

function wordsOf(phrases: readonly string[]): Set<string> {
  return new Set(
    phrases.flatMap((phrase) =>
      phrase
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean),
    ),
  );
}

function pick<T extends { words: readonly string[] }>(
  presets: readonly T[],
  desired: Set<string>,
  rejected: Set<string>,
): T | undefined {
  const matches = presets.filter(
    (preset) =>
      preset.words.some((word) => desired.has(word)) &&
      !preset.words.some((word) => rejected.has(word)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

const rem = (value: number): string => `${Number(value.toFixed(3))}rem`;

function relativeLuminance(hex: string): number | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = Number.parseInt(digits.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Text colour for content painted on the primary colour. The template paints
 * white there; only when white fails WCAG AA (4.5:1) is a dark foreground
 * derived, so palettes where white already passes keep their rendering.
 */
export function deriveOnPrimaryToken(primary: string | undefined): Record<string, string> {
  const luminance = primary ? relativeLuminance(primary) : undefined;
  if (luminance === undefined || contrast(1, luminance) >= 4.5) return {};
  return contrast(0, luminance) >= 4.5 ? { layout_on_primary: "#000000" } : {};
}

/**
 * Derive CSS-ready layout tokens from approved design attributes. Returns an
 * empty object when nothing in the vocabulary matches, so an unconfigured site
 * keeps the canonical template styles exactly.
 */
export function deriveLayoutTokens(
  desiredPhrases: readonly string[],
  rejectedPhrases: readonly string[] = [],
): Record<string, string> {
  const desired = wordsOf(desiredPhrases);
  const rejected = wordsOf(rejectedPhrases);
  const tokens: Record<string, string> = {};
  const type = pick(LAYOUT_PRESETS.type, desired, rejected);
  if (type) {
    // Heading steps h3..h1 = ratio^2..ratio^4 rem, fluid between 72% and 100%
    // (the vw term reaches the maximum at a 1280px viewport).
    for (const [level, step] of [
      ["h1", 4],
      ["h2", 3],
      ["h3", 2],
    ] as const) {
      const max = type.ratio ** step;
      tokens[`layout_fs_${level}`] =
        `clamp(${rem(max * 0.72)}, ${Number((max * 1.25).toFixed(3))}vw, ${rem(max)})`;
    }
    tokens.layout_type_scale = String(type.ratio);
  }
  const space = pick(LAYOUT_PRESETS.space, desired, rejected);
  if (space) {
    tokens.layout_section_space = rem(3 * space.scale);
    tokens.layout_flow_gap = rem(1.5 * space.scale);
  }
  const width = pick(LAYOUT_PRESETS.width, desired, rejected);
  if (width) tokens.layout_content_width = width.width;
  const radius = pick(LAYOUT_PRESETS.radius, desired, rejected);
  if (radius) tokens.layout_radius = radius.radius;
  const surface = pick(LAYOUT_PRESETS.surface, desired, rejected);
  if (surface) tokens.layout_surface = surface.surface;
  return tokens;
}

export class DesignIntelligenceStage implements Stage {
  name = "design-intelligence";

  /**
   * Approved layout evidence only: the sealed design direction under
   * REDESIGN_IMPROVE (which already ranks the client's vision first), or the
   * client's own first-party vision for COPY builds. Observed source, donor or
   * reference characteristics are never read.
   */
  private applyLayoutDirection(ctx: BuildContext): void {
    if (!ctx.designTokens) return;
    const direction = ctx.websiteBlueprint?.payload.design_direction;
    const vision = ctx.domainSpec.client_vision;
    const layout = direction
      ? deriveLayoutTokens(
          [...direction.principles, ...direction.desired_attributes],
          direction.rejected_attributes,
        )
      : deriveLayoutTokens([
          ...(vision?.brand_attributes ?? []),
          ...(vision?.visual_preferences ?? []),
        ]);
    Object.assign(layout, deriveOnPrimaryToken(ctx.designTokens.primary));
    if (Object.keys(layout).length === 0) return;
    ctx.designTokens = { ...ctx.designTokens, ...layout };
    logger.info(
      { layout: Object.keys(layout) },
      "Layout tokens derived from approved design direction",
    );
  }

  private blueprintContext(ctx: BuildContext): string {
    // REDESIGN_IMPROVE: the gated website blueprint (ADR-0004) informs design
    // decisions — differentiation to amplify, attributes to preserve, claims to
    // forbid. Copy-only builds carry no blueprint.
    const blueprint = ctx.websiteBlueprint;
    if (!blueprint) return "";
    const strategy = blueprint.payload.strategy;
    return [
      "Market-informed design constraints from the gated website blueprint:",
      `differentiation: ${strategy.differentiation.join("; ") || "none"}`,
      `preserve: ${strategy.preserve.join("; ") || "none"}`,
      `evolve: ${strategy.evolve.join("; ") || "none"}`,
      `forbid: ${strategy.forbid.join("; ") || "none"}`,
      `experience_attributes: ${strategy.experience_attributes.join("; ") || "none"}`,
      `forbidden_claims: ${blueprint.payload.content_guardrails.forbidden_claims.join("; ") || "none"}`,
      `primary_conversion_action: ${blueprint.payload.conversion.primary_action}`,
    ].join("\n");
  }

  /**
   * Design direction distilled from the sealed blueprint. Under V2 this is a
   * sealed decision (`design_direction`), not prose reconstructed from strategy
   * (ADR-0018 §7).
   */
  private blueprintDesignContext(ctx: BuildContext): string {
    const blueprint = ctx.websiteBlueprint;
    if (!blueprint) return "";
    const direction = blueprint.payload.design_direction;
    return [
      this.blueprintContext(ctx),
      "Sealed design direction (authoritative — higher tiers already resolved):",
      `principles: ${direction.principles.join("; ") || "none"}`,
      `desired_attributes: ${direction.desired_attributes.join("; ") || "none"}`,
      `rejected_attributes: ${direction.rejected_attributes.join("; ") || "none"}`,
      // Abstract characteristics only. The observed palette's concrete values
      // are deliberately absent: WBV2-007 forbids them becoming theme tokens.
      `observed_characteristics (NON-AUTHORITATIVE, abstract only): ${
        direction.palette_authority.observed_characteristics.join("; ") || "none"
      }`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.buildIntent === "REDESIGN_IMPROVE") await this.runRedesign(ctx);
    else await this.runCopy(ctx);
    this.applyLayoutDirection(ctx);
  }

  /**
   * REDESIGN_IMPROVE palette resolution (WBV2-007).
   *
   * The blueprint's `palette_authority` is the only thing consulted. An
   * observed source/donor/reference palette is NOT a source: a redesign that
   * deterministically inherits the source site's colors is a recolored copy.
   * With no authority declared, colors are generated fresh from sealed design
   * direction — the ladder's lowest tier, "generic model preference" — never
   * inherited from observation.
   */
  private async runRedesign(ctx: BuildContext): Promise<void> {
    const blueprint = ctx.websiteBlueprint;
    if (!blueprint) {
      // WBV2-020: realization may not decide what the blueprint should have.
      throw new BuildError(
        "DESIGN_REASONING_FAILED",
        "REDESIGN_IMPROVE design resolution requires the sealed WebsiteBuildBlueprint",
      );
    }
    const authority = blueprint.payload.design_direction.palette_authority;
    const fonts = ctx.domainSpec.design?.fonts ?? {};

    if (authority.source !== "none") {
      ctx.designTokens = normalizeDesignTokens(
        { ...authority.tokens },
        {
          heading: fonts.heading ?? fonts.font_heading ?? "Inter",
          body: fonts.body ?? fonts.font_body ?? "Inter",
        },
      );
      this.persistTokens(ctx);
      logger.info(
        { tokens: Object.keys(ctx.designTokens), authority: authority.source },
        "Design tokens resolved from the blueprint's declared palette authority",
      );
      return;
    }

    if (ctx.dryRun) {
      logger.info("[dry-run] Would generate redesign tokens from sealed design direction");
      return;
    }

    logger.info(
      { observed: authority.observed_characteristics },
      "No declared palette authority; generating fresh tokens from design direction " +
        "(observed palettes are non-authoritative under REDESIGN_IMPROVE)",
    );
    ctx.designTokens = await this.generateTokens(ctx, [
      "This is a REDESIGN, not a reconstruction.",
      "Do NOT reuse or approximate the colors of the existing site, any competitor, or any design reference.",
      "Observed characteristics below are abstract guidance only, never values to match.",
      this.blueprintDesignContext(ctx),
    ]);
    this.persistTokens(ctx);
  }

  /**
   * COPY reconstruction — unchanged. Faithful reconstruction is the declared
   * COPY contract (`copy_mode.existing_reconstruction_semantics_preserved`), so
   * preserving the source palette here is correct, not a leak. Palette
   * non-authority is a redesign invariant.
   */
  private async runCopy(ctx: BuildContext): Promise<void> {
    const sourcePalette = ctx.sourceSiteManifest?.palette;
    if (sourcePalette?.primary && sourcePalette?.background) {
      const fonts = ctx.domainSpec.design?.fonts ?? {};
      ctx.designTokens = normalizeDesignTokens(
        {
          primary: sourcePalette.primary,
          secondary: sourcePalette.secondary,
          accent: sourcePalette.accent ?? sourcePalette.primary,
          background: sourcePalette.background,
          text: sourcePalette.text,
        },
        {
          heading: fonts.heading ?? fonts.font_heading ?? "Inter",
          body: fonts.body ?? fonts.font_body ?? "Inter",
        },
      );
      this.persistTokens(ctx);
      logger.info(
        { tokens: Object.keys(ctx.designTokens), source: "source-site-css" },
        "Design tokens preserved from source-site palette",
      );
      return;
    }

    if (ctx.domainSpec.assets?.sourceSite?.enabled === true) {
      throw new BuildError(
        "DESIGN_REASONING_FAILED",
        "Source-site reconstruction requires a crawled CSS palette. Refusing to invent brand colors.",
      );
    }

    if (ctx.domainSpec.design?.status === "resolved") {
      ctx.designTokens = normalizeDesignTokens(
        ctx.domainSpec.design.palette ?? {},
        ctx.domainSpec.design.fonts ?? {},
      );
      logger.info(
        { tokens: Object.keys(ctx.designTokens) },
        "Resolved design tokens loaded from DomainSpec",
      );
      return;
    }

    if (ctx.dryRun) {
      logger.info("[dry-run] Would generate and validate design tokens via LLM");
      return;
    }

    ctx.designTokens = await this.generateTokens(ctx, [
      "If reconstructing an existing website, preserve its palette. Do not invent sage, beige, forest-green, or grey marketing palettes.",
      "Dark sites stay dark (near-black background, light text). Blue accents stay blue.",
      this.blueprintContext(ctx),
    ]);
    this.persistTokens(ctx);
  }

  private async generateTokens(
    ctx: BuildContext,
    guidance: string[],
  ): Promise<Record<string, string>> {
    const { vertical, business_name, geography } = ctx.domainSpec;
    const prompt = [
      `Generate CSS brand tokens for a ${vertical} business named "${business_name}" operating in ${geography.primary_state}.`,
      "Return ONLY a JSON object with primary, secondary, accent, background, text, font_heading, and font_body.",
      "Colors must be CSS hex/rgb/hsl/named values. Fonts must be plain font-family names.",
      ...guidance,
    ]
      .filter(Boolean)
      .join(" ");

    let raw: string;
    try {
      raw = await ctx.llm.designReasoning(prompt);
    } catch (error) {
      throw new BuildError(
        "DESIGN_REASONING_FAILED",
        `LLM design call failed: ${String(error)}`,
        true,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BuildError(
        "DESIGN_REASONING_FAILED",
        "LLM returned invalid JSON for design tokens",
        true,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BuildError(
        "DESIGN_REASONING_FAILED",
        "LLM design response must be a JSON object",
        true,
      );
    }
    return normalizeDesignTokens(parsed as Record<string, string>);
  }

  /** Write resolved tokens back onto the spec so downstream stages see them. */
  private persistTokens(ctx: BuildContext): void {
    const tokens = ctx.designTokens ?? {};
    ctx.domainSpec.design = {
      status: "resolved",
      palette: {
        ...(tokens.primary ? { primary: tokens.primary } : {}),
        ...(tokens.secondary ? { secondary: tokens.secondary } : {}),
        ...(tokens.accent ? { accent: tokens.accent } : {}),
        ...(tokens.background ? { background: tokens.background } : {}),
        ...(tokens.text ? { text: tokens.text } : {}),
      },
      fonts: {
        font_heading: tokens.font_heading,
        font_body: tokens.font_body,
      },
    };
    logger.info({ tokens: Object.keys(tokens) }, "Design tokens retained in BuildContext");
  }
}
