// L9_META: layer=test, role=content_plumbing_regression, status=active, version=1.0.0
//
// Lane wb-content-plumbing: one test group per CTO-verified defect.
//  (1) every section received the same [heading + first sentences of bodyText];
//  (2) templates split one string on blank lines and invented structure;
//  (3) single-client/roofing literals shipped to every site;
//  (4) the LLM saw only name/vertical/states and generated each section alone;
//  (5) the gallery heading regex matched "workmanship";
//  (6) no verified lead endpoint silently dropped the primary CTA.
// Fixtures are real-shaped: tests/fixtures/content/safehaven-home.html carries
// the SafeHaven crawl shape (nav, button links, tel: buttons, a <title>,
// a "Workmanship" section, an FAQ group, a contact block with a <button>).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { extractPage } from "../../src/ingestion/PageExtractor.js";
import type { BuildContext, DomainSpec } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import type {
  IngestedPage,
  SourceSiteManifest,
} from "../../src/pipeline/evidence/SourceSiteManifest.js";
import { getSection } from "../../src/services/content/sectionContent.js";
import { ContentGenerationStage } from "../../src/stages/ContentGenerationStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const HTML = readFileSync(resolve("tests/fixtures/content/safehaven-home.html"), "utf8");
const URL_HOME = "https://www.safehavenrr.com/";

function crawledPage(html: string, url: string, depth = 0): IngestedPage {
  const extracted = extractPage(html, url);
  return {
    url,
    title: extracted.title,
    description: extracted.description,
    headings: extracted.headings,
    textExcerpt: extracted.textExcerpt,
    bodyText: extracted.bodyText,
    phones: extracted.phones,
    nav: extracted.nav,
    blocks: extracted.blocks,
    depth,
  };
}

function manifest(pages: IngestedPage[]): SourceSiteManifest {
  return {
    schema: "website-bot.source-site-manifest/v1",
    sourceUrl: URL_HOME,
    crawledAt: "2026-11-20T00:00:00.000Z",
    crawlerVersion: "1.2.0",
    pages,
    images: [],
    rejected: [],
    warnings: [],
  };
}

const HOME_COMPONENTS = [
  "hero",
  "trust_bar",
  "process",
  "service_detail",
  "service_area",
  "faq",
  "gallery",
  "cta",
];

function ctxFor(opts: {
  components?: string[];
  routes?: DomainSpec["routes"];
  manifest?: SourceSiteManifest;
  spec?: Partial<DomainSpec>;
  responses?: string[];
}) {
  const prompts: string[] = [];
  const responses = [...(opts.responses ?? [])];
  const generatedContent = new Map<string, string>();
  const ctx = {
    dryRun: false,
    domainSpec: {
      client_id: "safehaven",
      vertical: "roofing",
      business_name: "Safe Haven Roofing & Renovations",
      geography: { primary_state: "NC", states: ["NC"] },
      design: { status: "pending" },
      routes: opts.routes ?? [
        { slug: "/", title: "Home", components: opts.components ?? HOME_COMPONENTS },
      ],
      ...opts.spec,
    },
    sourceSiteManifest: opts.manifest,
    generatedContent,
    llm: {
      async generateContent(prompt: string): Promise<string> {
        prompts.push(prompt);
        return responses.shift() ?? "";
      },
    },
  } as unknown as BuildContext;
  return { ctx, prompts, generatedContent };
}

const stage = new ContentGenerationStage();
const NAV_AND_BUTTON_TEXT = [
  "Call Now",
  "Get A Free Estimate",
  "Schedule Your Inspection",
  "Contact Us Today",
  "About Us",
  "Privacy Policy",
  "| Charlotte Roofing Contractor",
];

// ---------------------------------------------------------------- defect 1
void test("(1) every reconstructed section gets its own crawled material, never another section's", async () => {
  const { ctx, generatedContent } = ctxFor({ manifest: manifest([crawledPage(HTML, URL_HOME)]) });
  await stage.run(ctx);
  // Store-agnostic: the plain-text projection is "heading\n\nbody...".
  const bodies = [...generatedContent.values()]
    .map((text) => text.split("\n\n").slice(1).join("\n\n").trim())
    .filter(Boolean);
  assert.ok(bodies.length >= 6, `expected one body per content section, got ${bodies.length}`);
  assert.equal(new Set(bodies).size, bodies.length, "no two sections share a body");
  const all = [...generatedContent.values()].join("\n");
  for (const fragment of NAV_AND_BUTTON_TEXT)
    assert.doesNotMatch(all, new RegExp(escapeRegExp(fragment)));
  // The observed phone appears in no section body (it was only on buttons).
  assert.doesNotMatch(all, /648-7252/);
  assert.equal(headingOf(generatedContent, "/:service_detail"), "Workmanship That Lasts");
});

