// L9_META: layer=service, role=source_copy_port, status=active, version=1.0.0
//
// Reconstruction is the only path when a source site was crawled: port observed
// copy, do not ask an LLM to invent a new brochure. Generation is a gap filler.

import type { IngestedPage, SourceSiteManifest } from '../../pipeline/evidence/SourceSiteManifest.js';
import { stripMarkdownDecorators } from './plainText.js';

const LAME_CTA = /tell us about the job|take the next step|we usually reply/i;
const OFFER_HEADLINE = 'Free Roof Inspection Within 24 Hours';

export function pagePath(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '');
    return path || '/';
  } catch {
    return url.replace(/\/$/, '') || '/';
  }
}

export function matchSourcePage(manifest: SourceSiteManifest | undefined, slug: string): IngestedPage | undefined {
  if (!manifest?.pages.length) return undefined;
  const wanted = slug.replace(/\/$/, '') || '/';
  return manifest.pages.find(page => pagePath(page.url) === wanted)
    ?? (wanted === '/' ? manifest.pages.find(page => page.depth === 0) : undefined);
}

export function isTopNavHref(href: string): boolean {
  let path: string;
  try {
    path = new URL(href, 'https://nav.example').pathname.replace(/\/$/, '') || '/';
  } catch {
    path = href.replace(/\/$/, '') || '/';
  }
  const parts = path.split('/').filter(Boolean);
  return parts.length === 1;
}

export function topNavFromSource(manifest: SourceSiteManifest | undefined): Array<{ href: string; label: string }> {
  const home = matchSourcePage(manifest, '/');
  const items = home?.nav ?? [];
  const seen = new Set<string>();
  const out: Array<{ href: string; label: string }> = [];
  for (const item of items) {
    if (!isTopNavHref(item.href)) continue;
    const href = item.href.replace(/\/$/, '') || '/';
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label: item.label });
    if (out.length >= 8) break;
  }
  return out;
}

export function faqsFromManifest(manifest: SourceSiteManifest | undefined): Array<{ question: string; answer: string }> {
  if (!manifest?.pages.length) return [];
  const faqPage = manifest.pages.find(page => {
    const path = pagePath(page.url);
    const haystack = `${path} ${page.title ?? ''} ${page.headings.join(' ')}`;
    return /faq/i.test(haystack);
  }) ?? manifest.pages.find(page => page.headings.some(heading => heading.includes('?')));
  if (!faqPage) return [];
  const questions = faqPage.headings
    .map(heading => heading.trim())
    .filter(heading => heading.includes('?'));
  const paras = (faqPage.bodyText || faqPage.textExcerpt || '')
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/)
    .map(part => part.trim())
    .filter(part => part.length > 20 && !part.endsWith('?'));
  const out: Array<{ question: string; answer: string }> = [];
  for (const question of questions) {
    const answer = paras.find(part => !part.includes(question)) ?? paras[0];
    if (!answer) continue;
    out.push({ question, answer: answer.slice(0, 500) });
    if (out.length >= 8) break;
  }
  return out;
}

export function firstSourcePhone(manifest: SourceSiteManifest | undefined): string | undefined {
  for (const page of manifest?.pages ?? []) {
    const phone = page.phones?.[0];
    if (phone) return phone;
  }
  return undefined;
}

function bodyParagraphs(page: IngestedPage): string[] {
  const raw = page.bodyText || page.textExcerpt || page.description || '';
  return raw
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/)
    .map(part => part.trim())
    .filter(part => part.length > 40)
    .slice(0, 4);
}

export function assembleSourceSection(page: IngestedPage, component: string): string {
  const key = component.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const heading = page.headings[0] || page.title || '';
  const paras = bodyParagraphs(page);
  if (/^(cta|final_cta|contact_form)$/.test(key)) {
    const rest = paras[0] && !LAME_CTA.test(paras[0]) ? paras[0] : 'Call or text for a free inspection. We respond within 24 hours.';
    return stripMarkdownDecorators(`${OFFER_HEADLINE}\n\n${rest}`);
  }
  if (key === 'gallery') {
    return stripMarkdownDecorators(`${page.headings.find(h => /work|gallery|before/i.test(h)) || 'Our Work'}\n\n${paras[0] || ''}`.trim());
  }
  if (key === 'hero') {
    const rest = page.description || paras[0] || '';
    return stripMarkdownDecorators([heading, rest].filter(Boolean).join('\n\n'));
  }
  return stripMarkdownDecorators([heading, ...paras].filter(Boolean).join('\n\n'));
}
