// L9_META: layer=cli, role=spec_generator, status=active, version=1.1.0
//
// Pre-pipeline tool: crawl a live site, build DomainSpec identity from the
// crawl (routes, phone, palette, site_url), then optionally fill vertical /
// geography / keywords via LLM. Crawled identity always wins.
//
// Usage:
//   npx tsx scripts/generate-spec.ts <url>
//   npx tsx scripts/generate-spec.ts <url> --out=<path>
//   npx tsx scripts/generate-spec.ts <url> --client-id=<id>
//   npx tsx scripts/generate-spec.ts <url> --with-assets
//   npx tsx scripts/generate-spec.ts <url> --site-url=<showable-url>
//   npx tsx scripts/generate-spec.ts <url> --write-invalid
//
// Output: a flat DomainSpec YAML written to --out (default: build/specs/<client_id>.yaml)
// The output is validated through validateDomainSpec before writing.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stringify } from "yaml";
import { type CrawlOptions, SourceCrawler } from "../src/ingestion/SourceCrawler.js";
import type { DomainSpec } from "../src/pipeline/BuildContext.js";
import { validateDomainSpec } from "../src/pipeline/validateDomainSpec.js";
import { extractJson } from "../src/services/extractJson.js";
import { createWebsiteFactoryLLM } from "../src/services/llm.js";
import { buildCrawlIdentity, overlayCrawlIdentity } from "../src/services/spec/crawlIdentity.js";

// ── CLI argument parsing ──

const args = process.argv.slice(2);
const targetUrl = args.find((a) => !a.startsWith("--"));
if (!targetUrl) {
  console.error(
    "Usage: npx tsx scripts/generate-spec.ts <url> [--out=<path>] [--client-id=<id>] [--with-assets] [--site-url=<url>] [--write-invalid]",
  );
  process.exit(1);
}

function argValue(name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return undefined;
}

const withAssets = args.includes("--with-assets");
const writeInvalid = args.includes("--write-invalid");
const explicitClientId = argValue("client-id");
const explicitOut = argValue("out");
const explicitSiteUrl = argValue("site-url");

// ── Derive client_id from URL if not provided ──

function clientIdFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname
      .replace(/^www\./, "")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .toLowerCase()
      .slice(0, 40);
  } catch {
    return "unknown_client";
  }
}

const clientId = explicitClientId ?? clientIdFromUrl(targetUrl);
const outPath = explicitOut ?? resolve("build", "specs", `${clientId}.yaml`);

// ── Crawl the target site ──

console.log(`[generate-spec] Crawling ${targetUrl} ...`);

