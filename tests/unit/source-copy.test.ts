// L9_META: layer=test, role=source_copy_regression, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import type { SourceSiteManifest } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import {
  assembleSourceSection,
  firstSourcePhone,
  isTopNavHref,
  matchSourcePage,
  topNavFromSource,
} from "../../src/services/content/sourceCopy.js";

const manifest: SourceSiteManifest = {
  schema: "website-bot.source-site-manifest/v1",
  sourceUrl: "https://www.safehavenrr.com/",
  crawledAt: "2026-08-13T00:00:00.000Z",
  crawlerVersion: "1.1.0",
  pages: [
    {
      url: "https://www.safehavenrr.com/",
      title: "Safe Haven Roofing",
      description: "Trusted roofing in Charlotte.",
      headings: ["Safe Haven Roofing & Renovations"],
      bodyText:
        "We repair and replace roofs across the Charlotte metro. Storm damage, insurance claims, and new construction.",
      phones: ["(704) 648-7252"],
      nav: [
        { href: "/services", label: "Services" },
        { href: "/gallery", label: "Gallery" },
        { href: "/about", label: "About" },
        { href: "/services/roof-repair", label: "Roof Repair" },
        { href: "/contact", label: "Contact" },
      ],
      depth: 0,
    },
  ],
  images: [],
  rejected: [],
  warnings: [],
};

void test("top nav keeps depth-1 items and drops mega-menu children", () => {
  assert.equal(isTopNavHref("/services"), true);
  assert.equal(isTopNavHref("/services/roof-repair"), false);
  const nav = topNavFromSource(manifest);
  assert.deepEqual(
    nav.map((item) => item.href),
    ["/services", "/gallery", "/about", "/contact"],
  );
});

void test("hero copy is the crawled H1 plus description, not an LLM essay", () => {
  const page = matchSourcePage(manifest, "/");
  assert.ok(page);
  const hero = assembleSourceSection(page, "hero");
  assert.match(hero, /Safe Haven Roofing & Renovations/);
  assert.match(hero, /Trusted roofing in Charlotte/);
  assert.equal(hero.includes("**"), false);
});

void test("first observed phone is ported", () => {
  assert.equal(firstSourcePhone(manifest), "(704) 648-7252");
});
