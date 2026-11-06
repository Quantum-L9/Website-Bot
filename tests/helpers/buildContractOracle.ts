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

/** Where a finding sits, for findings on an emitted section. */
interface SectionWhere {
  route: string;
  sectionId: string;
}

const ctaText = (cta: { label: string; href: string } | null): string =>
  cta ? `"${cta.label}" → ${JSON.stringify(cta.href)}` : "no CTA";

/** T03 (renderer): a section renders through the component its blueprint class names. */
function rendererFindings(
  where: SectionWhere,
  section: EmittedPageSection,
  componentClass: string | undefined,
): ContractFinding[] {
  if (!componentClass) return [];
  const want = plannedRenderer(componentClass);
  if (section.name === want) return [];
  return [
    { id: "T03", ...where, expected: `renderer ${want}`, actual: `renderer ${section.name}` },
  ];
}

/** T02 / T03 (blocks): the approved copy, verbatim, in its approved structure. */
function copyFindings(
  where: SectionWhere,
  got: EmittedPageSection["structured"],
  approved: StructuredContentRoute["sections"][number],
): ContractFinding[] {
  const sameHeads =
    got.heading === approved.heading &&
    got.eyebrow === approved.eyebrow &&
    got.subheading === approved.subheading;
  if (!sameHeads || blockText(got.blocks) !== blockText(approved.blocks)) {
    return [
      {
        id: "T02",
        ...where,
        expected: `${approved.heading ?? ""} | ${blockText(approved.blocks)}`,
        actual: `${got.heading ?? ""} | ${blockText(got.blocks)}`,
      },
    ];
  }
  if (JSON.stringify(got.blocks) === JSON.stringify(approved.blocks)) return [];
  return [
    {
      id: "T03",
      ...where,
      expected: approved.blocks.map((block) => block.kind).join(","),
      actual: got.blocks.map((block) => (block as { kind?: string }).kind ?? "?").join(","),
    },
  ];
}

/** T02 (FAQs): the route's approved FAQs reach the planned FAQ section, verbatim. */
function faqFindings(
  where: SectionWhere,
  got: EmittedPageSection["structured"],
  approvedFaqs: StructuredContentRoute["faqs"],
): ContractFinding[] {
  if (approvedFaqs.length === 0) return [];
  if (JSON.stringify(got.faqs ?? []) === JSON.stringify(approvedFaqs)) return [];
  const state = got.faqs ? "differs" : "missing";
  return [
    {
      id: "T02",
      ...where,
      expected: `${approvedFaqs.length} approved FAQ(s)`,
      actual: `${got.faqs?.length ?? 0} rendered FAQ(s), content ${state}`,
    },
  ];
}

/** T04: a CTA renders exactly when its approved action has a derivable destination. */
function ctaFindings(
  accepted: AcceptedInputs,
  where: SectionWhere,
  got: EmittedPageSection["structured"],
  approved: StructuredContentRoute["sections"][number],
): ContractFinding[] {
  const label = approved.cta?.label;
  const wantHref = approved.cta ? expectedCtaHref(accepted, approved.cta.action) : undefined;
  if (wantHref === undefined) {
    if (!got.cta) return [];
    const expected = "no link (no verified destination)";
    return [{ id: "T04", ...where, expected, actual: ctaText(got.cta) }];
  }
  if (got.cta?.href === wantHref && got.cta.label === label) return [];
  return [{ id: "T04", ...where, expected: `"${label}" → ${wantHref}`, actual: ctaText(got.cta) }];
}

