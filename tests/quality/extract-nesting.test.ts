// L9_META: layer=test, role=site_quality_extract_nesting, status=active, version=1.0.0
//
// Paragraph extraction collects each piece of body text once, from the
// innermost block that carries it. A block nested in another (blockquote > p,
// dd > p, li > p) is not a second "paragraph" to compare against its parent,
// and a quote's attribution is never compared against the quote. Two separate
// elements with the same or similar text are still two paragraphs, so real
// duplicates still fail. Rendered in real headless Chromium.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkPage,
  DEFAULT_OPTIONS,
  type Finding,
  type PageModel,
} from "../../src/validation/site-quality/checks.js";
import { extractSite, serveDirectory } from "../../src/validation/site-quality/extract-page.js";
import { launchChromium } from "../../src/validation/site-quality/run.js";

const QUOTE =
  "The operational test is whether a team can follow through on every qualified account, week after week, without losing the thread of what was promised to the buyer.";
const ATTRIBUTION = "Head of Revenue Operations, a fictional regional distributor";
const SIMILAR =
  "The operational test is whether a team can follow through on every qualified account, week after week, without losing track of what was promised to the buyer.";

const PAGES: Record<string, string> = {
  blockquote: `<blockquote><p>${QUOTE}</p><footer><cite>${ATTRIBUTION}</cite></footer></blockquote>`,
  "list-item": `<ul><li><p>${QUOTE}</p></li></ul>`,
  definition: `<dl><dt>What is the operational test?</dt><dd><p>${QUOTE}</p></dd></dl>`,
  "separate-same": `<p>${QUOTE}</p><p>${QUOTE}</p>`,
  "separate-similar": `<p>${QUOTE}</p><p>${SIMILAR}</p>`,
  "quote-and-paragraph": `<blockquote><p>${QUOTE}</p><footer><cite>${ATTRIBUTION}</cite></footer></blockquote><p>${SIMILAR}</p>`,
};

const work = mkdtempSync(join(tmpdir(), "wb-extract-nesting-"));
const pages = new Map<string, PageModel>();

test.before(async () => {
  writeFileSync(
    join(work, "index.html"),
    "<!doctype html><title>Home</title><main><p>Home</p></main>",
  );
  for (const [name, body] of Object.entries(PAGES)) {
    mkdirSync(join(work, name), { recursive: true });
    writeFileSync(
      join(work, name, "index.html"),
      `<!doctype html><html lang="en"><head><title>${name}</title></head><body><main>${body}</main></body></html>`,
    );
  }
  const server = await serveDirectory(work);
  const session = await launchChromium();
  try {
    const routes = Object.keys(PAGES).map((name) => `/${name}/`);
    const extracted = await extractSite(session.browser, server.url, routes);
    for (const page of extracted) pages.set(page.path.replaceAll("/", ""), page);
  } finally {
    await session.close();
    await server.close();
  }
});
test.after(() => rmSync(work, { recursive: true, force: true }));

const duplicateFindings = (name: string): Finding[] => {
  const page = pages.get(name);
  assert.ok(page, `${name} was extracted`);
  return checkPage(page, { ...DEFAULT_OPTIONS, businessName: "Fixture Co" }).filter((finding) =>
    ["duplicate-paragraph", "near-duplicate-paragraph"].includes(finding.check),
  );
};

test("a blockquote with a paragraph and a cited footer is one paragraph, not a near-duplicate", () => {
  assert.deepEqual(pages.get("blockquote")?.paragraphs, [QUOTE]);
  assert.deepEqual(duplicateFindings("blockquote"), []);
});

test("li > p and dd > p each yield their text once", () => {
  assert.deepEqual(pages.get("list-item")?.paragraphs, [QUOTE]);
  assert.deepEqual(pages.get("definition")?.paragraphs, [QUOTE]);
  assert.deepEqual(duplicateFindings("list-item"), []);
  assert.deepEqual(duplicateFindings("definition"), []);
});

test("two separate paragraphs with the same text still fail as duplicates", () => {
  assert.deepEqual(pages.get("separate-same")?.paragraphs, [QUOTE, QUOTE]);
  assert.deepEqual(
    duplicateFindings("separate-same").map((finding) => finding.check),
    ["duplicate-paragraph"],
  );
});

test("two separate paragraphs with similar text still fail as near-duplicates", () => {
  assert.deepEqual(
    duplicateFindings("separate-similar").map((finding) => finding.check),
    ["near-duplicate-paragraph"],
  );
});

test("a quote and a separate similar paragraph elsewhere are still compared", () => {
  assert.deepEqual(pages.get("quote-and-paragraph")?.paragraphs, [QUOTE, SIMILAR]);
  assert.deepEqual(
    duplicateFindings("quote-and-paragraph").map((finding) => finding.check),
    ["near-duplicate-paragraph"],
  );
});
