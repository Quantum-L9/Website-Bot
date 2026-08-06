#!/usr/bin/env node
import fs from 'node:fs';

const isCI = process.argv.includes('--ci') || process.env.CI === 'true';

// Secrets/tokens — warn in CI, block only in production. Only real secrets/tokens
// belong here. CRM secrets are provider-agnostic (CRM_PROVIDER selects the vendor).
const secretsForLaunch = [
  'VERCEL_TOKEN',
  'FORM_WEBHOOK_SECRET', 'CRM_API_TOKEN', 'CRM_CLIENT_SECRET',
];

// Config values — required for production launch. A professional license is
// vertical-specific, so it is NOT unconditionally required here — it is enforced
// only via the conditional gate below when LICENSE_DISPLAY_REQUIRED is set.
//
// Vercel identity is split to match the deploy runtime (src/stages/
// VercelDeployStage.ts + SiteAssemblerStage.ts): VERCEL_TEAM_ID is the only
// GLOBAL Vercel identifier required here; project identity is PER-CLIENT
// (DomainSpec.deploy.vercel_project_id, env fallback CLIENT_VERCEL_PROJECT_ID)
// and enforced at deploy time. The legacy shared VERCEL_ORG_ID / VERCEL_PROJECT_ID
// are intentionally not validated — they are unused by the site-factory spine.
const requiredForLaunch = [
  'PROJECT_LICENSE', 'SUPPORT_CONTACT_EMAIL', 'SECURITY_CONTACT_EMAIL',
  'PUBLIC_SITE_URL', 'PRODUCTION_DOMAIN', 'FORM_PROVIDER', 'FORM_ENDPOINT_URL',
  'LEAD_NOTIFICATION_EMAIL',
  'LEGAL_DISCLAIMER_APPROVED', 'LEGAL_DISCLAIMER_VERSION', 'LEGAL_REVIEW_OWNER',
  'VERCEL_TEAM_ID',
];

const optionalUntilClaimed = [
  'SUPPORT_CONTACT_URL', 'SECURITY_DISCLOSURE_URL',
  'CRM_PROVIDER', 'CRM_API_BASE_URL', 'CRM_CLIENT_ID',
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
if (process.env.LICENSE_DISPLAY_REQUIRED === 'true') {
  // The professional_license contract defines NUMBER/STATE/TYPE — enforce all
  // three together so a displayed license can't be partially specified.
  const missingLicense = ['PROFESSIONAL_LICENSE_NUMBER', 'PROFESSIONAL_LICENSE_STATE', 'PROFESSIONAL_LICENSE_TYPE']
    .filter((k) => isMissing(process.env[k]));
  if (missingLicense.length) {
    gateFailures.push(`${missingLicense.join(', ')} required while LICENSE_DISPLAY_REQUIRED is true.`);
  }
}

// In CI: all missing env vars and gate failures are warnings, not blockers.
// Only production mode enforces FAIL_CLOSED.
const warnings = [];
if (isCI) {
  if (missingSecrets.length) warnings.push(`Missing secrets (CI warning): ${missingSecrets.join(', ')}`);
  if (missingRequired.length) warnings.push(`Missing config (CI warning): ${missingRequired.join(', ')}`);
  if (gateFailures.length) warnings.push(`Gate checks (CI warning): ${gateFailures.join('; ')}`);
}

let status;
if (isCI) {
  status = warnings.length ? 'WARN' : 'PASS';
} else if (missingRequired.length === 0 && missingSecrets.length === 0 && gateFailures.length === 0) {
  status = 'PASS';
} else {
  status = 'FAIL_CLOSED';
}

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
