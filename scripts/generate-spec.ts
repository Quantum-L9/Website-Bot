// L9_META: layer=cli, role=spec_generator, status=active, version=1.0.0
//
// Pre-pipeline tool: given a target URL, crawl the site, extract structure and
// content, then use the LLM Router (STRATEGIC_REASONING) to synthesize a flat
// DomainSpec YAML the pipeline can consume directly. This closes the gap between
// "I have a URL" and "I have a spec to feed the factory."
//
// Usage:
//   npx tsx scripts/generate-spec.ts <url>
//   npx tsx scripts/generate-spec.ts <url> --out=<path>
//   npx tsx scripts/generate-spec.ts <url> --client-id=<id>
//   npx tsx scripts/generate-spec.ts <url> --with-assets   # include image slots + sourceSite block
//
// Output: a flat DomainSpec YAML written to --out (default: build/specs/<client_id>.yaml)
// The output is validated through validateDomainSpec before writing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stringify } from 'yaml';
import { SourceCrawler, type CrawlOptions } from '../src/ingestion/SourceCrawler.js';
import { createWebsiteFactoryLLM } from '../src/services/llm.js';
import { validateDomainSpec } from '../src/pipeline/validateDomainSpec.js';
import { extractJson } from '../src/services/extractJson.js';
import type { DomainSpec } from '../src/pipeline/BuildContext.js';
import type { IngestedPage } from '../src/pipeline/evidence/SourceSiteManifest.js';

// ── CLI argument parsing ──

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const targetUrl = positional[0];
if (!targetUrl) {
  console.error('Usage: npx tsx scripts/generate-spec.ts <url> [--out=<path>] [--client-id=<id>] [--with-assets]');
  process.exit(1);
}

function valueOf(name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return undefined;
}

const withAssets = args.includes('--with-assets');
const explicitClientId = valueOf('client-id');
const explicitOut = valueOf('out');

// ── Derive client_id from URL if not provided ──

function clientIdFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname
      .replace(/^www\./, '')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9]+/gi, '_')
      .toLowerCase()
      .slice(0, 40);
  } catch {
    return 'unknown_client';
  }
}

const clientId = explicitClientId ?? clientIdFromUrl(targetUrl);
const outPath = explicitOut ?? resolve('build', 'specs', `${clientId}.yaml`);

// ── Crawl the target site ──

console.log(`[generate-spec] Crawling ${targetUrl} ...`);

const crawlOptions: CrawlOptions = {
  seedUrl: targetUrl,
  maxPages: 10,
  maxDepth: 2,
  downloadImages: false,
  captureScreenshots: false,
};

const crawler = new SourceCrawler(crawlOptions);
const manifest = await crawler.crawl();

if (manifest.pages.length === 0) {
  console.error(`[generate-spec] FATAL: crawl returned 0 pages from ${targetUrl}`);
  process.exit(1);
}

console.log(`[generate-spec] Crawled ${manifest.pages.length} pages, ${manifest.images.length} image candidates`);

// ── Compile crawl context for LLM ──

function summarizePage(page: IngestedPage): string {
  const parts = [`URL: ${page.url}`];
  if (page.title) parts.push(`Title: ${page.title}`);
  if (page.description) parts.push(`Description: ${page.description}`);
  if (page.headings.length) parts.push(`Headings: ${page.headings.slice(0, 8).join(' | ')}`);
  if (page.textExcerpt) parts.push(`Excerpt: ${page.textExcerpt.slice(0, 300)}`);
  return parts.join('\n');
}

const siteContext = manifest.pages.map(summarizePage).join('\n---\n');

// ── LLM call: synthesize DomainSpec ──

console.log(`[generate-spec] Synthesizing DomainSpec via LLM ...`);

const llm = createWebsiteFactoryLLM(clientId);

const systemPrompt = `You are an expert website analyst and L9 DomainSpec author. Given crawled page data from an existing website, produce a valid flat DomainSpec as a JSON object.

The DomainSpec MUST have this exact shape:
{
  "client_id": "<slug>",
  "business_name": "<name>",
  "vertical": "<industry_slug>",
  "geography": { "states": ["XX"], "primary_state": "XX" },
  "design": { "status": "pending" },
  "routes": [{ "slug": "/", "title": "Home", "components": ["hero", "trust-signals", "services-overview", "faq", "contact-form"] }, ...],
  "seo_contract": { "site_url": "<url>", "target_keywords": [...] }
}

Rules:
- client_id must be a lowercase slug (letters, numbers, underscores only).
- vertical must be a lowercase_snake_case industry descriptor.
- geography.states: use 2-letter US state codes. Infer from content.
- routes: derive from the crawled pages. Every route needs a slug, title, and components array.
- components: use these registered names: hero, trust-signals, trust_bar, services-overview, service-detail, service-list, process, audience_paths, service_area, cta, final_cta, compliance_note, disclaimer, faq, confirmation, contact-form, contact_form.
- seo_contract.site_url: the canonical URL of the site.
- seo_contract.target_keywords: 3-8 SEO keywords inferred from the content.
- Do NOT invent phone numbers, emails, addresses, or license numbers.
- Output ONLY the JSON object. No markdown fences, no prose.`;

