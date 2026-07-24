// L9_META: layer=stage, role=design_intelligence, stage_index=3, status=active, version=3.0.0
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';

const logger = createModuleLogger('stage:design-intelligence');

const COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'text'] as const;
const FONT_KEYS = ['font_heading', 'font_body'] as const;

function isColor(value: unknown): value is string {
  return typeof value === 'string' && (
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ||
    /^rgba?\([\d.,\s%/]+\)$/i.test(value) ||
    /^hsla?\([\d.,\s%/]+\)$/i.test(value) ||
    /^[a-zA-Z]+$/.test(value)
  );
}

function isFont(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]+(?:[ ._-][A-Za-z0-9]+)*$/.test(value);
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

  for (const key of ['primary', 'secondary', 'accent'] as const) {
    if (!isColor(tokens[key])) throw new BuildError('VALIDATION_FAILED', `Design token '${key}' must be a valid CSS color`);
  }
  for (const key of ['background', 'text'] as const) {
    if (tokens[key] !== undefined && !isColor(tokens[key])) {
      throw new BuildError('VALIDATION_FAILED', `Design token '${key}' must be a valid CSS color`);
    }
  }
  for (const key of FONT_KEYS) {
    if (!isFont(tokens[key])) throw new BuildError('VALIDATION_FAILED', `Design token '${key}' must be a valid font name`);
  }
  for (const key of COLOR_KEYS) if (tokens[key] !== undefined) tokens[key] = tokens[key].trim();
  for (const key of FONT_KEYS) tokens[key] = tokens[key].trim();
  return tokens;
}

export class DesignIntelligenceStage implements Stage {
  name = 'design-intelligence';

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.domainSpec.design?.status === 'resolved') {
      ctx.designTokens = normalizeDesignTokens(
        ctx.domainSpec.design.palette ?? {},
        ctx.domainSpec.design.fonts ?? {},
      );
      logger.info({ tokens: Object.keys(ctx.designTokens) }, 'Resolved design tokens loaded from DomainSpec');
      return;
    }

    if (ctx.dryRun) {
      logger.info('[dry-run] Would generate and validate design tokens via LLM');
      return;
    }

    const { vertical, business_name, geography } = ctx.domainSpec;
    const prompt = [
      `Generate CSS brand tokens for a ${vertical} business named "${business_name}" operating in ${geography.primary_state}.`,
      'Return ONLY a JSON object with primary, secondary, accent, background, text, font_heading, and font_body.',
      'Colors must be CSS hex/rgb/hsl/named values. Fonts must be plain font-family names.',
    ].join(' ');

    let raw: string;
    try { raw = await ctx.llm.designReasoning(prompt); }
    catch (error) { throw new BuildError('DESIGN_REASONING_FAILED', `LLM design call failed: ${String(error)}`, true); }

    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new BuildError('DESIGN_REASONING_FAILED', 'LLM returned invalid JSON for design tokens', true); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BuildError('DESIGN_REASONING_FAILED', 'LLM design response must be a JSON object', true);
    }

    ctx.designTokens = normalizeDesignTokens(parsed as Record<string, string>);
    logger.info({ tokens: Object.keys(ctx.designTokens) }, 'Design tokens retained in BuildContext');
  }
}
