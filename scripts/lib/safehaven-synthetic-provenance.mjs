#!/usr/bin/env node
/*
 * SAFE HAVEN GOLDEN - SYNTHETIC EVIDENCE PROVENANCE
 *
 * The Golden oracle refuses to let a synthetic calibration fixture certify a
 * real run. That refusal used to rest entirely on the fixture declaring
 * itself: `calibration.synthetic === true`. A single deleted field turned a
 * calibration fixture into something the verifier would accept as real
 * evidence.
 *
 * A declaration cannot be the boundary, because a declaration can be removed.
 * Neither can a seal alone: any digest the builder can compute is a discrete
 * field that can be deleted just as easily. The durable boundary is the
 * evidence itself. A synthetic fixture is built out of values that CANNOT
 * occur in a real run - reserved-TLD hostnames guaranteed never to resolve,
 * git SHAs with no plausible entropy - and those values sit in fields the
 * oracle requires, dozens of times over. Removing them is not editing a flag;
 * it is fabricating an entire receipt, which is a different threat that no
 * marker scheme can address and that the oracle's real-evidence requirements
 * (real DataForSEO observations, full git SHAs, evidence digests, timestamps)
 * already price in.
 *
 * This module holds the shared vocabulary. Detection lives in the verifier;
 * stamping lives in the builder. Both import from here so they cannot drift.
 */
import crypto from "node:crypto";

/*
 * Reserved namespace stamped into builder-produced identifiers. Precise and
 * greppable, but strippable - the diagnostic layer, never the load-bearing
 * one.
 */
export const SYNTHETIC_NAMESPACE = "l9-synthetic-calibration";

/* Domain separation for the provenance seal. */
export const SEAL_DOMAIN = "l9.safehaven.synthetic-provenance/v1";

/*
 * RFC 2606 / RFC 6761 reserved names. These are reserved precisely so that
 * they never resolve and are never registrable, so a real crawl, a real
 * screenshot, or a real DataForSEO observation can never produce one.
 */
export const RESERVED_TLDS = [
  "invalid",
  "test",
  "example",
  "localhost"
];
export const RESERVED_DOMAINS = [
  "example.com",
  "example.net",
  "example.org"
];

/*
 * A real SHA-1 is 40 nibbles drawn from 16 symbols and carries roughly 15
 * distinct hex digits. Fewer than 8 distinct digits does not arise by chance
 * in any realistic universe - it arises when a human types a placeholder.
 */
export const MINIMUM_DISTINCT_SHA_NIBBLES = 8;

export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  /*
   * Sort with an explicit code-unit comparator, never String.localeCompare:
   * a canonical form must produce the same bytes on every machine, and
   * locale-aware collation varies with the runtime's ICU data. This ordering
   * is identical to the default sort for string keys, and Object.keys only
   * ever yields strings.
   */
  return `{${Object.keys(value)
    .sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    })
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

/*
 * The seal covers the whole receipt except the seal field itself, so stamping
 * is idempotent and any edit to the body invalidates it.
 *
 * This is a labelled digest, not a signature: the algorithm is public, so
 * anyone can compute a valid seal for any body. That is deliberate, and it is
 * the honest limit of this layer. It proves "this body came out of the
 * calibration builder unmodified"; it cannot prove the converse, and it is
 * never the only thing standing between a fixture and a real-mode PASS.
 */
export function sealableBody(receipt) {
  const body = structuredClone(receipt);
  if (body && typeof body.calibration === "object" && body.calibration) {
    delete body.calibration.provenance_seal;
  }
  return body;
}

export function provenanceSeal(receipt) {
  return crypto
    .createHash("sha256")
    .update(SEAL_DOMAIN)
    .update(" ")
    .update(canonicalize(sealableBody(receipt)))
    .digest("hex");
}

/*
 * Extract a hostname from a value that is either an absolute URL or a bare
 * hostname. Anything else - file paths, version strings, timestamps, ids -
 * yields null, so the reserved-host scan cannot fire on non-host content.
 */
export function hostOf(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  const bareHost =
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  if (bareHost.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return null;
}

export function reservedHostReason(host) {
  if (!host) return null;
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  if (RESERVED_TLDS.includes(tld)) return `reserved TLD .${tld}`;
  const registrable = labels.slice(-2).join(".");
  if (RESERVED_DOMAINS.includes(registrable)) {
    return `reserved domain ${registrable}`;
  }
  return null;
}

export function degenerateShaReason(sha) {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/i.test(sha)) return null;
  const distinct = new Set(sha.toLowerCase()).size;
  if (distinct < MINIMUM_DISTINCT_SHA_NIBBLES) {
    return `only ${distinct} distinct hex digits`;
  }
  return null;
}

/* Walk every string in a receipt, reporting its dotted path. */
export function walkStrings(value, visit, pathParts = []) {
  if (typeof value === "string") {
    visit(value, pathParts.join("."));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      walkStrings(entry, visit, [...pathParts, `[${index}]`])
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      walkStrings(entry, visit, [...pathParts, key]);
    }
  }
}
