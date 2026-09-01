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

export class DesignIntelligenceStage implements Stage {
  name = "design-intelligence";

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
    if (ctx.buildIntent === "REDESIGN_IMPROVE") {
      await this.runRedesign(ctx);
      return;
    }
    await this.runCopy(ctx);
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
