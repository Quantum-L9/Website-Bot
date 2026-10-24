// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// WB-FACTORY-07: two invented businesses with different industries, route
// shapes, approved design intent, layouts and conversion authority. These
// checks need no build: they prove the fixtures are valid, fictional and
// distinct, that native stages derive their differences from the inputs
// (not from a fixture name), and that each owner seam rejects a bad input
// for the intended reason. Real builds live in
// tests/integration/local/wb-factory-07-golden.test.ts.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import type { BuildContext, DomainSpec } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { validateDomainSpec } from "../../src/pipeline/validateDomainSpec.js";
import { DesignIntelligenceStage } from "../../src/stages/DesignIntelligenceStage.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { pagePathForRoute } from "../../src/validation/validate-generated-site.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const FIXTURES = {
  editorial: "fixtures/wb-factory-07-editorial.yaml",
  industrial: "fixtures/wb-factory-07-industrial.yaml",
} as const;
type Client = keyof typeof FIXTURES;

function raw(client: Client): string {
  return readFileSync(FIXTURES[client], "utf-8");
}

/** A fresh, validated copy of the fixture spec, optionally mutated first. */
function spec(client: Client, mutate?: (draft: Record<string, unknown>) => void): DomainSpec {
  const draft = parse(raw(client)) as Record<string, unknown>;
  mutate?.(draft);
  return validateDomainSpec(draft, FIXTURES[client]);
}

function contextFor(domainSpec: DomainSpec): BuildContext {
  // fixtureContext supplies deterministic per-route content; every spec key is overridden.
  return fixtureContext(domainSpec);
}

async function nativeTokens(domainSpec: DomainSpec): Promise<Record<string, string>> {
  const ctx = contextFor(domainSpec);
  try {
    ctx.designTokens = undefined;
    await new DesignIntelligenceStage().run(ctx);
    assert.ok(ctx.designTokens, "native design stage produced tokens");
    return ctx.designTokens;
  } finally {
    cleanupContext(ctx);
  }
}

function routesOf(draft: Record<string, unknown>): Array<Record<string, unknown>> {
  return draft.routes as Array<Record<string, unknown>>;
}

function assertBuildError(action: () => unknown, code: string, reason: RegExp): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof BuildError && error.code === code && reason.test(error.message),
  );
}

async function assertRejects(action: () => Promise<unknown>, code: string, reason: RegExp) {
  await assert.rejects(
    action,
    (error: unknown) =>
      error instanceof BuildError && error.code === code && reason.test(error.message),
  );
}

void test("both fixtures pass native DomainSpec validation in COPY mode", () => {
  for (const client of Object.keys(FIXTURES) as Client[]) {
    const domainSpec = spec(client);
    assert.equal(domainSpec.build_intent, undefined, `${client} is a COPY fixture`);
    assert.ok(domainSpec.routes.length >= 5);
  }
});

void test("fixtures are fictional: reserved domains, 555-01xx phones, no QAP or customer input", () => {
  for (const client of Object.keys(FIXTURES) as Client[]) {
    const text = raw(client);
    assert.doesNotMatch(text, /quantum|qap|ai partners/i);
    const domainSpec = spec(client);
    assert.match(domainSpec.seo_contract?.site_url ?? "", /^[a-z0-9-]+\.example$/);
    assert.equal(
      new URL(domainSpec.seo_contract?.lead_form_action ?? "").hostname,
      "forms.example.org",
    );
    assert.match(domainSpec.seo_contract?.phone ?? "", /^\+155555501\d\d$/);
    assert.equal(domainSpec.assets, undefined, "no assets, so no third-party imagery");
  }
});

void test("the two businesses differ in industry, routes, layouts, design intent and conversion", () => {
  const editorial = spec("editorial");
  const industrial = spec("industrial");
  assert.notEqual(editorial.vertical, industrial.vertical);
  assert.notEqual(editorial.business_name, industrial.business_name);
  const slugs = (domainSpec: DomainSpec) => domainSpec.routes.map((route) => route.slug);
  assert.deepEqual(
    slugs(editorial).filter((slug) => slugs(industrial).includes(slug)),
    ["/"],
    "only the home route is shared",
  );
  const layouts = (domainSpec: DomainSpec) =>
    new Set(domainSpec.routes.map((route) => route.template).filter(Boolean));
  assert.deepEqual([...layouts(editorial)], ["layout:editorial"]);
  assert.deepEqual([...layouts(industrial)], ["layout:diagram"]);
  assert.notEqual(editorial.design.palette?.primary, industrial.design.palette?.primary);
  assert.notDeepEqual(editorial.client_vision, industrial.client_vision);
  assert.notEqual(
    editorial.conversion_authority?.primary_action,
    industrial.conversion_authority?.primary_action,
  );
  assert.ok(industrial.routes.some((route) => route.noindex === true));
  assert.ok(!editorial.routes.some((route) => route.noindex === true));
});

void test("the native design stage derives each client's tokens from its own approved intent", async () => {
  const editorial = await nativeTokens(spec("editorial"));
  const industrial = await nativeTokens(spec("industrial"));
  assert.equal(editorial.primary, "#5b2a3c");
  assert.equal(industrial.primary, "#22303c");
  assert.equal(editorial.font_heading, "Libre Baskerville");
  assert.equal(industrial.font_heading, "Archivo");
  // client_vision vocabulary: editorial/warm/spacious/readable vs technical/utilitarian/compact/wide.
  assert.equal(editorial.layout_radius, "1rem");
  assert.equal(industrial.layout_radius, "0.25rem");
  assert.equal(editorial.layout_content_width, "960px");
  assert.equal(industrial.layout_content_width, "1240px");
  assert.ok(editorial.layout_fs_h1, "editorial intent selects the expressive type scale");
  assert.equal(industrial.layout_fs_h1, undefined, "industrial intent names no type preset");
  assert.notEqual(editorial.layout_section_space, industrial.layout_section_space);
});

