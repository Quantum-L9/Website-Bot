// L9_META: layer=ingestion, role=page_extractor, status=active, version=1.0.0
//
// Reduce a fetched HTML document to the structured signals the planner needs:
// page metadata, internal links, and image candidates discovered across more
// than <img src> — srcset, <picture><source>, Open Graph, CSS backgrounds,
// linked assets, and JSON-LD image fields. Pure and DOM-library-free (regex over
// markup); good enough for real marketing sites and fully deterministic in CI.

export type ImageOrigin = 'img' | 'srcset' | 'picture' | 'og' | 'background' | 'link' | 'structured-data';

export interface RawImageCandidate {
  url: string;
  altText?: string;
  title?: string;
  origin: ImageOrigin;
  nearestHeading?: string;
  cssClasses: string[];
  isAboveFold: boolean;
}

export interface ExtractedPage {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  headings: string[];
  textExcerpt?: string;
  links: string[];
  images: RawImageCandidate[];
}

const ABOVE_FOLD_BYTES = 2000;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!match) return undefined;
  const raw = match[2] ?? match[3] ?? match[4] ?? '';
  return decodeEntities(raw);
}

function absolute(href: string | undefined, baseUrl: string): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return undefined;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/** Parse a srcset attribute into its candidate URLs (widths/densities dropped). */
function parseSrcset(srcset: string, baseUrl: string): string[] {
  return srcset
    .split(',')
    .map(part => part.trim().split(/\s+/)[0])
    .map(url => absolute(url, baseUrl))
    .filter((url): url is string => Boolean(url));
}

function headingBefore(headingPositions: Array<{ index: number; text: string }>, index: number): string | undefined {
  let found: string | undefined;
  for (const heading of headingPositions) {
    if (heading.index <= index) found = heading.text;
    else break;
  }
  return found;
}

function collectStructuredDataImages(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const blocks = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    try {
      const walk = (node: unknown): void => {
        if (!node) return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (typeof node === 'object') {
          for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (key === 'image') {
              if (typeof value === 'string') { const abs = absolute(value, baseUrl); if (abs) urls.push(abs); }
              else if (Array.isArray(value)) value.forEach(v => { if (typeof v === 'string') { const abs = absolute(v, baseUrl); if (abs) urls.push(abs); } else walk(v); });
              else walk(value);
            } else {
              walk(value);
            }
          }
        }
      };
      walk(JSON.parse(block[1].trim()));
    } catch {
      // Malformed JSON-LD is ignored rather than failing the crawl.
    }
  }
  return urls;
}

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '') || undefined;

  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
  let description: string | undefined;
  let ogImage: string | undefined;
  for (const tag of metaTags) {
    const name = attr(tag, 'name')?.toLowerCase();
    const property = attr(tag, 'property')?.toLowerCase();
    if (name === 'description' && !description) description = attr(tag, 'content');
    if ((property === 'og:image' || property === 'og:image:url' || name === 'twitter:image') && !ogImage) ogImage = attr(tag, 'content');
  }

  let canonicalUrl: string | undefined;
  for (const tag of [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0])) {
    if (attr(tag, 'rel')?.toLowerCase() === 'canonical') { canonicalUrl = absolute(attr(tag, 'href'), baseUrl); break; }
  }

  const headingPositions: Array<{ index: number; text: string }> = [];
  for (const match of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const text = stripTags(match[1]);
    if (text) headingPositions.push({ index: match.index ?? 0, text });
  }
  const headings = headingPositions.map(heading => heading.text);

  const bodyText = stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  const textExcerpt = bodyText ? bodyText.slice(0, 300) : undefined;

  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = absolute(attr(match[0], 'href'), baseUrl);
    if (href) links.push(href);
  }

  const images: RawImageCandidate[] = [];
  const seen = new Set<string>();
  const push = (url: string | undefined, origin: ImageOrigin, extra: Partial<RawImageCandidate> = {}): void => {
    if (!url || seen.has(`${origin}:${url}`)) return;
    seen.add(`${origin}:${url}`);
    images.push({ url, origin, cssClasses: [], isAboveFold: false, ...extra });
  };

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const index = match.index ?? 0;
    const meta: Partial<RawImageCandidate> = {
      altText: attr(tag, 'alt'),
      title: attr(tag, 'title'),
      cssClasses: (attr(tag, 'class') ?? '').split(/\s+/).filter(Boolean),
      isAboveFold: index < ABOVE_FOLD_BYTES,
      nearestHeading: headingBefore(headingPositions, index),
    };
    push(absolute(attr(tag, 'src'), baseUrl), 'img', meta);
    const srcset = attr(tag, 'srcset');
    if (srcset) for (const url of parseSrcset(srcset, baseUrl)) push(url, 'srcset', meta);
  }

  for (const match of html.matchAll(/<source\b[^>]*>/gi)) {
    const srcset = attr(match[0], 'srcset') ?? attr(match[0], 'src');
    if (srcset) for (const url of parseSrcset(srcset, baseUrl)) push(url, 'picture', { isAboveFold: (match.index ?? 0) < ABOVE_FOLD_BYTES });
  }

  for (const match of html.matchAll(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi)) {
    push(absolute(match[2], baseUrl), 'background', { isAboveFold: (match.index ?? 0) < ABOVE_FOLD_BYTES });
  }

  if (ogImage) push(absolute(ogImage, baseUrl), 'og', { isAboveFold: true });
  for (const url of collectStructuredDataImages(html, baseUrl)) push(url, 'structured-data');

  return { title, description, canonicalUrl, headings, textExcerpt, links, images };
}