/** T01–T04 for one blueprint route. */
function checkRoute(
  accepted: AcceptedInputs,
  route: WebsiteBlueprintRoute,
  emitted: readonly EmittedPageSection[],
  approvedRoute: StructuredContentRoute | undefined,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
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
  const content = new Map((approvedRoute?.sections ?? []).map((s) => [s.section_id, s]));
  const faqSection = blueprintSectionRendering(route, "faq");
  const planned = new Map(route.sections.map((s) => [s.section_id, s.component_class]));
  for (const section of emitted) {
    const where = { route: route.route_id, sectionId: section.sectionId };
    const got = section.structured;
    findings.push(...rendererFindings(where, section, planned.get(section.sectionId)));
    const approved = content.get(section.sectionId);
    if (!approved) {
      const actual = got.heading ?? "(copy)";
      findings.push({ id: "T02", ...where, expected: "no unapproved copy", actual });
      continue;
    }
    findings.push(...copyFindings(where, got, approved));
    if (section.sectionId === faqSection) {
      findings.push(...faqFindings(where, got, approvedRoute?.faqs ?? []));
    }
    findings.push(...ctaFindings(accepted, where, got, approved));
  }
  return findings;
}

/** T01–T04: the pages execute the blueprint and carry the approved copy. */
function checkPages(accepted: AcceptedInputs, site: AssembledSite): ContractFinding[] {
  const approved = new Map<string, StructuredContentRoute>(
    accepted.contentPackage.payload.routes.map((route) => [route.route_id, route]),
  );
  return accepted.blueprint.payload.routes.flatMap((route) =>
    checkRoute(accepted, route, site.pages.get(route.route_id) ?? [], approved.get(route.route_id)),
  );
}

/** Everything the image checks derive from the accepted inputs, computed once. */
interface ImageScope {
  site: AssembledSite;
  provided: ProvidedImage[];
  assignedTo: Map<string, ProvidedImage>;
  planned: Map<string, ImageAssetPlan["assets"][number]>;
  inputDigests: Map<string, string>;
  knownInput: Set<string>;
  blueprintRoutes: Map<string, WebsiteBlueprintRoute>;
}

type ProvidedImage = NonNullable<NonNullable<DomainSpec["assets"]>["providedImages"]>[number];
type Requirement = VisualRequirement;
type Resolution = ImageAssetPlan["assets"][number]["resolution"] | undefined;

function imageScope(
  accepted: AcceptedInputs,
  site: AssembledSite,
  plan: ImageAssetPlan | undefined,
): ImageScope {
  const provided = accepted.domainSpec.assets?.providedImages ?? [];
  const inputDigests = new Map(
    provided
      .filter((image) => existsSync(inputPath(image.path)))
      .map((image) => [image.id, sha256(readFileSync(inputPath(image.path)))]),
  );
  return {
    site,
    provided,
    assignedTo: new Map(
      provided
        .filter((image) => image.intendedPlacement)
        .map((image) => [image.intendedPlacement as string, image]),
    ),
    planned: new Map((plan?.assets ?? []).map((asset) => [asset.placement, asset])),
    inputDigests,
    knownInput: new Set(inputDigests.values()),
    blueprintRoutes: new Map(accepted.blueprint.payload.routes.map((r) => [r.route_id, r])),
  };
}

/** The bytes actually published for a registry entry ("missing" when absent). */
function publishedDigest(site: AssembledSite, entry: RegistryEntry): string {
  const file = join(site.outputDir, "public", entry.src);
  return existsSync(file) ? sha256(readFileSync(file)) : "missing";
}

/** Every emitted section (`<route>#<section>`) a placement is bound to. */
function boundTo(site: AssembledSite, placement: string): string[] {
  return [...site.pages.entries()].flatMap(([slug, sections]) =>
    sections
      .filter((section) => section.imagePlacement === placement)
      .map((section) => `${slug}#${section.sectionId}`),
  );
}

function describeResolution(resolution: Resolution): string {
  if (!resolution) return "none";
  const candidate = "candidateId" in resolution ? ` ${resolution.candidateId}` : "";
  return `${resolution.source}${candidate}`;
}

