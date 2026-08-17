import { exists, listFiles, readText, result, writeJsonl, statusFromRows } from './lib.mjs';

const checks = [];

function hasRelCanonical(html) {
  return /rel\s*=\s*(?:"canonical"|'canonical'|canonical\b)/i.test(html);
}

function hasProperty(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`property\\s*=\\s*(?:"${escaped}"|'${escaped}')`, 'i').test(html);
}

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

function checkHtmlFile(file) {
  const html = readText(file);

  const hasTitle = html.includes('<title>') && !html.includes('<title></title>');
  const hasDescription = html.includes('name="description"');
  const hasViewport = html.includes('name="viewport"');
  const hasCharset = html.includes('charset=');
  const hasOgTitle = hasProperty(html, 'og:title');
  const hasOgDescription = hasProperty(html, 'og:description');
  const hasOgUrl = hasProperty(html, 'og:url');
  const hasCanonical = hasRelCanonical(html);

  checks.push(
    result(
      `html-title-present:${file}`,
      'seo_meta',
      `${file} <title>`,
      'Page title is present and not empty',
      hasTitle ? 'Title found' : 'Title missing or empty',
      hasTitle ? 'PASS' : 'FAIL',
      'high',
      'Add meaningful <title> tag to pages'
    ),
    result(
      `meta-description-present:${file}`,
      'seo_meta',
      `${file} meta[name="description"]`,
      'Meta description present',
      hasDescription ? 'Description meta tag found' : 'Description meta tag missing',
      hasDescription ? 'PASS' : 'FAIL',
      'high',
      'Add meta description to pages'
    ),
    result(
      `viewport-meta-present:${file}`,
      'seo_meta',
      `${file} meta[name="viewport"]`,
      'Viewport meta tag present',
      hasViewport ? 'Viewport meta tag found' : 'Viewport meta tag missing',
      hasViewport ? 'PASS' : 'FAIL',
      'medium',
      'Add viewport meta tag for mobile responsiveness'
    ),
    result(
      `charset-declared:${file}`,
      'seo_meta',
      `${file} charset`,
      'Character encoding declared',
      hasCharset ? 'Charset declaration found' : 'Charset declaration missing',
      hasCharset ? 'PASS' : 'FAIL',
      'medium',
      'Add charset declaration to HTML'
    ),
    result(
      `open-graph-tags:${file}`,
      'seo_social',
      `${file} Open Graph`,
      'Open Graph meta tags present',
      (hasOgTitle && hasOgDescription) ? 'OG tags found' : 'OG tags incomplete',
      (hasOgTitle && hasOgDescription) ? 'PASS' : 'FAIL',
      'high',
      'Add Open Graph meta tags for social media sharing'
    ),
    result(
      `canonical-link:${file}`,
      'seo_canonical',
      `${file} link[rel=canonical]`,
      'Canonical link present',
      hasCanonical ? 'Canonical link found' : 'Canonical link missing',
      hasCanonical ? 'PASS' : 'FAIL',
      'high',
      'Add <link rel="canonical"> to pages'
    ),
    result(
      `og-url:${file}`,
      'seo_social',
      `${file} meta[property="og:url"]`,
      'Open Graph URL present',
      hasOgUrl ? 'og:url found' : 'og:url missing',
      hasOgUrl ? 'PASS' : 'FAIL',
      'high',
      'Add meta property="og:url" to pages'
    )
  );
}

// Check HTML meta tags in built output
if (exists('dist')) {
  const htmlFiles = listFiles('dist', (file) => file.endsWith('.html'));
  if (htmlFiles.length === 0) {
    checks.push(result(
      'build-required-for-seo',
      'prerequisite',
      'dist/',
      'Build output contains HTML for SEO checking',
      'No HTML files in dist/',
      'FAIL',
      'medium',
      'Run npm run build first'
    ));
  } else {
    for (const file of htmlFiles) {
      try {
        checkHtmlFile(file);
      } catch (error) {
        checks.push(result(
          `seo-meta-check-failed:${file}`,
          'file_access',
          file,
          'SEO meta tag check completed',
          `Error reading file: ${error.message}`,
          'UNKNOWN',
          'low',
          'Ensure build output is readable'
        ));
      }
    }
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
