// L9_META: layer=ingestion, role=page_extractor, status=active, version=1.0.0
//
// Reduce a fetched HTML document to the structured signals the planner needs:
// page metadata, internal links, and image candidates discovered across more
// than <img src> — srcset, <picture><source>, Open Graph, CSS backgrounds,
// linked assets, and JSON-LD image fields. Pure and DOM-library-free (regex over
// markup); good enough for real marketing sites and fully deterministic in CI.

export type ImageOrigin =
  | "img"
  | "srcset"
  | "picture"
  | "og"
  | "background"
  | "link"
  | "structured-data";

export interface RawImageCandidate {
  url: string;
  altText?: string;
  title?: string;
  origin: ImageOrigin;
  nearestHeading?: string;
  cssClasses: string[];
  isAboveFold: boolean;
}

export interface ExtractedNavItem {
  href: string;
  label: string;
}

export interface ExtractedPage {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  headings: string[];
  textExcerpt?: string;
  bodyText?: string;
  phones: string[];
  nav: ExtractedNavItem[];
  links: string[];
  images: RawImageCandidate[];
  stylesheets: string[];
}

const ABOVE_FOLD_BYTES = 24_000;
const BODY_TEXT_CHARS = 8_000;

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function attr(tag: string, name: string): string | undefined {
  // Quoted forms first, then a bare token — two linear regexes reproduce the
  // original single-alternation matcher exactly without the quote/word overlap.
  const quoted = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  if (quoted) return decodeEntities(quoted[2] ?? quoted[3] ?? "");
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  if (!bare) return undefined;
  return decodeEntities(bare[1]);
}

function absolute(href: string | undefined, baseUrl: string): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
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
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .map((url) => absolute(url, baseUrl))
    .filter((url): url is string => Boolean(url));
}

/** Format a tel: href into a display number. NANP becomes (704) 648-7252. */
export function formatObservedPhone(href: string): string | undefined {
  const digits = href.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const national = digits.slice(1);
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  return undefined;
}

function extractPhones(html: string): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
    const formatted = formatObservedPhone(match[1]);
    if (!formatted || seen.has(formatted)) continue;
    seen.add(formatted);
    phones.push(formatted);
  }
  return phones;
}

function extractNav(html: string, baseUrl: string): ExtractedNavItem[] {
  const header =
    /<header\b[^>]*>([\s\S]*?)<\/header>/i.exec(html)?.[1] ??
    /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(html)?.[1] ??
    "";
  if (!header) return [];
  const items: ExtractedNavItem[] = [];
  const seen = new Set<string>();
  for (const match of header.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(match[1], "href");
    if (!href || href.startsWith("#") || href.startsWith("tel:") || href.startsWith("mailto:"))
      continue;
    const abs = absolute(href, baseUrl);
    if (!abs) continue;
    let path: string;
    try {
      path = new URL(abs).pathname.replace(/\/$/, "") || "/";
    } catch {
      continue;
    }
    if (path === "/" || seen.has(path)) continue;
    const label = stripTags(match[2]).replace(/\s+/g, " ").trim();
    if (!label || label.length > 40) continue;
    seen.add(path);
    items.push({ href: path, label });
  }
  return items;
}

function headingBefore(
  headingPositions: Array<{ index: number; text: string }>,
  index: number,
): string | undefined {
  let found: string | undefined;
  for (const heading of headingPositions) {
    if (heading.index <= index) found = heading.text;
    else break;
  }
  return found;
}

function collectImageNode(node: unknown, baseUrl: string, urls: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((entry) => {
      collectImageNode(entry, baseUrl, urls);
    });
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "image") {
      if (typeof value === "string") {
        const abs = absolute(value, baseUrl);
        if (abs) urls.push(abs);
      } else if (Array.isArray(value))
        value.forEach((entry) => {
          if (typeof entry === "string") {
            const abs = absolute(entry, baseUrl);
            if (abs) urls.push(abs);
          } else collectImageNode(entry, baseUrl, urls);
        });
      else collectImageNode(value, baseUrl, urls);
    } else {
      collectImageNode(value, baseUrl, urls);
    }
  }
}

function collectStructuredDataImages(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const blocks = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    try {
      collectImageNode(JSON.parse(block[1].trim()), baseUrl, urls);
    } catch {
      // Malformed JSON-LD is ignored rather than failing the crawl.
    }
  }
  return urls;
}

function extractHeadMetadata(html: string): { title?: string; metaTags: string[] } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") || undefined;
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  return { title, metaTags };
}

