// L9_META: layer=stage, role=site_materializer, stage_index=6, status=active, version=2.1.0
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { StructuredContentRoute, VisualRequirement } from "@quantum-l9/bot-interop";
import {
  isRegisteredSection,
  isSectionLayoutVariant,
  LAYOUT_TEMPLATE_PREFIX,
  resolveSectionRenderer,
  SECTION_LAYOUT_VARIANTS,
  type SectionLayoutVariant,
  type StructuredSectionView,
} from "../../astro_template/src/components/SectionRegistry.js";
import { createModuleLogger } from "../core/logger.js";
import { slotsForSpecComponent } from "../intelligence/WebsiteBuildBlueprintCompiler.js";
import type {
  BuildContext,
  DeployTarget,
  DomainSpec,
  SiteConfig,
  SiteImageEntry,
} from "../pipeline/BuildContext.js";
import { BuildError } from "../pipeline/BuildError.js";
import type { EvidenceKind } from "../pipeline/evidence/EvidenceReference.js";
import type { Stage } from "../pipeline/PipelineRunner.js";
import {
  firstSourcePhone,
  isTopNavHref,
  topNavFromSource,
} from "../services/content/sourceCopy.js";
import { digestDirectory } from "../services/hashing.js";
import {
  isBrandMarkCandidate,
  placementRole,
  placementSectionId,
  routeSlugFromPlacement,
} from "../services/images/ImageAssetPlanner.js";
import { EXTENSION_BY_MIME, inspectImage } from "../services/images/ImageInspector.js";
import {
  buildAssemblyManifest,
  normalizeComponentName,
  normalizeRouteSlug,
  normalizeSiteUrl,
  pagePathForRoute,
  safeChild,
  safePathSegment,
  validateRouteContracts,
  writeAssemblyManifest,
} from "../validation/validate-generated-site.js";
import {
  type JoinedRedesignRoute,
  joinRedesignRoutes,
} from "./StructuredContentProjectionStage.js";

function colorSchemeFromBackground(background: string | undefined): "dark" | "light" {
  const raw = (background ?? "#ffffff").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : "";
  if (hex.length < 6) return "light";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return "light";
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.45 ? "dark" : "light";
}

const logger = createModuleLogger("stage:site-assembler");
const json = (value: unknown) => JSON.stringify(value, null, 2);
const ASTRO_VERSION = "5.16.9";
const ASTRO_CHECK_VERSION = "0.9.4";
const ASTRO_SITEMAP_VERSION = "3.7.3";
const TYPESCRIPT_VERSION = "5.8.3";
const TEMPLATE_ROOT = resolve(process.cwd(), "astro_template");

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveGeneratorVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version ? parsed.version : "Unknown";
  } catch {
    return "Unknown";
  }
}

function normalizeHttpsUrl(value: unknown, field: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BuildError("VALIDATION_FAILED", `${field} must be a valid URL`);
  }
  if (parsed.protocol !== "https:")
    throw new BuildError("VALIDATION_FAILED", `${field} must use HTTPS`);
  return parsed.toString();
}

interface RouteHead {
  title: string;
  description: string;
}

/**
 * Sections that never take a bound content image: the hero renders its own
 * image, forms/confirmations/CTAs/notices/FAQs are not visual regions, and the
 * gallery takes only gallery or project-proof imagery.
 */
const IMAGE_INELIGIBLE_SECTIONS = new Set([
  "hero",
  "contact_form",
  "confirmation",
  "cta",
  "final_cta",
  "compliance_note",
  "disclaimer",
  "faq",
  "gallery",
]);

/**
 * Planner role → the blueprint content slot whose section owns that role. The
 * blueprint derives these roles from the same content slots
 * (WebsiteBuildBlueprintCompiler.deriveVisualRequirements), so binding back
 * through slotsForSpecComponent reuses its vocabulary instead of a second one.
 */
const ROLE_CONTENT_SLOT: Readonly<Record<string, string>> = {
  service: "service_overview",
  trust: "trust",
  project_proof: "project_proof",
  gallery: "project_proof",
};

/** An unplaced image the gallery may show, copied unchanged from `path`. */
interface GalleryExtra {
  fileName: string;
  path: string;
  alt: string;
  width: number;
  height: number;
  sha256: string;
  source: "provided" | "source-site";
}

/** A file-name-safe stem for a provided image id. */
function safeFileStem(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "image"
  );
}

/** One route's sections and the image placement bound to each. */
interface RouteImageSlots {
  slug: string;
  components: string[];
  names: string[];
  /** REDESIGN_IMPROVE: blueprint section identity per section. */
  sectionIds?: string[];
  /** REDESIGN_IMPROVE: blueprint content slots per section. */
  slots?: string[][];
  bound: Array<string | null>;
}

/** One section to assemble, as the image binder sees it. */
interface AssemblySectionTarget {
  name: string;
  component: string;
  sectionId?: string;
  slots?: string[];
}

/**
 * One REDESIGN_IMPROVE section to render (WB-GLUE-01): blueprint identity and
 * order, the existing renderer that realizes its component class, the
 * accepted structured copy, and its legacy text projection. Assembly-local;
 * never serialized as an interop artifact.
 */
interface RedesignAssemblySection {
  sectionId: string;
  name: string;
  component: string;
  slots: string[];
  layout: SectionLayoutVariant | null;
  content: string;
  structured: StructuredSectionView;
}

interface RedesignRoutePlan {
  slug: string;
  sections: RedesignAssemblySection[];
  relatedLinks: Array<{ href: string; label: string }>;
}