void test("(1) a component with no material of its own fails loudly instead of borrowing text", async () => {
  const thin = `<html><head><title>T</title></head><body><main>
    <h1>Roof Repair In Charlotte</h1><p>We fix leaks, flashing and storm damage on homes across Charlotte.</p>
  </main></body></html>`;
  const { ctx, generatedContent } = ctxFor({
    components: ["hero", "process", "faq"],
    manifest: manifest([crawledPage(thin, URL_HOME)]),
  });
  await assert.rejects(
    () => stage.run(ctx),
    (error: unknown) =>
      error instanceof BuildError &&
      error.code === "CONTENT_VALIDATION_FAILED" &&
      /no crawled material of its own for process, faq/.test(error.message),
  );
  assert.equal(generatedContent.size, 0);
});

void test("(1) site-wide boilerplate blocks are ported once, not onto every page", async () => {
  const about = HTML.replace("Charlotte Roofing You Can Trust", "About Safe Haven")
    .replace(
      "repairs and replaces roofs for homeowners across the Charlotte metro.",
      "is a family-run contractor that has worked on Charlotte homes for its whole history.",
    )
    .replace(
      '<section class="storm">',
      '<section class="story"><h2>Our Story</h2><p>Founded by a Charlotte family who wanted roofing done honestly and on schedule.</p></section><section class="storm">',
    );
  const { ctx, generatedContent } = ctxFor({
    routes: [
      { slug: "/", title: "Home", components: ["hero", "service_detail"] },
      { slug: "/about", title: "About", components: ["hero", "service_detail"] },
    ],
    manifest: manifest([
      crawledPage(HTML, URL_HOME),
      crawledPage(about, "https://www.safehavenrr.com/about", 1),
    ]),
  });
  await stage.run(ctx);
  assert.equal(getSection(generatedContent, "/:service_detail")?.heading, "Workmanship That Lasts");
  // The About page cannot reuse the home page's "Workmanship" block.
  assert.equal(getSection(generatedContent, "/about:service_detail")?.heading, "Our Story");
});

// ---------------------------------------------------------------- defect 2
void test("(2) structure is captured from the DOM: steps, FAQ pairs with answers, short badges", async () => {
  const { ctx, generatedContent } = ctxFor({ manifest: manifest([crawledPage(HTML, URL_HOME)]) });
  await stage.run(ctx);
  assert.deepEqual(getSection(generatedContent, "/:process")?.steps, [
    "We inspect your roof and document every issue with photos.",
    "We walk you through repair or replacement options and pricing.",
    "Our crew completes the work and cleans up the site the same day.",
  ]);
  const faqs = getSection(generatedContent, "/:faq")?.faqs ?? [];
  assert.equal(faqs.length, 2);
  for (const faq of faqs) {
    assert.match(faq.question, /\?$/);
    assert.ok(faq.answer.split(/\s+/).length >= 5, `answer for ${faq.question}`);
  }
  // A question-shaped CTA heading outside the FAQ group is not an FAQ.
  assert.ok(!faqs.some((faq) => /Ready To Talk/.test(faq.question)));
  assert.deepEqual(getSection(generatedContent, "/:trust_bar")?.badges, [
    "Licensed and insured",
    "Locally owned in Charlotte",
    "Insurance claim assistance",
  ]);
});

