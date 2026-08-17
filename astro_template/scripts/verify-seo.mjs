import {
  buildRequiredResult,
  exists,
  fileReadErrorResult,
  listFiles,
  readText,
  result,
  statusFromRows,
  writeJsonl,
} from "./lib.mjs";

const checks = [];

function hasRelCanonical(html) {
  return /rel\s*=\s*(?:"canonical"|'canonical'|canonical\b)/i.test(html);
}

function hasProperty(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`property\s*=\s*(?:"${escaped}"|'${escaped}')`, "i").test(html);
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

function pushSeoCheck(file, checkId, checkClass, targetArtifact, expectedResult, okText, failText, ok, severity, remediation) {
  checks.push(
    result({
      check_id: `${checkId}:${file}`,
      check_class: checkClass,
      target_artifact: targetArtifact,
      expected_result: expectedResult,
      actual_result: ok ? okText : failText,
      status: ok ? "PASS" : "FAIL",
      severity,
      remediation_if_failed: remediation,
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

  pushSeoCheck(file, "html-title-present", "seo_meta", `${file} <title>`, "Page title is present and not empty", "Title found", "Title missing or empty", hasTitle, "high", "Add meaningful <title> tag to pages");
  pushSeoCheck(file, "meta-description-present", "seo_meta", `${file} meta[name="description"]`, "Meta description present", "Description meta tag found", "Description meta tag missing", hasDescription, "high", "Add meta description to pages");
  pushSeoCheck(file, "viewport-meta-present", "seo_meta", `${file} meta[name="viewport"]`, "Viewport meta tag present", "Viewport meta tag found", "Viewport meta tag missing", hasViewport, "medium", "Add viewport meta tag for mobile responsiveness");
  pushSeoCheck(file, "charset-declared", "seo_meta", `${file} charset`, "Character encoding declared", "Charset declaration found", "Charset declaration missing", hasCharset, "medium", "Add charset declaration to HTML");
  pushSeoCheck(file, "open-graph-tags", "seo_social", `${file} Open Graph`, "Open Graph meta tags present", "OG tags found", "OG tags incomplete", hasOgTitle && hasOgDescription, "high", "Add Open Graph meta tags for social media sharing");
  pushSeoCheck(file, "canonical-link", "seo_canonical", `${file} link[rel=canonical]`, "Canonical link present", "Canonical link found", "Canonical link missing", hasCanonical, "high", 'Add <link rel="canonical"> to pages');
  pushSeoCheck(file, "og-url", "seo_social", `${file} meta[property="og:url"]`, "Open Graph URL present", "og:url found", "og:url missing", hasOgUrl, "high", 'Add meta property="og:url" to pages');
}

// Check HTML meta tags in built output
if (exists("dist")) {
  const htmlFiles = listFiles("dist", (file) => file.endsWith(".html"));
  if (htmlFiles.length === 0) {
    checks.push(
      buildRequiredResult(
        "build-required-for-seo",
        "Build output contains HTML for SEO checking",
        "No HTML files in dist/",
        "FAIL",
      ),
    );
  } else {
    for (const file of htmlFiles) {
      try {
        checkHtmlFile(file);
      } catch (error) {
        checks.push(fileReadErrorResult(`seo-meta-check-failed:${file}`, file, "SEO meta tag", error));
      }
    }
  }
} else {
  checks.push(
    buildRequiredResult(
      "build-required-for-seo",
      "Build output exists for SEO checking",
      "Build output missing",
    ),
  );
}

writeJsonl("validation/seo_checks.jsonl", checks);

const status = statusFromRows(checks);
console.log(JSON.stringify({ status, checks: checks.length }, null, 2));

if (status === "FAIL") process.exit(1);