/** T07, then T06/T08: an assigned client image is selected, published, and byte-identical. */
function assignmentFindings(
  scope: ImageScope,
  placement: string,
  requirement: Requirement,
  assigned: ProvidedImage,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const resolution = scope.planned.get(placement)?.resolution;
  const published = scope.site.images[placement];
  const selected =
    resolution?.source === "provided" &&
    "candidateId" in resolution &&
    resolution.candidateId === assigned.id;
  if (!selected || (published && published.source !== "provided")) {
    findings.push({
      id: "T07",
      placement,
      expected: `provided ${assigned.id}`,
      actual: `plan ${describeResolution(resolution)}, published ${published?.source ?? "none"}`,
    });
  } else if (!published && requirement.route_id === "global") {
    const expected = `published ${assigned.id}`;
    findings.push({ id: "T07", placement, expected, actual: "not published" });
  }
  // The published bytes are that client file — not another supplied file (a
  // swap, T06) and not altered bytes (a modification, T08) — whatever source
  // label the registry carries.
  if (!published) return findings;
  const got = publishedDigest(scope.site, published);
  if (got === scope.inputDigests.get(assigned.id)) return findings;
  findings.push({
    id: scope.knownInput.has(got) ? "T06" : "T08",
    route: requirement.route_id,
    placement,
    expected: `the bytes of ${assigned.id}`,
    actual: got === "missing" ? `missing ${published.src}` : `sha256 ${got.slice(0, 12)}`,
  });
  return findings;
}

/** T10 / T09: generated (by plan or registry) only where neither factual nor supplied. */
function generationFindings(
  scope: ImageScope,
  placement: string,
  assigned: ProvidedImage | undefined,
): ContractFinding[] {
  const generated =
    scope.planned.get(placement)?.resolution.source === "generated" ||
    scope.site.images[placement]?.source === "generated";
  if (!generated) return [];
  if (INV09_FACTUAL_ROLES.includes(placementRole(placement))) {
    const expected = "a real client asset or unresolved";
    return [{ id: "T10", placement, expected, actual: "generated" }];
  }
  if (!assigned) return [];
  const expected = `no generation (client image ${assigned.id} was supplied)`;
  return [{ id: "T09", placement, expected, actual: "generated" }];
}

/** T05: a fulfilled hero is published and shown only in the route's hero section. */
function heroFindings(
  scope: ImageScope,
  placement: string,
  requirement: Requirement,
): ContractFinding[] {
  const resolution = scope.planned.get(placement)?.resolution;
  const published = scope.site.images[placement];
  // A generated hero not yet published is the generation stage's to produce.
  if (resolution?.source === "generated" && !published) return [];
  const route = scope.blueprintRoutes.get(requirement.route_id);
  const heroSection = (route && blueprintSectionRendering(route, "hero")) ?? requirement.section_id;
  const heroEmitted = (scope.site.pages.get(requirement.route_id) ?? []).find(
    (section) => section.sectionId === heroSection,
  );
  const bound = boundTo(scope.site, placement);
  const elsewhere = bound.filter((key) => key !== `${requirement.route_id}#${heroSection}`);
  const shown = heroEmitted?.name === "hero" || (bound.length === 1 && elsewhere.length === 0);
  if (published && shown && elsewhere.length === 0) return [];
  return [
    {
      id: "T05",
      route: requirement.route_id,
      sectionId: heroSection,
      placement,
      expected: `published and shown only in section ${heroSection}`,
      actual: published
        ? `also bound to [${elsewhere.join(", ")}]`
        : "not in the published image registry",
    },
  ];
}

/** T06: a published slot image is bound once, to its own accepted section. */
function slotBindingFindings(
  scope: ImageScope,
  placement: string,
  requirement: Requirement,
): ContractFinding[] {
  const where = {
    route: requirement.route_id,
    sectionId: requirement.section_id,
    placement,
  };
  if (!scope.site.images[placement]) {
    // A selected client or source-site image that never reached the registry.
    const generated = scope.planned.get(placement)?.resolution.source === "generated";
    return generated
      ? []
      : [{ id: "T06", ...where, expected: "published", actual: "not published" }];
  }
  const want = `${requirement.route_id}#${requirement.section_id}`;
  const bound = boundTo(scope.site, placement);
  if (bound.length === 1 && bound[0] === want) return [];
  return [
    {
      id: "T06",
      ...where,
      expected: `bound once, to ${want}`,
      actual: `bound to [${bound.join(", ")}]`,
    },
  ];
}

