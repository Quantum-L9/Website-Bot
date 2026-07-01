// L9_META: layer=pipeline, role=spec_validator, status=active, version=1.0.0
//
// Validates a parsed spec against the FLAT DomainSpec contract that the pipeline
// consumes (see fixtures/ci-test-spec.yaml for the canonical shape). Throws
// BuildError('VALIDATION_FAILED') with precise, actionable messages, and detects
// the rich NESTED authoring format (inputs/domain_spec.normalized.yaml) so the
// operator gets a real hint instead of a bare "field absent".
import { BuildError } from './BuildError.js';
import type { DomainSpec } from './BuildContext.js';

// Top-level keys that signal the rich nested authoring format, which the
// pipeline can NOT consume directly (it needs the flat/normalized schema).
const NESTED_MARKERS = ['identity', 'market', 'audience', 'offer', 'compliance', 'conversion'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(msg: string): never {
  throw new BuildError('VALIDATION_FAILED', msg);
}

/**
 * Validate `parsed` as a flat DomainSpec and return it typed. `specPath` is used
 * only for error messages.
 */
export function validateDomainSpec(parsed: unknown, specPath: string): DomainSpec {
  // Flat specs may be wrapped as { domain_spec: {...} } — unwrap first.
  const root = isObject(parsed) && 'domain_spec' in parsed
    ? (parsed as Record<string, unknown>).domain_spec
    : parsed;

  if (!isObject(root)) {
    fail(`Spec at ${specPath} is not a YAML mapping. Expected the flat DomainSpec (see fixtures/ci-test-spec.yaml).`);
  }

  // Detect the rich nested authoring format up front → actionable hint.
  const nestedHits = NESTED_MARKERS.filter((k) => k in root);
  if (nestedHits.length >= 2 && !('business_name' in root)) {
    fail(
      `Spec at ${specPath} looks like the rich NESTED authoring format (has ${nestedHits.join('/')}), ` +
      `but the pipeline needs the FLAT normalized DomainSpec. Provide a flat spec ` +
      `(see fixtures/ci-test-spec.yaml) or run the spec normalizer first.`,
    );
  }

  const errors: string[] = [];
  const check = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

  check(typeof root.client_id === 'string' && (root.client_id as string).length > 0, 'client_id must be a non-empty string');
  check(typeof root.business_name === 'string' && (root.business_name as string).length > 0, 'business_name must be a non-empty string');
  check(typeof root.vertical === 'string' && (root.vertical as string).length > 0, 'vertical must be a non-empty string');

  const geo = root.geography;
  if (!isObject(geo)) {
    errors.push('geography must be an object { states: string[], primary_state: string }');
  } else {
    check(Array.isArray(geo.states) && (geo.states as unknown[]).length > 0, 'geography.states must be a non-empty array of state codes');
    check(typeof geo.primary_state === 'string' && (geo.primary_state as string).length > 0, 'geography.primary_state must be a non-empty string');
  }

  const routes = root.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    errors.push('routes must be a non-empty array of { slug, title, components[] }');
  } else {
    routes.forEach((r, i) => {
      if (!isObject(r)) { errors.push(`routes[${i}] must be an object { slug, title, components[] }`); return; }
      check(typeof r.slug === 'string' && (r.slug as string).length > 0, `routes[${i}].slug must be a non-empty string`);
      check(typeof r.title === 'string' && (r.title as string).length > 0, `routes[${i}].title must be a non-empty string`);
      check(Array.isArray(r.components), `routes[${i}].components must be an array`);
    });
  }

  if (errors.length > 0) {
    fail(`Spec at ${specPath} failed flat DomainSpec validation:\n  - ${errors.join('\n  - ')}`);
  }

  return root as unknown as DomainSpec;
}
