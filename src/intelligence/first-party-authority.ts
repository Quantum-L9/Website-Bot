import { createHash } from "node:crypto";
import {
  canonicalJson,
  FIRST_PARTY_AUTHORITY_SCHEMA,
  type FirstPartyAuthorityRecord,
} from "@quantum-l9/bot-interop";
import type { DomainSpec } from "../pipeline/BuildContext.js";

/**
 * Market research is opt-in. Only an explicit "requested" buys a landscape.
 * Absence and "not_requested" both mean the domain spec is the authority.
 */
export function marketResearchRequested(spec: DomainSpec | undefined): boolean {
  return spec?.market_research === "requested";
}

/** sha256 of the canonical domain spec. This is the digest the authority record cites. */
export function domainSpecDigest(spec: DomainSpec): string {
  return createHash("sha256").update(canonicalJson(spec)).digest("hex");
}

export function firstPartyAuthorityFromSpec(spec: DomainSpec): FirstPartyAuthorityRecord {
  return {
    schema: FIRST_PARTY_AUTHORITY_SCHEMA,
    market_research: "not_requested",
    domain_spec_digest: domainSpecDigest(spec),
    donor_count: 0,
  };
}
