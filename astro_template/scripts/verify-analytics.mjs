import { exists, readText, result, writeJsonl, statusFromRows, parseEnvExample } from './lib.mjs';

const checks = [];

// Check for analytics environment variables
const envVars = parseEnvExample();
const analyticsEnvVars = Object.keys(envVars).filter(key => 
  key.toLowerCase().includes('analytics') || 
  key.toLowerCase().includes('gtag') ||
  key.toLowerCase().includes('measurement') ||
  key.toLowerCase().includes('posthog')
);

checks.push(result(
  'analytics-env-vars-defined',
  'environment_config',
  '.env.example',
  'Analytics environment variables defined',
  analyticsEnvVars.length > 0 ? `Found: ${analyticsEnvVars.join(', ')}` : 'No analytics environment variables found',
  analyticsEnvVars.length > 0 ? 'PASS' : 'UNKNOWN',
  'medium',
  'Define analytics configuration in .env.example'
));

// Check for analytics tracking in built HTML
if (exists('dist/index.html')) {
  try {
    const indexHtml = readText('dist/index.html');
    
    // Check for common analytics providers
    const hasGoogleAnalytics = indexHtml.includes('gtag') || indexHtml.includes('google-analytics');
    const hasPostHog = indexHtml.includes('posthog');
    const hasGenericAnalytics = indexHtml.includes('analytics') || indexHtml.includes('tracking');
    
    const analyticsFound = hasGoogleAnalytics || hasPostHog || hasGenericAnalytics;
    
    checks.push(result(
      'analytics-tracking-present',
      'analytics_implementation',
      'dist/index.html',
      'Analytics tracking code present',
      analyticsFound ? 'Analytics tracking code found' : 'No analytics tracking code found',
      analyticsFound ? 'PASS' : 'UNKNOWN',
      'medium',
      'Add analytics tracking code to site'
    ));

    // Check for event tracking setup
    const hasEventTracking = indexHtml.includes('track') || indexHtml.includes('event');
    checks.push(result(
      'event-tracking-setup',
      'analytics_events',
      'dist/index.html',
      'Event tracking setup present',
      hasEventTracking ? 'Event tracking code found' : 'No event tracking code found',
      hasEventTracking ? 'PASS' : 'UNKNOWN',
      'low',
      'Add event tracking for user interactions'
    ));
    
  } catch (error) {
    checks.push(result(
      'analytics-check-failed',
      'file_access',
      'dist/index.html',
      'Analytics check completed',
      `Error reading file: ${error.message}`,
      'UNKNOWN',
      'low',
      'Ensure build output is readable'
    ));
  }
} else {
  checks.push(result(
    'build-required-for-analytics',
    'prerequisite',
    'dist/',
    'Build output exists for analytics checking',
    'Build output missing',
    'BLOCKED',
    'medium',
    'Run npm run build first'
  ));
}

writeJsonl('validation/analytics_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === 'FAIL') process.exit(1);