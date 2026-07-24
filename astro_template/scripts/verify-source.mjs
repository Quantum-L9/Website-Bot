import { exists, listFiles, readText, result, writeJsonl, statusFromRows } from './lib.mjs';

const checks = [];

// Check Astro pages exist
const pages = listFiles('src/pages', (file) => file.endsWith('.astro') || file.endsWith('.md'));
checks.push(result(
  'pages-exist',
  'file_structure',
  'src/pages/',
  'At least one page file exists',
  pages.length > 0 ? `${pages.length} pages found` : 'No pages found',
  pages.length > 0 ? 'PASS' : 'FAIL',
  'high',
  'Create at least one page in src/pages/'
));

// Check layouts directory
const layouts = listFiles('src/layouts', (file) => file.endsWith('.astro'));
checks.push(result(
  'layouts-exist',
  'file_structure', 
  'src/layouts/',
  'Layout files exist',
  layouts.length > 0 ? `${layouts.length} layouts found` : 'No layouts found',
  layouts.length > 0 ? 'PASS' : 'UNKNOWN',
  'medium',
  'Consider creating layout files in src/layouts/'
));

// Check components directory
const components = listFiles('src/components', (file) => file.endsWith('.astro') || file.endsWith('.tsx') || file.endsWith('.jsx'));
checks.push(result(
  'components-exist',
  'file_structure',
  'src/components/', 
  'Component files exist',
  components.length > 0 ? `${components.length} components found` : 'No components found',
  components.length > 0 ? 'PASS' : 'UNKNOWN',
  'medium',
  'Consider creating reusable components in src/components/'
));

// Check for main page
const indexExists = exists('src/pages/index.astro') || exists('src/pages/index.md');
checks.push(result(
  'index-page-exists',
  'file_existence',
  'src/pages/index.*', 
  'Index page exists',
  indexExists ? 'Index page found' : 'No index page found',
  indexExists ? 'PASS' : 'FAIL',
  'high',
  'Create src/pages/index.astro or src/pages/index.md'
));

// Validate Astro config if it exists
if (exists('astro.config.mjs')) {
  try {
    const configText = readText('astro.config.mjs');
    const hasDefineConfig = configText.includes('defineConfig');
    checks.push(result(
      'astro-config-valid',
      'config_validation',
      'astro.config.mjs',
      'Uses defineConfig export', 
      hasDefineConfig ? 'defineConfig found' : 'defineConfig missing',
      hasDefineConfig ? 'PASS' : 'FAIL',
      'medium',
      'Use defineConfig in astro.config.mjs'
    ));
  } catch (error) {
    checks.push(result(
      'astro-config-readable',
      'file_validation',
      'astro.config.mjs',
      'Config file is readable',
      `Error: ${error.message}`,
      'FAIL',
      'medium',
      'Fix astro.config.mjs syntax errors'
    ));
  }
}

writeJsonl('validation/source_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === 'FAIL') process.exit(1);