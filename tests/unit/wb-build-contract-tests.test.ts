// L9_META: layer=test, role=build_contract_catalog, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01 — Wave 1 (T01–T10).
//
// One canonical valid fixture (F00), produced by the real production stages
// (projection → image planning → assembly), and a mutation catalog that
// changes exactly one property of F00 per case. The oracle
// (tests/helpers/buildContractOracle.ts) derives every expectation from the
// accepted blueprint, content package and supplied client assets, never from
// the generated project. A valid fixture must report no finding; each
// mutation must report exactly its intended test ids — a crash, parse error
// or unrelated finding is not a detected defect.
//
// Wave 2 (browser geometry, F01/F11/F12/F18) and Wave 3 (release order,
// F14/F15) are out of scope here.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { VisualRequirement } from "@quantum-l9/bot-interop";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import type { ImageAssetPlan } from "../../src/pipeline/evidence/ImageAssetPlan.js";
import { FACTUAL_ROLES } from "../../src/services/images/ImageAssetPlanner.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import {
  type AcceptedInputs,
  type AssembledSite,
  type ContractTestId,
  checkBuildContract,
  findingIds,
  INV09_FACTUAL_ROLES,
  pageFile,
  readAssembledSite,
  siteConfigFile,
} from "../helpers/buildContractOracle.js";
import { ROUTES, redesignContext } from "../helpers/redesignAssemblyFixture.js";
import { cleanupContext } from "../helpers/siteFactoryFixture.js";

const SLUGS = ROUTES.map((route) => route.slug);

function requirement(
  slot: string,
  route: string,
  section: string,
  role: VisualRequirement["role"],
  provenance: VisualRequirement["preferred_provenance"],
  required = false,
): VisualRequirement {
  return {
    requirement_id: `vr-${slot}`,
    route_id: route,
    section_id: section,
    slot_id: slot,
    role,
    required,
    min_count: 1,
    preferred_provenance: provenance,
    device_suitability: ["desktop", "mobile"],
  };
}

/** F00 visual requirements: a client asset for every factual slot, one missing illustration. */
function f00Requirements(
  heroProvenance: VisualRequirement["preferred_provenance"] = ["source", "generated"],
) {
  return [
    requirement("global:logo", "global", "global", "logo", ["source"], true),
    requirement("/:hero", "/", "hero", "hero", heroProvenance, true),
    requirement("/:repairs:service", "/", "repairs", "service", ["source", "generated"]),
    requirement("/:installs:service", "/", "installs", "service", ["source", "generated"]),
    requirement("/:story:team", "/", "story", "team", ["source"]),
    // The one genuinely missing illustration: only this slot may be generated.
    requirement("/:how:process", "/", "how", "process", ["generated"]),
  ];
}

const F00_PROVIDED = [
  { id: "brand-logo", intendedPlacement: "global:logo" },
  { id: "storefront", intendedPlacement: "/:hero" },
  { id: "repair-van", intendedPlacement: "/:service#repairs" },
  { id: "new-heater", intendedPlacement: "/:service#installs" },
  { id: "crew-photo", intendedPlacement: "/:team" },
  // Unplaced client photo: kept in the gallery inventory, bytes unchanged.
  { id: "spare-photo", altText: "Completed bathroom remodel" },
];

interface Built {
  ctx: BuildContext;
  accepted: AcceptedInputs;
  site: AssembledSite;
  plan: ImageAssetPlan | undefined;
}

type FixtureOptions = Parameters<typeof redesignContext>[0];

/** Build a fixture through the real production stages and read the result back from disk. */
async function build(overrides: Partial<FixtureOptions> = {}): Promise<Built> {
  const ctx = await redesignContext({
    generation: true,
    provided: F00_PROVIDED,
    visualRequirements: f00Requirements(),
    ...overrides,
  });
  await new SiteAssemblerStage().run(ctx);
  assert.ok(ctx.websiteBlueprint && ctx.structuredContentPackage);
  return {
    ctx,
    accepted: {
      blueprint: ctx.websiteBlueprint,
      contentPackage: ctx.structuredContentPackage,
      domainSpec: ctx.domainSpec,
    },
    site: readAssembledSite(ctx.outputDir, SLUGS),
    plan: ctx.imageAssetPlan,
  };
}