/** T05–T10 for one requirement placement. */
function placementFindings(
  scope: ImageScope,
  placement: string,
  requirement: Requirement,
): ContractFinding[] {
  const assigned = scope.assignedTo.get(placement);
  const findings = [
    ...(assigned ? assignmentFindings(scope, placement, requirement, assigned) : []),
    ...generationFindings(scope, placement, assigned),
  ];
  if (requirement.route_id === "global") return findings;
  const resolution = scope.planned.get(placement)?.resolution;
  const fulfilled = resolution !== undefined && resolution.source !== "unresolved";
  if (!fulfilled && !scope.site.images[placement]) return findings;
  if (placementRole(placement) === "hero") {
    findings.push(...heroFindings(scope, placement, requirement));
  } else {
    findings.push(...slotBindingFindings(scope, placement, requirement));
  }
  return findings;
}

/**
 * T10 everywhere: no published identity or factual imagery is synthetic,
 * including registry keys and gallery entries no requirement names.
 */
function unnamedSyntheticFindings(
  site: AssembledSite,
  requirements: ReadonlyMap<string, Requirement>,
): ContractFinding[] {
  const registry = Object.entries(site.images)
    .filter(
      ([key, entry]) =>
        entry.source === "generated" &&
        INV09_FACTUAL_ROLES.includes(placementRole(key)) &&
        !requirements.has(key),
    )
    .map(
      ([key, entry]): ContractFinding => ({
        id: "T10",
        placement: key,
        expected: "no synthetic asset published",
        actual: entry.src,
      }),
    );
  const gallery = site.gallery
    .filter((entry) => entry.source === "generated")
    .map(
      (entry): ContractFinding => ({
        id: "T10",
        placement: "gallery",
        expected: "no synthetic gallery photo",
        actual: entry.src,
      }),
    );
  return [...registry, ...gallery];
}

/**
 * T08 for the gallery inventory: every unplaced, non-logo client photo is
 * published once with its own bytes, and nothing else claims to be one.
 */
function galleryFindings(scope: ImageScope): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const unplaced = scope.provided.filter(
    (image) =>
      !image.intendedPlacement &&
      !/(^|[^a-z0-9])logo($|[^a-z0-9])/i.test(`${image.id} ${image.path}`),
  );
  const digests = scope.site.gallery
    .filter((entry) => entry.source === "provided")
    .map((entry) => publishedDigest(scope.site, entry));
  for (const image of unplaced) {
    const want = scope.inputDigests.get(image.id);
    const matches = digests.filter((digest) => digest === want).length;
    if (want && matches !== 1) {
      findings.push({
        id: "T08",
        placement: `gallery:${image.id}`,
        expected: `${image.id} published once with its own bytes`,
        actual: `${matches} matching gallery file(s)`,
      });
    }
  }
  const expected = new Set(unplaced.map((image) => scope.inputDigests.get(image.id)));
  for (const digest of digests.filter((value) => !expected.has(value))) {
    findings.push({
      id: "T08",
      placement: "gallery",
      expected: "only unplaced client photos, unchanged",
      actual: digest === "missing" ? "missing file" : `sha256 ${digest.slice(0, 12)}`,
    });
  }
  return findings;
}

/** T05–T10: images are chosen, placed and published as the inputs require. */
function checkImages(
  accepted: AcceptedInputs,
  site: AssembledSite,
  plan: ImageAssetPlan | undefined,
): ContractFinding[] {
  const requirements = requirementPlacements(accepted.blueprint.payload.visual_requirements);
  const scope = imageScope(accepted, site, plan);
  return [
    ...[...requirements].flatMap(([placement, requirement]) =>
      placementFindings(scope, placement, requirement),
    ),
    ...unnamedSyntheticFindings(site, requirements),
    ...galleryFindings(scope),
  ];
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
  return [...new Set(findings.map((finding) => finding.id))].sort((a, b) => a.localeCompare(b));
}
