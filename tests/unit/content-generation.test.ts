// L9_META: layer=source, role=tracked_file, status=active, version=2.0.0
//
// ContentGenerationStage v3 contract (lane wb-content-plumbing): one LLM call
// per page returning JSON sections; validation feeds exact issues back and
// fails after MAX_RETRIES. The v2 line-based tests were rewritten to the JSON
// contract with their intents kept (retry, correction wording, banned claims,
// markdown stripping, H1 limits, duplicate H1s, taken headlines). One v2 test
// encoded the wrong contract — "two slots with identical bodies and unique H1s
// succeed" — and is replaced by its inverse (test-defect classification,
// rule 95; CTO decision for this lane).

import assert from "node:assert/strict";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { getSection } from "../../src/services/content/sectionContent.js";
import { ContentGenerationStage } from "../../src/stages/ContentGenerationStage.js";

/** n distinct words, so two bodies built from different seeds never share phrasing. */
const prose = (n: number, seed = "a"): string =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

type SectionJson = Record<string, unknown>;
const page = (...sections: SectionJson[]): string => JSON.stringify({ sections });
const hero = (heading: string, subheading = "Clear help for every claim you file.") => ({
  component: "hero",
  heading,
  subheading,
});
const proseSection = (component: string, heading: string, words: number, seed: string) => ({
  component,
  heading,
  paragraphs: [prose(words, seed)],
});

