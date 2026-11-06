// L9_META: layer=test_support, role=build_contract_oracle, status=active, version=1.0.0
//
// WB-BUILD-CONTRACT-TESTS-01, Wave 1: an executable statement of what an
// assembled REDESIGN_IMPROVE project owes its accepted inputs (T01–T10).
//
// Expectations are derived ONLY from the accepted artifacts — the sealed
// WebsiteBuildBlueprint, the StructuredContentPackage, and the operator's
// DomainSpec (routes, lead form, supplied client images). The assembled
// output (page sources, siteConfig registry, public/ files) and the image
// plan are the things under test. Comparing the output with itself would let
// the factory certify its own mistake, so nothing here reads an expectation
// from the generated project.
//
// TEST support only: this is not a production gate (Wave 2 moves the browser
// facts into src/validation/rendered-site.ts).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type {
  StructuredContentPackageArtifact,
  StructuredContentRoute,
  VisualRequirement,
  WebsiteBuildBlueprintArtifact,
} from "@quantum-l9/bot-interop";
import type { DomainSpec } from "../../src/pipeline/BuildContext.js";
import type { ImageAssetPlan } from "../../src/pipeline/evidence/ImageAssetPlan.js";

/** Campaign test ids this oracle can report. */
export type ContractTestId =
  | "T01" // blueprint section ordering
  | "T02" // content identity (section receives its own approved copy)
  | "T03" // structured blocks keep their structure
  | "T04" // CTA rendered with an approved destination
  | "T05" // required hero image actually placed
  | "T06" // distinct same-role slots keep distinct, correctly bound images
  | "T07" // assigned client image wins its slot
  | "T08" // published client image bytes equal the input file
  | "T09" // generation only for unresolved illustrative slots
  | "T10"; // no synthetic identity or factual imagery

export interface ContractFinding {
  id: ContractTestId;
  route?: string;
  sectionId?: string;
  placement?: string;
  expected: string;
  actual: string;
}

/**
 * INV-09 roles that depict real identity or fact (logo, people, actual work,
 * credentials). Declared here from the campaign invariant, independently of
 * the production planner, so a production change cannot silently redefine
 * what the test accepts.
 */
export const INV09_FACTUAL_ROLES: readonly string[] = [
  "logo",
  "team",
  "project_proof",
  "gallery",
  "badge",
  "trust",
];

interface EmittedStructured {
  sectionId: string;
  eyebrow?: string;
  heading?: string;
  subheading?: string;
  blocks: unknown[];
  cta: { label: string; href: string } | null;
}

export interface EmittedPageSection {
  sectionId: string;
  name: string;
  structured: EmittedStructured;
  imagePlacement: string | null;
}

export interface RegistryEntry {
  src: string;
  alt: string;
  width: number;
  height: number;
  source: "provided" | "source-site" | "generated";
}

/** The assembled project, read from disk exactly as Astro would consume it. */
export interface AssembledSite {
  outputDir: string;
  pages: Map<string, EmittedPageSection[]>;
  images: Record<string, RegistryEntry>;
  gallery: RegistryEntry[];
}

export interface AcceptedInputs {
  blueprint: WebsiteBuildBlueprintArtifact;
  contentPackage: StructuredContentPackageArtifact;
  domainSpec: DomainSpec;
}

export function pageFile(outputDir: string, slug: string): string {
  return join(outputDir, slug === "/" ? "src/pages/index.astro" : `src/pages${slug}/index.astro`);
}

export function siteConfigFile(outputDir: string): string {
  return join(outputDir, "src/lib/siteConfig.ts");
}

const SECTIONS = /const sections = ([\s\S]*?) as const;\n/;
const CONFIG = /\.\.\.\(([\s\S]*?) as const\),\n {2}leadFormAction:/;

