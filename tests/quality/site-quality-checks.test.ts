// L9_META: layer=test, role=site_quality_checks_unit, status=active, version=1.0.0
//
// Pure-function tests for the deterministic rendered-site checks
// (scripts/quality/site-quality-checks.ts). Each defect class is exercised
// with a failing model and with the nearest legitimate shape that must pass.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReport,
  checkPage,
  checkSite,
  DEFAULT_OPTIONS,
  floorFor,
  isTitleCaseRunOn,
  jaccard,
  type PageModel,
  type SiteQualityOptions,
} from "../../scripts/quality/site-quality-checks.js";

const OPTIONS: SiteQualityOptions = { ...DEFAULT_OPTIONS, businessName: "Harbor Light Plumbing" };

const PROSE = Array.from(
  { length: 40 },
  (_, index) =>
    `Sentence ${index} explains how the technician inspects the line before starting any work.`,
).join(" ");

function page(overrides: Partial<PageModel> = {}): PageModel {
  return {
    path: "/",
    status: 200,
    title: "Harbor Light Plumbing",
    headings: [{ level: 1, text: "Plumbing repairs done right", inHero: true }],
    paragraphs: ["Our technicians diagnose leaks with cameras before they open any wall."],
    controls: [{ text: "Services", accessibleName: "", href: "/services", inNav: true }],
    faqs: [],
    images: [],
    labels: [],
    mainText: PROSE,
    fullText: PROSE,
    ...overrides,
  };
}

const checksOf = (model: PageModel, options = OPTIONS) =>
  checkPage(model, options).map((finding) => finding.check);

test("a clean page has no findings", () => {
  assert.deepEqual(checkPage(page(), OPTIONS), []);
});

test("an exact paragraph repeated on a page fails; short repeats are ignored", () => {
  const filler =
    "We are committed to providing the highest quality service to every customer in the area.";
  assert.ok(
    checksOf(page({ paragraphs: [filler, filler, filler] })).includes("duplicate-paragraph"),
  );
  assert.ok(!checksOf(page({ paragraphs: ["Learn more.", "Learn more."] })).length);
});

test("near-duplicate paragraphs fail", () => {
  const a =
    "Our licensed team repairs leaking pipes, clears blocked drains and replaces water heaters across the city every day.";
  const b =
    "Our licensed team repairs leaking pipes, clears blocked drains and replaces water heaters across the region every day.";
  assert.ok(jaccard(a, b) >= DEFAULT_OPTIONS.nearDuplicateThreshold);
  assert.ok(jaccard(a, "Water heaters are sized from household demand.") < 0.2);
  assert.ok(checksOf(page({ paragraphs: [a, b] })).includes("near-duplicate-paragraph"));
});

test("title-case run-ons are detected; sentences and short labels are not", () => {
  assert.equal(isTitleCaseRunOn("Get A Free Quote Call Now Home Services"), true);
  assert.equal(isTitleCaseRunOn("Get a free quote, or call now."), false);
  assert.equal(isTitleCaseRunOn("Request Service"), false);
  assert.ok(
    checksOf(
      page({ paragraphs: ["Home About Us Services Gallery Contact Us Get A Quote"] }),
    ).includes("run-on-text"),
  );
});

test("long navigation and button labels fail", () => {
  assert.ok(
    checksOf(
      page({
        controls: [
          {
            text: "Our Roofing Services And Storm Damage Repair Experts",
            accessibleName: "",
            href: "/services",
            inNav: true,
          },
        ],
      }),
    ).includes("nav-label-run-on"),
  );
  assert.ok(
    checksOf(
      page({
        controls: [
          {
            text: "Click here to get your completely free no obligation quote today",
            accessibleName: "",
            inNav: false,
          },
        ],
      }),
    ).includes("button-label-run-on"),
  );
});

test("controls without text or accessible name fail; aria-label satisfies", () => {
  assert.ok(
    checksOf(page({ controls: [{ text: "", accessibleName: "", inNav: false }] })).includes(
      "empty-control-label",
    ),
  );
  assert.ok(
    checksOf(
      page({ controls: [{ text: "", accessibleName: "", href: "/x", inNav: false }] }),
    ).includes("empty-control-label"),
  );
  assert.deepEqual(
    checksOf(page({ controls: [{ text: "", accessibleName: "Open menu", inNav: true }] })),
    [],
  );
});

test("body copy made of the page's own button labels fails", () => {
  const controls = [
    { text: "Get A Free Quote", accessibleName: "", href: "/contact", inNav: false },
    { text: "Call Now", accessibleName: "", href: "tel:", inNav: false },
  ];
  assert.ok(
    checksOf(page({ controls, paragraphs: ["Get a free quote. Call now!"] })).includes(
      "controls-as-body-copy",
    ),
  );
  assert.ok(
    !checksOf(
      page({
        controls,
        paragraphs: [
          "Call now if water is coming through the ceiling; we keep a crew free for emergencies.",
        ],
      }),
    ).includes("controls-as-body-copy"),
  );
});

test("an FAQ question without an answer fails", () => {
  assert.ok(
    checksOf(page({ faqs: [{ question: "How long does it take?", answer: "  " }] })).includes(
      "empty-faq-answer",
    ),
  );
  assert.deepEqual(
    checksOf(page({ faqs: [{ question: "How long does it take?", answer: "About two hours." }] })),
    [],
  );
});

