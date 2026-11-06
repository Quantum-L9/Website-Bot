// L9_META: layer=test, role=rendered_build_contract, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01 Wave 2: real-browser failures before publication.
// One REDESIGN_IMPROVE site is assembled and built for real (astro check +
// astro build); RenderedSiteValidationStage's expectations come from the
// accepted blueprint, image plan and asset registry. The valid build must pass
// in headless Chromium at desktop and mobile; each mutated copy of its dist/
// must fail on exactly the checks its fixture names — no more, and not because
// the browser or the page crashed. Requires the Playwright chromium binary; its
// absence fails this test (CI provisions it), never skips it.

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { BuildContext } from "../../../src/pipeline/BuildContext.js";
import { routeVisualExpectations } from "../../../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../../src/stages/SiteBuildStage.js";
import {
  PlaywrightSiteRenderer,
  type RenderedSiteValidationReport,
} from "../../../src/validation/rendered-site.js";
import { normalizeRouteSlug } from "../../../src/validation/validate-generated-site.js";
import { redesignContext } from "../../helpers/redesignAssemblyFixture.js";
import { cleanupContext } from "../../helpers/siteFactoryFixture.js";

let ctx: BuildContext;
let distDir: string;
const scratch = mkdtempSync(join(tmpdir(), "wb-rendered-contract-"));

before(
  async () => {
    ctx = await redesignContext({
      provided: [
        { id: "brand-logo", intendedPlacement: "global:logo" },
        { id: "storefront", intendedPlacement: "/:hero" },
        { id: "repair-van", intendedPlacement: "/:service#repairs" },
        { id: "new-heater", intendedPlacement: "/:service#installs" },
        { id: "crew-photo", intendedPlacement: "/:team#story" },
      ],
    });
    await new SiteAssemblerStage().run(ctx);
    await new SiteBuildStage().run(ctx);
    assert.ok(ctx.distDir, "astro check + astro build produced dist");
    distDir = ctx.distDir;
  },
  { timeout: 900_000 },
);

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  if (ctx) cleanupContext(ctx);
});

async function render(dir: string): Promise<RenderedSiteValidationReport> {
  const expectations = routeVisualExpectations(ctx);
  return new PlaywrightSiteRenderer().render({
    buildId: ctx.buildId,
    clientId: ctx.clientId,
    distDir: dir,
    routes: ctx.domainSpec.routes.map((route) => ({
      slug: route.slug,
      title: route.title,
      noindex: route.noindex,
      expect: expectations.get(normalizeRouteSlug(route.slug)),
    })),
    screenshotDir: join(dir, "..", "renders"),
  });
}

const failures = (report: RenderedSiteValidationReport): string[] =>
  report.routes
    .flatMap((route) =>
      route.checks
        .filter((check) => check.status !== "PASS")
        .map((check) => `${route.route}@${route.viewport}:${check.name}`),
    )
    .sort();

/** A copy of the valid dist/ with its home page rewritten (an output mutation). */
function mutatedHome(name: string, edit: (html: string) => string): string {
  const dir = join(scratch, name, "dist");
  cpSync(distDir, dir, { recursive: true });
  const file = join(dir, "index.html");
  const html = readFileSync(file, "utf-8");
  const edited = edit(html);
  assert.notEqual(edited, html, `${name} changed the page`);
  writeFileSync(file, edited);
  return dir;
}

/** The `<img>` tag rendering a placement, located by its data-image-slot. */
function imgTag(html: string, slot: string): { start: number; end: number; tag: string } {
  const marker = html.indexOf(`data-image-slot="${slot}"`);
  assert.ok(marker > 0, `${slot} renders`);
  const start = html.lastIndexOf("<img", marker);
  const end = html.indexOf(">", marker) + 1;
  return { start, end, tag: html.slice(start, end) };
}

const injectStyle = (css: string) => (html: string) =>
  html.replace("</head>", `<style>${css}</style></head>`);

const both = (check: string): string[] => [`/@desktop:${check}`, `/@mobile:${check}`];

