// L9_META: layer=template, role=generated_site_config, status=generated, version=1.1.0
// Placeholder only: SiteAssemblerStage overwrites this file in every generated
// site. The CTA keys mirror its output so the template type-checks standalone.
export const siteConfig = {
  leadFormAction: "" as string,
  phone: "" as string,
  primaryCta: null as { label: string; href: string } | null,
  businessName: "Generated Site",
  siteUrl: "https://example.invalid",
  vertical: "unknown",
  clientId: "unknown",
  namespace: "client",
  geography: { primaryState: "Unknown", states: [] },
  nav: [],
  routes: [] as Array<{ href: string; title: string }>,
  schemas: { siteWide: [], perRoute: {} },
  designTokens: {},
  images: {} as Record<
    string,
    { src: string; alt: string; width: number; height: number; source: string }
  >,
} as const;
