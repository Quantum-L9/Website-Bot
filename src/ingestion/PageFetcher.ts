// L9_META: layer=ingestion, role=page_fetcher, status=active, version=1.0.0
//
// HTTP(S) fetch with SSRF controls applied on every hop. The URL policy check is
// injectable: production wires the real assertUrlAllowed (plus DNS-resolved
// address checks); the crawl fixture in CI injects a loopback-permitting checker
// so the hermetic test server is reachable while production stays fail-closed.

export interface FetchedResource {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  body: Buffer;
}

export interface FetcherOptions {
  navigationTimeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
  /** Called with every hop URL before the request; throw to reject (SSRF gate). */
  validateUrl?: (url: string) => void | Promise<void>;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export class PageFetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "PageFetchError";
  }
}

export class HttpPageFetcher {
  private readonly navigationTimeoutMs: number;
  private readonly maxRedirects: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;

  constructor(private readonly options: FetcherOptions = {}) {
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 20_000;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
    this.userAgent = options.userAgent ?? "L9-Website-Bot-Crawler/1.0 (+https://quantum-l9.dev)";
  }

  async fetch(startUrl: string): Promise<FetchedResource> {
    let current = startUrl;
    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      await this.options.validateUrl?.(current);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.navigationTimeoutMs);
      let response: Response;
      try {
        response = await fetch(current, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": this.userAgent, accept: "*/*" },
        });
      } catch (error) {
        throw new PageFetchError(`fetch failed: ${String(error)}`, current);
      } finally {
        clearTimeout(timer);
      }

      if (REDIRECT_STATUS.has(response.status)) {
        const location = response.headers.get("location");
        if (!location)
          throw new PageFetchError(`redirect without Location (${response.status})`, current);
        current = new URL(location, current).toString();
        continue;
      }

      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (declaredLength > this.maxBytes)
        throw new PageFetchError(`content-length ${declaredLength} exceeds cap`, current);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > this.maxBytes)
        throw new PageFetchError(`body ${body.byteLength} exceeds cap`, current);
      return {
        requestedUrl: startUrl,
        finalUrl: current,
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        body,
      };
    }
    throw new PageFetchError(`too many redirects (> ${this.maxRedirects})`, startUrl);
  }
}
