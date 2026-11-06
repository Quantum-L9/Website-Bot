// L9_META: layer=test_support, role=redesign_assembly_fixture, status=active, version=1.0.0
//
// WB-GLUE-01 shared fixture: a REDESIGN_IMPROVE build context whose sealed
// WebsiteBuildBlueprint, PageContentContract and StructuredContentPackage
// agree by section identity, with the package's section order deliberately
// shuffled. TEST input only; every business, route, copy and image is synthetic.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import {
  type StructuredContentRoute,
  sealIntelligenceArtifact,
  WEBSITE_INTELLIGENCE_SCHEMAS,
} from "@quantum-l9/bot-interop";
import { deriveVisualRequirements } from "../../src/intelligence/WebsiteBuildBlueprintCompiler.js";
import type { BuildContext, DomainSpec } from "../../src/pipeline/BuildContext.js";
import { ImageAssetPlanningStage } from "../../src/stages/ImageAssetPlanningStage.js";
import { StructuredContentProjectionStage } from "../../src/stages/StructuredContentProjectionStage.js";
import { makeRedesignAuthorities, type RedesignRouteFixture } from "../unit/redesign-fixtures.js";
import { fixtureContext } from "./siteFactoryFixture.js";

export const LEAD_FORM = "https://forms.example.com/submit";
export const ROUTES: DomainSpec["routes"] = [
  // The spec's component list is NOT the redesign section authority.
  { slug: "/", title: "Home", components: ["hero", "services-overview"] },
  { slug: "/contact", title: "Contact", components: ["contact_form"] },
];

/** Blueprint order deliberately differs from both the spec list and the package order. */
export const BLUEPRINT: RedesignRouteFixture[] = [
  {
    route_id: "/",
    sections: [
      { section_id: "hero", component_class: "hero", content_slots: ["primary_offer"] },
      { section_id: "how", component_class: "process-steps", content_slots: ["process"] },
      {
        section_id: "repairs",
        component_class: "services-overview",
        content_slots: ["service_overview"],
      },
      {
        section_id: "installs",
        component_class: "services-overview",
        content_slots: ["service_overview"],
      },
      { section_id: "story", component_class: "about-story", content_slots: ["differentiation"] },
      { section_id: "questions", component_class: "faq-accordion", content_slots: ["faq"] },
      { section_id: "closing", component_class: "cta-banner", content_slots: ["conversion"] },
    ],
  },
  {
    route_id: "/contact",
    sections: [
      { section_id: "form", component_class: "contact-form", content_slots: ["conversion"] },
    ],
  },
];

export function packageRoutes(): StructuredContentRoute[] {
  return [
    {
      route_id: "/",
      path: "/",
      metadata: { title: "Fixture Home", description: "Synthetic home description." },
      // Package order is shuffled relative to the blueprint.
      sections: [
        {
          section_id: "closing",
          heading: "Ready when you are",
          blocks: [{ kind: "paragraph", text: "Closing copy." }],
          cta: { label: "Request a quote", action: "request_quote" },
        },
        {
          section_id: "story",
          eyebrow: "Since 2001",
          heading: "Our story",
          blocks: [
            { kind: "paragraph", text: "We started with one van." },
            { kind: "quote", text: "They fixed it the same day.", attribution: "A. Customer" },
          ],
          cta: { label: "Call now", action: "call_now" },
        },
        {
          section_id: "hero",
          heading: "Fixture Plumbing That Shows Up",
          subheading: "Same-week repairs",
          blocks: [{ kind: "paragraph", text: "Licensed crews across the county." }],
          cta: { label: "See our services", action: "/contact" },
        },
        {
          section_id: "installs",
          heading: "Installations",
          blocks: [{ kind: "bullets", items: ["Water heaters", "Fixtures"] }],
        },
        {
          section_id: "how",
          heading: "How it works",
          blocks: [{ kind: "steps", items: ["Call us", "We inspect", "We fix it"] }],
        },
        {
          section_id: "questions",
          heading: "Questions",
          blocks: [{ kind: "paragraph", text: "Answers to common questions." }],
        },
        {
          section_id: "repairs",
          heading: "Repairs",
          blocks: [{ kind: "bullets", items: ["Leaks", "Clogs"] }],
          cta: { label: "Book a repair", action: "https://external.example.com/book" },
        },
      ],
      faqs: [{ question: "Do you work weekends?", answer: "Yes, by appointment." }],
      internal_links: [
        { target_route_id: "/contact", anchor_text: "Contact our team" },
        { target_route_id: "/nowhere", anchor_text: "Unpublished page" },
      ],
      schema_content_inputs: {},
    },
    {
      route_id: "/contact",
      path: "/contact",
      metadata: { title: "Fixture Contact", description: "Synthetic contact description." },
      sections: [
        {
          section_id: "form",
          heading: "Contact us",
          blocks: [{ kind: "paragraph", text: "Tell us what you need." }],
        },
      ],
      faqs: [],
      internal_links: [],
      schema_content_inputs: {},
    },
  ];
}