void test("(2) C-owned section templates render structure, never split strings or show internal labels", () => {
  const read = (path: string) =>
    readFileSync(resolve("astro_template/src/components", path), "utf8");
  const files = [
    "sections/TrustBar.astro",
    "sections/Process.astro",
    "sections/Faq.astro",
    "sections/ProseSection.astro",
    "sections/ServiceArea.astro",
    "LeadForm.astro",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /\.split\(\/\\n\{2,\}\//, `${file} splits content on blank lines`);
    assert.doesNotMatch(source, /replaceAll\("_", " "\)/, `${file} renders the component name`);
  }
  assert.doesNotMatch(read("sections/Faq.astro"), /answer: ""/);
  assert.doesNotMatch(read("sections/Process.astro"), /paragraphs\.slice\(1\)/);
});

void test("(2) the COPY assembler hands every section its structured fields", async () => {
  const ctx = fixtureContext({
    routes: [{ slug: "/", title: "Home", components: ["hero", "process", "faq", "trust_bar"] }],
  });
  try {
    const source = ctxFor({
      components: ["hero", "process", "faq", "trust_bar"],
      manifest: manifest([crawledPage(HTML, URL_HOME)]),
    });
    await stage.run(source.ctx);
    ctx.generatedContent = source.generatedContent;
    await new SiteAssemblerStage().run(ctx);
    const home = readFileSync(join(ctx.outputDir, "src/pages/index.astro"), "utf-8");
    assert.match(home, /structured=\{section\.structured \?\? undefined\}/);
    const sections = JSON.parse(
      /const sections = (\[[\s\S]*?\]) as const;/.exec(home)?.[1] ?? "[]",
    );
    const process = sections.find((section: { name: string }) => section.name === "process");
    assert.deepEqual(process.structured.blocks.at(-1).kind, "steps");
    const faq = sections.find((section: { name: string }) => section.name === "faq");
    assert.equal(faq.structured.faqs.length, 2);
    const trust = sections.find((section: { name: string }) => section.name === "trust_bar");
    assert.deepEqual(trust.structured.badges, [
      "Licensed and insured",
      "Locally owned in Charlotte",
      "Insurance claim assistance",
    ]);
  } finally {
    cleanupContext(ctx);
  }
});

// ---------------------------------------------------------------- defect 3
void test("(3) no hardcoded client or roofing literals reach a site", async () => {
  const { ctx, generatedContent } = ctxFor({ manifest: manifest([crawledPage(HTML, URL_HOME)]) });
  await stage.run(ctx);
  assert.doesNotMatch(generatedContent.get("/:cta") ?? "", /Free Roof Inspection|24 hours/i);
  // Without an operator primary action the CTA heading is the site's own contact heading.
  assert.equal(headingOf(generatedContent, "/:cta"), "Ready To Talk About Your Roof?");
  const sources = [
    "src/services/content/sourceCopy.ts",
    "src/stages/ContentGenerationStage.ts",
    "astro_template/src/components/sections/TrustBar.astro",
  ].map((path) => readFileSync(resolve(path), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /Free Roof Inspection|Safe Haven Standard|respond within 24 hours/i,
    );
    assert.doesNotMatch(source, /Similar roofing copy/i);
  }
});

void test("(3) the CTA offer is the spec's primary action, verbatim", async () => {
  const { ctx, generatedContent } = ctxFor({
    manifest: manifest([crawledPage(HTML, URL_HOME)]),
    spec: {
      conversion_authority: {
        primary_action: "Book a Roof Assessment",
        secondary_actions: [],
        cta_library: [],
      },
    },
  });
  await stage.run(ctx);
  assert.equal(headingOf(generatedContent, "/:cta"), "Book a Roof Assessment");
});

void test("(3) a non-roofing vertical's prompt carries no roofing hint", async () => {
  const { ctx, prompts } = ctxFor({
    components: ["hero", "cta"],
    spec: { vertical: "dental", business_name: "Bright Smile Dental" },
    responses: [
      page([
        {
          component: "hero",
          heading: "Gentle dental care",
          subheading: "Cleanings and fillings for families.",
        },
        {
          component: "cta",
          heading: "Ask about an appointment",
          paragraphs: ["Call the front desk to find a time."],
        },
      ]),
    ],
  });
  await stage.run(ctx);
  assert.doesNotMatch(prompts[0], /roof/i);
});

// ---------------------------------------------------------------- defect 4
const SPEC_FACTS: Partial<DomainSpec> = {
  business_facts: { license_number: "NC-12345", service_hours: "Mon-Fri 8am-5pm" },
  value_proposition: {
    status: "locked",
    target_customer: ["Charlotte homeowners"],
    problem: ["leaks after storms"],
    outcome: ["a dry home"],
    mechanism: ["photo-documented inspections"],
    differentiators: ["in-house crews"],
    reasons_to_believe: ["licensed in North Carolina"],
    boundaries: ["residential only"],
  },
  conversion_authority: {
    primary_action: "Request a Roof Assessment",
    secondary_actions: ["Call the office"],
    cta_library: [],
  },
  client_vision: {
    desired_outcomes: ["more inspection requests"],
    brand_attributes: ["plainspoken"],
  },
};

void test("(4) the page prompt carries business facts, value proposition, conversion authority and vision", async () => {
  const { ctx, prompts } = ctxFor({
    components: ["hero", "cta"],
    spec: SPEC_FACTS,
    responses: [
      page([
        {
          component: "hero",
          heading: "Dry homes after every storm",
          subheading: "Inspections documented with photos.",
        },
        {
          component: "cta",
          heading: "x",
          paragraphs: ["Tell us where the leak shows up and we will look."],
        },
      ]),
    ],
  });
  await stage.run(ctx);
  for (const expected of [
    "NC-12345",
    "Mon-Fri 8am-5pm",
    "in-house crews",
    "Charlotte homeowners",
    "Request a Roof Assessment",
    "more inspection requests",
    "plainspoken",
  ])
    assert.ok(prompts[0].includes(expected), `prompt carries ${expected}`);
});

void test("(4) a page is generated in one call covering every section, later pages see earlier ones", async () => {
  const { ctx, prompts, generatedContent } = ctxFor({
    routes: [
      { slug: "/", title: "Home", components: ["hero", "cta"] },
      { slug: "/about", title: "About", components: ["hero"] },
    ],
    spec: SPEC_FACTS,
    responses: [
      page([
        {
          component: "hero",
          heading: "Dry homes after every storm",
          subheading: "Inspections documented with photos.",
        },
        {
          component: "cta",
          heading: "x",
          paragraphs: ["Tell us where the leak shows up and we will look."],
        },
      ]),
      page([
        {
          component: "hero",
          heading: "Who repairs your roof",
          subheading: "Our own crews, never subcontracted day labor.",
        },
      ]),
    ],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /"hero"[\s\S]*"cta"/);
  assert.match(prompts[1], /Already written elsewhere[\s\S]*Dry homes after every storm/);
  // The operator's primary action is the CTA heading regardless of model output.
  assert.equal(getSection(generatedContent, "/:cta")?.heading, "Request a Roof Assessment");
});

// ---------------------------------------------------------------- defect 5
void test("(5) a 'Workmanship' heading is not a gallery; a projects heading is", async () => {
  const { ctx, generatedContent } = ctxFor({ manifest: manifest([crawledPage(HTML, URL_HOME)]) });
  await stage.run(ctx);
  assert.equal(headingOf(generatedContent, "/:gallery"), "Recent Projects");
});

// ---------------------------------------------------------------- defect 6
void test("(6) with no verified lead endpoint the primary CTA calls the verified phone", async () => {
  const ctx = fixtureContext({
    seo_contract: { site_url: "ci-test.example.com", phone: "(704) 648-7252" },
    routes: [
      { slug: "/", title: "Home", components: ["hero", "cta"] },
      { slug: "/contact", title: "Contact", components: ["contact_form"] },
    ],
  });
  for (const route of ctx.domainSpec.routes)
    for (const component of route.components)
      ctx.generatedContent.set(
        `${route.slug}:${component}`,
        `${route.title} ${component}\n\nCopy.`,
      );
  try {
    await new SiteAssemblerStage().run(ctx);
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    const cta = JSON.parse(
      /primaryCta: ([\s\S]*?) as \{ label: string; href: string \} \| null,/.exec(config)?.[1] ??
        "null",
    );
    assert.deepEqual(cta, { label: "Call (704) 648-7252", href: "tel:7046487252" });
    assert.match(config, /leadFormAction: "" as string,/);
  } finally {
    cleanupContext(ctx);
  }
});

function headingOf(content: Map<string, string>, key: string): string | undefined {
  return content.get(key)?.split("\n")[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function page(sections: Array<Record<string, unknown>>): string {
  return JSON.stringify({ sections });
}
