import { exists, readText, result, writeJsonl, statusFromRows, parseEnvExample } from './lib.mjs';

const checks = [];

// Check for deployment configuration that enables rollback
const envVars = parseEnvExample();
const deploymentEnvVars = Object.keys(envVars).filter(key => 
  key.toLowerCase().includes('vercel') ||
  key.toLowerCase().includes('deploy') ||
  key.toLowerCase().includes('github')
);

checks.push(result(
  'deployment-config-present',
  'deployment_config',
  '.env.example',
  'Deployment configuration variables defined',
  deploymentEnvVars.length > 0 ? `Found: ${deploymentEnvVars.slice(0, 3).join(', ')}${deploymentEnvVars.length > 3 ? '...' : ''}` : 'No deployment variables found',
  deploymentEnvVars.length > 0 ? 'PASS' : 'UNKNOWN',
  'medium',
  'Define deployment configuration for rollback capability'
));

// Check for version control (Git)
const hasGitDir = exists('.git');
checks.push(result(
  'version-control-present',
  'rollback_capability',
  '.git/',
  'Git repository initialized',
  hasGitDir ? 'Git repository found' : 'Git repository missing',
  hasGitDir ? 'PASS' : 'FAIL',
  'high',
  'Initialize Git repository with: git init'
));

// Check for package.json scripts that support rollback
let hasRollbackScripts = false;
if (exists('package.json')) {
  try {
    const packageJson = JSON.parse(readText('package.json'));
    const scripts = packageJson.scripts || {};
    
    // Look for deployment-related scripts
    const deployScripts = Object.keys(scripts).filter(script =>
      script.includes('deploy') || 
      script.includes('build') ||
      script.includes('preview')
    );
    
    hasRollbackScripts = deployScripts.length > 0;
    
    checks.push(result(
      'deployment-scripts-present',
      'rollback_scripts',
      'package.json scripts',
      'Deployment scripts available',
      hasRollbackScripts ? `Scripts: ${deployScripts.join(', ')}` : 'No deployment scripts found',
      hasRollbackScripts ? 'PASS' : 'UNKNOWN',
      'medium',
      'Add deployment scripts to package.json'
    ));
    
  } catch (error) {
    checks.push(result(
      'package-json-readable',
      'file_access',
      'package.json',
      'Package.json is readable',
      `Error: ${error.message}`,
      'FAIL',
      'medium',
      'Fix package.json syntax'
    ));
  }
}

// Check for backup/rollback documentation
const docFiles = ['README.md', 'DEPLOYMENT.md', 'ROLLBACK.md'].filter(file => exists(file));
let hasRollbackDocs = false;

for (const docFile of docFiles) {
  try {
    const content = readText(docFile);
    if (content.toLowerCase().includes('rollback') || content.toLowerCase().includes('revert')) {
      hasRollbackDocs = true;
      break;
    }
  } catch (error) {
    // Ignore read errors
  }
}

checks.push(result(
  'rollback-documentation',
  'rollback_docs', 
  'Documentation files',
  'Rollback procedure documented',
  hasRollbackDocs ? 'Rollback documentation found' : 'No rollback documentation found',
  hasRollbackDocs ? 'PASS' : 'UNKNOWN',
  'low',
  'Document rollback procedures in README.md or DEPLOYMENT.md'
));

// Check for environment safety (test mode configurations)
const testModeVars = Object.keys(envVars).filter(key => 
  key.toLowerCase().includes('test') ||
  key.toLowerCase().includes('staging') ||
  key.toLowerCase().includes('development')
);

checks.push(result(
  'test-mode-config',
  'rollback_safety',
  'Test mode configuration',
  'Test/staging environment variables defined',
  testModeVars.length > 0 ? `Test vars: ${testModeVars.slice(0, 2).join(', ')}${testModeVars.length > 2 ? '...' : ''}` : 'No test mode configuration found',
  testModeVars.length > 0 ? 'PASS' : 'UNKNOWN',
  'medium',
  'Define test/staging environment configuration for safe rollback testing'
));

writeJsonl('validation/rollback_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === 'FAIL') process.exit(1);