export function pngBytes(seed: string): Buffer {
  const base = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const data = Buffer.concat([
    Buffer.from("tEXt", "ascii"),
    Buffer.from(`seed\0${seed}`, "latin1"),
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data));
  return Buffer.concat([
    base.subarray(0, base.length - 12),
    length,
    data,
    crc,
    base.subarray(base.length - 12),
  ]);
}

export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export interface RedesignFixtureOptions {
  routes?: (routes: StructuredContentRoute[]) => StructuredContentRoute[];
  blueprint?: RedesignRouteFixture[];
  provided?: Array<{ id: string; intendedPlacement: string }>;
}

export async function redesignContext(options: RedesignFixtureOptions = {}): Promise<BuildContext> {
  const ctx = fixtureContext({
    business_name: "Example Fixture Plumbing Co.",
    routes: ROUTES,
    seo_contract: { site_url: "glue.example.com", lead_form_action: LEAD_FORM },
    conversion_authority: {
      primary_action: "Request a quote",
      secondary_actions: [],
      cta_library: [],
    },
  } as Partial<DomainSpec>);
  ctx.buildIntent = "REDESIGN_IMPROVE";
  ctx.generatedContent.clear();
  const blueprint = options.blueprint ?? BLUEPRINT;
  const authorities = makeRedesignAuthorities(blueprint, { primaryAction: "request_quote" });
  ctx.websiteBlueprint = authorities.websiteBlueprint;
  ctx.pageContentContract = authorities.pageContentContract;
  if (options.provided) {
    const dir = mkdtempSync(join(tmpdir(), "glue-assets-"));
    const visualRequirements = deriveVisualRequirements(ctx.websiteBlueprint.payload.routes);
    ctx.websiteBlueprint = makeRedesignAuthorities(blueprint, {
      primaryAction: "request_quote",
      visualRequirements,
    }).websiteBlueprint;
    ctx.domainSpec.assets = {
      generation: { enabled: false },
      providedImages: options.provided.map((image) => {
        const path = join(dir, `${image.id}.png`);
        writeFileSync(path, pngBytes(image.id));
        return { ...image, path };
      }),
    };
  }
  const routes = (options.routes ?? ((value) => value))(packageRoutes());
  ctx.structuredContentPackage = sealIntelligenceArtifact({
    artifact_type: "structured_content_package",
    client_id: ctx.clientId,
    build_id: ctx.buildId,
    producer: { repo: "SEO-Bot", version: "1.0.0" },
    produced_at: "2026-11-06T00:00:00.000Z",
    payload: {
      schema: WEBSITE_INTELLIGENCE_SCHEMAS.structuredContentPackage,
      page_content_contract_ref: {
        artifact_type: "page_content_contract",
        artifact_id: authorities.pageContentContract.artifact_id,
        payload_digest: authorities.pageContentContract.integrity.payload_digest,
      },
      routes,
      validation: {
        seo_blueprint_passed: true,
        contract_passed: true,
        unsupported_claims: [],
        failed_requirements: [],
      },
      route_evidence: [],
    },
  });
  await new StructuredContentProjectionStage().run(ctx);
  if (options.provided) await new ImageAssetPlanningStage().run(ctx);
  return ctx;
}

export function page(ctx: BuildContext, slug: string): string {
  const path = slug === "/" ? "src/pages/index.astro" : `src/pages${slug}/index.astro`;
  return readFileSync(join(ctx.outputDir, path), "utf-8");
}

export interface EmittedSection {
  sectionId: string;
  name: string;
  layout: string | null;
  content: string;
  structured: {
    sectionId: string;
    eyebrow?: string;
    heading?: string;
    blocks: unknown[];
    cta: { label: string; href: string } | null;
    faqs?: Array<{ question: string; answer: string }>;
  };
  imagePlacement: string | null;
}

export function sections(source: string): EmittedSection[] {
  const match = /const sections = ([\s\S]*?) as const;\n/.exec(source);
  assert.ok(match, "generated page declares its sections");
  return JSON.parse(match[1]) as EmittedSection[];
}
