// L9_META: layer=test, role=source_copy_regression, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import type { SourceSiteManifest } from "../../src/pipeline/evidence/SourceSiteManifest.js";
import {
  faqsFromManifest,
  firstSourcePhone,
  isTopNavHref,
  matchSourcePage,
  reconstructPageSections,
  SourceReconstructionError,
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
      blocks: [
        {
          heading: "Safe Haven Roofing & Renovations",
          level: 1,
          paragraphs: [
            "We repair and replace roofs across the Charlotte metro, from storm damage to new construction.",
          ],
          items: [],
          qa: [],
        },
      ],
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

void test("hero copy is the crawled H1 plus the hero's own lead paragraph, not an LLM essay", () => {
  const page = matchSourcePage(manifest, "/");
  assert.ok(page);
  const hero = reconstructPageSections({
    page,
    components: ["hero"],
    businessName: "Safe Haven Roofing & Renovations",
  }).get("hero");
  assert.equal(hero?.heading, "Safe Haven Roofing & Renovations");
  assert.match(hero?.subheading ?? "", /Charlotte metro/);
  assert.equal(JSON.stringify(hero).includes("**"), false);
});

void test("a manifest crawled without structure fails loudly instead of guessing", () => {
  const page = { ...manifest.pages[0], blocks: undefined };
  assert.throws(
    () => reconstructPageSections({ page, components: ["hero"], businessName: "X" }),
    (error: unknown) =>
      error instanceof SourceReconstructionError && /crawler < 1\.2\.0/.test(error.message),
  );
});

void test("FAQ schema pairs come from observed Q/A structure, never a guessed paragraph", () => {
  const faqManifest: SourceSiteManifest = {
    ...manifest,
    pages: [
      {
        url: "https://www.safehavenrr.com/faq",
        title: "FAQ",
        headings: ["FAQ", "Do you file claims?"],
        bodyText: "Unrelated intro paragraph that must not become an answer to anything.",
        blocks: [
          { heading: "FAQ", level: 1, paragraphs: [], items: [], qa: [] },
          {
            heading: "Do you file claims?",
            level: 2,
            paragraphs: [],
            items: [],
            qa: [{ question: "Do you file claims?", answer: "We meet your adjuster on site." }],
          },
        ],
        depth: 1,
      },
    ],
  };
  assert.deepEqual(faqsFromManifest(faqManifest), [
    { question: "Do you file claims?", answer: "We meet your adjuster on site." },
  ]);
});

void test("first observed phone is ported", () => {
  assert.equal(firstSourcePhone(manifest), "(704) 648-7252");
});