const userPrompt = `Analyze this crawled site data and produce the flat DomainSpec JSON.

Target URL: ${targetUrl}
Client ID: ${clientId}

Crawled pages:
${siteContext}`;

const rawResponse = await llm.designReasoning(
  `${systemPrompt}\n\n${userPrompt}`,
);

// ── Parse and validate ──

let parsed: unknown;
try {
  parsed = extractJson(rawResponse);
} catch {
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    console.error('[generate-spec] FATAL: LLM returned unparseable response');
    console.error(rawResponse.slice(0, 500));
    process.exit(1);
  }
}

if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
  console.error('[generate-spec] FATAL: LLM response is not a JSON object');
  process.exit(1);
}

// Ensure client_id matches
(parsed as Record<string, unknown>).client_id = clientId;

// Inject assets block when requested
if (withAssets) {
  const routeSlugs = ((parsed as Record<string, unknown>).routes as Array<{ slug: string }> ?? []).map(r => r.slug);
  const imageSlots: Array<Record<string, unknown>> = [
    { id: 'logo', placement: 'global:logo', required: false, preferredSources: ['source-site', 'provided', 'generated'], aspectRatio: '1:1', imageSize: '1K', generation: { intent: `Company logo for ${(parsed as Record<string, unknown>).business_name ?? clientId}` } },
    { id: 'og-image', placement: 'global:og-image', required: false, preferredSources: ['generated'], aspectRatio: '16:9', imageSize: '2K', generation: { intent: `Professional Open Graph social preview image for ${(parsed as Record<string, unknown>).business_name ?? clientId}` } },
    { id: 'hero-home', placement: '/:hero', required: true, preferredSources: ['source-site', 'generated'], aspectRatio: '16:9', imageSize: '2K', generation: { intent: `Hero image for a ${(parsed as Record<string, unknown>).vertical ?? 'business'} company homepage`, subject: (parsed as Record<string, unknown>).business_name as string, style: 'professional, modern, trustworthy' } },
  ];
  for (const slug of routeSlugs) {
    if (slug !== '/' && slug.startsWith('/services/')) {
      const title = ((parsed as Record<string, unknown>).routes as Array<{ slug: string; title: string }> ?? []).find(r => r.slug === slug)?.title ?? slug;
      imageSlots.push({
        id: `hero-${slug.replace(/\//g, '-').replace(/^-/, '')}`,
        placement: `${slug}:hero`,
        required: false,
        preferredSources: ['source-site', 'generated'],
        aspectRatio: '16:9',
        imageSize: '2K',
        generation: { intent: `Service page hero image for ${title}`, subject: title, style: 'professional, modern' },
      });
    }
  }

  (parsed as Record<string, unknown>).assets = {
    sourceSite: {
      url: targetUrl,
      enabled: true,
      maxPages: 15,
      maxDepth: 2,
      downloadImages: true,
      captureScreenshots: false,
    },
    imageSlots,
    generation: {
      enabled: true,
      model: 'gemini-2.5-flash-image',
      budgetUsd: 2.0,
      promptCompiler: 'default',
    },
  };
}

// Validate through the pipeline's own validator
let validated: DomainSpec;
try {
  validated = validateDomainSpec(parsed, 'generate-spec output');
} catch (error) {
  console.error(`[generate-spec] WARNING: Generated spec failed validation: ${error instanceof Error ? error.message : String(error)}`);
  console.error('[generate-spec] Writing raw output anyway for manual correction.');
  validated = parsed as DomainSpec;
}

// ── Write output ──

mkdirSync(dirname(outPath), { recursive: true });
const header = `# L9_META: layer=configuration, role=generated_spec, status=generated, version=1.0.0\n# Generated from ${targetUrl} on ${new Date().toISOString()}\n# Review and correct before feeding to the pipeline.\n`;
writeFileSync(outPath, header + stringify(validated), 'utf-8');

console.log(`[generate-spec] Wrote ${outPath}`);
console.log(`[generate-spec] Next: review the spec, then run:`);
console.log(`  npm run pipeline:local-proof -- --spec=${outPath}`);
