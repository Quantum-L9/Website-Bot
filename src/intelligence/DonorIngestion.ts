// L9_META: layer=intelligence, role=donor_ingestion, status=active, version=1.0.0
//
// Real bounded donor acquisition (Campaign 7 R5). A donor record from the
// CompetitiveLandscape is NOT sufficient donor ingestion: each accepted donor
// must have at least one successfully fetched real page, deterministic page
// evidence, and at least one rendered screenshot. Donor raw assets remain
// analytical evidence only — disposition is always DONOR_REFERENCE_ONLY.

import { createHash } from "node:crypto";
import { promises as dnsPromises } from "node:dns";
import { mkdirSync, writeFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { resolve } from "node:path";
import { createModuleLogger } from "../core/logger.js";
import {
  PlaywrightScreenshotCapturer,
  type ScreenshotCapturer,
} from "../ingestion/ScreenshotCapturer.js";
import { stripHtmlTags } from "../lib/text-trim.mjs";

export { NoopScreenshotCapturer } from "../ingestion/ScreenshotCapturer.js";

const logger = createModuleLogger("intelligence:donor-ingestion");

export interface DonorPageEvidence {
  url: string;
  status: number;
  content_digest: string;
  content_bytes: number;
  /** Bounded visible text kept for nugget extraction. The digest still covers the fetched body. */
  content_excerpt?: string;
  fetched_at: string;
}

export interface AcceptedDonorEvidence {
  domain: string;
  serp_observation_ids: string[];
  pages: DonorPageEvidence[];
  screenshot_paths: string[];
  crawl_manifest_path: string;
  evidence_digest: string;
  crawled_at: string;
  disposition: "DONOR_REFERENCE_ONLY";
}

export interface DonorIngestionRequest {
  domain: string;
  /** Ranked candidate URLs from the CompetitiveLandscape plus bounded discovery. */
  candidate_urls: string[];
  serp_observation_ids: string[];
  output_dir: string;
  max_pages: number;
}

export interface DonorIngestor {
  /** Returns evidence when the donor is usable; null when it must be replaced. */
  ingest(request: DonorIngestionRequest): Promise<AcceptedDonorEvidence | null>;
  close(): Promise<void>;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha12(value: string): string {
  return sha256(value).slice(0, 12);
}

const MAX_BODY_BYTES = 1_048_576;
const EXCERPT_CHARS = 4_000;
const MAX_REDIRECTS = 5;

const BLOCKED_ADDRESSES = new BlockList();
BLOCKED_ADDRESSES.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED_ADDRESSES.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED_ADDRESSES.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED_ADDRESSES.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED_ADDRESSES.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED_ADDRESSES.addAddress("::", "ipv6");
BLOCKED_ADDRESSES.addAddress("::1", "ipv6");
BLOCKED_ADDRESSES.addSubnet("fc00::", 7, "ipv6");
BLOCKED_ADDRESSES.addSubnet("fe80::", 10, "ipv6");

export interface DonorFetchDeps {
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
}

class UnsafeDonorTarget extends Error {}

function mappedV4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const prefix = "::ffff:";
  if (!lower.startsWith(prefix)) return undefined;
  const rest = lower.slice(prefix.length);
  return isIP(rest) === 4 ? rest : undefined;
}

function addressBlocked(address: string): boolean {
  const bare = address.split("%")[0] ?? address;
  const v4 = mappedV4(bare);
  if (v4) return BLOCKED_ADDRESSES.check(v4, "ipv4");
  const family = isIP(bare);
  if (family === 4) return BLOCKED_ADDRESSES.check(bare, "ipv4");
  if (family === 6) return BLOCKED_ADDRESSES.check(bare, "ipv6");
  return true;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const records = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function assertPublicHttps(
  url: URL,
  resolveHost: DonorFetchDeps["resolveHost"],
): Promise<void> {
  if (url.protocol !== "https:") throw new UnsafeDonorTarget("donor URL must be https");
  if (!url.hostname) throw new UnsafeDonorTarget("donor URL has no host");
  const addresses = isIP(url.hostname)
    ? [url.hostname]
    : await (resolveHost ?? defaultResolveHost)(url.hostname);
  if (addresses.length === 0 || addresses.some(addressBlocked)) {
    throw new UnsafeDonorTarget("donor URL resolves to a local or private address");
  }
}

function isHtml(contentType: string | undefined): boolean {
  return !contentType || /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function sameHost(left: string, right: string): boolean {
  return left.replace(/\.$/, "").toLowerCase() === right.replace(/\.$/, "").toLowerCase();
}

function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || char === ">" || char === "/" || char.trim() === "";
}

/** Drop `<tag ...>...</tag ...>` including a spaced end tag such as `</script >`. */
function dropElements(html: string, tagName: string): string {
  const lower = html.toLowerCase();
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}`;
  let result = "";
  let cursor = 0;
  while (cursor < html.length) {
    const open = lower.indexOf(openToken, cursor);
    if (open === -1) return result + html.slice(cursor);
    if (!isTagBoundary(lower[open + openToken.length])) {
      result += html.slice(cursor, open + 1);
      cursor = open + 1;
      continue;
    }
    const close = lower.indexOf(closeToken, open + openToken.length);
    const closeEnd = close === -1 ? -1 : lower.indexOf(">", close + closeToken.length);
    if (closeEnd === -1) return result + html.slice(cursor, open);
    result += html.slice(cursor, open);
    cursor = closeEnd + 1;
  }
  return result;
}

function collapseSpace(value: string): string {
  let out = "";
  let pending = false;
  for (const char of value) {
    if (char.trim() === "") {
      pending = out.length > 0;
      continue;
    }
    if (pending) out += " ";
    pending = false;
    out += char;
  }
  return out;
}

function textExcerpt(body: string): string {
  const visible = collapseSpace(stripHtmlTags(dropElements(dropElements(body, "script"), "style")));
  return visible.slice(0, EXCERPT_CHARS);
}

async function readCappedBody(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!response.body) {
    const text = await response.text();
    return Buffer.byteLength(text) <= MAX_BODY_BYTES ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch-based bounded crawler with Playwright screenshots. No whole-site
 * crawling: only the supplied ranked URLs, capped by max_pages.
 */
export class HttpDonorIngestor implements DonorIngestor {
  private readonly screenshots: ScreenshotCapturer;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHost: DonorFetchDeps["resolveHost"];

  constructor(screenshots?: ScreenshotCapturer, deps?: DonorFetchDeps) {
    this.screenshots = screenshots ?? new PlaywrightScreenshotCapturer();
    this.fetchImpl = deps?.fetchImpl ?? fetch;
    this.resolveHost = deps?.resolveHost;
  }

  async ingest(request: DonorIngestionRequest): Promise<AcceptedDonorEvidence | null> {
    const pages: DonorPageEvidence[] = [];
    const screenshotPaths: string[] = [];
    const donorDir = resolve(request.output_dir, sha12(request.domain));
    mkdirSync(resolve(donorDir, "screenshots"), { recursive: true });

    const urls = request.candidate_urls.slice(0, Math.max(1, request.max_pages));
    for (const start of urls) {
      try {
        const fetched = await this.fetchPublic(start, request.domain);
        if (!fetched) continue;
        pages.push({
          url: fetched.url,
          status: fetched.status,
          content_digest: sha256(fetched.body),
          content_bytes: Buffer.byteLength(fetched.body),
          content_excerpt: textExcerpt(fetched.body),
          fetched_at: new Date().toISOString(),
        });
        if (screenshotPaths.length === 0) {
          const shot = await this.screenshots.capture({
            url: fetched.url,
            outputPath: resolve(donorDir, "screenshots", `${sha12(fetched.url)}.png`),
          });
          if (shot) screenshotPaths.push(shot);
        }
      } catch (error) {
        logger.warn(
          {
            donor: request.domain,
            url: start,
            reason: error instanceof Error ? error.message : String(error),
          },
          "donor page fetch failed; continuing bounded acquisition",
        );
      }
    }

    // Minimum evidence policy: >=1 fetched page AND >=1 rendered screenshot.
    if (pages.length === 0 || screenshotPaths.length === 0) {
      logger.warn(
        { donor: request.domain, pages: pages.length, screenshots: screenshotPaths.length },
        "donor failed minimum evidence policy; must be replaced",
      );
      return null;
    }

    const crawledAt = new Date().toISOString();
    const evidence: Omit<AcceptedDonorEvidence, "evidence_digest" | "crawl_manifest_path"> = {
      domain: request.domain,
      serp_observation_ids: [...request.serp_observation_ids],
      pages,
      screenshot_paths: screenshotPaths,
      crawled_at: crawledAt,
      disposition: "DONOR_REFERENCE_ONLY",
    };
    const evidenceDigest = sha256(JSON.stringify(evidence));
    const manifestPath = resolve(donorDir, "crawl-manifest.json");
    const complete: AcceptedDonorEvidence = {
      ...evidence,
      evidence_digest: evidenceDigest,
      crawl_manifest_path: manifestPath,
    };
    writeFileSync(manifestPath, `${JSON.stringify(complete, null, 2)}\n`, "utf-8");
    return complete;
  }

  private async fetchPublic(
    start: string,
    donorHost: string,
  ): Promise<{ url: string; status: number; body: string } | null> {
    let current = new URL(start);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!sameHost(current.hostname, donorHost)) return null;
      await assertPublicHttps(current, this.resolveHost);
      const response = await this.fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; L9-DonorEvidence/1.0)" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) return null;
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) return null;
      if (!isHtml(response.headers.get("content-type") ?? undefined)) return null;
      if (!sameHost(current.hostname, donorHost)) return null;
      const body = await readCappedBody(response);
      if (!body) return null;
      return { url: current.toString(), status: response.status, body };
    }
    return null;
  }

  async close(): Promise<void> {
    await this.screenshots.close();
  }
}
