// L9_META: layer=template, role=section_registry_contract, status=active, version=1.0.0
export const SECTION_COMPONENTS = [
  'hero', 'trust_bar', 'process', 'audience_paths', 'service_area', 'cta', 'final_cta',
  'compliance_note', 'disclaimer', 'faq', 'confirmation', 'contact_form',
] as const;
export type SectionComponentName = typeof SECTION_COMPONENTS[number];
export function isRegisteredSection(value: string): value is SectionComponentName {
  return (SECTION_COMPONENTS as readonly string[]).includes(value);
}
