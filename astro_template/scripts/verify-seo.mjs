import { exists, listFiles, readText, result, statusFromRows, writeJsonl } from "./lib.mjs";

const checks = [];

function hasRelCanonical(html) {
  return /rel\s*=\s*(?:"canonical"|'canonical'|canonical\b)/i.test(html);
}

function hasProperty(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`property\\s*=\\s*(?:"${escaped}"|'${escaped}')`, "i").test(html);
}

// Check for robots.txt
checks.push(
  result({
    check_id: "robots-txt-exists",
    check_class: "seo_files",
    target_artifact: "public/robots.txt",
    expected_result: "robots.txt file exists",
    actual_result: exists("public/robots.txt") ? "robots.txt found" : "robots.txt missing",
    status: exists("public/robots.txt") ? "PASS" : "FAIL",
    severity: "medium",
    remediation_if_failed: "Create public/robots.txt file",
  }),
);

// Check for sitemap in built output
if (exists("dist")) {
  const hasSitemap = exists("dist/sitemap-index.xml") || exists("dist/sitemap.xml");
  checks.push(
    result({
      check_id: "sitemap-generated",
      check_class: "seo_sitemap",
      target_artifact: "dist/sitemap*.xml",
      expected_result: "Sitemap generated in build output",
      actual_result: hasSitemap ? "Sitemap found" : "Sitemap missing",
      status: hasSitemap ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: "Configure sitemap generation in astro.config.mjs",
    }),
  );
}

function checkHtmlFile(file) {
  const html = readText(file);

  const hasTitle = html.includes("<title>") && !html.includes("<title></title>");
  const hasDescription = html.includes('name="description"');
  const hasViewport = html.includes('name="viewport"');
  const hasCharset = html.includes("charset=");
  const hasOgTitle = hasProperty(html, "og:title");
  const hasOgDescription = hasProperty(html, "og:description");
  const hasOgUrl = hasProperty(html, "og:url");
  const hasCanonical = hasRelCanonical(html);

  checks.push(
    result({
      check_id: `html-title-present:${file}`,
      check_class: "seo_meta",
      target_artifact: `${file} <title>`,
      expected_result: "Page title is present and not empty",
      actual_result: hasTitle ? "Title found" : "Title missing or empty",
      status: hasTitle ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: "Add meaningful <title> tag to pages",
    }),
    result({
      check_id: `meta-description-present:${file}`,
      check_class: "seo_meta",
      target_artifact: `${file} meta[name="description"]`,
      expected_result: "Meta description present",
      actual_result: hasDescription ? "Description meta tag found" : "Description meta tag missing",
      status: hasDescription ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: "Add meta description to pages",
    }),
    result({
      check_id: `viewport-meta-present:${file}`,
      check_class: "seo_meta",
      target_artifact: `${file} meta[name="viewport"]`,
      expected_result: "Viewport meta tag present",
      actual_result: hasViewport ? "Viewport meta tag found" : "Viewport meta tag missing",
      status: hasViewport ? "PASS" : "FAIL",
      severity: "medium",
      remediation_if_failed: "Add viewport meta tag for mobile responsiveness",
    }),
    result({
      check_id: `charset-declared:${file}`,
      check_class: "seo_meta",
      target_artifact: `${file} charset`,
      expected_result: "Character encoding declared",
      actual_result: hasCharset ? "Charset declaration found" : "Charset declaration missing",
      status: hasCharset ? "PASS" : "FAIL",
      severity: "medium",
      remediation_if_failed: "Add charset declaration to HTML",
    }),
    result({
      check_id: `open-graph-tags:${file}`,
      check_class: "seo_social",
      target_artifact: `${file} Open Graph`,
      expected_result: "Open Graph meta tags present",
      actual_result: hasOgTitle && hasOgDescription ? "OG tags found" : "OG tags incomplete",
      status: hasOgTitle && hasOgDescription ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: "Add Open Graph meta tags for social media sharing",
    }),
    result({
      check_id: `canonical-link:${file}`,
      check_class: "seo_canonical",
      target_artifact: `${file} link[rel=canonical]`,
      expected_result: "Canonical link present",
      actual_result: hasCanonical ? "Canonical link found" : "Canonical link missing",
      status: hasCanonical ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: 'Add <link rel="canonical"> to pages',
    }),
    result({
      check_id: `og-url:${file}`,
      check_class: "seo_social",
      target_artifact: `${file} meta[property="og:url"]`,
      expected_result: "Open Graph URL present",
      actual_result: hasOgUrl ? "og:url found" : "og:url missing",
      status: hasOgUrl ? "PASS" : "FAIL",
      severity: "high",
      remediation_if_failed: 'Add meta property="og:url" to pages',
    }),
  );
}

// Check HTML meta tags in built output
if (exists("dist")) {
  const htmlFiles = listFiles("dist", (file) => file.endsWith(".html"));
  if (htmlFiles.length === 0) {
    checks.push(
      result({
        check_id: "build-required-for-seo",
        check_class: "prerequisite",
        target_artifact: "dist/",
        expected_result: "Build output contains HTML for SEO checking",
        actual_result: "No HTML files in dist/",
        status: "FAIL",
        severity: "medium",
        remediation_if_failed: "Run npm run build first",
      }),
    );
  } else {
    for (const file of htmlFiles) {
      try {
        checkHtmlFile(file);
      } catch (error) {
        checks.push(
          result({
            check_id: `seo-meta-check-failed:${file}`,
            check_class: "file_access",
            target_artifact: file,
            expected_result: "SEO meta tag check completed",
            actual_result: `Error reading file: ${error.message}`,
            status: "UNKNOWN",
            severity: "low",
            remediation_if_failed: "Ensure build output is readable",
          }),
        );
      }
    }
  }
} else {
  checks.push(
    result({
      check_id: "build-required-for-seo",
      check_class: "prerequisite",
      target_artifact: "dist/",
      expected_result: "Build output exists for SEO checking",
      actual_result: "Build output missing",
      status: "BLOCKED",
      severity: "medium",
      remediation_if_failed: "Run npm run build first",
    }),
  );
}

writeJsonl("validation/seo_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