export function readAssembledSite(outputDir: string, routes: readonly string[]): AssembledSite {
  const pages = new Map<string, EmittedPageSection[]>();
  for (const slug of routes) {
    const match = SECTIONS.exec(readFileSync(pageFile(outputDir, slug), "utf-8"));
    pages.set(slug, match ? (JSON.parse(match[1]) as EmittedPageSection[]) : []);
  }
  const config = CONFIG.exec(readFileSync(siteConfigFile(outputDir), "utf-8"));
  const parsed = config
    ? (JSON.parse(config[1]) as {
        images?: Record<string, RegistryEntry>;
        galleryImages?: RegistryEntry[];
      })
    : {};
  return { outputDir, pages, images: parsed.images ?? {}, gallery: parsed.galleryImages ?? [] };
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function blockText(blocks: readonly unknown[]): string {
  return blocks
    .map((block) => {
      const row = block as { text?: string; items?: string[]; attribution?: string };
      return [row.text, ...(row.items ?? []), row.attribution].filter(Boolean).join(" ");
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function placementRole(placement: string): string {
  const base = placement.split("#")[0];
  return base.slice(base.lastIndexOf(":") + 1);
}

function requirementPlacements(
  requirements: readonly VisualRequirement[],
): Map<string, VisualRequirement> {
  // The accepted placement key of each requirement: <route>:<role>, qualified
  // by section when several requirements on a route share that role.
  const base = (r: VisualRequirement) =>
    r.route_id === "global" ? `global:${r.role}` : `${r.route_id}:${r.role}`;
  const sections = new Map<string, Set<string>>();
  for (const r of requirements) {
    const key = base(r);
    sections.set(key, (sections.get(key) ?? new Set()).add(r.section_id));
  }
  const byPlacement = new Map<string, VisualRequirement>();
  for (const r of requirements) {
    const key = base(r);
    byPlacement.set((sections.get(key)?.size ?? 0) > 1 ? `${key}#${r.section_id}` : key, r);
  }
  return byPlacement;
}

function inputPath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

/** T01–T04: the pages execute the blueprint and carry the approved copy. */
function checkPages(accepted: AcceptedInputs, site: AssembledSite): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const routes = new Set(accepted.domainSpec.routes.map((route) => route.slug));
  const formRoute = accepted.domainSpec.routes.find((route) =>
    route.components.some((component) => component.replace(/-/g, "_") === "contact_form"),
  );
  const leadForm = Boolean(accepted.domainSpec.seo_contract?.lead_form_action);
  const scp = new Map<string, StructuredContentRoute>(
    accepted.contentPackage.payload.routes.map((route) => [route.route_id, route]),
  );
  for (const route of accepted.blueprint.payload.routes) {
    const emitted = site.pages.get(route.route_id) ?? [];
    const expectedOrder = route.sections.map((section) => section.section_id);
    const actualOrder = emitted.map((section) => section.sectionId);
    if (JSON.stringify(expectedOrder) !== JSON.stringify(actualOrder)) {
      findings.push({
        id: "T01",
        route: route.route_id,
        expected: expectedOrder.join(" > "),
        actual: actualOrder.join(" > "),
      });
    }
    const content = new Map(
      (scp.get(route.route_id)?.sections ?? []).map((s) => [s.section_id, s]),
    );
    for (const section of emitted) {
      const approved = content.get(section.sectionId);
      if (!approved) continue;
      const got = section.structured;
      const sameHeads =
        got.heading === approved.heading &&
        got.eyebrow === approved.eyebrow &&
        got.subheading === approved.subheading;
      if (!sameHeads || blockText(got.blocks) !== blockText(approved.blocks)) {
        findings.push({
          id: "T02",
          route: route.route_id,
          sectionId: section.sectionId,
          expected: `${approved.heading ?? ""} | ${blockText(approved.blocks)}`,
          actual: `${got.heading ?? ""} | ${blockText(got.blocks)}`,
        });
      } else if (JSON.stringify(got.blocks) !== JSON.stringify(approved.blocks)) {
        findings.push({
          id: "T03",
          route: route.route_id,
          sectionId: section.sectionId,
          expected: approved.blocks.map((block) => block.kind).join(","),
          actual: got.blocks.map((block) => (block as { kind?: string }).kind ?? "?").join(","),
        });
      }
      const where = { route: route.route_id, sectionId: section.sectionId };
      if (got.cta) {
        const href = got.cta.href ?? "";
        const path = href.split("#")[0];
        const fragment = href.includes("#") ? href.slice(href.indexOf("#") + 1) : undefined;
        const authorized =
          routes.has(path) &&
          (fragment === undefined ||
            (fragment === "quote" && leadForm && path === formRoute?.slug));
        if (!authorized || got.cta.label !== approved.cta?.label) {
          findings.push({
            id: "T04",
            ...where,
            expected: `"${approved.cta?.label ?? "(none)"}" → an authorized route or the verified form`,
            actual: `"${got.cta.label}" → ${JSON.stringify(href)}`,
          });
        }
      }
      // An approved CTA whose action names a canonical route must link there.
      const actionPath = (approved.cta?.action ?? "").split("#")[0];
      if (routes.has(actionPath) && (got.cta?.href ?? "").split("#")[0] !== actionPath) {
        findings.push({
          id: "T04",
          ...where,
          expected: `"${approved.cta?.label}" → ${actionPath}`,
          actual: got.cta
            ? `"${got.cta.label}" → ${JSON.stringify(got.cta.href)}`
            : "no CTA rendered",
        });
      }
    }
  }
  return findings;
}

/** T05–T10: images are chosen, placed and published as the inputs require. */
function checkImages(
  accepted: AcceptedInputs,
  site: AssembledSite,
  plan: ImageAssetPlan | undefined,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const requirements = requirementPlacements(accepted.blueprint.payload.visual_requirements);
  const provided = accepted.domainSpec.assets?.providedImages ?? [];
  const assignedTo = new Map(
    provided
      .filter((image) => image.intendedPlacement)
      .map((image) => [image.intendedPlacement as string, image]),
  );
  const planned = new Map((plan?.assets ?? []).map((asset) => [asset.placement, asset]));

  for (const [placement, requirement] of requirements) {
    const role = placementRole(placement);
    const resolution = planned.get(placement)?.resolution;
    const assigned = assignedTo.get(placement);
    // T07: an assigned client image wins its slot.
    if (
      assigned &&
      !(
        resolution?.source === "provided" &&
        "candidateId" in resolution &&
        resolution.candidateId === assigned.id
      )
    ) {
      findings.push({
        id: "T07",
        placement,
        expected: `provided ${assigned.id}`,
        actual: resolution
          ? `${resolution.source}${"candidateId" in resolution ? ` ${resolution.candidateId}` : ""}`
          : "no plan entry",
      });
    }
    if (resolution?.source === "generated") {
      if (INV09_FACTUAL_ROLES.includes(role)) {
        // T10: identity and factual imagery are never synthetic.
        findings.push({
          id: "T10",
          placement,
          expected: "a real client asset or unresolved",
          actual: "generated",
        });
      } else if (assigned) {
        // T09: generation only where no client asset was available.
        findings.push({
          id: "T09",
          placement,
          expected: `no generation (client image ${assigned.id} was supplied)`,
          actual: "generated",
        });
      }
    }
    const published = site.images[placement];
    if (published?.source === "generated" && INV09_FACTUAL_ROLES.includes(role)) {
      findings.push({
        id: "T10",
        placement,
        expected: "no synthetic asset published",
        actual: published.src,
      });
    }
    const fulfilled =
      resolution && (resolution.source === "provided" || resolution.source === "source-site");
    if (role === "hero" && fulfilled) {
      // T05: a fulfilled hero is published and shown in the route's hero section.
      const route = site.pages.get(requirement.route_id) ?? [];
      const hero = route.find((section) => section.name === "hero");
      if (
        !published ||
        !hero ||
        (hero.imagePlacement !== null && hero.imagePlacement !== placement)
      ) {
        findings.push({
          id: "T05",
          route: requirement.route_id,
          placement,
          expected: "published and rendered in the hero section",
          actual: !published
            ? "not in the published image registry"
            : hero
              ? `hero shows ${hero.imagePlacement}`
              : "no hero section",
        });
      }
    } else if (fulfilled && requirement.route_id !== "global") {
      // T06: each non-hero slot is bound to exactly its own accepted section.
      const bound = [...site.pages.entries()].flatMap(([slug, sections]) =>
        sections
          .filter((section) => section.imagePlacement === placement)
          .map((section) => `${slug}#${section.sectionId}`),
      );
      const want = `${requirement.route_id}#${requirement.section_id}`;
      if (!published || bound.length !== 1 || bound[0] !== want) {
        findings.push({
          id: "T06",
          route: requirement.route_id,
          sectionId: requirement.section_id,
          placement,
          expected: `bound once, to ${want}`,
          actual: published ? `bound to [${bound.join(", ")}]` : "not published",
        });
      }
    }
  }

  // T08: every published client-provided file is byte-identical to its input.
  const inputs = new Map(provided.map((image) => [image.id, inputPath(image.path)]));
  const shaOfInput = new Map<string, string>();
  for (const [id, path] of inputs)
    if (existsSync(path)) shaOfInput.set(sha256(readFileSync(path)), id);
  const publishedProvided = [
    ...Object.entries(site.images).filter(([, entry]) => entry.source === "provided"),
    ...site.gallery
      .filter((entry) => entry.source === "provided")
      .map((entry) => [entry.src, entry] as const),
  ];
  for (const [key, entry] of publishedProvided) {
    const file = join(site.outputDir, "public", entry.src);
    const digest = existsSync(file) ? sha256(readFileSync(file)) : "missing";
    if (!shaOfInput.has(digest)) {
      findings.push({
        id: "T08",
        placement: key,
        expected: "bytes equal to a supplied input file",
        actual:
          digest === "missing" ? `missing ${entry.src}` : `unmatched sha256 ${digest.slice(0, 12)}`,
      });
    }
  }
  return findings;
}

/** Every T01–T10 violation of the accepted inputs by the assembled output and plan. */
export function checkBuildContract(
  accepted: AcceptedInputs,
  site: AssembledSite,
  plan: ImageAssetPlan | undefined,
): ContractFinding[] {
  return [...checkPages(accepted, site), ...checkImages(accepted, site, plan)];
}

/** Sorted unique ids, for asserting a fixture fails for exactly its intended reasons. */
export function findingIds(findings: readonly ContractFinding[]): ContractTestId[] {
  return [...new Set(findings.map((finding) => finding.id))].sort();
}
