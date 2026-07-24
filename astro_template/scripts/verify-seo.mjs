import { exists, readText, result, writeJsonl, statusFromRows } from './lib.mjs';

const checks = [];

// Check for robots.txt
checks.push(result(
  'robots-txt-exists',
  'seo_files',
  'public/robots.txt', 
  'robots.txt file exists',
  exists('public/robots.txt') ? 'robots.txt found' : 'robots.txt missing',
  exists('public/robots.txt') ? 'PASS' : 'FAIL',
  'medium',
  'Create public/robots.txt file'
));

// Check for sitemap in built output
if (exists('dist')) {
  const hasSitemap = exists('dist/sitemap-index.xml') || exists('dist/sitemap.xml');
  checks.push(result(
    'sitemap-generated',
    'seo_sitemap',
    'dist/sitemap*.xml',
    'Sitemap generated in build output',
    hasSitemap ? 'Sitemap found' : 'Sitemap missing',
    hasSitemap ? 'PASS' : 'FAIL',
    'high', 
    'Configure sitemap generation in astro.config.mjs'
  ));
}

// Check HTML meta tags in built output
if (exists('dist/index.html')) {
  try {
    const indexHtml = readText('dist/index.html');
    
    // Check for essential meta tags
    const hasTitle = indexHtml.includes('<title>') && !indexHtml.includes('<title></title>');
    const hasDescription = indexHtml.includes('name="description"');
    const hasViewport = indexHtml.includes('name="viewport"');
    const hasCharset = indexHtml.includes('charset=');
    
    checks.push(result(
      'html-title-present',
      'seo_meta',
      'dist/index.html <title>',
      'Page title is present and not empty',
      hasTitle ? 'Title found' : 'Title missing or empty',
      hasTitle ? 'PASS' : 'FAIL',
      'high',
      'Add meaningful <title> tag to pages'
    ));

    checks.push(result(
      'meta-description-present',
      'seo_meta',
      'dist/index.html meta[name="description"]',
      'Meta description present',
      hasDescription ? 'Description meta tag found' : 'Description meta tag missing',
      hasDescription ? 'PASS' : 'FAIL', 
      'high',
      'Add meta description to pages'
    ));

    checks.push(result(
      'viewport-meta-present',
      'seo_meta',
      'dist/index.html meta[name="viewport"]',
      'Viewport meta tag present',
      hasViewport ? 'Viewport meta tag found' : 'Viewport meta tag missing',
      hasViewport ? 'PASS' : 'FAIL',
      'medium',
      'Add viewport meta tag for mobile responsiveness'
    ));

    checks.push(result(
      'charset-declared',
      'seo_meta',
      'dist/index.html charset',
      'Character encoding declared',
      hasCharset ? 'Charset declaration found' : 'Charset declaration missing',
      hasCharset ? 'PASS' : 'FAIL',
      'medium',
      'Add charset declaration to HTML'
    ));

    // Check for Open Graph tags
    const hasOgTitle = indexHtml.includes('property="og:title"');
    const hasOgDescription = indexHtml.includes('property="og:description"');
    
    checks.push(result(
      'open-graph-tags',
      'seo_social',
      'dist/index.html Open Graph',
      'Open Graph meta tags present',
      (hasOgTitle && hasOgDescription) ? 'OG tags found' : 'OG tags incomplete',
      (hasOgTitle && hasOgDescription) ? 'PASS' : 'UNKNOWN',
      'low',
      'Add Open Graph meta tags for social media sharing'
    ));

  } catch (error) {
    checks.push(result(
      'seo-meta-check-failed',
      'file_access',
      'dist/index.html',
      'SEO meta tag check completed',
      `Error reading file: ${error.message}`,
      'UNKNOWN',
      'low',
      'Ensure build output is readable'
    ));
  }
} else {
  checks.push(result(
    'build-required-for-seo',
    'prerequisite', 
    'dist/',
    'Build output exists for SEO checking',
    'Build output missing',
    'BLOCKED',
    'medium',
    'Run npm run build first'
  ));
}

writeJsonl('validation/seo_checks.jsonl', checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === 'FAIL') process.exit(1);