test("internal component labels fail in headings, eyebrows and short copy", () => {
  assert.ok(
    checksOf(
      page({ headings: [...page().headings, { level: 2, text: "SERVICE DETAIL", inHero: false }] }),
    ).includes("internal-label-visible"),
  );
  assert.ok(checksOf(page({ labels: ["TRUST SIGNALS"] })).includes("internal-label-visible"));
  assert.ok(checksOf(page({ paragraphs: ["Trust Signals"] })).includes("internal-label-visible"));
});

test("template artifacts and validator filler fail", () => {
  for (const text of [
    "Call us at {{ phone }}",
    "Rated [object Object] by neighbours",
    "Price: undefined",
    "Validated fixture content for Home hero. This content is deterministic.",
  ])
    assert.ok(
      checksOf(page({ paragraphs: [text] })).includes("template-artifact-visible"),
      JSON.stringify(text),
    );
});

test("an H1/H2 that is only the business name fails outside the hero", () => {
  assert.ok(
    checksOf(
      page({
        headings: [...page().headings, { level: 2, text: "Harbor Light Plumbing", inHero: false }],
      }),
    ).includes("heading-equals-business-name"),
  );
  assert.deepEqual(
    checksOf(page({ headings: [{ level: 1, text: "Harbor Light Plumbing", inHero: true }] })),
    [],
  );
});

test("a page without an H1 fails", () => {
  assert.ok(checksOf(page({ headings: [] })).includes("no-h1"));
});

test("word floors depend on the route kind", () => {
  assert.equal(floorFor("/", DEFAULT_OPTIONS.wordFloors), 300);
  assert.equal(floorFor("/contact", DEFAULT_OPTIONS.wordFloors), 60);
  assert.equal(floorFor("/contact-us", DEFAULT_OPTIONS.wordFloors), 200);
  assert.equal(floorFor("/services/roofing", DEFAULT_OPTIONS.wordFloors), 200);
  assert.ok(checksOf(page({ mainText: "Too few words here." })).includes("word-count-floor"));
});

test("another client's literal fails unless it is this client's own name", () => {
  const leaked = `${PROSE} Free Roof Inspection Within 24 Hours from Safe Haven.`;
  const findings = checkPage(page({ fullText: leaked }), OPTIONS).filter(
    (finding) => finding.check === "cross-client-literal",
  );
  assert.equal(findings.length, 2);
  assert.deepEqual(
    checksOf(page({ fullText: `${PROSE} Safe Haven Roofing` }), {
      ...OPTIONS,
      businessName: "Safe Haven Roofing",
    }),
    [],
  );
});

test("missing, broken and oversized images fail; a missing alt warns", () => {
  const base = { alt: "x", naturalWidth: 10, naturalHeight: 10, bytes: 100, status: 200 };
  assert.ok(checksOf(page({ images: [{ ...base, src: "" }] })).includes("image-missing-src"));
  assert.ok(
    checksOf(
      page({ images: [{ ...base, src: "http://127.0.0.1:1/a.jpg", status: 404 }] }),
    ).includes("image-broken"),
  );
  assert.ok(
    checksOf(page({ images: [{ ...base, src: "/a.jpg", naturalWidth: 0 }] })).includes(
      "image-broken",
    ),
  );
  assert.ok(
    checksOf(page({ images: [{ ...base, src: "/a.jpg", bytes: 4_000_000 }] })).includes(
      "image-oversized",
    ),
  );
  const warn = checkPage(page({ images: [{ ...base, src: "/a.jpg", alt: null }] }), OPTIONS);
  assert.deepEqual(
    warn.map((finding) => [finding.check, finding.severity]),
    [["image-missing-alt", "warn"]],
  );
});

test("a non-2xx document fails and is not otherwise judged", () => {
  assert.deepEqual(checksOf(page({ status: 404, headings: [] })), ["page-unrenderable"]);
});

test("the same paragraph on several pages fails across the site", () => {
  const shared =
    "We are committed to providing the highest quality service to every customer in the area.";
  const findings = checkSite(
    [page({ paragraphs: [shared] }), page({ path: "/about", paragraphs: [shared] })],
    OPTIONS,
  );
  assert.deepEqual(
    findings.map((finding) => [finding.check, finding.page]),
    [["cross-page-duplicate-paragraph", "/,/about"]],
  );
});

test("report status: PASS clean, FAIL on a fail finding, PASS with only warnings, BLOCKED on error or no pages", () => {
  assert.equal(buildReport("t", [page()], OPTIONS).status, "PASS");
  assert.equal(buildReport("t", [page({ headings: [] })], OPTIONS).status, "FAIL");
  const warnOnly = page({
    images: [
      { src: "/a.jpg", alt: null, naturalWidth: 1, naturalHeight: 1, bytes: 1, status: 200 },
    ],
  });
  const report = buildReport("t", [warnOnly], OPTIONS);
  assert.equal(report.status, "PASS");
  assert.equal(report.summary.warn, 1);
  assert.equal(buildReport("t", [], OPTIONS).status, "BLOCKED");
  assert.equal(buildReport("t", [page()], OPTIONS, ["browser missing"]).status, "BLOCKED");
});
