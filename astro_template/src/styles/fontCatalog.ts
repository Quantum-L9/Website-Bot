// L9_META: layer=template, role=font_catalog, status=active, version=1.0.0
//
// The only typefaces a generated site may use. Each is self-hosted from
// public/fonts (Latin subset, SIL Open Font License 1.1, license file beside
// the font), so a visitor gets the chosen face instead of a system fallback and
// no third-party font CDN is contacted. DesignIntelligenceStage refuses any
// family outside this catalog; BaseLayout emits @font-face, preload and the
// fallback stack from it. Adding a family means vendoring its woff2 and OFL
// text into public/fonts and adding one entry here.

export interface FontFace {
  /** Path under public/ (served at the site root). */
  readonly file: string;
  /** CSS font-weight descriptor: a range for variable fonts, one value otherwise. */
  readonly weight: string;
}

export interface CatalogFont {
  readonly family: string;
  readonly category: "sans-serif" | "serif";
  /** System fallbacks used while the face loads, ending in the generic family. */
  readonly fallback: string;
  readonly faces: readonly FontFace[];
  /** OFL license text shipped beside the font files. */
  readonly license: string;
  /**
   * Other names that resolve to this face by a declared compatibility, never by
   * resemblance: a renamed release of the same design ("Source Serif" is
   * Source Serif 4), or a metric-compatible open replacement for a
   * proprietary system face (Arimo is metric-compatible with Arial).
   */
  readonly aliases?: readonly string[];
}

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', Times, serif";

export const FONT_CATALOG: readonly CatalogFont[] = [
  {
    family: "Inter",
    category: "sans-serif",
    fallback: SANS,
    faces: [{ file: "/fonts/inter-latin-wght.woff2", weight: "100 900" }],
    license: "/fonts/OFL-inter.txt",
  },
  {
    family: "Archivo",
    category: "sans-serif",
    fallback: SANS,
    faces: [{ file: "/fonts/archivo-latin-wght.woff2", weight: "100 900" }],
    license: "/fonts/OFL-archivo.txt",
  },
  {
    family: "Manrope",
    category: "sans-serif",
    fallback: SANS,
    faces: [{ file: "/fonts/manrope-latin-wght.woff2", weight: "200 800" }],
    license: "/fonts/OFL-manrope.txt",
  },
  {
    family: "Space Grotesk",
    category: "sans-serif",
    fallback: SANS,
    faces: [{ file: "/fonts/space-grotesk-latin-wght.woff2", weight: "300 700" }],
    license: "/fonts/OFL-space-grotesk.txt",
  },
  {
    family: "Arimo",
    category: "sans-serif",
    fallback: `Arial, ${SANS}`,
    faces: [{ file: "/fonts/arimo-latin-wght.woff2", weight: "400 700" }],
    license: "/fonts/OFL-arimo.txt",
    aliases: ["Arial", "Liberation Sans"],
  },
  {
    family: "Source Serif 4",
    category: "serif",
    fallback: SERIF,
    faces: [{ file: "/fonts/source-serif-4-latin-wght.woff2", weight: "200 900" }],
    license: "/fonts/OFL-source-serif-4.txt",
    aliases: ["Source Serif", "Source Serif Pro"],
  },
  {
    family: "Libre Baskerville",
    category: "serif",
    fallback: SERIF,
    faces: [
      { file: "/fonts/libre-baskerville-latin-400.woff2", weight: "400" },
      { file: "/fonts/libre-baskerville-latin-700.woff2", weight: "700" },
    ],
    license: "/fonts/OFL-libre-baskerville.txt",
  },
];

/** The family used when a site names none (matches the generated tokens.css fallback). */
export const DEFAULT_FONT_FAMILY = "Inter";

const key = (family: string): string => family.trim().replace(/\s+/g, " ").toLowerCase();

/** The catalog entry for a family name (case- and spacing-insensitive), if any. */
export function findCatalogFont(family: string | undefined): CatalogFont | undefined {
  if (typeof family !== "string") return undefined;
  const wanted = key(family);
  return FONT_CATALOG.find(
    (font) =>
      key(font.family) === wanted || (font.aliases ?? []).some((alias) => key(alias) === wanted),
  );
}

/** Full CSS font-family value: the catalog face first, then its system fallbacks. */
export function fontStack(font: CatalogFont): string {
  return `'${font.family}', ${font.fallback}`;
}

/** @font-face rules for the given catalog fonts, deduplicated, swap display. */
export function fontFaceCss(fonts: readonly CatalogFont[]): string {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const font of fonts) {
    if (seen.has(font.family)) continue;
    seen.add(font.family);
    for (const face of font.faces) {
      rules.push(
        `@font-face{font-family:'${font.family}';font-style:normal;font-weight:${face.weight};` +
          `font-display:swap;src:url('${face.file}') format('woff2');}`,
      );
    }
  }
  return rules.join("");
}
