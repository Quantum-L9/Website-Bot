// L9_META: layer=pipeline, role=spec_validator, status=active, version=2.0.0
import { BuildError } from './BuildError.js';
import type { DomainSpec } from './BuildContext.js';
import { normalizeComponentName, normalizeRouteSlug } from '../validation/validate-generated-site.js';

const NESTED_MARKERS = ['identity', 'market', 'audience', 'offer', 'compliance', 'conversion'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new BuildError('VALIDATION_FAILED', message);
}

function validOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.trim().length > 0);
}

export function validateDomainSpec(parsed: unknown, specPath: string): DomainSpec {
  const root = isObject(parsed) && 'domain_spec' in parsed ? parsed.domain_spec : parsed;
  if (!isObject(root)) fail(`Spec at ${specPath} is not a YAML mapping. Expected the flat DomainSpec (see fixtures/ci-test-spec.yaml).`);

  const nestedHits = NESTED_MARKERS.filter(key => key in root);
  if (nestedHits.length >= 2 && !('business_name' in root)) {
    fail(
      `Spec at ${specPath} looks like the rich NESTED authoring format (has ${nestedHits.join('/')}), ` +
      'but the pipeline needs the FLAT normalized DomainSpec. Provide a flat spec or run the spec normalizer first.',
    );
  }

  const errors: string[] = [];
  const check = (condition: boolean, message: string) => { if (!condition) errors.push(message); };
  check(typeof root.client_id === 'string' && root.client_id.trim().length > 0, 'client_id must be a non-empty string');
  check(typeof root.business_name === 'string' && root.business_name.trim().length > 0, 'business_name must be a non-empty string');
  check(typeof root.vertical === 'string' && root.vertical.trim().length > 0, 'vertical must be a non-empty string');

  const geography = root.geography;
  if (!isObject(geography)) {
    errors.push('geography must be an object { states: string[], primary_state: string }');
  } else {
    check(
      Array.isArray(geography.states) && geography.states.length > 0 && geography.states.every(state => typeof state === 'string' && state.trim().length > 0),
      'geography.states must be a non-empty array of non-empty state strings',
    );
    check(typeof geography.primary_state === 'string' && geography.primary_state.trim().length > 0, 'geography.primary_state must be a non-empty string');
  }

  const routes = root.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    errors.push('routes must be a non-empty array of { slug, title, components[], noindex? }');
  } else {
    const seen = new Set<string>();
    routes.forEach((route, index) => {
      if (!isObject(route)) { errors.push(`routes[${index}] must be an object`); return; }
      check(typeof route.slug === 'string' && route.slug.length > 0, `routes[${index}].slug must be a non-empty string`);
      check(typeof route.title === 'string' && route.title.trim().length > 0, `routes[${index}].title must be a non-empty string`);
      check(Array.isArray(route.components) && route.components.every(component => typeof component === 'string' && component.trim().length > 0), `routes[${index}].components must be an array of non-empty strings`);
      check(route.noindex === undefined || typeof route.noindex === 'boolean', `routes[${index}].noindex, when present, must be a boolean`);
      if (typeof route.slug === 'string') {
        try {
          const normalized = normalizeRouteSlug(route.slug);
          if (seen.has(normalized)) errors.push(`routes[${index}].slug normalizes to duplicate route ${normalized}`);
          seen.add(normalized);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (Array.isArray(route.components)) {
        for (const component of route.components) {
          if (typeof component !== 'string') continue;
          try { normalizeComponentName(component); }
          catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
        }
      }
    });
  }

  const design = root.design;
  if (!isObject(design)) {
    errors.push("design must be an object { status: 'resolved' | 'pending', palette?, fonts? }");
  } else {
    check(design.status === 'resolved' || design.status === 'pending', "design.status must be 'resolved' or 'pending'");
    check(design.palette === undefined || isObject(design.palette), 'design.palette, when present, must be an object');
    check(design.fonts === undefined || isObject(design.fonts), 'design.fonts, when present, must be an object');
  }

  if (root.seo_contract !== undefined) check(isObject(root.seo_contract), 'seo_contract, when present, must be an object');
  const deploy = root.deploy;
  if (deploy !== undefined) {
    if (!isObject(deploy)) {
      errors.push('deploy, when present, must be an object');
    } else {
      check(typeof deploy.github_repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(deploy.github_repo), 'deploy.github_repo must be owner/repository');
      check(validOptionalString(deploy.github_repo_id), 'deploy.github_repo_id, when present, must be a non-empty string');
      check(validOptionalString(deploy.source_branch), 'deploy.source_branch, when present, must be a non-empty string');
      check(
        deploy.publish_credential_ref === undefined
          || (typeof deploy.publish_credential_ref === 'string' && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(deploy.publish_credential_ref)),
        'deploy.publish_credential_ref, when present, must be env://NAME',
      );
      check(validOptionalString(deploy.vercel_project_id), 'deploy.vercel_project_id, when present, must be a non-empty string');
      check(
        deploy.seo_bot_github_credential_ref === undefined
          || (typeof deploy.seo_bot_github_credential_ref === 'string' && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(deploy.seo_bot_github_credential_ref)),
        'deploy.seo_bot_github_credential_ref, when present, must be env://NAME',
      );
      check(
        deploy.seo_bot_vercel_deploy_hook_ref === undefined
          || (typeof deploy.seo_bot_vercel_deploy_hook_ref === 'string' && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(deploy.seo_bot_vercel_deploy_hook_ref)),
        'deploy.seo_bot_vercel_deploy_hook_ref, when present, must be env://NAME',
      );
      if (deploy.vercel_deploy_hook !== undefined) {
        if (typeof deploy.vercel_deploy_hook !== 'string') {
          errors.push('deploy.vercel_deploy_hook, when present, must be a string');
        } else {
          try {
            const hook = new URL(deploy.vercel_deploy_hook);
            if (hook.protocol !== 'https:') errors.push('deploy.vercel_deploy_hook must use HTTPS');
          } catch {
            errors.push('deploy.vercel_deploy_hook must be a valid URL');
          }
        }
      }
    }
  }


  const provision = root.provision;
  if (provision !== undefined) {
    if (!isObject(provision)) {
      errors.push('provision, when present, must be an object');
    } else {
      check(provision.enabled === undefined || typeof provision.enabled === 'boolean', 'provision.enabled, when present, must be boolean');
      const github = provision.github;
      if (!isObject(github)) {
        errors.push('provision.github must be an object');
      } else {
        check(typeof github.owner === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(github.owner), 'provision.github.owner is invalid');
        check(github.repository === undefined || (typeof github.repository === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(github.repository)), 'provision.github.repository is invalid');
        check(github.visibility === undefined || github.visibility === 'private' || github.visibility === 'public', 'provision.github.visibility must be private|public');
        check(validOptionalString(github.description), 'provision.github.description, when present, must be a non-empty string');
        check(validOptionalString(github.source_branch), 'provision.github.source_branch, when present, must be a non-empty string');
        check(
          github.publish_credential_ref === undefined
            || (typeof github.publish_credential_ref === 'string' && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(github.publish_credential_ref)),
          'provision.github.publish_credential_ref, when present, must be env://NAME',
        );
      }
      const vercel = provision.vercel;
      if (!isObject(vercel)) {
        errors.push('provision.vercel must be an object');
      } else {
        check(vercel.project === undefined || (typeof vercel.project === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(vercel.project)), 'provision.vercel.project is invalid');
        check(validOptionalString(vercel.team_id), 'provision.vercel.team_id, when present, must be a non-empty string');
        if (vercel.environment !== undefined) {
          if (!Array.isArray(vercel.environment)) {
            errors.push('provision.vercel.environment must be an array');
          } else {
            const seenKeys = new Set<string>();
            vercel.environment.forEach((entry, index) => {
              if (!isObject(entry)) { errors.push(`provision.vercel.environment[${index}] must be an object`); return; }
              check(typeof entry.key === 'string' && /^[A-Z][A-Z0-9_]*$/.test(entry.key), `provision.vercel.environment[${index}].key is invalid`);
              if (typeof entry.key === 'string') {
                if (seenKeys.has(entry.key)) errors.push(`provision.vercel.environment contains duplicate key ${entry.key}`);
                seenKeys.add(entry.key);
              }
              check(typeof entry.value_ref === 'string' && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(entry.value_ref), `provision.vercel.environment[${index}].value_ref must be env://NAME`);
              check(entry.type === undefined || ['plain', 'encrypted', 'sensitive'].includes(String(entry.type)), `provision.vercel.environment[${index}].type is invalid`);
              check(entry.targets === undefined || (Array.isArray(entry.targets) && entry.targets.length > 0 && entry.targets.every(target => ['production', 'preview', 'development'].includes(String(target)))), `provision.vercel.environment[${index}].targets is invalid`);
            });
          }
        }
      }
      const maintenance = provision.maintenance;
      if (maintenance !== undefined) {
        if (!isObject(maintenance)) errors.push('provision.maintenance must be an object');
        else {
          check(maintenance.github_credential_ref === undefined || (typeof maintenance.github_credential_ref === 'string' && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(maintenance.github_credential_ref)), 'provision.maintenance.github_credential_ref must be env://NAME');
          check(maintenance.vercel_deploy_hook_ref === undefined || (typeof maintenance.vercel_deploy_hook_ref === 'string' && /^env:\/\/[A-Z][A-Z0-9_]*$/.test(maintenance.vercel_deploy_hook_ref)), 'provision.maintenance.vercel_deploy_hook_ref must be env://NAME');
        }
      }
      check(provision.persist_deploy_block === undefined || typeof provision.persist_deploy_block === 'boolean', 'provision.persist_deploy_block must be boolean');
      check(provision.rollback_created_resources === undefined || typeof provision.rollback_created_resources === 'boolean', 'provision.rollback_created_resources must be boolean');
    }
  }

  if (errors.length > 0) fail(`Spec at ${specPath} failed flat DomainSpec validation:\n  - ${errors.join('\n  - ')}`);
  return root as unknown as DomainSpec;
}
