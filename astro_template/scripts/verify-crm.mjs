import { result, writeJsonl, statusFromRows, parseEnvExample } from './lib.mjs';

const checks = [];

// Check for CRM environment variables  
const envVars = parseEnvExample();
const crmEnvVars = Object.keys(envVars).filter(key => 
  key.toLowerCase().includes('crm') ||
  key.toLowerCase().includes('hubspot') ||
  key.toLowerCase().includes('salesforce') ||
  key.toLowerCase().includes('acculynx')
);

checks.push(result(
  'crm-env-vars-defined',
  'environment_config', 
  '.env.example',
  'CRM environment variables defined',
  crmEnvVars.length > 0 ? `Found: ${crmEnvVars.join(', ')}` : 'No CRM environment variables found',
  crmEnvVars.length > 0 ? 'PASS' : 'UNKNOWN',
  'medium',
  'Define CRM provider and API configuration in .env.example'
));

// Check for CRM provider configuration
const crmProviderVar = Object.keys(envVars).find(key => key === 'CRM_PROVIDER');
const crmProvider = crmProviderVar ? envVars[crmProviderVar] : null;

checks.push(result(
  'crm-provider-configured',
  'crm_config',
  'CRM_PROVIDER',
  'CRM provider specified',
  crmProvider ? `Provider: ${crmProvider}` : 'CRM_PROVIDER not set',
  crmProvider ? 'PASS' : 'UNKNOWN',
  'medium', 
  'Set CRM_PROVIDER to: acculynx, hubspot, salesforce, or none'
));

// Validate CRM provider value if set
if (crmProvider) {
  const validProviders = ['acculynx', 'hubspot', 'salesforce', 'none'];
  const isValidProvider = validProviders.includes(crmProvider.toLowerCase());
  
  checks.push(result(
    'crm-provider-valid',
    'crm_config_validation',
    'CRM_PROVIDER',
    `Valid CRM provider (${validProviders.join(', ')})`,
    crmProvider,
    isValidProvider ? 'PASS' : 'FAIL',
    'high',
    `CRM_PROVIDER must be one of: ${validProviders.join(', ')}`
  ));

  // Check for provider-specific configuration
  if (crmProvider.toLowerCase() !== 'none') {
    const requiredVars = {
      'acculynx': ['CRM_API_BASE_URL', 'CRM_API_TOKEN'],
      'hubspot': ['CRM_API_TOKEN'],
      'salesforce': ['CRM_CLIENT_ID', 'CRM_CLIENT_SECRET']
    };

    const required = requiredVars[crmProvider.toLowerCase()] || [];
    const missing = required.filter(varName => !envVars[varName]);

    checks.push(result(
      'crm-provider-config-complete',
      'crm_provider_config',
      `${crmProvider} configuration`,
      `Required variables: ${required.join(', ')}`,
      missing.length === 0 ? 'All required variables defined' : `Missing: ${missing.join(', ')}`,
      missing.length === 0 ? 'PASS' : 'FAIL',
      'high',
      `Define missing CRM variables: ${missing.join(', ')}`
    ));
  }
}

// Check test mode configuration
const testModeVar = envVars['CRM_TEST_MODE'];
checks.push(result(
  'crm-test-mode-configured',
  'crm_safety',
  'CRM_TEST_MODE',
  'CRM test mode configured',
  testModeVar ? `Test mode: ${testModeVar}` : 'CRM_TEST_MODE not set',
  testModeVar ? 'PASS' : 'UNKNOWN',
  'medium',
  'Set CRM_TEST_MODE=true for development/testing'
));

writeJsonl('validation/crm_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === 'FAIL') process.exit(1);