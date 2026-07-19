// L9_META
// skill_schema: 1
// parent: l9-website-factory
// layer: script
// role: visual_qa_verification
// tags: [verification, vision, qa, layout, screenshots]
// owner: igor_beylin
// status: active
// version: 1.0.0
// updated: 2026-06-15
// /L9_META

/**
 * Visual QA Verification Script
 * Captures screenshots at multiple viewports and validates layout via LLM vision.
 * Pattern: Screenshot capture → Vision model analysis → Issue report
 * Requires: OPENROUTER_API_KEY, SITE_URL (or local dev server)
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCREENSHOTS_DIR = join(process.cwd(), 'validation', 'screenshots');
const REPORT_PATH = join(process.cwd(), 'validation', 'visual_qa_report.json');

// Viewports to test (matches @quantum-l9/llm-router VIEWPORTS)
const VIEWPORTS = [
  { name: 'desktop_1920', width: 1920, height: 1080 },
  { name: 'desktop_1440', width: 1440, height: 900 },
  { name: 'ipad', width: 1024, height: 768 },
  { name: 'iphone_14', width: 390, height: 844 },
  { name: 'pixel_7', width: 412, height: 915 },
];

// Pages to validate — derived from the DomainSpec, never hardcoded to one
// client's routes. Precedence: explicit QA_PAGES env (comma-separated) →
// the spec's route slugs (SPEC_PATH or the default normalized spec) → home only.
async function resolvePages() {
  // Normalize to a leading-slash path so later `${siteUrl}${pagePath}` builds a
  // valid URL for both env-supplied and spec-derived values (e.g. 'about' → '/about').
  const toPath = (p) => (p.startsWith('/') ? p : `/${p}`);
  if (process.env.QA_PAGES) {
    return process.env.QA_PAGES.split(',').map((s) => s.trim()).filter(Boolean).map(toPath);
  }
  const specPath = process.env.SPEC_PATH || 'domain_spec/domain_spec.normalized.yaml';
  try {
    const { parse } = await import('yaml');
    const spec = parse(readFileSync(specPath, 'utf-8'));
    const root = spec?.domain_spec ?? spec;
    const slugs = (root?.routes ?? []).map((r) => r.slug).filter(Boolean).map(toPath);
    if (slugs.length) return slugs;
  } catch {
    // fall through to the safe default
  }
  console.log('⚠️  Could not derive pages from a DomainSpec — defaulting to home page only.');
  return ['/'];
}

const PAGES = await resolvePages();

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  L9 Website Factory — Visual QA Verification');
  console.log('═══════════════════════════════════════════════════');

  // Check prerequisites
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('⚠️  OPENROUTER_API_KEY not set — skipping vision analysis');
    console.log('   Screenshots will still be captured for manual review');
  }

  const siteUrl = process.env.SITE_URL || 'http://localhost:4321';
  console.log(`\n📸 Target: ${siteUrl}`);
  console.log(`📐 Viewports: ${VIEWPORTS.length}`);
  console.log(`📄 Pages: ${PAGES.length}`);
  console.log(`📊 Total screenshots: ${VIEWPORTS.length * PAGES.length}\n`);

  // Create screenshots directory
  if (!existsSync(SCREENSHOTS_DIR)) {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  // Check if site is reachable
  try {
    execSync(`curl -s -o /dev/null -w "%{http_code}" ${siteUrl}`, { encoding: 'utf-8' });
  } catch {
    console.error('❌ Site not reachable at', siteUrl);
    console.error('   Start the dev server with: npm run dev');
    console.error('   Or set SITE_URL to a deployed URL');
    process.exit(1);
  }

  console.log('✅ Site reachable\n');

  // Capture screenshots (requires Playwright or Puppeteer)
  const hasPlaywright = checkDependency('playwright');
  if (!hasPlaywright) {
    console.log('⚠️  Playwright not installed — generating screenshot plan only');
    console.log('   Install with: npx playwright install chromium');
    console.log('');

    // Output the plan for manual execution or future automation
    const plan = {
      status: 'PLAN_ONLY',
      reason: 'Playwright not installed for automated screenshot capture',
      siteUrl,
      viewports: VIEWPORTS,
      pages: PAGES,
      totalScreenshots: VIEWPORTS.length * PAGES.length,
      instruction: 'Install Playwright and re-run, or capture screenshots manually',
      screenshotsDir: SCREENSHOTS_DIR,
    };

    writeFileSync(REPORT_PATH, JSON.stringify(plan, null, 2));
    console.log(`📋 Plan written to: ${REPORT_PATH}`);
    console.log('');
    console.log('STATUS: DEFERRED (missing dependency)');
    return;
  }

  // If we have Playwright, capture and analyze
  console.log('📸 Capturing screenshots...\n');
  const screenshots = await captureScreenshots(siteUrl);

  if (process.env.OPENROUTER_API_KEY) {
    console.log('\n🤖 Running vision analysis...\n');
    // Dynamic import of the LLM service
    const { createWebsiteFactoryLLM } = await import('../dist/services/llm.js');
    const llm = createWebsiteFactoryLLM();

    const issues = [];
    for (const screenshot of screenshots) {
      const result = await llm.validateLayout(
        [screenshot.path],
        `Page: ${screenshot.page}, Viewport: ${screenshot.viewport.name} (${screenshot.viewport.width}x${screenshot.viewport.height})`,
      );
      issues.push({
        page: screenshot.page,
        viewport: screenshot.viewport.name,
        analysis: result,
      });
    }

    const report = {
      status: issues.some(i => i.analysis.includes('critical')) ? 'FAIL' : 'PASS',
      timestamp: new Date().toISOString(),
      siteUrl,
      totalScreenshots: screenshots.length,
      issues,
    };

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`\n📋 Report written to: ${REPORT_PATH}`);
    console.log(`STATUS: ${report.status}`);
  } else {
    console.log('📋 Screenshots captured. Run with OPENROUTER_API_KEY for AI analysis.');
  }
}

function checkDependency(name) {
  try {
    execSync(`npx ${name} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function captureScreenshots(siteUrl) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const screenshots = [];

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();

    for (const pagePath of PAGES) {
      const url = `${siteUrl}${pagePath}`;
      const filename = `${pagePath.replace(/\//g, '_') || '_index'}_${viewport.name}.png`;
      const filepath = join(SCREENSHOTS_DIR, filename);

      try {
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.screenshot({ path: filepath, fullPage: true });
        screenshots.push({ page: pagePath, viewport, path: filepath });
        console.log(`  ✅ ${pagePath} @ ${viewport.name}`);
      } catch (err) {
        console.log(`  ❌ ${pagePath} @ ${viewport.name}: ${err.message}`);
      }
    }

    await context.close();
  }

  await browser.close();
  return screenshots;
}

main().catch(console.error);
