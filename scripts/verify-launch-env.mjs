#!/usr/bin/env node
import fs from 'node:fs';

const requiredForLaunch = [
  'PROJECT_LICENSE', 'SUPPORT_CONTACT_EMAIL', 'SECURITY_CONTACT_EMAIL',
  'PUBLIC_SITE_URL', 'PRODUCTION_DOMAIN', 'FORM_PROVIDER', 'FORM_ENDPOINT_URL',
  'LEAD_NOTIFICATION_EMAIL', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'VERCEL_TOKEN',
  'LEGAL_DISCLAIMER_APPROVED', 'LEGAL_DISCLAIMER_VERSION', 'LEGAL_REVIEW_OWNER',
  'PUBLIC_ADJUSTER_LICENSE_NUMBER', 'PUBLIC_ADJUSTER_LICENSE_STATE'
];
const optionalUntilClaimed = [
  'SUPPORT_CONTACT_URL', 'SECURITY_DISCLOSURE_URL', 'FORM_WEBHOOK_SECRET',
  'ACCULYNX_API_BASE_URL', 'ACCULYNX_CLIENT_ID', 'ACCULYNX_CLIENT_SECRET',
  'ACCULYNX_API_TOKEN', 'ANALYTICS_PROVIDER', 'ANALYTICS_MEASUREMENT_ID',
  'ANALYTICS_CONVERSION_EVENT', 'ANALYTICS_THANK_YOU_EVENT'
];
const invalidMarkers = new Set(['', 'UNKNOWN', 'Unknown', 'unknown', 'UNKNOWN_REQUIRED_BEFORE_LAUNCH', 'UNKNOWN_REQUIRED_FOR_DEPLOY', 'UNKNOWN_REQUIRED_FOR_FORM_DELIVERY', 'UNKNOWN_SECRET_DO_NOT_COMMIT']);
function isMissing(value) { return value === undefined || invalidMarkers.has(String(value).trim()); }
const missing = requiredForLaunch.filter((key) => isMissing(process.env[key]));
const gateFailures = [];
if (process.env.LEGAL_DISCLAIMER_APPROVED !== 'true') gateFailures.push('LEGAL_DISCLAIMER_APPROVED must be true for launch.');
if (process.env.DOMAIN_VERIFICATION_REQUIRED !== 'false') gateFailures.push('DOMAIN_VERIFICATION_REQUIRED must be false only after domain verification passes.');
if (process.env.LICENSE_DISPLAY_REQUIRED !== 'false' && isMissing(process.env.PUBLIC_ADJUSTER_LICENSE_NUMBER)) gateFailures.push('PUBLIC_ADJUSTER_LICENSE_NUMBER required while LICENSE_DISPLAY_REQUIRED is true.');
const report = {
  validation_scope: 'launch_env_contract',
  timestamp_utc: new Date().toISOString(),
  required_checked: requiredForLaunch.length,
  optional_until_claimed_checked: optionalUntilClaimed.length,
  missing_required: missing,
  gate_failures: gateFailures,
  status: missing.length === 0 && gateFailures.length === 0 ? 'PASS' : 'FAIL_CLOSED',
  note: 'This validates env presence and launch gates only. It does not verify external credentials.'
};
fs.mkdirSync('validation', { recursive: true });
fs.writeFileSync('validation/launch_env_report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.status === 'PASS' ? 0 : 1);