/** Comparable form of a conversion action name ("Request a Quote" ≡ "request_quote"). */
function actionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export class SiteAssemblerStage implements Stage {
  name = "site-assembler";
  version = "3.7.0";
  evidence = {
    // A site with planned images consumes the delivered image_assets evidence
    // (written by planning/generation) before it materializes public/images.
    // The resolved image plan is the authority: a blueprint-only redesign has
    // planned images but no spec-declared slots, and keying on spec slots alone
    // let a resumed assembly ignore changed image assets. Spec slots still
    // count so a build whose plan is absent keeps its prior dependency.
    inputs: (ctx: BuildContext): EvidenceKind[] =>
      ctx.dryRun ||
      ((ctx.imageAssetPlan?.assets.length ?? 0) === 0 &&
        (ctx.domainSpec.assets?.imageSlots ?? []).length === 0)
        ? []
        : ["image_assets"],
    outputs: (_ctx: BuildContext) => ["assembly" as const],
    resumable: true,
    externalMutation: false,
  };

  // Injectable seam over `renameSync` so the atomic swap/rollback path is deterministically testable.
  constructor(private readonly rename: (from: string, to: string) => void = renameSync) {}

  /**
   * WB-GLUE-01: a REDESIGN_IMPROVE assembly consumes the accepted blueprint,
   * page content contract and structured content package, none of which is
   * checkpointed evidence; a resumed build re-acquires them. Its checkpoint
   * therefore cannot prove the pages current, so it always reassembles rather
   * than reusing pages built from earlier content. COPY keeps its resume.
   */
  async canResume(ctx: BuildContext): Promise<boolean> {
    return ctx.buildIntent !== "REDESIGN_IMPROVE";
  }

  async run(ctx: BuildContext): Promise<void> {
    this.validateInputs(ctx);
    const routeSlugs = validateRouteContracts(ctx.domainSpec.routes);
    const outputDir = this.resolveOutputDir(ctx);
    const siteConfig = this.buildSiteConfig(ctx, routeSlugs);
    const template = this.templateIdentity();
    ctx.siteConfig = siteConfig;
    ctx.deployTarget = this.resolveDeployTarget(ctx);

    if (ctx.dryRun) {
      logger.info(
        {
          outputDir,
          routes: routeSlugs.length,
          templateVersion: template.version,
          templateDigest: template.digest,
        },
        "[dry-run] Would atomically materialize Astro project",
      );
      return;
    }

    const temporaryParent = resolve(dirname(outputDir), ".tmp");
    mkdirSync(temporaryParent, { recursive: true });
    const temporaryRoot = mkdtempSync(
      join(temporaryParent, `${safePathSegment(ctx.buildId, "buildId")}-`),
    );
    const backupRoot = `${outputDir}.backup-${safePathSegment(ctx.buildId, "buildId")}`;
    rmSync(backupRoot, { recursive: true, force: true });

    try {
      this.writeProject(temporaryRoot, ctx, siteConfig, template.root);
      const manifest = buildAssemblyManifest(
        temporaryRoot,
        ctx.buildId,
        ctx.clientId,
        resolveGeneratorVersion(),
        ctx.domainSpec.routes,
        template.version,
        template.digest,
      );
      writeAssemblyManifest(temporaryRoot, manifest);

      mkdirSync(dirname(outputDir), { recursive: true });
      if (existsSync(outputDir)) this.rename(outputDir, backupRoot);
      try {
        this.rename(temporaryRoot, outputDir);
      } catch (error) {
        if (existsSync(backupRoot) && !existsSync(outputDir)) this.rename(backupRoot, outputDir);
        throw error;
      }
      rmSync(backupRoot, { recursive: true, force: true });
      manifest.generatedAt = new Date().toISOString();
      manifest.outputDir = outputDir;
      ctx.assemblyManifest = manifest;
      await ctx.evidenceStore.writeAssembly(manifest);
      logger.info(
        { outputDir, routes: routeSlugs.length, sourceDigest: manifest.sourceDigest },
        "Astro site materialized",
      );
    } catch (error) {
      rmSync(temporaryRoot, { recursive: true, force: true });
      if (error instanceof BuildError) throw error;
      throw new BuildError(
        "SITE_ASSEMBLY_FAILED",
        `Unable to materialize Astro site: ${String(error)}`,
      );
    }
  }

  private templateIdentity(): { root: string; version: string; digest: string } {
    if (!existsSync(TEMPLATE_ROOT))
      throw new BuildError(
        "SITE_ASSEMBLY_FAILED",
        `Canonical Astro template is missing: ${TEMPLATE_ROOT}`,
      );
    const versionPath = join(TEMPLATE_ROOT, "TEMPLATE_VERSION");
    if (!existsSync(versionPath))
      throw new BuildError("SITE_ASSEMBLY_FAILED", "astro_template/TEMPLATE_VERSION is required");
    const version = readFileSync(versionPath, "utf-8").trim();
    if (!/^\d+\.\d+\.\d+$/.test(version))
      throw new BuildError("SITE_ASSEMBLY_FAILED", `Invalid Astro template version: ${version}`);
    const digest = digestDirectory(TEMPLATE_ROOT).digest;
    return { root: TEMPLATE_ROOT, version, digest };
  }

  private resolveOutputDir(ctx: BuildContext): string {
    safePathSegment(ctx.clientId, "clientId");
    const configured = ctx.outputDir.trim() || join("build", "sites", ctx.clientId);
    const resolved = resolve(configured);
    ctx.outputDir = resolved;
    return resolved;
  }

  private validateInputs(ctx: BuildContext): void {
    if (!ctx.domainSpec.business_name?.trim())
      throw new BuildError("MISSING_INPUT", "domainSpec.business_name is required");
    if (!ctx.domainSpec.client_id?.trim())
      throw new BuildError("MISSING_INPUT", "domainSpec.client_id is required");
    if (ctx.domainSpec.client_id !== ctx.clientId) {
      throw new BuildError(
        "VALIDATION_FAILED",
        `BuildContext clientId (${ctx.clientId}) does not match DomainSpec (${ctx.domainSpec.client_id})`,
      );
    }
    if (
      !ctx.domainSpec.geography?.primary_state ||
      !Array.isArray(ctx.domainSpec.geography.states)
    ) {
      throw new BuildError("MISSING_INPUT", "domainSpec.geography is required");
    }
    if (!ctx.dryRun && !ctx.designTokens)
      throw new BuildError(
        "MISSING_INPUT",
        "Validated design tokens are required before site assembly",
      );
    validateRouteContracts(ctx.domainSpec.routes);
    const redesign = ctx.buildIntent === "REDESIGN_IMPROVE";
    // A REDESIGN_IMPROVE run checks layout realizability against the blueprint
    // sections (redesignPlans); a dry run without them keeps the spec check.
    if (!redesign || ctx.dryRun) {
      for (const [index, route] of ctx.domainSpec.routes.entries()) this.routeLayout(route, index);
    }
    this.assertNoPretendInquiry(ctx);
    if (!ctx.dryRun) {
      if (redesign) {
        this.routeHeads(ctx);
        // REDESIGN_IMPROVE content comes from the accepted blueprint + content
        // package joined by section identity, never from component-keyed copy.
        this.redesignPlans(ctx);
      } else {
        this.assertRouteContentAvailable(ctx);
        this.routeHeads(ctx);
      }
    }
  }

  /**
   * Route <head> title and description, in spec route order (WB-FACTORY-05).
   * COPY keeps the legacy route-title head. REDESIGN_IMPROVE takes both
   * verbatim from the accepted SEO-Bot StructuredContentPackage, bound by route
   * identity and path; a missing, duplicate, mismatched or invalid producer
   * route fails assembly instead of falling back to a synthesized description.
   */
  private routeHeads(ctx: BuildContext): RouteHead[] {
    const routes = ctx.domainSpec.routes;
    if (ctx.buildIntent !== "REDESIGN_IMPROVE") {
      return routes.map((route) => ({
        title: route.title,
        description: `${route.title} | ${ctx.domainSpec.business_name}`,
      }));
    }
    const contentPackage = ctx.structuredContentPackage;
    if (!contentPackage) {
      throw new BuildError(
        "REDESIGN_PIPELINE_INCOMPLETE",
        "seo-metadata: REDESIGN_IMPROVE site assembly requires the accepted StructuredContentPackage",
      );
    }
    const produced = new Map<string, StructuredContentRoute>();
    for (const structured of contentPackage.payload.routes) {
      if (produced.has(structured.route_id)) {
        throw new BuildError(
          "ROUTE_SET_MISMATCH",
          `seo-metadata: StructuredContentPackage carries duplicate route ${JSON.stringify(structured.route_id)}`,
        );
      }
      produced.set(structured.route_id, structured);
    }
    const specRouteIds = new Set(routes.map((route) => route.slug));
    for (const routeId of produced.keys()) {
      if (!specRouteIds.has(routeId)) {
        throw new BuildError(
          "ROUTE_SET_MISMATCH",
          `seo-metadata: StructuredContentPackage route ${JSON.stringify(routeId)} is not a spec route`,
        );
      }
    }
    return routes.map((route, index) => {
      const source = `domainSpec.routes[${index}] (${normalizeRouteSlug(route.slug)})`;
      const structured = produced.get(route.slug);
      if (!structured) {
        throw new BuildError(
          "ROUTE_SET_MISMATCH",
          `seo-metadata: StructuredContentPackage carries no route for ${source}`,
        );
      }
      if (structured.path !== route.slug) {
        throw new BuildError(
          "ROUTE_SET_MISMATCH",
          `seo-metadata: StructuredContentPackage route ${JSON.stringify(structured.route_id)} has path ${JSON.stringify(structured.path)}; ${source} requires ${JSON.stringify(route.slug)}`,
        );
      }
      const metadata = structured.metadata as Partial<RouteHead> | undefined;
      const title = metadata?.title;
      const description = metadata?.description;
      if (
        typeof title !== "string" ||
        !title.trim() ||
        typeof description !== "string" ||
        !description.trim()
      ) {
        throw new BuildError(
          "VALIDATION_FAILED",
          `seo-metadata: StructuredContentPackage route for ${source} has no valid metadata title and description`,
        );
      }
      return { title, description };
    });
  }

  /**
   * Opt-in static layout explicitly requested through the existing
   * `route.template` field (WB-QAP-01). Only `layout:`-prefixed values are
   * layout requests; page-type templates (`homepage`, `service_page`, …) select
   * nothing and keep legacy rendering. A request this template cannot realize
   * fails assembly with a source-bound finding instead of rendering generic
   * prose as if it had been honored.
   */
  private routeLayout(
    route: DomainSpec["routes"][number],
    index: number,
    sectionNames: string[] = route.components.map((component) => normalizeComponentName(component)),
  ): SectionLayoutVariant | undefined {
    // The spec validator does not type-check this optional field; a non-string
    // value was ignored before layouts existed and stays a non-request.
    const template = typeof route.template === "string" ? route.template.trim() : undefined;
    if (!template?.toLowerCase().startsWith(LAYOUT_TEMPLATE_PREFIX)) return undefined;
    const variant = template.slice(LAYOUT_TEMPLATE_PREFIX.length).trim().toLowerCase();
    const source = `domainSpec.routes[${index}].template ${JSON.stringify(template)} on ${normalizeRouteSlug(route.slug)}`;
    if (!isSectionLayoutVariant(variant)) {
      const supported = SECTION_LAYOUT_VARIANTS.map((name) => `${LAYOUT_TEMPLATE_PREFIX}${name}`);
      throw new BuildError(
        "VALIDATION_FAILED",
        `unsupported-layout: ${source} is not a supported layout (supported: ${supported.join(", ")})`,
      );
    }
    if (sectionNames.every((name) => isRegisteredSection(name))) {
      throw new BuildError(
        "VALIDATION_FAILED",
        `unsupported-layout: ${source} cannot be realized; the route has no generic section for the layout to arrange`,
      );
    }
    return variant;
  }

  /**
   * REDESIGN_IMPROVE section plan per canonical route (WB-GLUE-01): the
   * blueprint's sections in blueprint order, each realized by an existing
   * renderer and carrying its accepted structured copy by section identity.
   * A missing redesign artifact, an unjoinable identity, or a component class
   * this template cannot realize fails assembly; it never falls back to
   * component-keyed legacy copy or silent prose.
   */
  private redesignPlans(ctx: BuildContext): RedesignRoutePlan[] {
    const joined = joinRedesignRoutes(ctx);
    const routeSlugs = new Set(
      ctx.domainSpec.routes.map((route) => normalizeRouteSlug(route.slug)),
    );
    const primaryActions = new Set(
      [
        ctx.domainSpec.conversion_authority?.primary_action,
        ctx.websiteBlueprint?.payload.conversion.primary_action,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim() !== "")
        .map(actionKey),
    );
    const primaryCta = this.primaryCta(ctx);
    return joined.map((route, index) => {
      const specRoute = ctx.domainSpec.routes[index];
      const where = `route ${JSON.stringify(route.routeId)}`;
      let faqsAttached = false;
      let serviceGridShown = false;
      const sections = route.sections.map((section): RedesignAssemblySection => {
        const component = section.blueprint.component_class;
        const resolution = resolveSectionRenderer(normalizeComponentName(component));
        const source = `${where} section ${JSON.stringify(section.sectionId)} requests component_class ${JSON.stringify(component)}`;
        if (resolution.kind === "unsupported") {
          throw new BuildError(
            "SITE_ASSEMBLY_FAILED",
            `unsupported-section-renderer: ${source}; this template has no component for ${JSON.stringify(resolution.token)} and will not substitute prose`,
          );
        }
        if (resolution.kind === "ambiguous") {
          throw new BuildError(
            "SITE_ASSEMBLY_FAILED",
            `ambiguous-section-renderer: ${source}; candidate renderers: ${resolution.candidates.join(", ")}`,
          );
        }
        const name =
          resolution.kind === "registered" ? resolution.name : normalizeComponentName(component);
        const structured = section.structured;
        const view: StructuredSectionView = {
          sectionId: section.sectionId,
          ...(structured.eyebrow !== undefined ? { eyebrow: structured.eyebrow } : {}),
          ...(structured.heading !== undefined ? { heading: structured.heading } : {}),
          ...(structured.subheading !== undefined ? { subheading: structured.subheading } : {}),
          blocks: structured.blocks,
          cta: structured.cta
            ? this.resolveSectionCta(structured.cta, routeSlugs, primaryActions, primaryCta)
            : null,
          ...(name === "faq" && !faqsAttached && route.structured.faqs.length > 0
            ? { faqs: route.structured.faqs }
            : {}),
          ...(name === "services_overview" && serviceGridShown ? { serviceCards: false } : {}),
        };
        if (name === "faq") faqsAttached = true;
        if (name === "services_overview") serviceGridShown = true;
        return {
          sectionId: section.sectionId,
          name,
          component,
          slots: [...section.blueprint.content_slots],
          layout: resolution.kind === "layout" ? resolution.layout : null,
          content: this.lookupRedesignContent(ctx, route, section.sectionId),
          structured: view,
        };
      });
      const heroes = sections.filter((section) => section.name === "hero");
      if (heroes.length > 1) {
        throw new BuildError(
          "SITE_ASSEMBLY_FAILED",
          `duplicate-hero: ${where} plans ${heroes.length} hero sections (${heroes.map((hero) => hero.sectionId).join(", ")}); a page has exactly one H1`,
        );
      }
      // A route-level `layout:` request arranges the generic sections only.
      const routeLayout = this.routeLayout(
        specRoute,
        index,
        sections.map((section) => section.name),
      );
      if (routeLayout) {
        for (const section of sections) {
          if (!isRegisteredSection(section.name) && section.layout === null) {
            section.layout = routeLayout;
          }
        }
      }
      return {
        slug: normalizeRouteSlug(route.routeId),
        sections,
        relatedLinks: this.relatedLinks(route, routeSlugs),
      };
    });
  }

  /** The projected legacy text for a redesign section, keyed by section identity. */
  private lookupRedesignContent(
    ctx: BuildContext,
    route: JoinedRedesignRoute,
    sectionId: string,
  ): string {
    const content = ctx.generatedContent.get(`${route.routeId}:${sectionId}`);
    if (content === undefined) {
      throw new BuildError(
        "SITE_ASSEMBLY_FAILED",
        `Missing projected content for ${normalizeRouteSlug(route.routeId)} section ${JSON.stringify(sectionId)}; structured-content-projection must run first`,
      );
    }
    return content;
  }

  /**
   * Resolve a content-package CTA to a verified destination, or null. The
   * package's `action` is not trusted as a URL: only a canonical spec route,
   * or the operator's primary action backed by a verified lead form
   * (primaryCta), resolves. No contact link, form endpoint or offer is ever
   * manufactured.
   */
  private resolveSectionCta(
    cta: { label: string; action: string },
    routeSlugs: Set<string>,
    primaryActions: Set<string>,
    primaryCta: { label: string; href: string } | null,
  ): { label: string; href: string } | null {
    const label = cta.label.trim();
    const action = cta.action.trim();
    if (!label || !action) return null;
    if (action.startsWith("/")) {
      const [path, fragment] = action.split("#", 2);
      let slug: string;
      try {
        slug = normalizeRouteSlug(path);
      } catch {
        return null;
      }
      if (!routeSlugs.has(slug)) return null;
      // A fragment is kept only when it is the verified form anchor.
      const href = fragment ? `${slug}#${fragment}` : slug;
      if (fragment && href !== primaryCta?.href) return { label, href: slug };
      return { label, href };
    }
    if (primaryCta && primaryActions.has(actionKey(action))) {
      return { label, href: primaryCta.href };
    }
    return null;
  }

  /** Route-level internal links that resolve to published canonical routes. */
  private relatedLinks(
    route: JoinedRedesignRoute,
    routeSlugs: Set<string>,
  ): Array<{ href: string; label: string }> {
    const self = normalizeRouteSlug(route.routeId);
    const links: Array<{ href: string; label: string }> = [];
    for (const link of route.structured.internal_links) {
      let href: string;
      try {
        href = normalizeRouteSlug(link.target_route_id);
      } catch {
        continue;
      }
      const label = link.anchor_text.trim();
      if (!label || href === self || !routeSlugs.has(href)) continue;
      if (links.some((existing) => existing.href === href)) continue;
      links.push({ href, label });
    }
    return links;
  }

  private assertRouteContentAvailable(ctx: BuildContext): void {
    for (const route of ctx.domainSpec.routes) {
      for (const component of route.components) {
        const normalized = normalizeComponentName(component);
        if (normalized === "contact_form" && this.leadFormAction(ctx)) continue;
        if (normalized === "gallery") continue;
        if (this.lookupContent(ctx, route.slug, component) === undefined) {
          throw new BuildError(
            "SITE_ASSEMBLY_FAILED",
            `Missing generated content for ${normalizeRouteSlug(route.slug)}:${component}`,
          );
        }
      }
    }
  }

  private buildSiteConfig(ctx: BuildContext, routeSlugs: string[]): SiteConfig {
    const seo = ctx.domainSpec.seo_contract ?? {};
    const rawSiteUrl = seo.site_url ?? process.env.SITE_URL;
    if (typeof rawSiteUrl !== "string" || !rawSiteUrl.trim()) {
      throw new BuildError(
        "MISSING_INPUT",
        "seo_contract.site_url or SITE_URL is required for site assembly",
      );
    }
    const siteUrl = normalizeSiteUrl(rawSiteUrl);
    const perRoute: Record<string, object[]> = Object.fromEntries(
      routeSlugs.map((slug) => [slug, []]),
    );
    const siteWide: object[] = [];
    for (const [key, schema] of ctx.generatedSchemas) {
      if (key === "FAQPage") {
        const faqRoute =
          ctx.domainSpec.routes.find((route) =>
            normalizeComponentName(route.components.join("_")).includes("faq"),
          ) ?? ctx.domainSpec.routes.find((route) => normalizeRouteSlug(route.slug) === "/faq");
        if (faqRoute) perRoute[normalizeRouteSlug(faqRoute.slug)].push(schema);
        else siteWide.push(schema);
      } else {
        siteWide.push(schema);
      }
    }

    return {
      businessName: ctx.domainSpec.business_name,
      siteUrl,
      vertical: ctx.domainSpec.vertical,
      clientId: ctx.clientId,
      namespace: slugify(ctx.clientId) || "client",
      geography: {
        primaryState: ctx.domainSpec.geography.primary_state,
        states: [...ctx.domainSpec.geography.states],
      },
      nav: (() => {
        const fromSource = topNavFromSource(ctx.sourceSiteManifest);
        if (fromSource.length) return fromSource;
        return ctx.domainSpec.routes
          .filter((route) => !route.noindex && isTopNavHref(route.slug))
          .map((route) => ({ href: normalizeRouteSlug(route.slug), label: route.title }));
      })(),
      routes: ctx.domainSpec.routes
        .filter((route) => !route.noindex)
        .map((route) => ({ href: normalizeRouteSlug(route.slug), title: route.title })),
      schemas: { siteWide, perRoute },
      designTokens: ctx.designTokens ?? {},
      // JSON.stringify drops undefined keys, so the emitted `as const` site
      // config would lose phone/leadFormAction entirely for phone-less,
      // form-less clients and astro check would fail on the template
      // components that read them (live run: quantumaipartners_com — 7
      // ts(2339) errors across LeadForm, CtaBanner, Hero, BaseLayout).
      // Empty strings keep the keys present; the components either guard
      // truthiness or are only rendered when a real value exists.
      leadFormAction: this.leadFormAction(ctx) ?? "",
      phone:
        ctx.domainSpec.seo_contract?.phone?.trim() ||
        firstSourcePhone(ctx.sourceSiteManifest) ||
        "",
      images: this.buildImageRegistry(ctx),
      galleryImages: this.buildGalleryRegistry(ctx),
    };
  }

  /**
   * Public image registry keyed by placement. Only client-owned assets are
   * republished; reference-only or unknown-rights assets are intentionally
   * excluded so they never reach the generated site.
   */
  private buildImageRegistry(ctx: BuildContext): Record<string, SiteImageEntry> {
    const registry: Record<string, SiteImageEntry> = {};
    for (const asset of ctx.resolvedImages?.values() ?? []) {
      if (asset.disposition !== "approved-client-owned") continue;
      registry[asset.placement] = {
        src: `/images/${asset.outputFileName}`,
        alt: asset.altText,
        width: asset.width,
        height: asset.height,
        source: asset.source,
      };
    }
    return registry;
  }

  /**
   * Bind every published, route-scoped placement of the resolved image plan to
   * exactly one section of its route, so the renderer shows each image in the
   * section it was planned for. Global placements (logo, og-image) stay owned
   * by the layout.
   *
   * Pass 0 (REDESIGN_IMPROVE) binds by identity: the plan's slot_id names the
   * blueprint visual requirement, whose section_id is the intended section (a
   * section-qualified placement names it too). A hero placement goes to the
   * route's hero renderer when one exists, since Hero.astro renders it.
   * Pass 1 binds by role: hero → the hero section (Hero.astro renders it),
   * gallery → the gallery section, service/trust/project_proof → the first
   * section whose component carries the matching blueprint content slot.
   * Pass 2 gives a placement no section claimed by role to the first unbound
   * image-eligible section. One image per section; required placements bind
   * first. A placement naming no route, or a required placement with no
   * eligible section, fails assembly; an optional one is logged and omitted.
   *
   * Returns, per normalized route slug with at least one binding, the
   * placement bound to each section, aligned with that route's sections.
   */
  private bindSectionImages(
    ctx: BuildContext,
    config: SiteConfig,
    targets: Map<string, AssemblySectionTarget[]>,
  ): Map<string, Array<string | null>> {
    const published = config.images ?? {};
    const seen = new Set<string>();
    const planned = (ctx.imageAssetPlan?.assets ?? [])
      .filter((asset) => {
        if (seen.has(asset.placement)) return false;
        seen.add(asset.placement);
        return (
          published[asset.placement] !== undefined &&
          routeSlugFromPlacement(asset.placement) !== undefined
        );
      })
      .sort(
        (a, b) => Number(b.required) - Number(a.required) || a.placement.localeCompare(b.placement),
      );
    if (planned.length === 0) return new Map();

    const routes = new Map<string, RouteImageSlots>();
    for (const [slug, sections] of targets) {
      const identified = sections.every((section) => section.sectionId !== undefined);
      routes.set(slug, {
        slug,
        components: sections.map((section) => section.component),
        names: sections.map((section) => section.name),
        ...(identified
          ? {
              sectionIds: sections.map((section) => section.sectionId ?? ""),
              slots: sections.map((section) => section.slots ?? []),
            }
          : {}),
        bound: sections.map(() => null),
      });
    }

    const requirementSections = new Map<string, string>(
      (ctx.websiteBlueprint?.payload.visual_requirements ?? []).map((requirement) => [
        requirement.slot_id,
        requirement.section_id,
      ]),
    );
    const remaining = this.bindByIdentity(planned, routes, requirementSections);

    // Required placements bind completely (role pass, then fallback pass)
    // before any optional placement, so an optional role match can never take
    // the only section a required placement could fall back to.
    this.bindImageTier(
      remaining.filter((asset) => asset.required),
      routes,
    );
    this.bindImageTier(
      remaining.filter((asset) => !asset.required),
      routes,
    );

    const bindings = new Map<string, Array<string | null>>();
    for (const [slug, target] of routes) {
      if (target.bound.some((placement) => placement !== null)) bindings.set(slug, target.bound);
    }
    logger.info(
      {
        bindings: Object.fromEntries(
          [...bindings].map(([slug, bound]) => [
            slug,
            Object.fromEntries(
              bound.flatMap((placement, position) => {
                const target = routes.get(slug);
                const key = target?.sectionIds?.[position] ?? target?.names[position];
                return placement ? [[key ?? String(position), placement]] : [];
              }),
            ),
          ]),
        ),
      },
      "Section image placements bound",
    );
    return bindings;
  }

  /**
   * Pass 0: bind each placement whose intended blueprint section is known to
   * that section. Returns the placements left for the role/fallback passes —
   * those with no section identity, and required ones whose intended section
   * cannot show an image. An optional placement is never moved to a section
   * it was not planned for; it is logged and omitted instead.
   */
  private bindByIdentity(
    planned: ReadonlyArray<{ slotId: string; placement: string; required: boolean }>,
    routes: Map<string, RouteImageSlots>,
    requirementSections: Map<string, string>,
  ): Array<{ slotId: string; placement: string; required: boolean }> {
    const remaining: Array<{ slotId: string; placement: string; required: boolean }> = [];
    for (const asset of planned) {
      const target = this.imageRouteTarget(routes, asset.placement);
      const sectionId =
        requirementSections.get(asset.slotId) ?? placementSectionId(asset.placement);
      if (!target.sectionIds || sectionId === undefined) {
        remaining.push(asset);
        continue;
      }
      const role = placementRole(asset.placement);
      let index = role === "hero" ? target.names.indexOf("hero") : -1;
      if (index < 0) index = target.sectionIds.indexOf(sectionId);
      if (index < 0) {
        throw new BuildError(
          "SITE_ASSEMBLY_FAILED",
          `image-placement-unbound: ${asset.placement} (slot ${asset.slotId}) is planned for section ${JSON.stringify(sectionId)}, which ${target.slug} does not render`,
        );
      }
      const name = target.names[index];
      const eligible =
        name === "hero"
          ? role === "hero"
          : name === "gallery"
            ? role === "gallery" || role === "project_proof"
            : !IMAGE_INELIGIBLE_SECTIONS.has(name);
      if (eligible && target.bound[index] === null) {
        target.bound[index] = asset.placement;
        continue;
      }
      if (asset.required && !eligible) {
        remaining.push(asset);
        continue;
      }
      if (asset.required) {
        throw new BuildError(
          "SITE_ASSEMBLY_FAILED",
          `image-placement-conflict: ${asset.placement} is required in section ${JSON.stringify(sectionId)} on ${target.slug}, which already shows ${target.bound[index]}`,
        );
      }
      logger.warn(
        {
          placement: asset.placement,
          route: target.slug,
          section: sectionId,
          reason: eligible ? "section already shows an image" : "section takes no image",
        },
        "Optional image placement not rendered",
      );
    }
    return remaining;
  }

  /**
   * Bind one tier of placements: first each to a section owning its role, then
   * any still unclaimed to the first unbound image-eligible section. A required
   * placement left unbound fails assembly; an optional one is logged.
   */
  private bindImageTier(
    tier: ReadonlyArray<{ placement: string; required: boolean }>,
    routes: Map<string, RouteImageSlots>,
  ): void {
    const unclaimed: Array<{ placement: string; required: boolean }> = [];
    for (const asset of tier) {
      const target = this.imageRouteTarget(routes, asset.placement);
      const role = placementRole(asset.placement);
      const index = target.names.findIndex(
        (name, position) =>
          target.bound[position] === null &&
          this.sectionOwnsRole(name, target.components[position], role, target.slots?.[position]),
      );
      if (index >= 0) target.bound[index] = asset.placement;
      else unclaimed.push(asset);
    }
    for (const asset of unclaimed) {
      const target = this.imageRouteTarget(routes, asset.placement);
      const index = target.names.findIndex(
        (name, position) => target.bound[position] === null && !IMAGE_INELIGIBLE_SECTIONS.has(name),
      );
      if (index >= 0) {
        target.bound[index] = asset.placement;
        continue;
      }
      const role = placementRole(asset.placement);
      if (asset.required) {
        throw new BuildError(
          "SITE_ASSEMBLY_FAILED",
          `image-placement-unbound: ${asset.placement} (${role}) has no image-eligible section on ${target.slug}`,
        );
      }
      logger.warn(
        {
          placement: asset.placement,
          route: target.slug,
          role,
          reason: "no image-eligible section",
        },
        "Optional image placement not rendered",
      );
    }
  }

  /** The spec route a placement targets, or a fail-closed assembly error. */
  private imageRouteTarget(
    routes: Map<string, RouteImageSlots>,
    placement: string,
  ): RouteImageSlots {
    let slug: string | undefined;
    try {
      slug = normalizeRouteSlug(routeSlugFromPlacement(placement) ?? "");
    } catch {
      slug = undefined;
    }
    const target = slug === undefined ? undefined : routes.get(slug);
    if (!target) {
      throw new BuildError(
        "SITE_ASSEMBLY_FAILED",
        `image-placement-unbound: ${placement} targets no spec route`,
      );
    }
    return target;
  }

  private sectionOwnsRole(
    name: string,
    component: string,
    role: string,
    blueprintSlots?: readonly string[],
  ): boolean {
    if (role === "hero") return name === "hero";
    if (role === "gallery") return name === "gallery";
    const slot = ROLE_CONTENT_SLOT[role];
    if (!slot) return false;
    if (name === "gallery") return slot === "project_proof";
    if (IMAGE_INELIGIBLE_SECTIONS.has(name)) return false;
    return (blueprintSlots ?? (slotsForSpecComponent(component) as readonly string[])).includes(
      slot,
    );
  }

  /**
   * Images available to the gallery beyond those the plan placed: suitable
   * unused client-provided photos first (they outrank reuse), then unused
   * source-site photos. A provided image with an explicit intendedPlacement is
   * never moved here (it belongs where it was placed), brand marks never
   * become gallery photos, and an asset already shown elsewhere — by content
   * hash — is not repeated. Files are copied unchanged.
   */
  private galleryExtras(ctx: BuildContext): GalleryExtra[] {
    const used = new Set([...(ctx.resolvedImages?.values() ?? [])].map((asset) => asset.sha256));
    const extras: GalleryExtra[] = [];
    for (const spec of ctx.domainSpec.assets?.providedImages ?? []) {
      if (spec.intendedPlacement?.trim()) continue;
      if (
        isBrandMarkCandidate({
          sourceUrl: spec.path,
          altText: spec.altText,
          surroundingText: spec.id,
        })
      )
        continue;
      const path = isAbsolute(spec.path) ? spec.path : resolve(process.cwd(), spec.path);
      if (!existsSync(path)) continue;
      let inspected: ReturnType<typeof inspectImage>;
      try {
        inspected = inspectImage(readFileSync(path));
      } catch {
        continue;
      }
      if (used.has(inspected.sha256)) continue;
      used.add(inspected.sha256);
      const extension = EXTENSION_BY_MIME[inspected.mimeType] ?? (extname(path).slice(1) || "img");
      extras.push({
        fileName: `provided-${safeFileStem(spec.id)}.${extension}`,
        path,
        alt: spec.altText || "Project photo",
        width: inspected.width,
        height: inspected.height,
        sha256: inspected.sha256,
        source: "provided",
      });
    }
    for (const image of ctx.sourceSiteManifest?.images ?? []) {
      if (used.has(image.sha256)) continue;
      if (isBrandMarkCandidate(image)) continue;
      if (!existsSync(image.localPath)) continue;
      used.add(image.sha256);
      extras.push({
        fileName: `${image.id}${extname(image.localPath) || ".jpg"}`,
        path: image.localPath,
        alt: image.altText || image.surroundingText || "Project photo",
        width: image.width,
        height: image.height,
        sha256: image.sha256,
        source: "source-site",
      });
    }
    return extras;
  }

  private buildGalleryRegistry(ctx: BuildContext): SiteImageEntry[] {
    return this.galleryExtras(ctx).map((image) => ({
      src: `/images/gallery/${image.fileName}`,
      alt: image.alt,
      width: image.width,
      height: image.height,
      source: image.source,
    }));
  }

  /** Copy every registered image into the project's public/images/ directory. */
  private copyResolvedImages(root: string, ctx: BuildContext): void {
    if (!ctx.resolvedImages?.size) return;
    for (const asset of ctx.resolvedImages.values()) {
      if (asset.disposition !== "approved-client-owned") continue;
      if (!existsSync(asset.absolutePath)) {
        throw new BuildError(
          "SITE_ASSEMBLY_FAILED",
          `Resolved image missing on disk: ${asset.absolutePath}`,
        );
      }
      const target = safeChild(root, `public/images/${asset.outputFileName}`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(asset.absolutePath, target);
    }
    this.copyGalleryImages(root, ctx);
  }

  private copyGalleryImages(root: string, ctx: BuildContext): void {
    for (const image of this.galleryExtras(ctx)) {
      const target = safeChild(root, `public/images/gallery/${image.fileName}`);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(image.path, target);
    }
  }

  private leadFormAction(ctx: BuildContext): string | undefined {
    return normalizeHttpsUrl(
      ctx.domainSpec.seo_contract?.lead_form_action,
      "seo_contract.lead_form_action",
    );
  }

  /**
   * Primary call to action (WB-QAP-03). The label comes only from the
   * operator's conversion_authority; the destination is verified separately
   * and exists only when a verified lead form renders on a real route. A label
   * alone never manufactures a link, and there is no default offer text.
   */
  private primaryCta(ctx: BuildContext): { label: string; href: string } | null {
    const label = ctx.domainSpec.conversion_authority?.primary_action?.trim();
    if (!label || !this.leadFormAction(ctx)) return null;
    const formRoute = ctx.domainSpec.routes.find((route) =>
      route.components.some((component) => normalizeComponentName(component) === "contact_form"),
    );
    return formRoute ? { label, href: `${normalizeRouteSlug(formRoute.slug)}#quote` } : null;
  }

  /**
   * A confirmation section announces a received inquiry; without a verified
   * lead form action nothing can have been received (WB-QAP-03).
   */
  private assertNoPretendInquiry(ctx: BuildContext): void {
    if (this.leadFormAction(ctx)) return;
    for (const [index, route] of ctx.domainSpec.routes.entries()) {
      if (
        route.components.some((component) => normalizeComponentName(component) === "confirmation")
      )
        throw new BuildError(
          "VALIDATION_FAILED",
          `pretend-inquiry: domainSpec.routes[${index}] (${normalizeRouteSlug(route.slug)}) renders a confirmation section but seo_contract.lead_form_action is not configured`,
        );
    }
  }

  private resolveDeployTarget(ctx: BuildContext): DeployTarget | undefined {
    const deploy = ctx.domainSpec.deploy;
    const githubRepo = deploy?.github_repo ?? process.env.CLIENT_GITHUB_REPO;
    if (!githubRepo) return undefined;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) {
      throw new BuildError("VALIDATION_FAILED", `Invalid GitHub repository name: ${githubRepo}`);
    }
    const sourceBranch = deploy?.source_branch ?? process.env.CLIENT_SOURCE_BRANCH ?? "main";
    if (!/^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,255}$/.test(sourceBranch)) {
      throw new BuildError("VALIDATION_FAILED", `Invalid source branch: ${sourceBranch}`);
    }
    return {
      githubRepo,
      githubRepoId: deploy?.github_repo_id ?? process.env.CLIENT_GITHUB_REPO_ID,
      sourceBranch,
      publishCredentialRef:
        deploy?.publish_credential_ref ??
        process.env.CLIENT_GITHUB_PUBLISH_CREDENTIAL_REF ??
        "env://GITHUB_SITE_TOKEN",
      vercelProjectId: deploy?.vercel_project_id ?? process.env.CLIENT_VERCEL_PROJECT_ID,
      vercelDeployHook: normalizeHttpsUrl(
        deploy?.vercel_deploy_hook ?? process.env.CLIENT_VERCEL_DEPLOY_HOOK,
        "deploy.vercel_deploy_hook",
      ),
      seoBotGithubCredentialRef:
        deploy?.seo_bot_github_credential_ref ??
        process.env.SEO_BOT_SITE_GITHUB_CREDENTIAL_REF ??
        "env://SEO_BOT_SITE_GITHUB_TOKEN",
      seoBotVercelDeployHookRef:
        deploy?.seo_bot_vercel_deploy_hook_ref ?? process.env.SEO_BOT_SITE_VERCEL_HOOK_REF,
    };
  }

  private lookupContent(
    ctx: BuildContext,
    routeSlug: string,
    component: string,
  ): string | undefined {
    const normalizedSlug = normalizeRouteSlug(routeSlug);
    const normalizedComponent = normalizeComponentName(component);
    const candidates = [
      `${routeSlug}:${component}`,
      `${routeSlug}:${normalizedComponent}`,
      `${normalizedSlug}:${component}`,
      `${normalizedSlug}:${normalizedComponent}`,
    ];
    for (const key of candidates) {
      const value = ctx.generatedContent.get(key);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  private writeProject(
    root: string,
    ctx: BuildContext,
    config: SiteConfig,
    templateRoot: string,
  ): void {
    cpSync(templateRoot, root, { recursive: true, errorOnExist: false, force: true });
    this.copyResolvedImages(root, ctx);
    const write = (path: string, content: string): void => {
      const target = safeChild(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf-8");
    };

    write(
      "package.json",
      `${json({
        name: `${config.namespace}-site`,
        private: true,
        version: "1.0.0",
        type: "module",
        engines: { node: ">=20.3.0" },
        scripts: { check: "astro check", build: "astro build" },
        dependencies: {
          "@astrojs/check": ASTRO_CHECK_VERSION,
          "@astrojs/sitemap": ASTRO_SITEMAP_VERSION,
          astro: ASTRO_VERSION,
          typescript: TYPESCRIPT_VERSION,
        },
      })}\n`,
    );
    write(
      "astro.config.mjs",
      `// L9_META: layer=generated_site, role=astro_configuration, status=generated, version=1.0.0\nimport { defineConfig } from 'astro/config';\nimport sitemap from '@astrojs/sitemap';\n\nexport default defineConfig({\n  site: ${json(config.siteUrl)},\n  output: 'static',\n  integrations: [sitemap()],\n});\n`,
    );
    write(
      "src/lib/siteConfig.ts",
      // `as const` types absent values as the literal "" — the template
      // components' truthiness guards then narrow to `never` and astro check
      // fails (live run: quantumaipartners_com). The two optional keys are
      // re-declared with a widening cast so they type as plain string, and the
      // verified primary CTA (or null) is typed the same way.
      `// L9_META: layer=generated_site, role=site_configuration, status=generated, version=1.0.0
export const siteConfig = {
  ...(${json(config)} as const),
  leadFormAction: ${json(config.leadFormAction ?? "")} as string,
  phone: ${json(config.phone ?? "")} as string,
  primaryCta: ${json(this.primaryCta(ctx))} as { label: string; href: string } | null,
};
`,
    );

    const tokens = config.designTokens;
    const cleanFont = (value: string | undefined, fallback: string) =>
      `'${(value ?? fallback).replace(/["'\\;]/g, "")}', sans-serif`;
    const scheme = colorSchemeFromBackground(tokens.background);
    write(
      "src/styles/tokens.css",
      `/* L9_META: layer=generated_site, role=design_tokens, status=generated, version=1.0.0 */\n:root {\n  color-scheme: ${scheme};\n  --color-primary: ${tokens.primary ?? "#17324d"};\n  --color-secondary: ${tokens.secondary ?? "#eef4f8"};\n  --color-accent: ${tokens.accent ?? "#1677ff"};\n  --color-background: ${tokens.background ?? "#ffffff"};\n  --color-text: ${tokens.text ?? "#17212b"};\n  --font-heading: ${cleanFont(tokens.font_heading, "Inter")};\n  --font-body: ${cleanFont(tokens.font_body, "Inter")};\n}\n`,
    );
    write(
      "public/robots.txt",
      `User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}/sitemap-index.xml\n`,
    );

    const heads = this.routeHeads(ctx);
    if (ctx.buildIntent === "REDESIGN_IMPROVE") {
      this.writeRedesignPages(ctx, config, heads, write);
      return;
    }
    const imageBindings = this.bindSectionImages(
      ctx,
      config,
      new Map(
        ctx.domainSpec.routes.map((route) => [
          normalizeRouteSlug(route.slug),
          route.components.map((component) => ({
            name: normalizeComponentName(component),
            component,
          })),
        ]),
      ),
    );
    for (const [index, route] of ctx.domainSpec.routes.entries()) {
      const slug = normalizeRouteSlug(route.slug);
      const head = heads[index];
      const layout = this.routeLayout(route, index);
      const routeImages = imageBindings.get(slug);
      const pagePath = pagePathForRoute(slug);
      const pageDirectoryDepth = slug === "/" ? 1 : slug.split("/").filter(Boolean).length + 1;
      const prefix = "../".repeat(pageDirectoryDepth);
      const sections = route.components.map((component, componentIndex) => {
        const name = normalizeComponentName(component);
        const content = this.lookupContent(ctx, route.slug, component);
        if (
          content === undefined &&
          !(name === "contact_form" && config.leadFormAction) &&
          name !== "gallery"
        ) {
          throw new BuildError(
            "SITE_ASSEMBLY_FAILED",
            `Missing generated content for ${slug}:${component}`,
          );
        }
        // Every section of a route with a bound image carries imagePlacement
        // (null when unbound) so the emitted `as const` array has one shape.
        return routeImages
          ? { name, content: content ?? "", imagePlacement: routeImages[componentIndex] ?? null }
          : { name, content: content ?? "" };
      });
      const routeSchemas = config.schemas.perRoute[slug] ?? [];
      // Exactly one H1 per rendered page (rendered-site single_h1 gate). The hero
      // section owns it when present; otherwise the layout renders the route
      // title as the page heading (L2-S16-001).
      const pageHeading = sections.some((section) => section.name === "hero")
        ? ""
        : ` pageHeading={${json(route.title)}}`;
      // Routes without a layout request keep their legacy page source byte for byte.
      const layoutDeclaration = layout ? `const layout = ${json(layout)};\n` : "";
      const layoutProp = layout ? " layout={layout}" : "";
      // Routes without a bound image keep their legacy page source byte for byte.
      const imageProp = routeImages ? " imagePlacement={section.imagePlacement}" : "";
      write(
        pagePath,
        `---\nimport BaseLayout from '${prefix}layouts/BaseLayout.astro';\nimport SectionRenderer from '${prefix}components/SectionRenderer.astro';\nconst sections = ${json(sections)} as const;\nconst routeSchemas: readonly object[] = ${json(routeSchemas)};\n${layoutDeclaration}---\n<BaseLayout title={${json(head.title)}} description={${json(head.description)}} noindex={${Boolean(route.noindex)}} routeSchemas={routeSchemas}${pageHeading}>\n  {sections.map(section => <SectionRenderer name={section.name} content={section.content}${layoutProp}${imageProp} />)}\n</BaseLayout>\n`,
      );
    }
  }

  /**
   * REDESIGN_IMPROVE pages (WB-GLUE-01): each canonical route renders its
   * blueprint sections in blueprint order through the existing
   * SectionRenderer, with accepted structured copy and the image planned for
   * that section. Head, schemas, navigation, tokens and the one-H1 rule are
   * the same authorities COPY uses.
   */
  private writeRedesignPages(
    ctx: BuildContext,
    config: SiteConfig,
    heads: RouteHead[],
    write: (path: string, content: string) => void,
  ): void {
    const plans = this.redesignPlans(ctx);
    const imageBindings = this.bindSectionImages(
      ctx,
      config,
      new Map(plans.map((plan) => [plan.slug, plan.sections])),
    );
    this.assertGalleryCoverage(ctx, plans, imageBindings);
    for (const [index, route] of ctx.domainSpec.routes.entries()) {
      const plan = plans[index];
      const slug = plan.slug;
      const head = heads[index];
      const routeImages = imageBindings.get(slug);
      const pageDirectoryDepth = slug === "/" ? 1 : slug.split("/").filter(Boolean).length + 1;
      const prefix = "../".repeat(pageDirectoryDepth);
      // Every section carries the same keys so the emitted `as const` array has one shape.
      const sections = plan.sections.map((section, position) => ({
        sectionId: section.sectionId,
        name: section.name,
        layout: section.layout,
        content: section.content,
        structured: section.structured,
        imagePlacement: routeImages?.[position] ?? null,
      }));
      const routeSchemas = config.schemas.perRoute[slug] ?? [];
      // Exactly one H1 per rendered page: the hero section owns it when present;
      // otherwise the layout renders the route title (L2-S16-001).
      const pageHeading = sections.some((section) => section.name === "hero")
        ? ""
        : ` pageHeading={${json(route.title)}}`;
      const links = plan.relatedLinks;
      const linksDeclaration = links.length
        ? `const relatedLinks = ${json(links)} as const;\n`
        : "";
      const linksMarkup = links.length
        ? `\n  <nav class="related-links" aria-label="Related pages">\n    <ul>\n      {relatedLinks.map(link => <li><a href={link.href}>{link.label}</a></li>)}\n    </ul>\n  </nav>`
        : "";
      write(
        pagePathForRoute(slug),
        `---\nimport BaseLayout from '${prefix}layouts/BaseLayout.astro';\nimport SectionRenderer from '${prefix}components/SectionRenderer.astro';\nconst sections = ${json(sections)} as const;\nconst routeSchemas: readonly object[] = ${json(routeSchemas)};\n${linksDeclaration}---\n<BaseLayout title={${json(head.title)}} description={${json(head.description)}} noindex={${Boolean(route.noindex)}} routeSchemas={routeSchemas}${pageHeading}>\n  {sections.map(section => <SectionRenderer name={section.name} content={section.content} structured={section.structured} layout={section.layout ?? undefined} imagePlacement={section.imagePlacement} />)}${linksMarkup}\n</BaseLayout>\n`,
      );
    }
  }

  /**
   * A required multi-image region needs `min_count` distinct images: the
   * planned image bound to its gallery section plus the source-site gallery
   * extras. One asset is never counted as several. An optional region below
   * its count is logged.
   */
  private assertGalleryCoverage(
    ctx: BuildContext,
    plans: RedesignRoutePlan[],
    bindings: Map<string, Array<string | null>>,
  ): void {
    const extras = new Set(this.galleryExtras(ctx).map((image) => image.sha256));
    const requirements: VisualRequirement[] = (
      ctx.websiteBlueprint?.payload.visual_requirements ?? []
    ).filter((requirement) => requirement.role === "gallery" && requirement.min_count > 1);
    for (const requirement of requirements) {
      let slug: string;
      try {
        slug = normalizeRouteSlug(requirement.route_id);
      } catch {
        continue;
      }
      const plan = plans.find((candidate) => candidate.slug === slug);
      const position =
        plan?.sections.findIndex((section) => section.sectionId === requirement.section_id) ?? -1;
      const boundPlacement = position >= 0 ? bindings.get(slug)?.[position] : null;
      const bound = boundPlacement ? ctx.resolvedImages?.get(boundPlacement) : undefined;
      const distinct = new Set(extras);
      if (bound) distinct.add(bound.sha256);
      if (distinct.size >= requirement.min_count) continue;
      if (requirement.required) {
        throw new BuildError(
          "VISUAL_ASSET_REQUIREMENT_UNSATISFIED",
          `gallery-under-count: ${requirement.slot_id} requires ${requirement.min_count} distinct images; ${distinct.size} available`,
        );
      }
      logger.warn(
        { slot: requirement.slot_id, required: requirement.min_count, available: distinct.size },
        "Optional gallery region renders fewer images than planned",
      );
    }
  }
}
