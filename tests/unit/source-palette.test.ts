// L9_META: layer=test, role=source_palette_regression, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import { crawlPagePriority, hasMediaPage } from "../../src/ingestion/CrawlPriority.js";
import { extractHexColors, inferPalette } from "../../src/ingestion/SourcePalette.js";
import { stripMarkdownDecorators } from "../../src/services/content/plainText.js";
import { DesignIntelligenceStage } from "../../src/stages/DesignIntelligenceStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

void test("infers Kyle-style black / sky-blue / light text from crawled CSS hexes", () => {
  const css = ":root{--bg:#0a0a0a;--fg:#f5f5f5;--accent:#1ca0e0} a{color:#1ca0e0}";
  const palette = inferPalette(extractHexColors(css));
  assert.ok(palette);
  assert.equal(palette?.background, "#0a0a0a");
  assert.equal(palette?.text, "#f5f5f5");
  assert.equal(palette?.primary, "#1ca0e0");
});

void test("gallery URLs are crawled before generic service pages", () => {
  assert.ok(
    crawlPagePriority("https://x.test/gallery") <
      crawlPagePriority("https://x.test/services/roof-repair"),
  );
  assert.equal(hasMediaPage(["https://x.test/about", "https://x.test/gallery/"]), true);
});

void test("stripMarkdownDecorators removes leaked heading emphasis", () => {
  assert.equal(
    stripMarkdownDecorators("**Protect Your Home with Trusted Roofing Experts**"),
    "Protect Your Home with Trusted Roofing Experts",
  );
});

void test("design stage prefers crawled palette over an LLM-resolved spec", async () => {
  const ctx = fixtureContext({
    design: {
      status: "resolved",
      palette: { primary: "#2C5530", secondary: "#8B6914" },
      fonts: { heading: "Inter", body: "Inter" },
    },
  });
  ctx.sourceSiteManifest = {
    schema: "website-bot.source-site-manifest/v1",
    sourceUrl: "https://www.safehavenrr.com/",
    crawledAt: "2026-08-13T00:00:00.000Z",
    crawlerVersion: "1.1.0",
    pages: [],
    images: [],
    rejected: [],
    warnings: [],
    palette: {
      primary: "#1ca0e0",
      secondary: "#171717",
      accent: "#1ca0e0",
      background: "#0a0a0a",
      text: "#f5f5f5",
    },
  };
  try {
    await new DesignIntelligenceStage().run(ctx);
    assert.equal(ctx.designTokens?.primary, "#1ca0e0");
    assert.equal(ctx.designTokens?.background, "#0a0a0a");
  } finally {
    cleanupContext(ctx);
  }
});

void test("source-site reconstruction fails closed when CSS palette is missing", async () => {
  const ctx = fixtureContext({
    assets: { sourceSite: { url: "https://www.safehavenrr.com/", enabled: true } },
    design: { status: "pending" },
  });
  ctx.sourceSiteManifest = {
    schema: "website-bot.source-site-manifest/v1",
    sourceUrl: "https://www.safehavenrr.com/",
    crawledAt: "2026-08-13T00:00:00.000Z",
    crawlerVersion: "1.1.0",
    pages: [],
    images: [],
    rejected: [],
    warnings: [],
  };
  try {
    await assert.rejects(
      () => new DesignIntelligenceStage().run(ctx),
      /Refusing to invent brand colors/,
    );
  } finally {
    cleanupContext(ctx);
  }
});
