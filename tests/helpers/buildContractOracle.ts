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
  WebsiteBlueprintRoute,
  WebsiteBuildBlueprintArtifact,
} from "@quantum-l9/bot-interop";
import { resolveSectionRenderer } from "../../astro_template/src/components/SectionRegistry.js";
import type { DomainSpec } from "../../src/pipeline/BuildContext.js";
import type { ImageAssetPlan } from "../../src/pipeline/evidence/ImageAssetPlan.js";
import { normalizeComponentName } from "../../src/validation/validate-generated-site.js";

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
  faqs?: Array<{ question: string; answer: string }>;
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

/**
 * The LeadForm section's anchor (astro_template/src/components/LeadForm.astro,
 * `id="quote"`): the only fragment a verified lead-form CTA may carry.
 */
export const LEAD_FORM_ANCHOR = "quote";

const actionKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/**
 * The destination an approved CTA action is entitled to, from accepted inputs
 * only: a canonical route path; or the operator's primary action, when a
 * verified lead form exists on a canonical route; otherwise none — and a CTA
 * with no derivable destination must not render as a link at all.
 */
function expectedCtaHref(accepted: AcceptedInputs, action: string): string | undefined {
  const routes = new Set(accepted.domainSpec.routes.map((route) => route.slug));
  const path = action.trim().split("#")[0];
  if (path.startsWith("/") && routes.has(path)) return path;
  const primaries = [
    accepted.domainSpec.conversion_authority?.primary_action,
    accepted.blueprint.payload.conversion.primary_action,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map(actionKey);
  const formRoute = accepted.domainSpec.routes.find((route) =>
    route.components.some((component) => actionKey(component) === "contact_form"),
  );
  if (
    primaries.includes(actionKey(action)) &&
    accepted.domainSpec.seo_contract?.lead_form_action &&
    formRoute
  ) {
    return `${formRoute.slug}#${LEAD_FORM_ANCHOR}`;
  }
  return undefined;
}

/** The blueprint section a component class realizes as the given registered renderer. */
function blueprintSectionRendering(
  route: WebsiteBlueprintRoute,
  renderer: string,
): string | undefined {
  return route.sections.find((section) => plannedRenderer(section.component_class) === renderer)
    ?.section_id;
}

/**
 * The renderer a blueprint component class is entitled to: its registered
 * section component, else the normalized class the generic renderer keys on.
 */
function plannedRenderer(componentClass: string): string {
  const normalized = normalizeComponentName(componentClass);
  const resolution = resolveSectionRenderer(normalized);
  return resolution.kind === "registered" ? resolution.name : normalized;
}

/** T01–T04: the pages execute the blueprint and carry the approved copy. */
function checkPages(accepted: AcceptedInputs, site: AssembledSite): ContractFinding[] {
  const findings: ContractFinding[] = [];
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
    const approvedRoute = scp.get(route.route_id);
    const content = new Map((approvedRoute?.sections ?? []).map((s) => [s.section_id, s]));
    const faqSection = blueprintSectionRendering(route, "faq");
    const planned = new Map(route.sections.map((s) => [s.section_id, s.component_class]));
    for (const section of emitted) {
      const where = { route: route.route_id, sectionId: section.sectionId };
      const approved = content.get(section.sectionId);
      const got = section.structured;
      // T03: each section renders through the component its blueprint class names.
      const componentClass = planned.get(section.sectionId);
      if (componentClass && section.name !== plannedRenderer(componentClass)) {
        findings.push({
          id: "T03",
          ...where,
          expected: `renderer ${plannedRenderer(componentClass)}`,
          actual: `renderer ${section.name}`,
        });
      }
      if (!approved) {
        findings.push({
          id: "T02",
          ...where,
          expected: "no unapproved copy",
          actual: got.heading ?? "(copy)",
        });
        continue;
      }
      const sameHeads =
        got.heading === approved.heading &&
        got.eyebrow === approved.eyebrow &&
        got.subheading === approved.subheading;
      if (!sameHeads || blockText(got.blocks) !== blockText(approved.blocks)) {
        findings.push({
          id: "T02",
          ...where,
          expected: `${approved.heading ?? ""} | ${blockText(approved.blocks)}`,
          actual: `${got.heading ?? ""} | ${blockText(got.blocks)}`,
        });
      } else if (JSON.stringify(got.blocks) !== JSON.stringify(approved.blocks)) {
        findings.push({
          id: "T03",
          ...where,
          expected: approved.blocks.map((block) => block.kind).join(","),
          actual: got.blocks.map((block) => (block as { kind?: string }).kind ?? "?").join(","),
        });
      }
      // The route's approved FAQs reach the planned FAQ section, verbatim.
      if (section.sectionId === faqSection && (approvedRoute?.faqs.length ?? 0) > 0) {
        if (JSON.stringify(got.faqs ?? []) !== JSON.stringify(approvedRoute?.faqs)) {
          findings.push({
            id: "T02",
            ...where,
            expected: `${approvedRoute?.faqs.length} approved FAQ(s)`,
            actual: `${got.faqs?.length ?? 0} rendered FAQ(s), content ${got.faqs ? "differs" : "missing"}`,
          });
        }
      }
      // T04: a CTA renders exactly when its approved action has a derivable destination.
      const wantHref = approved.cta ? expectedCtaHref(accepted, approved.cta.action) : undefined;
      const gotDesc = got.cta ? `"${got.cta.label}" → ${JSON.stringify(got.cta.href)}` : "no CTA";
      if (wantHref) {
        if (!got.cta || got.cta.href !== wantHref || got.cta.label !== approved.cta?.label) {
          findings.push({
            id: "T04",
            ...where,
            expected: `"${approved.cta?.label}" → ${wantHref}`,
            actual: gotDesc,
          });
        }
      } else if (got.cta) {
        findings.push({
          id: "T04",
          ...where,
          expected: "no link (no verified destination)",
          actual: gotDesc,
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
  const inputDigests = new Map(
    provided
      .filter((image) => existsSync(inputPath(image.path)))
      .map((image) => [image.id, sha256(readFileSync(inputPath(image.path)))]),
  );
  const knownInput = new Set(inputDigests.values());
  const digestOf = (entry: RegistryEntry): string => {
    const file = join(site.outputDir, "public", entry.src);
    return existsSync(file) ? sha256(readFileSync(file)) : "missing";
  };
  const blueprintRoutes = new Map(accepted.blueprint.payload.routes.map((r) => [r.route_id, r]));
  const boundTo = (placement: string): string[] =>
    [...site.pages.entries()].flatMap(([slug, sections]) =>
      sections
        .filter((section) => section.imagePlacement === placement)
        .map((section) => `${slug}#${section.sectionId}`),
    );

  for (const [placement, requirement] of requirements) {
    const role = placementRole(placement);
    const resolution = planned.get(placement)?.resolution;
    const published = site.images[placement];
    const assigned = assignedTo.get(placement);
    const generated = resolution?.source === "generated" || published?.source === "generated";

    if (assigned) {
      // T07: the assigned client image is the slot's selected AND published asset.
      const selected =
        resolution?.source === "provided" &&
        "candidateId" in resolution &&
        resolution.candidateId === assigned.id;
      if (!selected || (published && published.source !== "provided")) {
        findings.push({
          id: "T07",
          placement,
          expected: `provided ${assigned.id}`,
          actual: `plan ${resolution?.source ?? "none"}${resolution && "candidateId" in resolution ? ` ${resolution.candidateId}` : ""}, published ${published?.source ?? "none"}`,
        });
      } else if (!published && requirement.route_id === "global") {
        findings.push({
          id: "T07",
          placement,
          expected: `published ${assigned.id}`,
          actual: "not published",
        });
      }
      // T06 / T08: the published bytes are that client file — not another
      // supplied file (a swap) and not altered bytes (a modification) —
      // whatever source label the registry carries.
      if (published) {
        const got = digestOf(published);
        if (got !== inputDigests.get(assigned.id)) {
          findings.push({
            id: knownInput.has(got) ? "T06" : "T08",
            route: requirement.route_id,
            placement,
            expected: `the bytes of ${assigned.id}`,
            actual: got === "missing" ? `missing ${published.src}` : `sha256 ${got.slice(0, 12)}`,
          });
        }
      }
    }
    if (generated) {
      if (INV09_FACTUAL_ROLES.includes(role)) {
        findings.push({
          id: "T10",
          placement,
          expected: "a real client asset or unresolved",
          actual: "generated",
        });
      } else if (assigned) {
        findings.push({
          id: "T09",
          placement,
          expected: `no generation (client image ${assigned.id} was supplied)`,
          actual: "generated",
        });
      }
    }

    if (requirement.route_id === "global") continue;
    const fulfilled = Boolean(resolution && resolution.source !== "unresolved");
    if (!fulfilled && !published) continue;
    const bound = boundTo(placement);
    if (role === "hero") {
      // T05: a fulfilled hero is published and shown only in the route's hero section.
      const route = blueprintRoutes.get(requirement.route_id);
      const heroSection =
        (route && blueprintSectionRendering(route, "hero")) ?? requirement.section_id;
      const heroEmitted = (site.pages.get(requirement.route_id) ?? []).find(
        (section) => section.sectionId === heroSection,
      );
      const elsewhere = bound.filter((key) => key !== `${requirement.route_id}#${heroSection}`);
      const shown =
        heroEmitted?.name === "hero" ? true : bound.length === 1 && elsewhere.length === 0;
      if (resolution?.source !== "generated" || published) {
        if (!published || !shown || elsewhere.length > 0) {
          findings.push({
            id: "T05",
            route: requirement.route_id,
            sectionId: heroSection,
            placement,
            expected: `published and shown only in section ${heroSection}`,
            actual: !published
              ? "not in the published image registry"
              : `also bound to [${elsewhere.join(", ")}]`,
          });
        }
      }
    } else if (published) {
      // T06: a published slot image is bound once, to its own accepted section.
      const want = `${requirement.route_id}#${requirement.section_id}`;
      if (bound.length !== 1 || bound[0] !== want) {
        findings.push({
          id: "T06",
          route: requirement.route_id,
          sectionId: requirement.section_id,
          placement,
          expected: `bound once, to ${want}`,
          actual: `bound to [${bound.join(", ")}]`,
        });
      }
    } else if (resolution?.source !== "generated") {
      // A selected client or source-site image that never reached the registry.
      findings.push({
        id: "T06",
        route: requirement.route_id,
        sectionId: requirement.section_id,
        placement,
        expected: "published",
        actual: "not published",
      });
    }
  }

  // T10 everywhere: no published identity or factual imagery is synthetic,
  // including registry keys and gallery entries no requirement names.
  for (const [key, entry] of Object.entries(site.images)) {
    if (
      entry.source === "generated" &&
      INV09_FACTUAL_ROLES.includes(placementRole(key)) &&
      !requirements.has(key)
    ) {
      findings.push({
        id: "T10",
        placement: key,
        expected: "no synthetic asset published",
        actual: entry.src,
      });
    }
  }
  for (const entry of site.gallery) {
    if (entry.source === "generated") {
      findings.push({
        id: "T10",
        placement: "gallery",
        expected: "no synthetic gallery photo",
        actual: entry.src,
      });
    }
  }

  // T08 for the gallery inventory: every unplaced, non-logo client photo is
  // published once with its own bytes, and nothing else claims to be one.
  const unplaced = provided.filter(
    (image) =>
      !image.intendedPlacement &&
      !/(^|[^a-z0-9])logo($|[^a-z0-9])/i.test(`${image.id} ${image.path}`),
  );
  const galleryDigests = site.gallery.filter((entry) => entry.source === "provided").map(digestOf);
  for (const image of unplaced) {
    const want = inputDigests.get(image.id);
    if (want && galleryDigests.filter((digest) => digest === want).length !== 1) {
      findings.push({
        id: "T08",
        placement: `gallery:${image.id}`,
        expected: `${image.id} published once with its own bytes`,
        actual: `${galleryDigests.filter((digest) => digest === want).length} matching gallery file(s)`,
      });
    }
  }
  const expectedGallery = new Set(unplaced.map((image) => inputDigests.get(image.id)));
  for (const digest of galleryDigests) {
    if (!expectedGallery.has(digest)) {
      findings.push({
        id: "T08",
        placement: "gallery",
        expected: "only unplaced client photos, unchanged",
        actual: digest === "missing" ? "missing file" : `sha256 ${digest.slice(0, 12)}`,
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
