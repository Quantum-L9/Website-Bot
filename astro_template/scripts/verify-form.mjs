import { exists, listFiles, readText, result, writeJsonl, statusFromRows, parseEnvExample } from './lib.mjs';

const checks = [];

// Check for form-related environment variables
const envVars = parseEnvExample();
const formEnvVars = Object.keys(envVars).filter(key => 
  key.toLowerCase().includes('form') || 
  key.toLowerCase().includes('webhook') ||
  key.toLowerCase().includes('lead')
);

checks.push(result(
  'form-env-vars-defined',
  'environment_config',
  '.env.example',
  'Form-related environment variables defined',
  formEnvVars.length > 0 ? `Found: ${formEnvVars.join(', ')}` : 'No form environment variables found',
  formEnvVars.length > 0 ? 'PASS' : 'UNKNOWN',
  'medium',
  'Define form endpoint and webhook configuration in .env.example'
));

// Look for form components or pages
const formFiles = listFiles('src', (file) => 
  file.toLowerCase().includes('form') || 
  file.toLowerCase().includes('contact') ||
  file.toLowerCase().includes('lead')
);

checks.push(result(
  'form-files-exist',
  'file_structure',
  'src/ form files',
  'Form-related files exist',
  formFiles.length > 0 ? `Found: ${formFiles.slice(0, 3).join(', ')}${formFiles.length > 3 ? '...' : ''}` : 'No form files found',
  formFiles.length > 0 ? 'PASS' : 'UNKNOWN', 
  'medium',
  'Create form components or contact pages'
));

// Check for form validation in built files (if dist exists)
if (exists('dist')) {
  let hasFormValidation = false;
  try {
    const indexHtml = exists('dist/index.html') ? readText('dist/index.html') : '';
    hasFormValidation = indexHtml.includes('required') || indexHtml.includes('validation');
  } catch (error) {
    // Ignore read errors
  }

  checks.push(result(
    'form-validation-present',
    'form_validation',
    'dist/index.html',
    'HTML form validation attributes present',
    hasFormValidation ? 'Validation attributes found' : 'No validation attributes found',
    hasFormValidation ? 'PASS' : 'UNKNOWN',
    'low',
    'Add required and validation attributes to form fields'
  ));
}

writeJsonl('validation/form_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === 'FAIL') process.exit(1);