async function withBuild(
  overrides: Partial<FixtureOptions>,
  body: (built: Built) => void | Promise<void>,
): Promise<void> {
  const built = await build(overrides);
  try {
    await body(built);
  } finally {
    cleanupContext(built.ctx);
  }
}

function report(built: Built, plan: ImageAssetPlan | undefined = built.plan) {
  const site = readAssembledSite(built.ctx.outputDir, SLUGS);
  return checkBuildContract(built.accepted, site, plan);
}

/** Rewrite one route's emitted sections in place (an output mutation). */
function editSections(
  outputDir: string,
  slug: string,
  edit: (sections: Array<Record<string, unknown>>) => void,
) {
  const file = pageFile(outputDir, slug);
  const source = readFileSync(file, "utf-8");
  const match = /const sections = ([\s\S]*?) as const;\n/.exec(source);
  assert.ok(match, `page ${slug} declares its sections`);
  const sections = JSON.parse(match[1]) as Array<Record<string, unknown>>;
  edit(sections);
  writeFileSync(file, source.replace(match[1], JSON.stringify(sections, null, 2)));
}

/** Rewrite the published image registry in place (an output mutation). */
function editRegistry(
  outputDir: string,
  edit: (images: Record<string, Record<string, unknown>>) => void,
) {
  const file = siteConfigFile(outputDir);
  const source = readFileSync(file, "utf-8");
  const match = /\.\.\.\(([\s\S]*?) as const\),\n {2}leadFormAction:/.exec(source);
  assert.ok(match, "siteConfig declares its registry");
  const config = JSON.parse(match[1]) as { images: Record<string, Record<string, unknown>> };
  edit(config.images);
  writeFileSync(file, source.replace(match[1], JSON.stringify(config, null, 2)));
}

function generatedInPlan(plan: ImageAssetPlan | undefined, placement: string): ImageAssetPlan {
  assert.ok(plan);
  const copy = structuredClone(plan);
  const asset = copy.assets.find((entry) => entry.placement === placement);
  assert.ok(asset, `plan carries ${placement}`);
  asset.resolution = {
    source: "generated",
    compiledBrief: { slotId: asset.slotId, intent: "synthetic" },
  };
  return copy;
}

function assertOnly(built: Built, expected: ContractTestId[], plan?: ImageAssetPlan): void {
  const findings = report(built, plan ?? built.plan);
  assert.deepEqual(findingIds(findings), expected, JSON.stringify(findings, null, 2));
}

// ---- Positive controls ------------------------------------------------------

void test("F00 valid-redesign: the real pipeline output satisfies T01–T10", async () => {
  await withBuild({}, (built) => {
    assert.deepEqual(report(built), []);
    // T09 positive: the single missing illustration is the only generated slot.
    const generated = (built.plan?.assets ?? []).filter((a) => a.resolution.source === "generated");
    assert.deepEqual(
      generated.map((a) => a.placement),
      ["/:process"],
    );
    // T08 also covers the gallery inventory: the unplaced client photo is published.
    assert.ok(built.site.gallery.some((entry) => entry.source === "provided"));
  });
});

void test("F07 shuffled-content: reordering every content-package section array changes nothing", async () => {
  const reference = await build();
  try {
    await withBuild(
      {
        routes: (routes) =>
          routes.map((route) => ({ ...route, sections: [...route.sections].reverse() })),
      },
      (shuffled) => {
        assert.deepEqual(report(shuffled), []);
        for (const slug of SLUGS) {
          assert.equal(
            readFileSync(pageFile(shuffled.ctx.outputDir, slug), "utf-8"),
            readFileSync(pageFile(reference.ctx.outputDir, slug), "utf-8"),
            `${slug} page source is identical`,
          );
        }
      },
    );
  } finally {
    cleanupContext(reference.ctx);
  }
});

