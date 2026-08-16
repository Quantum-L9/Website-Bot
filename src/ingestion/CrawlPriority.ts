// L9_META: layer=ingestion, role=crawl_priority, status=active, version=1.0.0
//
// Gallery / portfolio / work pages carry the photos operators expect to reuse.
// A FIFO BFS that fills maxPages with service URLs never reaches them.

export const MEDIA_PAGE_PATH =
  /\/(gallery|portfolio|our-work|work|projects|photos|before-and-after|before-after)\b/i;

/** Lower number is crawled sooner. Media pages beat generic service lists. */
export function crawlPagePriority(url: string): number {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return 9;
  }
  if (MEDIA_PAGE_PATH.test(path)) return 0;
  if (/\/(services?|about|contact)\b/.test(path)) return 1;
  return 2;
}

export function hasMediaPage(urls: readonly string[]): boolean {
  return urls.some((url) => {
    try {
      return MEDIA_PAGE_PATH.test(new URL(url).pathname);
    } catch {
      return MEDIA_PAGE_PATH.test(url);
    }
  });
}
