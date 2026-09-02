#!/usr/bin/env node
// L9_META: layer=configuration, role=launch_env_gate, status=active, version=2.0.0
import fs from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { hydrateSecretsIfConfigured } from './lib/hydrate-secrets.mjs';

const isCI = process.argv.includes('--ci') || process.env.CI === 'true';
/** Full client production launch claim (domain + form delivery + legal). Off for factory MVP. */
const clientLaunch = process.argv.includes('--client-launch')
  || process.env.LAUNCH_PHASE === 'client_production';

const VALUES_PATH = resolve('config/launch-env.values.yaml');

/**
 * Load committed non-secret defaults. Never overwrites process.env.
 * @returns {{ loaded: boolean, keys: string[] }}
 */
function applyCommittedValues() {
  if (!fs.existsSync(VALUES_PATH)) {
    return { loaded: false, keys: [] };
  }
  const doc = YAML.parse(fs.readFileSync(VALUES_PATH, 'utf8')) || {};
  const keys = [];
  for (const block of [doc.operator, doc.mvp_deferred]) {
    if (!block || typeof block !== 'object') continue;
    for (const [key, raw] of Object.entries(block)) {
      if (process.env[key] !== undefined) continue;
      if (raw === undefined || raw === null) continue;
      process.env[key] = String(raw);
      keys.push(key);
    }
  }
  return { loaded: true, keys };
}

// Operator .env.local / Infisical must land before committed YAML defaults,
// otherwise applyCommittedValues() fills process.env and loadDotEnvLocal()
// cannot override (it never overwrites existing keys).
const hydrateMeta = await hydrateSecretsIfConfigured();
const valuesMeta = applyCommittedValues();

const invalidMarkers = new Set([
  '', 'UNKNOWN', 'Unknown', 'unknown',
  'UNKNOWN_REQUIRED_BEFORE_LAUNCH',
  'UNKNOWN_REQUIRED_FOR_DEPLOY',
  'UNKNOWN_REQUIRED_FOR_FORM_DELIVERY',
  'UNKNOWN_SECRET_DO_NOT_COMMIT',
]);
const isMissing = (value) => value === undefined || invalidMarkers.has(String(value).trim());

// Factory MVP: contacts + license + global Vercel team id. Not client-site launch.
const requiredForFactory = [
  'PROJECT_LICENSE',
  'SUPPORT_CONTACT_EMAIL',
  'SECURITY_CONTACT_EMAIL',
  'VERCEL_TEAM_ID',
];

// Client production launch only (deferred until a complete site exists).
const requiredForClientLaunch = [
  'PUBLIC_SITE_URL',
  'PRODUCTION_DOMAIN',
  'FORM_PROVIDER',
  'FORM_ENDPOINT_URL',
  'LEAD_NOTIFICATION_EMAIL',
  'LEGAL_DISCLAIMER_APPROVED',
  'LEGAL_DISCLAIMER_VERSION',
  'LEGAL_REVIEW_OWNER',
];

const requiredForLaunch = clientLaunch
  ? [...requiredForFactory, ...requiredForClientLaunch]
  : requiredForFactory;

// Real secrets only. CRM never blocks factory MVP. Form webhook only when form is claimed.
const secretsForLaunch = ['VERCEL_TOKEN'];
const formProvider = String(process.env.FORM_PROVIDER ?? '').trim().toLowerCase();
if (clientLaunch && formProvider && formProvider !== 'none') {
  secretsForLaunch.push('FORM_WEBHOOK_SECRET');
}
const crmProvider = String(process.env.CRM_PROVIDER ?? '').trim().toLowerCase();
if (crmProvider && crmProvider !== 'none') {
  secretsForLaunch.push('CRM_API_TOKEN', 'CRM_CLIENT_SECRET');
}

