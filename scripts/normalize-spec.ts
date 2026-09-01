// L9_META: layer=cli, role=spec_normalizer, status=active, version=1.0.0
//
// Deterministically transform a rich NESTED authoring spec (…/domain_spec.source.yaml)
// into the FLAT DomainSpec the pipeline consumes (…/domain_spec.normalized.yaml).
// Fully spec-driven: routes/components/titles come from the source's
// required_pages + page_templates, so new clients author only the rich format
// and the flat file is generated, never hand-maintained. Defaults target the
// bundled reference client under examples/supplemental-insurance-pros/.
//
// Usage (both `--in <p>` and `--in=<p>` forms are accepted):
//   tsx scripts/normalize-spec.ts                 # write the reference client's flat spec (examples/…)
//   tsx scripts/normalize-spec.ts --check         # verify the committed flat file matches (CI guard)
//   tsx scripts/normalize-spec.ts --in <p> --out <p>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import type { DomainSpec } from "../src/pipeline/BuildContext.js";
import { validateDomainSpec } from "../src/pipeline/validateDomainSpec.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read a flag value supporting both `--name=value` and `--name value` forms. */
function getArg(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return undefined;
}

/** Order-independent structural equality (objects compared key-by-key, not by
 *  serialized string) so `--check` fails only on real semantic drift. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) => Object.hasOwn(b as object, k) && deepEqual((a as any)[k], (b as any)[k]),
    );
  }
  return false;
}

// Generic path→title fallback. '/' → 'Home' is a universal site convention; any
// other display title a client wants (e.g. 'FAQ' vs 'Faq') is authored as an
// explicit `title:` on the source `required_pages` entry, not hardcoded here.
function titleFromPath(path: string): string {
  if (path === "/") return "Home";
  return path
    .replace(/^\//, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function hasPlaceholder(v: unknown): boolean {
  return typeof v === "string" && v.includes("{{") && v.includes("}}");
}

export function buildFlatSpec(nested: unknown): DomainSpec {
  const ds = (
    isObject(nested) && "domain_spec" in nested ? (nested as any).domain_spec : nested
  ) as any;

  const primaryRegions: string[] = ds.geography.primary_regions;

  // design: pending if the design is a placeholder or any brand token is a placeholder.
  const brandTokens = ds.design?.brand_tokens ?? {};
  const designPending =
    ds.design?.design_status === "placeholder" || Object.values(brandTokens).some(hasPlaceholder);

  // routes: each required_page resolves its components from its page_template
  // (by template_name, else by applies_to), or from an explicit `sections` list
  // on the page. Title comes from the page's explicit `title`, else the generic
  // path→title fallback. Fully spec-driven — no per-client sets baked into the tool.
  const templates: Array<{
    template_name?: string;
    applies_to?: string[];
    required_sections?: string[];
  }> = ds.content.page_templates ?? [];
  const routes = (ds.content.required_pages as any[]).map((p) =>
    routeFromRequiredPage(p, templates),
  );

  // lead_form_action: the concrete POST endpoint for lead forms. Authored at
  // conversion.lead_capture.form_action in the nested spec. validateDomainSpec
  // requires it whenever a route renders contact_form, so the transform carries
  // it through (placeholders excluded — those surface as wom_flags instead).
  const leadCapture = ds.conversion?.lead_capture ?? {};
  const leadFormAction: unknown = leadCapture.form_action;
  const contact = ds.identity?.contact_placeholders ?? {};
  const seoContract = buildSeoContract(ds, leadFormAction, contact);

  // wom_flags: emit a flag ONLY for items that are still UNRESOLVED (ordered as
  // reviewed in SD2). Critically, the error-severity gates (license number +
  // required disclaimers) are conditional on the underlying nested value still
  // being a `{{…PLACEHOLDER}}` token — once an operator fills in the real value
  // in inputs/, the flag drops and UnknownResolverStage stops blocking. Emitting
  // them unconditionally would leave the pipeline permanently unable to proceed.
  const womFlags = buildWomFlags(ds, contact, leadFormAction, designPending, primaryRegions);

  const flat: DomainSpec = {
    client_id: ds.metadata.spec_id,
    business_name: ds.identity.business_name,
    vertical: ds.market.niche,
    geography: { primary_state: primaryRegions[0], states: primaryRegions },
    design: { status: designPending ? "pending" : "resolved" },
    routes,
    seo_contract: seoContract,
    wom_flags: womFlags,
  };
  carryStructuredAssets(ds, flat);
  carryBuildIntent(ds, flat);
  carryClientVision(ds, flat);
  carryDesignReferences(ds, flat);
  carryStructuredDesignTokens(ds, flat);
  return flat;
}

const BUILD_INTENTS = ["COPY", "REDESIGN_IMPROVE"] as const;

/**
 * build_intent: carried from the rich spec when authored. Redesign clients
 * must be able to declare the transformation intent in the same document that
 * declares everything else; the flat file is generated, never hand-maintained,
 * so hand-adding it there was the only alternative.
 */
