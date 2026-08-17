// L9_META: layer=ingestion, role=source_palette, status=active, version=1.0.0
//
// Reconstruct the source site's color tokens from crawled CSS. Operators pick
// palettes on purpose (Kyle's blue on black). The design stage must reuse these
// instead of asking an LLM to invent sage/beige marketing colors.

export interface SourcePaletteHint {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

interface Rgb {
  hex: string;
  r: number;
  g: number;
  b: number;
  luminance: number;
  saturation: number;
  hue: number;
}

const HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;

function expandHex(raw: string): string | undefined {
  const value = raw.replace("#", "").toLowerCase();
  if (value.length === 3 || value.length === 4) {
    const [r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (value.length === 6 || value.length === 8) return `#${value.slice(0, 6)}`;
  return undefined;
}

function parseRgb(hex: string): Rgb | undefined {
  const expanded = expandHex(hex);
  if (!expanded) return undefined;
  const r = Number.parseInt(expanded.slice(1, 3), 16);
  const g = Number.parseInt(expanded.slice(3, 5), 16);
  const b = Number.parseInt(expanded.slice(5, 7), 16);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  let hue = 0;
  if (delta > 0) {
    if (max === r / 255) hue = 60 * (((g / 255 - b / 255) / delta) % 6);
    else if (max === g / 255) hue = 60 * ((b / 255 - r / 255) / delta + 2);
    else hue = 60 * ((r / 255 - g / 255) / delta + 4);
    if (hue < 0) hue += 360;
  }
  return { hex: expanded, r, g, b, luminance, saturation, hue };
}

export function extractHexColors(css: string): string[] {
  const seen = new Set<string>();
  for (const match of css.matchAll(HEX)) {
    const parsed = parseRgb(match[0]);
    if (!parsed) continue;
    if (parsed.hex === "#000000" && match[0].length <= 5) continue;
    seen.add(parsed.hex);
  }
  return [...seen];
}

function isBlueAccent(color: Rgb): boolean {
  return (
    color.saturation >= 0.25 &&
    color.hue >= 170 &&
    color.hue <= 250 &&
    color.luminance > 0.15 &&
    color.luminance < 0.75
  );
}

/** Pick background / text / primary from observed hexes. Returns undefined when
 *  there is not enough signal to beat a later LLM fallback. */
export function inferPalette(hexes: readonly string[]): SourcePaletteHint | undefined {
  const colors = hexes.map(parseRgb).filter((color): color is Rgb => Boolean(color));
  if (colors.length < 2) return undefined;

  const byLum = [...colors].sort((a, b) => a.luminance - b.luminance);
  const darkest = byLum[0];
  const lightest = byLum.at(-1)!;
  const darkSite = darkest.luminance < 0.25;
  const background = darkSite ? darkest.hex : lightest.hex;
  const text = darkSite ? lightest.hex : darkest.hex;

  const blues = colors.filter(isBlueAccent).sort((a, b) => b.saturation - a.saturation);
  const chromatic = [...colors]
    .filter((color) => color.saturation >= 0.2 && color.hex !== background && color.hex !== text)
    .sort((a, b) => b.saturation - a.saturation);
  const primary = (blues[0] ?? chromatic[0])?.hex;
  if (!primary) return undefined;

  const secondary = darkSite ? "#171717" : "#eef4f8";
  return { primary, secondary, accent: primary, background, text };
}