const crawlOptions: CrawlOptions = {
  seedUrl: targetUrl,
  maxPages: 40,
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

console.log(
  `[generate-spec] Crawled ${manifest.pages.length} pages, ${manifest.images.length} image candidates`,
);

const identity = buildCrawlIdentity(manifest, {
  clientId,
  targetUrl,
  siteUrl: explicitSiteUrl,
});
console.log(
  `[generate-spec] CODE identity: ${identity.routes.length} crawled routes, phone=${identity.seo_contract.phone ?? "none"}, palette=${identity.design.status}`,
);

console.log(`[generate-spec] Filling vertical/keywords via LLM (identity stays CODE) ...`);

const llm = createWebsiteFactoryLLM(clientId);
const fillPrompt = `Given crawled headings from an existing website, return ONLY JSON:
{"vertical":"lowercase_snake_industry","geography":{"states":["XX"],"primary_state":"XX"},"target_keywords":["k1","k2"]}
Use 2-letter US state codes. Do not invent phone, palette, routes, or site_url.
Headings: ${manifest.pages
  .flatMap((page) => page.headings.slice(0, 3))
  .slice(0, 24)
  .join(" | ")}`;

const fill: {
  vertical: string;
  geography: { states: string[]; primary_state: string };
  target_keywords?: string[];
} = {
  vertical: "local_services",
  geography: { states: ["US"], primary_state: "US" },
};
try {
  const rawResponse = await llm.designReasoning(fillPrompt);
  let parsedFill: unknown;
  try {
    parsedFill = extractJson(rawResponse);
  } catch {
    parsedFill = JSON.parse(rawResponse);
  }
  if (parsedFill && typeof parsedFill === "object" && !Array.isArray(parsedFill)) {
    const row = parsedFill as Record<string, unknown>;
    if (typeof row.vertical === "string" && row.vertical.trim())
      fill.vertical = row.vertical.trim();
    if (row.geography && typeof row.geography === "object" && !Array.isArray(row.geography)) {
      const geo = row.geography as Record<string, unknown>;
      if (
        Array.isArray(geo.states) &&
        geo.states.every((state) => typeof state === "string") &&
        typeof geo.primary_state === "string"
      ) {
        fill.geography = { states: geo.states as string[], primary_state: geo.primary_state };
      }
    }
    if (
      Array.isArray(row.target_keywords) &&
      row.target_keywords.every((keyword) => typeof keyword === "string" && keyword.trim())
    ) {
      fill.target_keywords = row.target_keywords as string[];
    }
  }
} catch (error) {
  console.warn(
    `[generate-spec] LLM fill skipped (${error instanceof Error ? error.message : String(error)}); using CODE defaults`,
  );
}

const parsed: Record<string, unknown> = overlayCrawlIdentity(
  {
    vertical: fill.vertical,
    geography: fill.geography,
    seo_contract: fill.target_keywords ? { target_keywords: fill.target_keywords } : {},
  },
  identity,
);

// Inject assets block when requested
if (withAssets) {
  const routeSlugs = (
    ((parsed as Record<string, unknown>).routes as Array<{ slug: string }>) ?? []
  ).map((r) => r.slug);
  const imageSlots: Array<Record<string, unknown>> = [
    {
      id: "logo",
      placement: "global:logo",
      required: false,
      preferredSources: ["source-site", "provided", "generated"],
      aspectRatio: "1:1",
      imageSize: "1K",
      generation: {
        intent: `Company logo for ${String((parsed as Record<string, unknown>).business_name ?? clientId)}`,
      },
    },
    {
      id: "og-image",
      placement: "global:og-image",
      required: false,
      preferredSources: ["generated"],
      aspectRatio: "16:9",
      imageSize: "2K",
      generation: {
        intent: `Professional Open Graph social preview image for ${String((parsed as Record<string, unknown>).business_name ?? clientId)}`,
      },
    },
    {
      id: "hero-home",
      placement: "/:hero",
      required: true,
      preferredSources: ["source-site", "generated"],
      aspectRatio: "16:9",
      imageSize: "2K",
      generation: {
        intent: `Hero image for a ${String((parsed as Record<string, unknown>).vertical ?? "business")} company homepage`,
        subject: (parsed as Record<string, unknown>).business_name as string,
        style: "professional, modern, trustworthy",
      },
    },
  ];
  for (const slug of routeSlugs) {
    if (slug !== "/" && slug.startsWith("/services/")) {
      const title =
        (
          ((parsed as Record<string, unknown>).routes as Array<{ slug: string; title: string }>) ??
          []
        ).find((r) => r.slug === slug)?.title ?? slug;
      imageSlots.push({
        id: `hero-${slug.replaceAll("/", "-").replace(/^-/, "")}`,
        placement: `${slug}:hero`,
        required: false,
        preferredSources: ["source-site", "generated"],
        aspectRatio: "16:9",
        imageSize: "2K",
        generation: {
          intent: `Service page hero image for ${title}`,
          subject: title,
          style: "professional, modern",
        },
      });
    }
  }

  (parsed as Record<string, unknown>).assets = {
    sourceSite: {
      url: targetUrl,
      enabled: true,
      maxPages: 40,
      maxDepth: 2,
      downloadImages: true,
      captureScreenshots: false,
    },
    imageSlots,
    generation: {
      enabled: true,
      model: "gemini-2.5-flash-image",
      budgetUsd: 2.0,
      promptCompiler: "default",
    },
  };

  const routes = parsed.routes as Array<{ slug: string; components?: string[] }> | undefined;
  const home = routes?.find((route) => route.slug === "/");
  if (home) {
    home.components ??= [];
    if (!home.components.some((name) => name.replaceAll("-", "_") === "gallery")) {
      const heroIndex = home.components.findIndex((name) => name.replaceAll("-", "_") === "hero");
      home.components.splice(heroIndex >= 0 ? heroIndex + 1 : 0, 0, "gallery");
    }
  }
  overlayCrawlIdentity(parsed, identity);
}

function writeSpec(spec: unknown): void {
  mkdirSync(dirname(outPath), { recursive: true });
  const header = `# L9_META: layer=configuration, role=generated_spec, status=generated, version=1.0.0\n# Generated from ${targetUrl} on ${new Date().toISOString()}\n# Review and correct before feeding to the pipeline.\n`;
  writeFileSync(outPath, header + stringify(spec), "utf-8");
}

overlayCrawlIdentity(parsed, identity);

// Validate through the pipeline's own validator — fail-closed (do not write --out).
let validated: DomainSpec;
try {
  validated = validateDomainSpec(parsed, "generate-spec output");
} catch (error) {
  console.error(
    `[generate-spec] ERROR: Generated spec failed validation: ${error instanceof Error ? error.message : String(error)}`,
  );
  if (writeInvalid) {
    console.error("[generate-spec] --write-invalid set: writing raw output for manual correction.");
    writeSpec(parsed);
    console.error(`[generate-spec] Wrote invalid spec to ${outPath}`);
  } else {
    console.error(
      "[generate-spec] Refusing to write invalid spec. Pass --write-invalid to dump raw YAML for manual correction.",
    );
  }
  process.exit(1);
}

// ── Write output ──

writeSpec(validated);

console.log(`[generate-spec] Wrote ${outPath}`);
console.log(`[generate-spec] Next: review the spec, then run:`);
console.log(`  npm run pipeline:local-proof -- --spec=${outPath}`);
