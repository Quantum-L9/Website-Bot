// L9_META: layer=intelligence, role=verified_business_facts, status=active, version=1.0.0
//
// Deterministic derivation of VerifiedBusinessFacts from the operator-owned
// DomainSpec. Nothing here is invented: every fact is a value the operator
// supplied in the spec, carried with a source ref back to the spec field.

import type { VerifiedBusinessFact } from "@quantum-l9/bot-interop";
import type { DomainSpec } from "../pipeline/BuildContext.js";

export function verifiedBusinessFactsFromSpec(spec: DomainSpec): VerifiedBusinessFact[] {
  const facts: VerifiedBusinessFact[] = [
    {
      fact_id: "fact-business-name",
      key: "business_name",
      value: spec.business_name,
      verified: true,
      source_refs: ["domain_spec:business_name"],
    },
    {
      fact_id: "fact-vertical",
      key: "vertical",
      value: spec.vertical,
      verified: true,
      source_refs: ["domain_spec:vertical"],
    },
    {
      fact_id: "fact-states-served",
      key: "states_served",
      value: [...spec.geography.states],
      verified: true,
      source_refs: ["domain_spec:geography.states"],
    },
    {
      fact_id: "fact-primary-state",
      key: "primary_state",
      value: spec.geography.primary_state,
      verified: true,
      source_refs: ["domain_spec:geography.primary_state"],
    },
  ];
  const phone = spec.seo_contract?.phone?.trim();
  if (phone) {
    facts.push({
      fact_id: "fact-phone",
      key: "phone",
      value: phone,
      verified: true,
      source_refs: ["domain_spec:seo_contract.phone"],
    });
  }
  const siteUrl = spec.seo_contract?.site_url?.trim();
  if (siteUrl) {
    facts.push({
      fact_id: "fact-site-url",
      key: "site_url",
      value: siteUrl,
      verified: true,
      source_refs: ["domain_spec:seo_contract.site_url"],
    });
  }
  // Operator-verified business facts carried by the spec itself. These are
  // the literal phrases claim grounding validates against ("24/7", "free
  // inspection", warranty years, …) — without them, generated prose that
  // states a true client fact is scored as an unsupported claim (golden
  // run #15).
  for (const [key, value] of Object.entries(spec.business_facts ?? {})) {
    facts.push({
      fact_id: `fact-${key}`,
      key,
      value,
      verified: true,
      source_refs: [`domain_spec:business_facts.${key}`],
    });
  }
  return facts;
}
