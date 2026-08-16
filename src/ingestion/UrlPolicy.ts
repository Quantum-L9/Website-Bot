// L9_META: layer=ingestion, role=ssrf_url_policy, status=active, version=1.0.0
//
// Source-site ingestion accepts a URL from spec input, so every fetch target
// must be validated before a request is made and re-validated after any
// redirect. These are pure predicates over URL strings and resolved IP
// literals; the crawler layers network resolution on top and calls back here.

export interface UrlPolicyOptions {
  /** Allow requests to hostnames outside the seed's registrable domain. */
  allowSubdomains?: boolean;
  /** The seed host, used to scope the crawl when allowSubdomains is false. */
  seedHost?: string;
}

export class UrlPolicyError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "UrlPolicyError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Cloud metadata + obviously-internal hostnames that must never be fetched. */
const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

function ipv4Octets(hostname: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets;
}

/** True for loopback, private (RFC1918), link-local, CGNAT, and metadata ranges. */
export function isForbiddenIpv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** True for IPv6 loopback, unspecified, unique-local, and link-local addresses. */
export function isForbiddenIpv6(hostname: string): boolean {
  const raw = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!raw.includes(":")) return false;
  const lower = raw.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped (::ffff:127.0.0.1) — inspect the embedded literal.
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(lower);
  if (mapped && isForbiddenIpv4(mapped[1])) return true;
  return false;
}

export function isForbiddenHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (FORBIDDEN_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    return true;
  return false;
}

/** True when a literal (already-resolved) IP address must not be fetched. */
export function isForbiddenAddress(address: string): boolean {
  return isForbiddenIpv4(address) || isForbiddenIpv6(address);
}

/** Reduce a hostname to its registrable-ish suffix for same-site scoping. */
function registrableHost(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/, "").split(".");
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

/**
 * Validate a URL string against the ingestion policy. Throws UrlPolicyError with
 * a stable `reason` code on rejection; returns the parsed URL on success.
 */
export function assertUrlAllowed(rawUrl: string, options: UrlPolicyOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlPolicyError(`Not a valid absolute URL: ${rawUrl}`, "invalid-url");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UrlPolicyError(`Protocol not allowed: ${parsed.protocol}`, "forbidden-protocol");
  }
  const hostname = parsed.hostname;
  if (!hostname) throw new UrlPolicyError("URL has no hostname", "no-hostname");
  if (isForbiddenHostname(hostname)) {
    throw new UrlPolicyError(`Forbidden hostname: ${hostname}`, "forbidden-hostname");
  }
  if (isForbiddenAddress(hostname)) {
    throw new UrlPolicyError(`Forbidden address: ${hostname}`, "forbidden-address");
  }
  if (options.seedHost) {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    const seed = options.seedHost.toLowerCase().replace(/\.$/, "");
    // Without allowSubdomains the fetch host must be the seed host exactly; with
    // it, any host under the same registrable domain is in scope (but a sibling
    // registrable domain never is).
    const allowed = options.allowSubdomains
      ? registrableHost(host) === registrableHost(seed)
      : host === seed;
    if (!allowed) throw new UrlPolicyError(`Off-site host not allowed: ${hostname}`, "off-site");
  }
  return parsed;
}

export function isUrlAllowed(rawUrl: string, options: UrlPolicyOptions = {}): boolean {
  try {
    assertUrlAllowed(rawUrl, options);
    return true;
  } catch {
    return false;
  }
}
