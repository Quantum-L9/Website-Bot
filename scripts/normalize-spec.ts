// L9_META: layer=cli, role=spec_normalizer, status=active, version=1.0.0
//
// Deterministically transform the rich NESTED authoring spec
// (inputs/domain_spec.source.yaml) into the FLAT DomainSpec the pipeline
// consumes (domain_spec/domain_spec.normalized.yaml). Encodes the reviewed SD2
// field mapping so new clients author only the rich format and the flat file is
// generated, never hand-maintained.
//
// Usage (both `--in <p>` and `--in=<p>` forms are accepted):
//   tsx scripts/normalize-spec.ts                 # write domain_spec/domain_spec.normalized.yaml
//   tsx scripts/normalize-spec.ts --check         # verify the committed flat file matches (CI guard)
//   tsx scripts/normalize-spec.ts --in <p> --out <p>
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { parse, stringify } from 'yaml';
import { validateDomainSpec } from '../src/pipeline/validateDomainSpec.js';
import type { DomainSpec } from '../src/pipeline/BuildContext.js';

// Pages with no `page_template` in the source → component sets derived (and reviewed) in SD2.
const DERIVED_COMPONENTS: Record<string, string[]> = {
  '/about': ['hero', 'credentials', 'experience', 'cta'],
  '/contact': ['hero', 'contact_form', 'cta'],
  '/thank-you': ['hero', 'confirmation'],
};
// Titles that don't fall out of the path-title rule.
const TITLE_OVERRIDES: Record<string, string> = { '/': 'Home', '/faq': 'FAQ' };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read a flag value supporting both `--name=value` and `--name value` forms. */
function getArg(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
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
  if (typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as any)[k], (b as any)[k]),
    );
  }
  return false;
}

function titleFromPath(path: string): string {
  if (TITLE_OVERRIDES[path]) return TITLE_OVERRIDES[path];
  return path.replace(/^\//, '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function hasPlaceholder(v: unknown): boolean {
  return typeof v === 'string' && v.includes('{{') && v.includes('}}');
}

export function buildFlatSpec(nested: unknown): DomainSpec {
  const ds = (isObject(nested) && 'domain_spec' in nested ? (nested as any).domain_spec : nested) as any;

  const primaryRegions: string[] = ds.geography.primary_regions;

  // design: pending if the design is a placeholder or any brand token is a placeholder.
  const brandTokens = ds.design?.brand_tokens ?? {};
  const designPending =
    ds.design?.design_status === 'placeholder' || Object.values(brandTokens).some(hasPlaceholder);

  // routes: required_pages joined with page_templates.required_sections (verbatim),
  // falling back to the derived sets for template-less pages.
  const templates: Array<{ applies_to: string[]; required_sections: string[] }> = ds.content.page_templates ?? [];
  const routes = (ds.content.required_pages as any[]).map((p) => {
    const tpl = templates.find((t) => t.applies_to.includes(p.path));
    const components = DERIVED_COMPONENTS[p.path] ?? tpl?.required_sections ?? [];
    const route: DomainSpec['routes'][number] = { slug: p.path, title: titleFromPath(p.path), components };
    if (p.noindex === true) route.noindex = true;
    return route;
  });

  // seo_contract: flatten keyword clusters + carry rules; annotate per-route schema application.
  const clusters = [ds.seo.primary_keyword_cluster, ...(ds.seo.secondary_keyword_clusters ?? [])];
  const targetKeywords = clusters.flatMap((c: any) => c.keywords as string[]);
  const seoContract = {
    site_url: ds.identity.canonical_url,
    target_keywords: targetKeywords,
    metadata_rules: ds.seo.metadata_rules,
    schema_rules: ds.seo.schema_rules,
    schema_application: 'per_route',
    internal_linking_rules: ds.seo.internal_linking_rules,
  };

  // wom_flags: emit a flag ONLY for items that are still UNRESOLVED (ordered as
  // reviewed in SD2). Critically, the error-severity gates (license number +
  // required disclaimers) are conditional on the underlying nested value still
  // being a `{{…PLACEHOLDER}}` token — once an operator fills in the real value
  // in inputs/, the flag drops and UnknownResolverStage stops blocking. Emitting
  // them unconditionally would leave the pipeline permanently unable to proceed.
  const contact = ds.identity?.contact_placeholders ?? {};
  const licenses = (ds.authority?.licenses ?? []) as any[];
  const licenseUnresolved = licenses.some((l) => hasPlaceholder(l?.license_number));
  const stateRules = ds.compliance?.state_specific_rules;
  const stateUnvalidated =
    stateRules?.validation_required_before_launch === true || stateRules?.status === 'Unknown';

  const womFlags: DomainSpec['wom_flags'] = [
    ...(hasPlaceholder(contact.phone) ? [{ key: 'identity.contact.phone', value: 'unresolved', severity: 'warning' as const }] : []),
    ...(hasPlaceholder(contact.email) ? [{ key: 'identity.contact.email', value: 'unresolved', severity: 'warning' as const }] : []),
    ...(hasPlaceholder(contact.address) ? [{ key: 'identity.contact.address', value: 'unresolved', severity: 'warning' as const }] : []),
    ...(licenseUnresolved ? [{ key: 'authority.license_number', value: 'unresolved', severity: 'error' as const }] : []),
    ...((ds.compliance?.disclaimers ?? []) as any[])
      .filter((d) => d.required && hasPlaceholder(d.text))
      .map((d) => ({ key: `compliance.${d.name}`, value: 'unresolved', severity: 'error' as const })),
    ...(designPending ? [{ key: 'design.brand_tokens', value: 'placeholder', severity: 'warning' as const }] : []),
    ...(stateUnvalidated
      ? [{
          key: 'state_compliance_unvalidated',
          value: (stateRules?.affected_states ?? primaryRegions).join(','),
          severity: 'warning' as const,
        }]
      : []),
  ];

  return {
    client_id: ds.metadata.spec_id,
    business_name: ds.identity.business_name,
    vertical: ds.market.niche,
    geography: { primary_state: primaryRegions[0], states: primaryRegions },
    design: { status: designPending ? 'pending' : 'resolved' },
    routes,
    seo_contract: seoContract,
    wom_flags: womFlags,
  };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const inPath = getArg(args, '--in') ?? 'inputs/domain_spec.source.yaml';
  const outPath = getArg(args, '--out') ?? 'domain_spec/domain_spec.normalized.yaml';

  const flat = buildFlatSpec(parse(readFileSync(inPath, 'utf-8')));
  validateDomainSpec(flat, `${inPath} (normalized)`); // fail loud if the transform ever produces an invalid spec

  if (check) {
    const committed = parse(readFileSync(outPath, 'utf-8'));
    if (!deepEqual(flat, committed)) {
      console.error(`normalize-spec --check FAILED: ${outPath} is stale.\nRegenerate with: tsx scripts/normalize-spec.ts`);
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
  writeFileSync(outPath, stringify(flat), 'utf-8');
  console.log(`Wrote ${outPath} from ${inPath}.`);
}

main();