function carryBuildIntent(ds: any, flat: DomainSpec): void {
  const intent = ds.build_intent;
  if (intent === undefined) return;
  if (!BUILD_INTENTS.includes(intent)) {
    throw new Error(
      `build_intent must be one of ${BUILD_INTENTS.join("|")}, got ${JSON.stringify(intent)}`,
    );
  }
  flat.build_intent = intent;
}

/**
 * client_vision / design_references: first-party design authority blocks
 * (ADR-0018, WBV2-003 / WBV2-004). Carried verbatim — fail-closed validation
 * of a malformed declaration is the design-authority resolver's job at
 * pipeline time, not the normalizer's.
 */
function carryClientVision(ds: any, flat: DomainSpec): void {
  if (ds.client_vision === undefined) return;
  if (!isObject(ds.client_vision)) throw new Error("client_vision must be an object");
  flat.client_vision = ds.client_vision as DomainSpec["client_vision"];
}

function carryDesignReferences(ds: any, flat: DomainSpec): void {
  if (ds.design_references === undefined) return;
  if (!Array.isArray(ds.design_references)) throw new Error("design_references must be an array");
  flat.design_references = ds.design_references as DomainSpec["design_references"];
}

/**
 * Structured brand tokens: when the rich spec authors colors/typography as
 * maps (rather than {{PLACEHOLDER}} strings), they are first-party resolved
 * design the pipeline consumes directly (WBV2-007's first-party route).
 * Placeholder strings keep the legacy pending → LLM-generated path.
 */
function carryStructuredDesignTokens(ds: any, flat: DomainSpec): void {
  const brandTokens = ds.design?.brand_tokens ?? {};
  const colors = brandTokens.colors;
  const typography = brandTokens.typography;
  if (isObject(colors) && Object.keys(colors).length > 0) {
    flat.design = { ...flat.design, palette: colors as Record<string, string> };
  }
  if (isObject(typography)) {
    const fonts: Record<string, string> = {};
    if (typeof typography.heading === "string") fonts.font_heading = typography.heading;
    if (typeof typography.body === "string") fonts.font_body = typography.body;
    if (Object.keys(fonts).length > 0) flat.design = { ...flat.design, fonts };
  }
}

function routeFromRequiredPage(
  p: any,
  templates: Array<{
    template_name?: string;
    applies_to?: string[];
    required_sections?: string[];
  }>,
): DomainSpec["routes"][number] {
  const tpl =
    templates.find((t) => t.template_name && t.template_name === p.template) ??
    templates.find((t) => (t.applies_to ?? []).includes(p.path));
  const components = p.sections ?? tpl?.required_sections ?? [];
  const route: DomainSpec["routes"][number] = {
    slug: p.path,
    title: p.title ?? titleFromPath(p.path),
    components,
  };
  if (p.noindex === true) route.noindex = true;
  return route;
}

function buildSeoContract(ds: any, leadFormAction: unknown, contact: any): Record<string, unknown> {
  // seo_contract: flatten keyword clusters + carry rules; annotate per-route schema application.
  const clusters = [ds.seo.primary_keyword_cluster, ...(ds.seo.secondary_keyword_clusters ?? [])];
  const targetKeywords = clusters.flatMap((c: any) => c.keywords as string[]);
  const seoContract: Record<string, unknown> = {
    site_url: ds.identity.canonical_url,
    target_keywords: targetKeywords,
    metadata_rules: ds.seo.metadata_rules,
    schema_rules: ds.seo.schema_rules,
    schema_application: "per_route",
    internal_linking_rules: ds.seo.internal_linking_rules,
  };
  if (
    typeof leadFormAction === "string" &&
    leadFormAction.trim() !== "" &&
    !hasPlaceholder(leadFormAction)
  ) {
    seoContract.lead_form_action = leadFormAction.trim();
  }
  if (
    typeof contact.phone === "string" &&
    contact.phone.trim() !== "" &&
    !hasPlaceholder(contact.phone)
  ) {
    seoContract.phone = contact.phone.trim();
  }
  return seoContract;
}

