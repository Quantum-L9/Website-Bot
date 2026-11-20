// L9_META: layer=template, role=section_variant_resolver, status=active, version=1.0.0
//
// Section variants chosen by DesignIntelligenceStage (ds_*_variant tokens in the
// generated siteConfig.designTokens). A component asks for its variant here; an
// absent or unknown value falls back to the first (classic) option, so a
// template with no design system still renders.

export const SECTION_VARIANT_OPTIONS = {
  hero: ["split", "centered", "statement", "backdrop"],
  services: ["cards", "media", "list"],
  cta: ["band", "panel", "split"],
  gallery: ["grid", "mosaic", "feature"],
} as const;

export type SectionKind = keyof typeof SECTION_VARIANT_OPTIONS;
export type SectionVariant<K extends SectionKind> = (typeof SECTION_VARIANT_OPTIONS)[K][number];

export function sectionVariant<K extends SectionKind>(
  kind: K,
  tokens: Readonly<Record<string, unknown>> | undefined,
): SectionVariant<K> {
  const options: readonly string[] = SECTION_VARIANT_OPTIONS[kind];
  const requested = tokens?.[`ds_${kind}_variant`];
  return (
    typeof requested === "string" && options.includes(requested) ? requested : options[0]
  ) as SectionVariant<K>;
}
