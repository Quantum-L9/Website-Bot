#!/usr/bin/env node
import fs from 'node:fs';

const isCI = process.argv.includes('--ci') || process.env.CI === 'true';

// Secrets/tokens — warn in CI, block only in production
const secretsForLaunch = [
  'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID',
  'FORM_WEBHOOK_SECRET', 'ACCULYNX_API_TOKEN', 'ACCULYNX_CLIENT_SECRET',
];

// Config values — required for production launch
const requiredForLaunch = [
  'PROJECT_LICENSE', 'SUPPORT_CONTACT_EMAIL', 'SECURITY_CONTACT_EMAIL',
  'PUBLIC_SITE_URL', 'PRODUCTION_DOMAIN', 'FORM_PROVIDER', 'FORM_ENDPOINT_URL',
  'LEAD_NOTIFICATION_EMAIL',
  'LEGAL_DISCLAIMER_APPROVED', 'LEGAL_DISCLAIMER_VERSION', 'LEGAL_REVIEW_OWNER',
  'PUBLIC_ADJUSTER_LICENSE_NUMBER', 'PUBLIC_ADJUSTER_LICENSE_STATE',
];

const optionalUntilClaimed = [
  'SUPPORT_CONTACT_URL', 'SECURITY_DISCLOSURE_URL',
  'ACCULYNX_API_BASE_URL', 'ACCULYNX_CLIENT_ID',
  'ANALYTICS_PROVIDER', 'ANALYTICS_MEASUREMENT_ID',
  'ANALYTICS_CONVERSION_EVENT', 'ANALYTICS_THANK_YOU_EVENT',
];

const invalidMarkers = new Set([
  '', 'UNKNOWN', 'Unknown', 'unknown',
  'UNKNOWN_REQUIRED_BEFORE_LAUNCH',
  'UNKNOWN_REQUIRED_FOR_DEPLOY',
  'UNKNOWN_REQUIRED_FOR_FORM_DELIVERY',
  'UNKNOWN_SECRET_DO_NOT_COMMIT',
]);

function isMissing(value) {
  return value === undefined || invalidMarkers.has(String(value).trim());
}

const missingRequired = requiredForLaunch.filter((key) => isMissing(process.env[key]));
const missingSecrets = secretsForLaunch.filter((key) => isMissing(process.env[key]));

const gateFailures = [];
if (process.env.LEGAL_DISCLAIMER_APPROVED !== 'true') {
  gateFailures.push('LEGAL_DISCLAIMER_APPROVED must be true for launch.');
}
if (process.env.DOMAIN_VERIFICATION_REQUIRED !== 'false') {
  gateFailures.push('DOMAIN_VERIFICATION_REQUIRED must be false only after domain verification passes.');
}
if (process.env.LICENSE_DISPLAY_REQUIRED !== 'false' && isMissing(process.env.PUBLIC_ADJUSTER_LICENSE_NUMBER)) {
  gateFailures.push('PUBLIC_ADJUSTER_LICENSE_NUMBER required while LICENSE_DISPLAY_REQUIRED is true.');
}

// In CI: all missing env vars and gate failures are warnings, not blockers.
// Only production mode enforces FAIL_CLOSED.
const warnings = [];
if (isCI) {
  if (missingSecrets.length) warnings.push(`Missing secrets (CI warning): ${missingSecrets.join(', ')}`);
  if (missingRequired.length) warnings.push(`Missing config (CI warning): ${missingRequired.join(', ')}`);
  if (gateFailures.length) warnings.push(`Gate checks (CI warning): ${gateFailures.join('; ')}`);
}

const status = isCI
  ? (warnings.length ? 'WARN' : 'PASS')
  : (missingRequired.length === 0 && missingSecrets.length === 0 && gateFailures.length === 0 ? 'PASS' : 'FAIL_CLOSED');

const report = {
  validation_scope: 'launch_env_contract',
  mode: isCI ? 'ci' : 'production',
  timestamp_utc: new Date().toISOString(),
  required_checked: requiredForLaunch.length,
  secrets_checked: secretsForLaunch.length,
  optional_until_claimed_checked: optionalUntilClaimed.length,
  missing_required: missingRequired,
  missing_secrets: missingSecrets,
  gate_failures: gateFailures,
  warnings,
  status,
  note: 'This validates env presence and launch gates only. It does not verify external credentials.',
};

fs.mkdirSync('validation', { recursive: true });
fs.writeFileSync('validation/launch_env_report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// CI: always exit 0 (warnings are informational, not blocking)
// Production: exit 1 on FAIL_CLOSED
process.exit(status === 'FAIL_CLOSED' ? 1 : 0);