void test("F13 text-only-editorial: a route the blueprint gives no imagery passes without images", async () => {
  await withBuild({}, (built) => {
    const drains = built.site.pages.get("/services/drains") ?? [];
    assert.ok(drains.length > 0);
    assert.ok(drains.every((section) => section.imagePlacement === null));
    assert.deepEqual(report(built), []);
  });
});

// ---- Production-input variants (the pipeline itself must hold the contract) --

void test("T07 production: an assigned client hero wins even when the blueprint prefers generation", async () => {
  await withBuild({ visualRequirements: f00Requirements(["generated"]) }, (built) => {
    assert.deepEqual(report(built), []);
  });
});

void test("T10 production: a missing team photo is left unresolved, never generated", async () => {
  await withBuild(
    {
      provided: F00_PROVIDED.filter((image) => image.id !== "crew-photo"),
      visualRequirements: f00Requirements().map((r) =>
        r.role === "team" ? { ...r, preferred_provenance: ["source", "generated"] } : r,
      ),
    },
    (built) => {
      const team = built.plan?.assets.find((asset) => asset.placement === "/:team");
      assert.equal(team?.resolution.source, "unresolved");
      assert.deepEqual(report(built), []);
    },
  );
});

void test("INV-09 roles: the production planner protects at least every role the contract names", () => {
  for (const role of INV09_FACTUAL_ROLES) assert.ok(FACTUAL_ROLES.has(role), role);
});

// ---- Mutation catalog: each must fail for exactly its intended reason --------

void test("F10 reordered-sections: services moved before the hero fails T01", async () => {
  await withBuild({}, (built) => {
    editSections(built.ctx.outputDir, "/", (sections) => {
      const [hero, how, repairs] = sections.splice(0, 3);
      sections.unshift(repairs, hero, how);
    });
    assertOnly(built, ["T01"]);
  });
});

void test("F02-content: a section rendering another section's copy fails T02", async () => {
  await withBuild({}, (built) => {
    editSections(built.ctx.outputDir, "/", (sections) => {
      const repairs = sections.find((s) => s.sectionId === "repairs") as { structured: object };
      const installs = sections.find((s) => s.sectionId === "installs") as { structured: object };
      const copy = { ...installs.structured, sectionId: "repairs" };
      repairs.structured = copy;
    });
    assertOnly(built, ["T02"]);
  });
});

void test("F08 flattened-content: bullets and steps rendered as paragraphs fail T03", async () => {
  await withBuild({}, (built) => {
    editSections(built.ctx.outputDir, "/", (sections) => {
      for (const section of sections) {
        const structured = section.structured as {
          blocks: Array<{ kind: string; items?: string[] }>;
        };
        structured.blocks = structured.blocks.map((block) =>
          block.items ? { kind: "paragraph", text: block.items.join(" ") } : block,
        );
      }
    });
    const findings = report(built);
    assert.deepEqual(findingIds(findings), ["T03"], JSON.stringify(findings, null, 2));
    assert.deepEqual(
      findings.map((f) => f.sectionId).sort(),
      ["how", "installs", "proof", "repairs"],
      "exactly the sections that carried bullets or steps",
    );
  });
});

void test("F09 missing-cta-link: a CTA label with no destination fails T04", async () => {
  await withBuild({}, (built) => {
    editSections(built.ctx.outputDir, "/", (sections) => {
      const hero = sections.find((s) => s.sectionId === "hero") as {
        structured: { cta: { label: string; href: string } };
      };
      hero.structured.cta = { ...hero.structured.cta, href: "" };
    });
    const findings = report(built);
    assert.deepEqual(findingIds(findings), ["T04"]);
    assert.ok(findings.every((f) => f.sectionId === "hero"));
  });
});

