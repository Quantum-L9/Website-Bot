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

/**
 * Accepted structured section handed to a section component under
 * REDESIGN_IMPROVE (WB-GLUE-01). Copy is verbatim from the accepted
 * StructuredContentPackage; `cta` is present only when the assembler resolved
 * the package's CTA action to a verified canonical destination.
 */
export type StructuredBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "bullets"; readonly items: readonly string[] }
  | { readonly kind: "steps"; readonly items: readonly string[] }
  | { readonly kind: "quote"; readonly text: string; readonly attribution?: string };

export interface StructuredSectionView {
  readonly sectionId: string;
  readonly eyebrow?: string;
  readonly heading?: string;
  readonly subheading?: string;
  readonly blocks: readonly StructuredBlock[];
  readonly cta: { readonly label: string; readonly href: string } | null;
  /** Route-level FAQ data, attached only to a planned FAQ section. */
  readonly faqs?: readonly { readonly question: string; readonly answer: string }[];
  /**
   * False on every services_overview section after the route's first: the
   * route's service-card grid renders once, never repeated per section.
   */
  readonly serviceCards?: boolean;
}

/** A generic section: rendered by the structured prose renderer or a layout variant. */
export const GENERIC_SECTION = "prose";

/**
 * Explicit abstract component-class correspondence (WB-GLUE-01). A blueprint
 * section names an abstract class; these whole tokens of its normalized class
 * select exactly one registered renderer. More than one candidate is
 * ambiguous and fails; none falls back to the generic structured renderer.
 */
const RENDERER_TOKENS: Readonly<Record<string, readonly string[]>> = {
  hero: ["hero", "masthead"],
  faq: ["faq", "faqs"],
  cta: ["cta", "conversion"],
  process: ["process", "steps", "workflow", "timeline"],
  trust_bar: ["trust", "credentials", "certifications"],
  gallery: ["gallery", "portfolio", "showcase"],
  contact_form: ["form"],
  services_overview: ["services", "offerings"],
  service_area: ["area", "coverage", "map"],
  audience_paths: ["audience", "audiences", "personas"],
  compliance_note: ["compliance", "disclaimer"],
};

/** Classes whose generic tokens name the structured prose renderer outright. */
const GENERIC_TOKENS: readonly string[] = ["prose", "text", "content", "rich_text", "body"];

/**
 * Visual or interactive compositions this template has no component for. A
 * section requesting one cannot be honored by prose and fails the build.
 */
const UNSUPPORTED_TOKENS: readonly string[] = [
  "video",
  "carousel",
  "slider",
  "calculator",
  "estimator",
  "configurator",
  "booking",
  "scheduler",
  "chat",
  "quiz",
];

export type RendererResolution =
  | { readonly kind: "registered"; readonly name: SectionComponentName }
  | { readonly kind: "layout"; readonly layout: SectionLayoutVariant }
  | { readonly kind: "generic" }
  | { readonly kind: "unsupported"; readonly token: string }
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] };

/**
 * Deterministically resolve a normalized blueprint component class to an
 * existing renderer: exact registered component, then explicit layout
 * variant, then the explicit token correspondence above.
 */
export function resolveSectionRenderer(normalizedClass: string): RendererResolution {
  if (isRegisteredSection(normalizedClass)) return { kind: "registered", name: normalizedClass };
  if (isSectionLayoutVariant(normalizedClass)) return { kind: "layout", layout: normalizedClass };
  const tokens = normalizedClass.split("_").filter(Boolean);
  const unsupported = tokens.find((token) => UNSUPPORTED_TOKENS.includes(token));
  if (unsupported) return { kind: "unsupported", token: unsupported };
  if (GENERIC_TOKENS.includes(normalizedClass)) return { kind: "generic" };
  const candidates = Object.entries(RENDERER_TOKENS)
    .filter(([, words]) => tokens.some((token) => words.includes(token)))
    .map(([name]) => name);
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  const [only] = candidates;
  if (only && isRegisteredSection(only)) return { kind: "registered", name: only };
  return { kind: "generic" };
}
