// L9_META: layer=service, role=crawl_identity, status=active, version=1.0.0
//
// When a source site was crawled, DomainSpec identity (routes, phone, palette,
// business_name, site_url) comes from observations. LLM may fill only vertical,
// geography, and keywords.

import { pagePath } from '../content/sourceCopy.js';
import type { IngestedPage, SourceSiteManifest } from '../../pipeline/evidence/SourceSiteManifest.js';

export type CrawlIdentity = {
  client_id: string;
  business_name: string;
  design: { status: 'resolved' | 'pending'; palette?: Record<string, string>; fonts?: Record<string, string> };
  routes: Array<{ slug: string; title: string; components: string[] }>;
  seo_contract: {
    site_url: string;
    phone?: string;
  };
};

function slugOf(page: IngestedPage): string {
  return pagePath(page.url);
}

function titleOf(page: IngestedPage): string {
  return (page.headings[0] || page.title || slugOf(page)).trim();
}

export function componentsForSlug(slug: string): string[] {
  if (slug === '/') return ['hero', 'gallery', 'trust-signals', 'cta', 'contact-form'];
  if (/faq/i.test(slug)) return ['hero', 'faq', 'contact-form'];
  if (/gallery/i.test(slug)) return ['hero', 'gallery'];
  if (/contact/i.test(slug)) return ['hero', 'contact-form'];
  if (/about/i.test(slug)) return ['hero', 'service-detail', 'contact-form'];
  return ['hero', 'service-detail', 'contact-form'];
}

export function routesFromCrawl(pages: IngestedPage[]): Array<{ slug: string; title: string; components: string[] }> {
  const bySlug = new Map<string, IngestedPage>();
  for (const page of pages) {
    const slug = slugOf(page);
    const existing = bySlug.get(slug);
    if (!existing || page.depth < existing.depth) bySlug.set(slug, page);
  }
  const ordered = [...bySlug.entries()].sort((a, b) => {
    if (a[0] === '/') return -1;
    if (b[0] === '/') return 1;
    return a[1].depth - b[1].depth || a[0].localeCompare(b[0]);
  });
  return ordered.map(([slug, page]) => ({
    slug,
    title: titleOf(page),
    components: componentsForSlug(slug),
  }));
}

export function buildCrawlIdentity(
  manifest: SourceSiteManifest,
  opts: { clientId: string; targetUrl: string; siteUrl?: string },
): CrawlIdentity {
  const home = manifest.pages.find(page => slugOf(page) === '/')
    ?? manifest.pages.find(page => page.depth === 0)
    ?? manifest.pages[0];
  const businessName = (home?.headings[0] || home?.title || opts.clientId).trim();
  const phone = manifest.pages.flatMap(page => page.phones ?? []).find(Boolean);
  const siteUrl = (opts.siteUrl?.trim() || opts.targetUrl).replace(/\/$/, '');
  const identity: CrawlIdentity = {
    client_id: opts.clientId,
    business_name: businessName,
    design: manifest.palette
      ? { status: 'resolved', palette: { ...manifest.palette }, fonts: { heading: 'Inter', body: 'Inter' } }
      : { status: 'pending' },
    routes: routesFromCrawl(manifest.pages),
    seo_contract: { site_url: siteUrl },
  };
  if (phone) identity.seo_contract.phone = phone;
  return identity;
}

export function overlayCrawlIdentity(
  parsed: Record<string, unknown>,
  identity: CrawlIdentity,
): Record<string, unknown> {
  parsed.client_id = identity.client_id;
  parsed.business_name = identity.business_name;
  parsed.design = identity.design;
  parsed.routes = identity.routes;
  const seo = (parsed.seo_contract && typeof parsed.seo_contract === 'object' && !Array.isArray(parsed.seo_contract))
    ? { ...(parsed.seo_contract as Record<string, unknown>) }
    : {};
  seo.site_url = identity.seo_contract.site_url;
  if (identity.seo_contract.phone) seo.phone = identity.seo_contract.phone;
  parsed.seo_contract = seo;
  return parsed;
}