function extractMetaDescription(metaTags: string[]): { description?: string; ogImage?: string } {
  let description: string | undefined;
  let ogImage: string | undefined;
  for (const tag of metaTags) {
    const name = attr(tag, "name")?.toLowerCase();
    const property = attr(tag, "property")?.toLowerCase();
    if (name === "description" && !description) description = attr(tag, "content");
    if (
      (property === "og:image" || property === "og:image:url" || name === "twitter:image") &&
      !ogImage
    )
      ogImage = attr(tag, "content");
  }
  return { description, ogImage };
}

function extractCanonicalAndStylesheets(
  html: string,
  baseUrl: string,
): { canonicalUrl?: string; stylesheets: string[] } {
  let canonicalUrl: string | undefined;
  const stylesheets: string[] = [];
  for (const tag of [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0])) {
    const rel = attr(tag, "rel")?.toLowerCase() ?? "";
    if (rel === "canonical") canonicalUrl = absolute(attr(tag, "href"), baseUrl);
    if (/\bstylesheet\b/.test(rel)) {
      const href = absolute(attr(tag, "href"), baseUrl);
      if (href) stylesheets.push(href);
    }
  }
  return { canonicalUrl, stylesheets };
}

function extractHeadings(html: string): {
  headingPositions: Array<{ index: number; text: string }>;
  headings: string[];
} {
  const headingPositions: Array<{ index: number; text: string }> = [];
  for (const match of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const text = stripTags(match[1]);
    if (text) headingPositions.push({ index: match.index ?? 0, text });
  }
  const headings = headingPositions.map((heading) => heading.text);
  return { headingPositions, headings };
}

function collectImages(
  html: string,
  baseUrl: string,
  headingPositions: Array<{ index: number; text: string }>,
  ogImage: string | undefined,
): RawImageCandidate[] {
  const images: RawImageCandidate[] = [];
  const seen = new Set<string>();
  const push = (
    url: string | undefined,
    origin: ImageOrigin,
    extra: Partial<RawImageCandidate> = {},
  ): void => {
    if (!url || seen.has(`${origin}:${url}`)) return;
    seen.add(`${origin}:${url}`);
    images.push({ url, origin, cssClasses: [], isAboveFold: false, ...extra });
  };

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const index = match.index ?? 0;
    const meta: Partial<RawImageCandidate> = {
      altText: attr(tag, "alt"),
      title: attr(tag, "title"),
      cssClasses: (attr(tag, "class") ?? "").split(/\s+/).filter(Boolean),
      isAboveFold: index < ABOVE_FOLD_BYTES,
      nearestHeading: headingBefore(headingPositions, index),
    };
    push(absolute(attr(tag, "src"), baseUrl), "img", meta);
    const srcset = attr(tag, "srcset");
    if (srcset) for (const url of parseSrcset(srcset, baseUrl)) push(url, "srcset", meta);
  }

  for (const match of html.matchAll(/<source\b[^>]*>/gi)) {
    const srcset = attr(match[0], "srcset") ?? attr(match[0], "src");
    if (srcset)
      for (const url of parseSrcset(srcset, baseUrl))
        push(url, "picture", { isAboveFold: (match.index ?? 0) < ABOVE_FOLD_BYTES });
  }

  for (const match of html.matchAll(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi)) {
    push(absolute(match[2], baseUrl), "background", {
      isAboveFold: (match.index ?? 0) < ABOVE_FOLD_BYTES,
    });
  }

  if (ogImage) push(absolute(ogImage, baseUrl), "og", { isAboveFold: true });
  for (const url of collectStructuredDataImages(html, baseUrl)) push(url, "structured-data");
  return images;
}

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const { title, metaTags } = extractHeadMetadata(html);
  const { description, ogImage } = extractMetaDescription(metaTags);
  const { canonicalUrl, stylesheets } = extractCanonicalAndStylesheets(html, baseUrl);
  const { headingPositions, headings } = extractHeadings(html);
  const images = collectImages(html, baseUrl, headingPositions, ogImage);

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  const bodyText = stripTags(stripped).slice(0, BODY_TEXT_CHARS) || undefined;
  const textExcerpt = bodyText ? bodyText.slice(0, 500) : undefined;
  const phones = extractPhones(html);
  const nav = extractNav(html, baseUrl);

  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = absolute(attr(match[0], "href"), baseUrl);
    if (href) links.push(href);
  }

  return {
    title,
    description,
    canonicalUrl,
    headings,
    textExcerpt,
    bodyText,
    phones,
    nav,
    links,
    images,
    stylesheets,
  };
}