void test("NEGATIVE swap: tokens follow the design inputs, not the business or fixture identity", async () => {
  const industrial = spec("industrial");
  const swapped = spec("editorial", (draft) => {
    draft.design = industrial.design;
    draft.client_vision = industrial.client_vision;
  });
  assert.equal(swapped.business_name, "Larchmere Bindery & Press");
  assert.deepEqual(await nativeTokens(swapped), await nativeTokens(industrial));
});

void test("assembly realizes each spec's own route tree, layouts and verified CTA", async () => {
  const expected = {
    editorial: { layout: "editorial", cta: "/contact#quote" },
    industrial: { layout: "diagram", cta: "/quote#quote" },
  } as const;
  for (const client of Object.keys(FIXTURES) as Client[]) {
    const domainSpec = spec(client);
    const ctx = contextFor(domainSpec);
    try {
      await new DesignIntelligenceStage().run(ctx);
      await new SiteAssemblerStage().run(ctx);
      for (const route of domainSpec.routes) {
        const source = readFileSync(join(ctx.outputDir, pagePathForRoute(route.slug)), "utf-8");
        if (route.template)
          assert.match(source, new RegExp(`const layout = "${expected[client].layout}"`));
        else assert.doesNotMatch(source, /const layout =/);
      }
      const other = client === "editorial" ? spec("industrial") : spec("editorial");
      for (const route of other.routes.filter((candidate) => candidate.slug !== "/"))
        assert.equal(existsSync(join(ctx.outputDir, pagePathForRoute(route.slug))), false);
      const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
      assert.ok(
        config.includes(
          JSON.stringify(
            { label: domainSpec.conversion_authority?.primary_action, href: expected[client].cta },
            null,
            2,
          ),
        ),
        `${client} CTA is the operator label bound to its verified form route`,
      );
    } finally {
      cleanupContext(ctx);
    }
  }
});

void test("NEGATIVE CTA destination: a contact form without a verified action is rejected", () => {
  assertBuildError(
    () =>
      spec("editorial", (draft) => {
        delete (draft.seo_contract as Record<string, unknown>).lead_form_action;
      }),
    "VALIDATION_FAILED",
    /lead_form_action/,
  );
  assertBuildError(
    () =>
      spec("industrial", (draft) => {
        (draft.seo_contract as Record<string, unknown>).lead_form_action =
          "http://forms.example.org/brannock-quote";
      }),
    "VALIDATION_FAILED",
    /lead_form_action/,
  );
});

void test("NEGATIVE CTA destination: a label with no form route never manufactures a link", async () => {
  const domainSpec = spec("editorial", (draft) => {
    routesOf(draft).splice(
      routesOf(draft).findIndex((route) => route.slug === "/contact"),
      1,
    );
  });
  const ctx = contextFor(domainSpec);
  try {
    await new SiteAssemblerStage().run(ctx);
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    assert.match(config, /primaryCta: null as/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("NEGATIVE pretend inquiry: a confirmation route without a verified action fails assembly", async () => {
  const domainSpec = spec("industrial", (draft) => {
    delete (draft.seo_contract as Record<string, unknown>).lead_form_action;
    for (const route of routesOf(draft))
      route.components = (route.components as string[]).filter((name) => name !== "contact-form");
  });
  const ctx = contextFor(domainSpec);
  try {
    await assertRejects(
      () => new SiteAssemblerStage().run(ctx),
      "VALIDATION_FAILED",
      /pretend-inquiry: .*\/quote\/received/,
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("NEGATIVE layout: unsupported or unrealizable layout requests fail assembly", async () => {
  const unknown = spec("editorial", (draft) => {
    routesOf(draft)[1].template = "layout:carousel";
  });
  const unrealizable = spec("industrial", (draft) => {
    const home = routesOf(draft)[0];
    home.template = "layout:diagram";
    home.components = ["hero", "cta"];
  });
  for (const [domainSpec, reason] of [
    [unknown, /unsupported-layout: .*layout:carousel.* is not a supported layout/],
    [unrealizable, /unsupported-layout: .* cannot be realized/],
  ] as const) {
    const ctx = contextFor(domainSpec);
    try {
      await assertRejects(() => new SiteAssemblerStage().run(ctx), "VALIDATION_FAILED", reason);
    } finally {
      cleanupContext(ctx);
    }
  }
});

void test("NEGATIVE routes: an unsafe, duplicate or malformed declared route is rejected", () => {
  assertBuildError(
    () =>
      spec("editorial", (draft) => {
        routesOf(draft)[2].slug = "/journal/../admin";
      }),
    "VALIDATION_FAILED",
    /Invalid route slug/,
  );
  assertBuildError(
    () =>
      spec("editorial", (draft) => {
        routesOf(draft)[2].slug = "/journal/";
      }),
    "VALIDATION_FAILED",
    /duplicate route \/journal/,
  );
  assertBuildError(
    () =>
      spec("industrial", (draft) => {
        routesOf(draft)[5].noindex = "yes";
      }),
    "VALIDATION_FAILED",
    /noindex/,
  );
});

void test("NEGATIVE design: an invalid approved color is rejected by the native design stage", async () => {
  const domainSpec = spec("industrial", (draft) => {
    ((draft.design as Record<string, unknown>).palette as Record<string, string>).primary =
      "safety-orange";
  });
  const ctx = contextFor(domainSpec);
  try {
    await assertRejects(
      () => new DesignIntelligenceStage().run(ctx),
      "VALIDATION_FAILED",
      /'primary' must be a valid CSS color/,
    );
  } finally {
    cleanupContext(ctx);
  }
});
