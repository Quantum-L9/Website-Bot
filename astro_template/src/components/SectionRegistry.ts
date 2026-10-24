// L9_META: layer=template, role=section_registry_contract, status=active, version=1.1.0
export const SECTION_COMPONENTS = [
  "hero",
  "trust_bar",
  "process",
  "audience_paths",
  "service_area",
  "cta",
  "final_cta",
  "compliance_note",
  "disclaimer",
  "faq",
  "confirmation",
  "contact_form",
  "gallery",
  "services_overview",
] as const;
export type SectionComponentName = (typeof SECTION_COMPONENTS)[number];
export function isRegisteredSection(value: string): value is SectionComponentName {
  return (SECTION_COMPONENTS as readonly string[]).includes(value);
}

/**
 * Opt-in static layout variants (WB-QAP-01). A route selects one through the
 * existing DomainSpec `route.template` field with the `layout:` prefix, e.g.
 * `layout:editorial`. The variant replaces only the generic prose fallback of
 * that route's unregistered sections; registered sections keep their own
 * component. Templates without the prefix (`homepage`, `service_page`, …) are
 * page-type names and never select a variant.
 */
export const LAYOUT_TEMPLATE_PREFIX = "layout:";
export const SECTION_LAYOUT_VARIANTS = ["editorial", "diagram"] as const;
export type SectionLayoutVariant = (typeof SECTION_LAYOUT_VARIANTS)[number];
export function isSectionLayoutVariant(value: string): value is SectionLayoutVariant {
  return (SECTION_LAYOUT_VARIANTS as readonly string[]).includes(value);
}