const optionalUntilClaimed = [
  'SUPPORT_CONTACT_URL', 'SECURITY_DISCLOSURE_URL',
  'CRM_PROVIDER', 'CRM_API_BASE_URL', 'CRM_CLIENT_ID',
  'ANALYTICS_PROVIDER', 'ANALYTICS_MEASUREMENT_ID',
  'ANALYTICS_CONVERSION_EVENT', 'ANALYTICS_THANK_YOU_EVENT',
  'FORM_PROVIDER', 'FORM_ENDPOINT_URL', 'LEAD_NOTIFICATION_EMAIL',
  'PUBLIC_SITE_URL', 'PRODUCTION_DOMAIN',
  'CLIENT_VERCEL_PROJECT_ID', 'CLIENT_VERCEL_DEPLOY_HOOK',
];

const missingRequired = requiredForLaunch.filter((key) => isMissing(process.env[key]));
const missingSecrets = secretsForLaunch.filter((key) => isMissing(process.env[key]));

const gateFailures = [];
if (clientLaunch) {
  if (!formProvider || formProvider === 'none') {
    gateFailures.push('FORM_PROVIDER must be a real provider (not none) for client production launch.');
  }
  if (process.env.LEGAL_DISCLAIMER_APPROVED !== 'true') {
    gateFailures.push('LEGAL_DISCLAIMER_APPROVED must be true for client production launch.');
  }
  if (process.env.DOMAIN_VERIFICATION_REQUIRED !== 'false') {
    gateFailures.push('DOMAIN_VERIFICATION_REQUIRED must be false only after domain verification passes.');
  }
}
if (process.env.LICENSE_DISPLAY_REQUIRED === 'true') {
  const missingLicense = ['PROFESSIONAL_LICENSE_NUMBER', 'PROFESSIONAL_LICENSE_STATE', 'PROFESSIONAL_LICENSE_TYPE']
    .filter((k) => isMissing(process.env[k]));
  if (missingLicense.length) {
    gateFailures.push(`${missingLicense.join(', ')} required while LICENSE_DISPLAY_REQUIRED is true.`);
  }
}

const warnings = [];
if (isCI) {
  if (missingSecrets.length) warnings.push(`Missing secrets (CI warning): ${missingSecrets.join(', ')}`);
  if (missingRequired.length) warnings.push(`Missing config (CI warning): ${missingRequired.join(', ')}`);
  if (gateFailures.length) warnings.push(`Gate checks (CI warning): ${gateFailures.join('; ')}`);
}
if (!clientLaunch) {
  warnings.push('Factory MVP mode: form/CRM/analytics/domain/legal client-launch gates are deferred (use --client-launch to enforce).');
}

let status;
if (isCI) {
  status = (missingRequired.length || missingSecrets.length || gateFailures.length) ? 'WARN' : 'PASS';
} else if (missingRequired.length === 0 && missingSecrets.length === 0 && gateFailures.length === 0) {
  status = 'PASS';
} else {
  status = 'FAIL_CLOSED';
}

const report = {
  validation_scope: 'launch_env_contract',
  mode: isCI ? 'ci' : (clientLaunch ? 'client_production' : 'factory_mvp'),
  timestamp_utc: new Date().toISOString(),
  required_checked: requiredForLaunch.length,
  secrets_checked: secretsForLaunch.length,
  optional_until_claimed_checked: optionalUntilClaimed.length,
  missing_required: missingRequired,
  missing_secrets: missingSecrets,
  gate_failures: gateFailures,
  warnings,
  status,
  bootstrap_present: hydrateMeta.bootstrap_present,
  source_mode: hydrateMeta.source_mode,
  committed_values_loaded: valuesMeta.loaded,
  committed_values_applied: valuesMeta.keys,
  note: clientLaunch
    ? 'Client production launch gate. CRM still only required when CRM_PROVIDER is set and not none.'
    : 'Factory MVP gate. Non-secrets load from config/launch-env.values.yaml; CRM/form delivery/legal/domain are deferred.',
};

fs.mkdirSync('validation', { recursive: true });
fs.writeFileSync('validation/launch_env_report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

process.exit(status === 'FAIL_CLOSED' ? 1 : 0);
