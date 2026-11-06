// L9_META: layer=test, role=rendered_build_contract_unit, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01 Wave 2, pure half: the rendered-site checks over
// collected DOM facts, and the stage's hand-off of what the accepted artifacts
// require of each route. The real-browser half is
// tests/integration/local/wb-build-contract-rendered.test.ts.

import assert from "node:assert/strict";
import test from "node:test";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  RenderedSiteValidationStage,
  routeVisualExpectations,
} from "../../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../src/stages/SiteBuildStage.js";
import {
  evaluateVisualFacts,
  type RenderedVisualFacts,
  type RenderSiteOptions,
  type RouteVisualExpectation,
} from "../../src/validation/rendered-site.js";
import { fakeAstroBuild, renderedReport } from "../helpers/fakeSiteBuild.js";
import { redesignContext } from "../helpers/redesignAssemblyFixture.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const EXPECT: RouteVisualExpectation = {
  section_order: ["hero", "services", "closing"],
  images: [
    { slot: "global:logo", src: "/images/logo.png" },
    { slot: "/:hero", src: "/images/hero.png", section_id: "hero" },
    { slot: "/:service", src: "/images/service.png", section_id: "services" },
  ],
};

function healthy(): RenderedVisualFacts {
  const image = (slot: string, src: string, section_id: string | null) => ({
    slot,
    src,
    section_id,
    visible: true,
    decoded: true,
    in_viewport: true,
  });
  return {
    sections: ["hero", "services", "closing"],
    slot_images: [
      image("global:logo", "/images/logo.png", null),
      image("/:hero", "/images/hero.png", "hero"),
      image("/:service", "/images/service.png", "services"),
    ],
    outside_viewport: [],
    clipped_headings: [],
    obstructed_ctas: [],
  };
}

const status = (facts: RenderedVisualFacts, expect: RouteVisualExpectation = EXPECT) =>
  Object.fromEntries(evaluateVisualFacts(facts, expect).map((c) => [c.name, c.status]));

const detail = (facts: RenderedVisualFacts, name: string): string =>
  evaluateVisualFacts(facts, EXPECT).find((check) => check.name === name)?.detail ?? "";

void test("a render matching the accepted requirement passes every visual check", () => {
  assert.deepEqual(status(healthy()), {
    blueprint_section_order: "PASS",
    required_images_visible: "PASS",
    critical_elements_in_viewport: "PASS",
    headings_not_clipped: "PASS",
    cta_not_obstructed: "PASS",
  });
});

void test("a route with no accepted requirement is held to geometry only, and a text-only route passes", () => {
  assert.deepEqual(
    evaluateVisualFacts(healthy(), undefined)
      .map((check) => check.name)
      .sort(),
    ["critical_elements_in_viewport", "cta_not_obstructed", "headings_not_clipped"],
  );
  const textOnly = { ...healthy(), slot_images: [] };
  assert.equal(status(textOnly, { images: [] }).required_images_visible, "PASS");
});

void test("each way a required image can fail to reach the visitor is named", () => {
  const mutate = (edit: (image: RenderedVisualFacts["slot_images"][number]) => void) => {
    const facts = healthy();
    edit(facts.slot_images[2]);
    return detail(facts, "required_images_visible");
  };
  assert.match(
    detail(
      { ...healthy(), slot_images: healthy().slot_images.slice(0, 2) },
      "required_images_visible",
    ),
    /\/:service: not rendered/,
  );
  const twice = healthy();
  twice.slot_images.push(twice.slot_images[2]);
  assert.match(detail(twice, "required_images_visible"), /rendered 2 times/);
  assert.match(
    mutate((i) => {
      i.section_id = "closing";
    }),
    /in section closing, expected services/,
  );
  assert.match(
    mutate((i) => {
      i.src = "/images/hero.png";
    }),
    /shows \/images\/hero\.png/,
  );
  assert.match(
    mutate((i) => {
      i.visible = false;
    }),
    /not visible/,
  );
  assert.match(
    mutate((i) => {
      i.in_viewport = false;
    }),
    /never enters the viewport/,
  );
  assert.match(
    mutate((i) => {
      i.decoded = false;
    }),
    /did not load and decode/,
  );
});

void test("section order and geometry faults fail their own checks only", () => {
  const reordered = { ...healthy(), sections: ["services", "hero", "closing"] };
  assert.deepEqual(
    Object.entries(status(reordered)).filter(([, s]) => s === "FAIL"),
    [["blueprint_section_order", "FAIL"]],
  );
  const geometry = {
    ...healthy(),
    outside_viewport: ['a "Call now"'],
    clipped_headings: ['h2 "Our services"'],
    obstructed_ctas: ['a "Request a quote"'],
  };
  assert.deepEqual(
    Object.entries(status(geometry))
      .filter(([, s]) => s === "FAIL")
      .map(([name]) => name),
    ["critical_elements_in_viewport", "headings_not_clipped", "cta_not_obstructed"],
  );
});

void test("a REDESIGN_IMPROVE build without its accepted blueprint cannot be checked and fails closed", async () => {
  const ctx = await redesignContext({});
  try {
    ctx.websiteBlueprint = undefined;
    assert.throws(
      () => routeVisualExpectations(ctx),
      (error: unknown) =>
        error instanceof BuildError && error.code === "RENDERED_SITE_VALIDATION_FAILED",
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("a COPY build is held to the published logo only; no blueprint order is invented", () => {
  const ctx = fixtureContext();
  try {
    for (const expectation of routeVisualExpectations(ctx).values()) {
      assert.equal(expectation.section_order, undefined);
      assert.ok(expectation.images.every((image) => image.slot === "global:logo"));
    }
  } finally {
    cleanupContext(ctx);
  }
});

void test("the stage hands each route its blueprint order and identity-bound images", async () => {
  const ctx = await redesignContext({
    provided: [
      { id: "brand-logo", intendedPlacement: "global:logo" },
      { id: "storefront", intendedPlacement: "/:hero" },
      { id: "repair-van", intendedPlacement: "/:service#repairs" },
      { id: "crew-photo", intendedPlacement: "/:team#story" },
    ],
  });
  try {
    await new SiteAssemblerStage().run(ctx);
    await new SiteBuildStage(fakeAstroBuild(["/", "/contact", "/services/drains"])).run(ctx);
    let seen: RenderSiteOptions | undefined;
    await new RenderedSiteValidationStage({
      async render(options) {
        seen = options;
        return renderedReport(options);
      },
    }).run(ctx);
    const home = seen?.routes.find((route) => route.slug === "/")?.expect;
    assert.deepEqual(
      home?.section_order,
      ctx.websiteBlueprint?.payload.routes[0].sections.map((s) => s.section_id),
    );
    const src = (placement: string) =>
      `/images/${ctx.resolvedImages?.get(placement)?.outputFileName}`;
    assert.deepEqual(
      home?.images.map((image) => [image.slot, image.section_id, image.src]).sort(),
      [
        ["/:hero", "hero", src("/:hero")],
        ["/:service#repairs", "repairs", src("/:service#repairs")],
        ["/:team#story", "story", src("/:team#story")],
        ["global:logo", undefined, src("global:logo")],
      ].sort(),
    );
    const drains = seen?.routes.find((route) => route.slug === "/services/drains")?.expect;
    assert.deepEqual(
      drains?.images.map((image) => image.slot),
      ["global:logo"],
    );
  } finally {
    cleanupContext(ctx);
  }
});
