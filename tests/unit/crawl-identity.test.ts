// L9_META: layer=test, role=crawl_identity_regression, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import type { SourceSiteManifest } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import {
  buildCrawlIdentity,
  overlayCrawlIdentity,
  routesFromCrawl,
} from "../../src/services/spec/crawlIdentity.js";

const manifest: SourceSiteManifest = {
  schema: "website-bot.source-site-manifest/v1",
  sourceUrl: "https://www.safehavenrr.com/",
  crawledAt: "2026-08-13T00:00:00.000Z",
  crawlerVersion: "1.1.0",
  pages: [
    {
      url: "https://www.safehavenrr.com/",
      title: "Safe Haven Roofing",
      headings: ["Safe Haven Roofing & Renovations"],
      phones: ["(704) 648-7252"],
      depth: 0,
    },
    {
      url: "https://www.safehavenrr.com/gallery",
      headings: ["Our Work"],
      depth: 1,
    },
    {
      url: "https://www.safehavenrr.com/services/roof-repair",
      headings: ["Roof Repair"],
      depth: 2,
    },
  ],
  images: [],
  rejected: [],
  warnings: [],
  palette: {
    primary: "#1ca0e0",
    secondary: "#171717",
    accent: "#1ca0e0",
    background: "#000000",
    text: "#ffffff",
  },
};

void test("routes come from crawled slugs, not an invented service list", () => {
  const routes = routesFromCrawl(manifest.pages);
  assert.deepEqual(
    routes.map((route) => route.slug),
    ["/", "/gallery", "/services/roof-repair"],
  );
  assert.ok(routes[0].components.includes("gallery"));
});

void test("CODE identity wins over an LLM-invented spec", () => {
  const identity = buildCrawlIdentity(manifest, {
    clientId: "safehavenrr",
    targetUrl: "https://www.safehavenrr.com/",
    siteUrl: "https://safehavenrr-site.vercel.app",
  });
  const overlaid = overlayCrawlIdentity(
    {
      client_id: "invented",
      business_name: "Invented Brochures LLC",
      vertical: "roofing_contractor",
      geography: { states: ["NC"], primary_state: "NC" },
      design: { status: "pending" },
      routes: [{ slug: "/services/invented", title: "Invented", components: ["hero"] }],
      seo_contract: { site_url: "https://igorbeylin.com", phone: "555-0100" },
    },
    identity,
  );
  assert.equal(overlaid.client_id, "safehavenrr");
  assert.match(String(overlaid.business_name), /Safe Haven/);
  const seo = overlaid.seo_contract as { site_url: string; phone: string };
  assert.equal(seo.site_url, "https://safehavenrr-site.vercel.app");
  assert.equal(seo.phone, "(704) 648-7252");
  const routes = overlaid.routes as Array<{ slug: string }>;
  assert.ok(
    routes.every((route) => ["/", "/gallery", "/services/roof-repair"].includes(route.slug)),
  );
  assert.equal((overlaid.design as { status: string }).status, "resolved");
});
