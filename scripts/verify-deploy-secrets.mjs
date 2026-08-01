#!/usr/bin/env node
// L9_META: layer=configuration, role=deploy_secret_preflight, status=active, version=1.0.0
//
// Deploy-execution preflight. Complements verify-launch-env.mjs (which covers the
// launch/legal contract) by checking the credentials the build+deploy pipeline
// actually READS at runtime, so a triggered deploy fails fast with a readable
// message instead of deep inside the pipeline.
//
// Grounded in the runtime env reads:
//   - OPENROUTER_API_KEY   src/services/llm.ts (hard-required)
//   - VERCEL_TOKEN         src/stages/VercelDeployStage.ts
//   - GITHUB_SITE_TOKEN    src/stages/ClientSourcePublishStage.ts (env://GITHUB_SITE_TOKEN)
//   - VERCEL_TEAM_ID       src/stages/VercelDeployStage.ts (team scoping)
//   - project identity     CLIENT_VERCEL_PROJECT_ID or CLIENT_VERCEL_DEPLOY_HOOK
//                          (per-client; or DomainSpec.deploy.*)
import fs from 'node:fs';

const isCI = process.argv.includes('--ci') || process.env.CI === 'true';

const requiredSecrets = ['OPENROUTER_API_KEY', 'VERCEL_TOKEN', 'GITHUB_SITE_TOKEN'];
const requiredIdentifiers = ['VERCEL_TEAM_ID'];
// Project identity: at least one of these must be present (API deploy uses the
// project id; hook deploy uses the deploy hook). Spec-embedded deploy.* also
// satisfies this at runtime, so this is a warning-only nudge in CI.
const projectIdentityAnyOf = ['CLIENT_VERCEL_PROJECT_ID', 'CLIENT_VERCEL_DEPLOY_HOOK'];
const optional = [
  'PERPLEXITY_API_KEY',
  'PUBLIC_POSTHOG_KEY', 'POSTHOG_KEY',
  'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD',
  'SEO_BOT_URL', 'SEO_BOT_API_KEY',
];

const invalidMarkers = new Set([
  '', 'UNKNOWN', 'Unknown', 'unknown',
  'UNKNOWN_REQUIRED_BEFORE_LAUNCH', 'UNKNOWN_REQUIRED_FOR_DEPLOY',
  'UNKNOWN_REQUIRED_FOR_FORM_DELIVERY', 'UNKNOWN_SECRET_DO_NOT_COMMIT',
]);
const isMissing = (v) => v === undefined || invalidMarkers.has(String(v).trim());

const missingSecrets = requiredSecrets.filter((k) => isMissing(process.env[k]));
const missingIdentifiers = requiredIdentifiers.filter((k) => isMissing(process.env[k]));
const missingProjectIdentity = projectIdentityAnyOf.every((k) => isMissing(process.env[k]))
  ? [`one of ${projectIdentityAnyOf.join(' / ')} (or DomainSpec.deploy.vercel_project_id)`]
  : [];
const missingOptional = optional.filter((k) => isMissing(process.env[k]));

const blocking = [...missingSecrets, ...missingIdentifiers];
const warnings = [];
if (isCI) {
  if (blocking.length) warnings.push(`Missing deploy credentials (CI warning): ${blocking.join(', ')}`);
  if (missingProjectIdentity.length) warnings.push(`Missing project identity (CI warning): ${missingProjectIdentity.join(', ')}`);
}

const status = isCI
  ? (warnings.length ? 'WARN' : 'PASS')
  : (blocking.length === 0 ? 'PASS' : 'FAIL_CLOSED');

const report = {
  validation_scope: 'deploy_execution_secrets',
  mode: isCI ? 'ci' : 'production',
  timestamp_utc: new Date().toISOString(),
  missing_secrets: missingSecrets,
  missing_identifiers: missingIdentifiers,
  missing_project_identity: missingProjectIdentity,
  missing_optional: missingOptional,
  warnings,
  status,
  note: 'Presence check only; does not validate that credentials are accepted by the provider.',
};

fs.mkdirSync('validation', { recursive: true });
fs.writeFileSync('validation/deploy_secrets_report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// CI: informational (exit 0). Production: fail closed on missing required credentials.
process.exit(status === 'FAIL_CLOSED' ? 1 : 0);