function makeCtx(opts: {
  dryRun?: boolean;
  responses: string[];
  components?: string[];
  routes?: Array<{ slug: string; title: string; components: string[] }>;
}) {
  const responses = [...opts.responses];
  const prompts: string[] = [];
  const generatedContent = new Map<string, string>();
  const ctx = {
    dryRun: opts.dryRun ?? false,
    domainSpec: {
      vertical: "insurance_supplementing",
      business_name: "Test Biz",
      geography: { primary_state: "TN", states: ["TN", "KY"] },
      routes: opts.routes ?? [
        { slug: "/", title: "Home", components: opts.components ?? ["hero"] },
      ],
    },
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
const rejectsWith = (pattern: RegExp) => (error: unknown) =>
  error instanceof BuildError &&
  error.code === "CONTENT_VALIDATION_FAILED" &&
  pattern.test(error.message);

void test("a valid page JSON is accepted in a single call and stored as structure", async () => {
  const { ctx, prompts, generatedContent } = makeCtx({
    components: ["hero", "about"],
    responses: [page(hero("Home hero headline"), proseSection("about", "Who we help", 60, "a"))],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 1);
  assert.equal(getSection(generatedContent, "/:hero")?.heading, "Home hero headline");
  assert.equal(getSection(generatedContent, "/:about")?.paragraphs[0], prose(60, "a"));
  assert.match(generatedContent.get("/:hero") ?? "", /^Home hero headline\n\n/);
});

void test("a short first response then a valid one succeeds after two calls", async () => {
  const { ctx, prompts, generatedContent } = makeCtx({
    components: ["hero", "about"],
    responses: [
      page(hero("Home hero headline"), proseSection("about", "Who we help", 12, "a")),
      page(hero("Home hero headline"), proseSection("about", "Who we help", 60, "a")),
    ],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.equal(getSection(generatedContent, "/:about")?.paragraphs[0], prose(60, "a"));
});

void test("the correction prompt reports the actual first-attempt word count", async () => {
  const { ctx, prompts } = makeCtx({
    components: ["hero", "about"],
    responses: [
      page(hero("Home hero headline"), proseSection("about", "Who we help", 12, "a")),
      page(hero("Home hero headline"), proseSection("about", "Who we help", 60, "a")),
    ],
  });
  await stage.run(ctx);
  assert.match(prompts[1], /failed validation/i);
  assert.match(prompts[1], /\/:about: section body has 12 words, minimum 40/);
  assert.match(prompts[1], /Rewrite the complete page JSON from scratch\./);
});

void test("short bodies fail with CONTENT_VALIDATION_FAILED and commit nothing", async () => {
  const short = (n: number) =>
    page(hero("Home hero headline"), proseSection("about", "Who we help", n, "a"));
  const { ctx, generatedContent } = makeCtx({
    components: ["hero", "about"],
    responses: [short(10), short(20), short(30)],
  });
  await assert.rejects(() => stage.run(ctx), rejectsWith(/has 30 words, minimum 40/));
  assert.equal(generatedContent.size, 0);
});

void test("a prohibited claim triggers a corrective retry naming the claim", async () => {
  const { ctx, prompts, generatedContent } = makeCtx({
    responses: [
      page(hero("Trusted local coverage", "Results guaranteed for every claim.")),
      page(hero("Trusted local coverage")),
    ],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /prohibited claim "guaranteed"/);
  assert.equal(
    getSection(generatedContent, "/:hero")?.subheading,
    "Clear help for every claim you file.",
  );
});

void test("a prohibited claim that persists after retry fails", async () => {
  const banned = page(hero("Trusted local coverage", "Results guaranteed."));
  const { ctx } = makeCtx({ responses: [banned, banned, banned] });
  await assert.rejects(() => stage.run(ctx), rejectsWith(/prohibited claim "guaranteed"/));
});

void test("markdown inside JSON strings is stored as plain text; fenced JSON is accepted", async () => {
  const fenced = `Here you go:\n\`\`\`json\n${page(hero("**Home hero headline**", "**Bold** support line."))}\n\`\`\``;
  const { ctx, generatedContent } = makeCtx({ responses: [fenced] });
  await stage.run(ctx);
  assert.equal(getSection(generatedContent, "/:hero")?.heading, "Home hero headline");
  assert.equal(generatedContent.get("/:hero")?.includes("**"), false);
});

void test("a non-JSON answer is retried and reported", async () => {
  const { ctx, prompts } = makeCtx({
    responses: ["Home hero headline\n\nplain text", page(hero("Home hero headline"))],
  });
  await stage.run(ctx);
  assert.match(prompts[1], /response was not JSON/);
});

void test("dry-run invokes the LLM zero times", async () => {
  const { ctx, prompts, generatedContent } = makeCtx({
    dryRun: true,
    responses: [page(hero("Home hero headline"))],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 0);
  assert.equal(generatedContent.size, 0);
});

void test("crawled source copy is ported and the LLM is not called", async () => {
  const { ctx, prompts, generatedContent } = makeCtx({ responses: [] });
  ctx.sourceSiteManifest = {
    schema: "website-bot.source-site-manifest/v1",
    sourceUrl: "https://www.safehavenrr.com/",
    crawledAt: "2026-08-13T00:00:00.000Z",
    crawlerVersion: "1.2.0",
    pages: [
      {
        url: "https://www.safehavenrr.com/",
        headings: ["Safe Haven Roofing & Renovations"],
        description: "Charlotte roofing specialists.",
        bodyText:
          "We handle storm damage, insurance claims, and full replacements across the metro.",
        blocks: [
          {
            heading: "Safe Haven Roofing & Renovations",
            level: 1,
            paragraphs: [
              "We handle storm damage, insurance claims, and full replacements across the metro.",
            ],
            items: [],
            qa: [],
          },
        ],
        depth: 0,
      },
    ],
    images: [],
    rejected: [],
    warnings: [],
  };
  await stage.run(ctx);
  assert.equal(prompts.length, 0);
  assert.match(generatedContent.get("/:hero") ?? "", /Safe Haven Roofing & Renovations/);
});

void test("sourceSite.enabled with an empty crawl fails closed and does not call the LLM", async () => {
  const { ctx, prompts } = makeCtx({ responses: [] });
  ctx.domainSpec.assets = { sourceSite: { url: "https://www.safehavenrr.com/", enabled: true } };
  ctx.sourceSiteManifest = {
    schema: "website-bot.source-site-manifest/v1",
    sourceUrl: "https://www.safehavenrr.com/",
    crawledAt: "2026-08-13T00:00:00.000Z",
    crawlerVersion: "1.2.0",
    pages: [],
    images: [],
    rejected: [],
    warnings: [],
  };
  await assert.rejects(() => stage.run(ctx), rejectsWith(/Refusing to invent copy/));
  assert.equal(prompts.length, 0);
});

void test("unmatched reconstructing slug does not receive home copy", async () => {
  const { ctx, prompts } = makeCtx({ responses: [] });
  ctx.domainSpec.routes = [
    { slug: "/", title: "Home", components: ["hero"] },
    { slug: "/services/invented", title: "Invented", components: ["hero"] },
  ];
  ctx.sourceSiteManifest = {
    schema: "website-bot.source-site-manifest/v1",
    sourceUrl: "https://www.safehavenrr.com/",
    crawledAt: "2026-08-13T00:00:00.000Z",
    crawlerVersion: "1.2.0",
    pages: [
      {
        url: "https://www.safehavenrr.com/",
        headings: ["Safe Haven Roofing & Renovations"],
        blocks: [
          {
            heading: "Safe Haven Roofing & Renovations",
            level: 1,
            paragraphs: ["Home-only body that must not paint invented service routes."],
            items: [],
            qa: [],
          },
        ],
        depth: 0,
      },
    ],
    images: [],
    rejected: [],
    warnings: [],
  };
  await assert.rejects(
    () => stage.run(ctx),
    rejectsWith(/no crawled page matched \/services\/invented/),
  );
  assert.equal(prompts.length, 0);
});

void test("H1 longer than 12 words fails after retries", async () => {
  const longH1 = Array.from({ length: 13 }, (_, i) => `w${i}`).join(" ");
  const tooLong = page(hero(longH1));
  const { ctx, generatedContent } = makeCtx({ responses: [tooLong, tooLong, tooLong] });
  await assert.rejects(() => stage.run(ctx), rejectsWith(/heading has 13 words, maximum 12/));
  assert.equal(generatedContent.size, 0);
});

void test("two sections with an identical H1 fail with CONTENT_VALIDATION_FAILED", async () => {
  const same = page(
    hero("Same headline here"),
    proseSection("about", "Same headline here", 60, "b"),
  );
  const { ctx, generatedContent } = makeCtx({
    components: ["hero", "about"],
    responses: [same, same, same],
  });
  await assert.rejects(() => stage.run(ctx), rejectsWith(/duplicate heading "Same headline here"/));
  assert.equal(generatedContent.size, 0);
});

// Inverse of the v2 test "two slots with identical bodies and unique H1s
// succeed": that test encoded the defect (the same copy in every section).
void test("two sections with identical bodies and unique H1s FAIL", async () => {
  const dup = page(
    hero("First unique headline"),
    proseSection("about", "Second unique headline", 60, "same"),
    proseSection("services", "Third unique headline", 60, "same"),
  );
  const { ctx, generatedContent } = makeCtx({
    components: ["hero", "about", "services"],
    responses: [dup, dup, dup],
  });
  await assert.rejects(
    () => stage.run(ctx),
    rejectsWith(/\/:services: body duplicates \/:about \(100% shared phrasing\)/),
  );
  assert.equal(generatedContent.size, 0);
});

void test("a near-duplicate body on a later page fails too", async () => {
  const shared = prose(60, "x");
  const { ctx } = makeCtx({
    routes: [
      { slug: "/", title: "Home", components: ["hero", "about"] },
      { slug: "/more", title: "More", components: ["hero", "about"] },
    ],
    responses: [
      page(hero("Home headline"), {
        component: "about",
        heading: "About us",
        paragraphs: [shared],
      }),
      ...Array.from({ length: 3 }, () =>
        page(hero("More headline", "Another angle on the same service."), {
          component: "about",
          heading: "More about us",
          paragraphs: [`${shared} plus a short tail`],
        }),
      ),
    ],
  });
  await assert.rejects(() => stage.run(ctx), rejectsWith(/\/more:about: body duplicates \/:about/));
});

void test("an FAQ with an empty answer fails", async () => {
  const faq = page(hero("Home headline"), {
    component: "faq",
    heading: "Common questions",
    faqs: [
      { question: "Do you file claims?", answer: "Yes, we meet your adjuster on site." },
      { question: "How long does it take?", answer: "" },
    ],
  });
  const { ctx } = makeCtx({ components: ["hero", "faq"], responses: [faq, faq, faq] });
  await assert.rejects(
    () => stage.run(ctx),
    rejectsWith(/FAQ "How long does it take\?" has an empty answer/),
  );
});

void test("navigation/button run-ons and repeated phone numbers fail", async () => {
  const runOn = page(hero("Home headline"), proseSection("about", "Who we are", 0, "a")).replace(
    '"paragraphs":[""]',
    `"paragraphs":["Home About Us Services Gallery Contact Get A Free Estimate Call Now. ${prose(50, "r")}"]`,
  );
  const phones = page(hero("Home headline"), {
    component: "about",
    heading: "Who we are",
    paragraphs: [`Call (704) 648-7252 today. ${prose(50, "p")} Or call (704) 648-7252.`],
  });
  const a = makeCtx({ components: ["hero", "about"], responses: [runOn, runOn, runOn] });
  await assert.rejects(() => stage.run(a.ctx), rejectsWith(/navigation\/button run-on/));
  const b = makeCtx({ components: ["hero", "about"], responses: [phones, phones, phones] });
  await assert.rejects(() => stage.run(b.ctx), rejectsWith(/phone number 7046487252 repeated/));
});

void test("the business name as a heading outside the hero fails", async () => {
  const response = page(hero("Test Biz"), proseSection("about", "Test Biz", 60, "n"));
  const { ctx } = makeCtx({
    components: ["hero", "about"],
    responses: [response, response, response],
  });
  await assert.rejects(
    () => stage.run(ctx),
    rejectsWith(/\/:about: heading repeats the business name "Test Biz" outside the hero/),
  );
});

void test("the page prompt names the route, its sections and the 12-word headline rule", async () => {
  const { ctx, prompts } = makeCtx({
    components: ["hero", "faq"],
    responses: [
      page(hero("Protect your claim this season"), {
        component: "faq",
        heading: "Answers for insurance claims",
        faqs: [{ question: "Do you file claims?", answer: "We meet your adjuster on site." }],
      }),
    ],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /at most 12 words/);
  assert.match(prompts[0], /route slug "\/"/);
  assert.match(prompts[0], /"Home" page/);
  assert.match(prompts[0], /- "hero":[\s\S]*- "faq":/);
});

void test("the next page's first prompt lists already-written headings", async () => {
  const { ctx, prompts, generatedContent } = makeCtx({
    routes: [
      { slug: "/", title: "Home", components: ["hero"] },
      { slug: "/contact", title: "Contact", components: ["hero"] },
    ],
    responses: [
      page(hero("Protect your roof this season")),
      page(hero("Request a roofing quote today", "Tell us what happened to your roof.")),
    ],
  });
  await stage.run(ctx);
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[0], /Already written elsewhere/);
  assert.match(prompts[1], /Already written elsewhere on the site/);
  assert.match(prompts[1], /- "Protect your roof this season"/);
  assert.match(prompts[1], /route slug "\/contact"/);
  assert.equal(
    getSection(generatedContent, "/contact:hero")?.heading,
    "Request a roofing quote today",
  );
});

void test("a duplicate H1 correction lists the issue on every retry then fails", async () => {
  const { ctx, prompts, generatedContent } = makeCtx({
    routes: [
      { slug: "/", title: "Home", components: ["hero"] },
      { slug: "/faq", title: "FAQ", components: ["hero"] },
    ],
    responses: [
      page(hero("Same headline here")),
      ...Array.from({ length: 3 }, (_, i) =>
        page(hero("Same headline here", `Different support line ${i}.`)),
      ),
    ],
  });
  await assert.rejects(() => stage.run(ctx), rejectsWith(/duplicate heading "Same headline here"/));
  assert.equal(generatedContent.size, 1);
  assert.match(prompts[2], /duplicate heading "Same headline here" \(also \/:hero\)/);
  assert.match(prompts[3], /duplicate heading "Same headline here"/);
});