function buildWomFlags(
  ds: any,
  contact: any,
  leadFormAction: unknown,
  designPending: boolean,
  primaryRegions: string[],
): DomainSpec["wom_flags"] {
  const licenses = (ds.authority?.licenses ?? []) as any[];
  const licenseUnresolved = licenses.some((l) => hasPlaceholder(l?.license_number));
  const stateRules = ds.compliance?.state_specific_rules;
  const stateUnvalidated =
    stateRules?.validation_required_before_launch === true || stateRules?.status === "Unknown";

  return [
    ...(hasPlaceholder(contact.phone)
      ? [{ key: "identity.contact.phone", value: "unresolved", severity: "warning" as const }]
      : []),
    ...(hasPlaceholder(contact.email)
      ? [{ key: "identity.contact.email", value: "unresolved", severity: "warning" as const }]
      : []),
    ...(hasPlaceholder(contact.address)
      ? [{ key: "identity.contact.address", value: "unresolved", severity: "warning" as const }]
      : []),
    ...(hasPlaceholder(leadFormAction)
      ? [
          {
            key: "conversion.lead_capture.form_action",
            value: "unresolved",
            severity: "error" as const,
          },
        ]
      : []),
    ...(licenseUnresolved
      ? [{ key: "authority.license_number", value: "unresolved", severity: "error" as const }]
      : []),
    ...((ds.compliance?.disclaimers ?? []) as any[])
      .filter((d) => d.required && hasPlaceholder(d.text))
      .map((d) => ({
        key: `compliance.${d.name}`,
        value: "unresolved",
        severity: "error" as const,
      })),
    ...(designPending
      ? [{ key: "design.brand_tokens", value: "placeholder", severity: "warning" as const }]
      : []),
    ...(stateUnvalidated
      ? [
          {
            key: "state_compliance_unvalidated",
            value: (stateRules?.affected_states ?? primaryRegions).join(","),
            severity: "warning" as const,
          },
        ]
      : []),
  ];
}

function carryStructuredAssets(ds: any, flat: DomainSpec): void {
  // assets: carried through verbatim when authored. The flat `assets` block is
  // already in pipeline shape (sourceSite/providedImages/imageSlots), so there is
  // nothing to derive — losing it here would silently drop the image pipeline
  // inputs from the normalized spec the pipeline actually consumes.
  // Only a STRUCTURED asset block (sourceSite / providedImages / imageSlots /
  // generation) is carried. The legacy authoring format also uses `assets` for a
  // freeform {logo, photos, icons} note; that shape is not the pipeline contract
  // and is intentionally ignored so it never reaches the normalized spec.
  if (
    isObject(ds.assets) &&
    ["sourceSite", "providedImages", "imageSlots", "generation"].some(
      (key) => key in (ds.assets as object),
    )
  ) {
    flat.assets = ds.assets as DomainSpec["assets"];
  }
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  // Defaults point at the bundled reference client under examples/. Real client
  // builds pass explicit --in/--out (or CLIENT_ID/spec_path via the workflows).
  const inPath =
    getArg(args, "--in") ?? "examples/supplemental-insurance-pros/domain_spec.source.yaml";
  const outPath =
    getArg(args, "--out") ?? "examples/supplemental-insurance-pros/domain_spec.normalized.yaml";

  const flat = buildFlatSpec(parse(readFileSync(inPath, "utf-8")));
  validateDomainSpec(flat, `${inPath} (normalized)`); // fail loud if the transform ever produces an invalid spec

  if (check) {
    const committed = parse(readFileSync(outPath, "utf-8"));
    if (!deepEqual(flat, committed)) {
      console.error(
        `normalize-spec --check FAILED: ${outPath} is stale.\nRegenerate with: tsx scripts/normalize-spec.ts`,
      );
      // Show the first differing key for a quick diagnosis.
      for (const k of Object.keys(flat)) {
        if (!deepEqual((flat as any)[k], (committed as any)?.[k])) {
          console.error(`  first diff at key: ${k}`);
          break;
        }
      }
      process.exit(1);
    }
    console.log(`normalize-spec --check OK: ${outPath} matches normalize(${inPath}).`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, stringify(flat), "utf-8");
  console.log(`Wrote ${outPath} from ${inPath}.`);
}

main();