void test("F00 valid-redesign: blueprint order, every required image visible, clean geometry", async () => {
  const expectations = routeVisualExpectations(ctx);
  const bySlot = (images: Array<{ slot: string; section_id?: string }> = []) =>
    images.map((image) => `${image.slot} @ ${image.section_id ?? "layout"}`).sort();
  assert.deepEqual(
    bySlot(expectations.get("/")?.images),
    [
      "/:hero @ hero",
      "/:service#installs @ installs",
      "/:service#repairs @ repairs",
      "/:team#story @ story",
      "global:logo @ layout",
    ],
    "the accepted artifacts, not the page, name the images",
  );
  const report = await render(distDir);
  assert.deepEqual(failures(report), [], JSON.stringify(report.routes, null, 2));
  assert.equal(report.status, "PASS");
  const home = report.routes.find((route) => route.route === "/" && route.viewport === "mobile");
  for (const name of [
    "blueprint_section_order",
    "required_images_visible",
    "critical_elements_in_viewport",
    "headings_not_clipped",
    "cta_not_obstructed",
  ]) {
    assert.equal(home?.checks.find((check) => check.name === name)?.status, "PASS", name);
  }
  // F13: a text-only editorial route needs no imagery beyond the layout's logo.
  const drains = report.routes.find((route) => route.route === "/services/drains");
  assert.match(
    drains?.checks.find((check) => check.name === "required_images_visible")?.detail ?? "",
    /^1 required image/,
  );
});

const MUTATIONS: Array<{ name: string; edit: (html: string) => string; expected: string[] }> = [
  {
    name: "F01 missing-image: a required section image removed from the page",
    edit: (html) => {
      const { start, end } = imgTag(html, "/:service#repairs");
      return html.slice(0, start) + html.slice(end);
    },
    expected: both("required_images_visible"),
  },
  {
    name: "F12 hidden-hero: the hero image present but hidden by CSS",
    edit: injectStyle('[data-image-slot="/:hero"]{display:none!important}'),
    expected: both("required_images_visible"),
  },
  {
    name: "F12b invisible-image: a section image laid out at zero opacity",
    edit: injectStyle('[data-image-slot="/:team#story"]{opacity:0!important}'),
    expected: both("required_images_visible"),
  },
  {
    name: "F03 swapped-images: two same-role service images exchange files",
    edit: (html) => {
      const repairs = imgTag(html, "/:service#repairs");
      const installs = imgTag(html, "/:service#installs");
      const src = (tag: string) =>
        tag.slice(tag.indexOf('src="'), tag.indexOf('"', tag.indexOf('src="') + 5) + 1);
      return html
        .replace(repairs.tag, repairs.tag.replace(src(repairs.tag), src(installs.tag)))
        .replace(installs.tag, installs.tag.replace(src(installs.tag), src(repairs.tag)));
    },
    expected: both("required_images_visible"),
  },
  {
    name: "F10 reordered-sections: two sections rendered in each other's place",
    edit: (html) =>
      html
        .replace('data-section-id="repairs"', 'data-section-id="__swap__"')
        .replace('data-section-id="installs"', 'data-section-id="repairs"')
        .replace('data-section-id="__swap__"', 'data-section-id="installs"'),
    expected: both("blueprint_section_order"),
  },
  {
    name: "F11 mobile-overflow: a fixed-width block wider than a phone",
    edit: (html) =>
      html.replace(
        "</main>",
        '<div aria-hidden="true" style="width:700px;height:1px"></div></main>',
      ),
    expected: ["/@mobile:no_horizontal_overflow"],
  },
  {
    name: "F11b clipped-heading: section headings truncated by their own box",
    edit: injectStyle(
      "main h2{white-space:nowrap!important;overflow:hidden!important;width:4rem!important}",
    ),
    expected: both("headings_not_clipped"),
  },
  {
    name: "F11c obstructed-cta: a transparent overlay covers every call to action",
    edit: (html) =>
      html.replace(
        "</body>",
        '<div aria-hidden="true" style="position:fixed;inset:0;z-index:9999"></div></body>',
      ),
    expected: both("cta_not_obstructed"),
  },
  {
    name: "F11e covered-banner: the CTA banner's conversion link sits under an overlay",
    edit: injectStyle(
      '.cta-banner{position:relative!important}.cta-banner::after{content:"";position:absolute;inset:0;z-index:50}',
    ),
    expected: both("cta_not_obstructed"),
  },
  {
    name: "F11d offscreen-cta: a call to action pushed past the viewport edge",
    edit: injectStyle("main a.btn{position:relative!important;left:-3000px!important}"),
    expected: both("critical_elements_in_viewport"),
  },
];

for (const mutation of MUTATIONS) {
  void test(mutation.name, { timeout: 300_000 }, async () => {
    const report = await render(mutatedHome(mutation.name.split(" ")[0], mutation.edit));
    assert.equal(report.status, "FAIL");
    assert.deepEqual(failures(report), mutation.expected, JSON.stringify(report.routes, null, 2));
  });
}