void test("F09b off-site-cta: a CTA pointing outside the canonical routes fails T04", async () => {
  await withBuild({}, (built) => {
    editSections(built.ctx.outputDir, "/", (sections) => {
      const closing = sections.find((s) => s.sectionId === "closing") as {
        structured: { cta: { label: string; href: string } };
      };
      closing.structured.cta = { ...closing.structured.cta, href: "/nowhere" };
    });
    assertOnly(built, ["T04"]);
  });
});

void test("F02 unplaced-image: hero file on disk but unpublished fails T05", async () => {
  await withBuild({}, (built) => {
    editRegistry(built.ctx.outputDir, (images) => {
      delete images["/:hero"];
    });
    assertOnly(built, ["T05"]);
  });
});

void test("F03 swapped-images: two same-role service images switched fails T06", async () => {
  await withBuild({}, (built) => {
    editSections(built.ctx.outputDir, "/", (sections) => {
      const repairs = sections.find((s) => s.sectionId === "repairs") as { imagePlacement: string };
      const installs = sections.find((s) => s.sectionId === "installs") as {
        imagePlacement: string;
      };
      [repairs.imagePlacement, installs.imagePlacement] = [
        installs.imagePlacement,
        repairs.imagePlacement,
      ];
    });
    const findings = report(built);
    assert.deepEqual(findingIds(findings), ["T06"]);
    assert.deepEqual(findings.map((f) => f.sectionId).sort(), ["installs", "repairs"]);
  });
});

void test("F03b collapsed-images: one image shown in both same-role sections fails T06", async () => {
  await withBuild({}, (built) => {
    editSections(built.ctx.outputDir, "/", (sections) => {
      const installs = sections.find((s) => s.sectionId === "installs") as {
        imagePlacement: string;
      };
      installs.imagePlacement = "/:service#repairs";
    });
    assertOnly(built, ["T06"]);
  });
});

void test("F04 modified-logo: a recompressed or recolored published logo fails T08", async () => {
  await withBuild({}, (built) => {
    const logo = built.site.images["global:logo"];
    assert.ok(logo);
    const file = join(built.ctx.outputDir, "public", logo.src);
    const bytes = readFileSync(file);
    writeFileSync(file, Buffer.concat([bytes, Buffer.from("recolored")]));
    const findings = report(built);
    assert.deepEqual(findingIds(findings), ["T08"]);
    assert.equal(findings[0].placement, "global:logo");
  });
});

void test("F04b modified-gallery-photo: a changed unplaced client photo fails T08", async () => {
  await withBuild({}, (built) => {
    const photo = built.site.gallery.find((entry) => entry.source === "provided");
    assert.ok(photo);
    const file = join(built.ctx.outputDir, "public", photo.src);
    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("x")]));
    assertOnly(built, ["T08"]);
  });
});

void test("F05 generated-logo: a synthetic logo in place of the supplied one fails T07 and T10", async () => {
  await withBuild({}, (built) => {
    editRegistry(built.ctx.outputDir, (images) => {
      images["global:logo"] = { ...images["global:logo"], source: "generated" };
    });
    assertOnly(built, ["T07", "T10"], generatedInPlan(built.plan, "global:logo"));
  });
});

void test("F06 unnecessary-generation: a generated hero despite a supplied one fails T07 and T09", async () => {
  await withBuild({}, (built) => {
    editRegistry(built.ctx.outputDir, (images) => {
      images["/:hero"] = { ...images["/:hero"], source: "generated" };
    });
    assertOnly(built, ["T07", "T09"], generatedInPlan(built.plan, "/:hero"));
  });
});

void test("F06b generated-team: a synthetic team portrait fails T07 and T10", async () => {
  await withBuild({}, (built) => {
    assertOnly(built, ["T07", "T10"], generatedInPlan(built.plan, "/:team"));
  });
});
