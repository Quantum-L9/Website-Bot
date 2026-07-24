import { createValidator } from './validation-framework.mjs';
import { exists, listFiles, readText } from './lib.mjs';

const validator = createValidator('source');

// Check Astro pages exist
await validator.addDirectoryContentCheck(
  'pages-exist',
  'src/pages',
  (file) => file.endsWith('.astro') || file.endsWith('.md'),
  'At least one page file exists',
  'high',
  1
);

// Check layouts directory
await validator.addDirectoryContentCheck(
  'layouts-exist',
  'src/layouts',
  (file) => file.endsWith('.astro'),
  'Layout files exist',
  'medium',
  0 // Optional
);

// Check components directory  
await validator.addDirectoryContentCheck(
  'components-exist',
  'src/components',
  (file) => file.endsWith('.astro') || file.endsWith('.tsx') || file.endsWith('.jsx'),
  'Component files exist',
  'medium',
  0 // Optional
);

// Check for main page
const indexExists = exists('src/pages/index.astro') || exists('src/pages/index.md');
validator.addCheck(
  'index-page-exists',
  'file_existence',
  'src/pages/index.*', 
  'Index page exists',
  indexExists ? 'Index page found' : 'No index page found',
  indexExists ? 'PASS' : 'FAIL',
  'high',
  'Create src/pages/index.astro or src/pages/index.md'
);

// Validate Astro config if it exists
if (exists('astro.config.mjs')) {
  try {
    const configText = readText('astro.config.mjs');
    const hasDefineConfig = configText.includes('defineConfig');
    validator.addCheck(
      'astro-config-valid',
      'config_validation',
      'astro.config.mjs',
      'Uses defineConfig export', 
      hasDefineConfig ? 'defineConfig found' : 'defineConfig missing',
      hasDefineConfig ? 'PASS' : 'FAIL',
      'medium',
      'Use defineConfig in astro.config.mjs'
    );
  } catch (error) {
    validator.addCheck(
      'astro-config-readable',
      'file_validation',
      'astro.config.mjs',
      'Config file is readable',
      `Error: ${error.message}`,
      'FAIL',
      'medium',
      'Fix astro.config.mjs syntax errors'
    );
  }
}

await validator.run();