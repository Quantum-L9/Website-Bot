// L9_META: layer=service, role=image_alt_text, status=active, version=1.0.0
//
// Alt text for every shipped image. A slot id ("/:hero"), placement, file name
// or path is never alt text: a screen reader would announce it and search
// engines index it. Alt comes from a real description (the slot's alt
// guidance, the brief's subject or intent, the source image's own alt); a
// decorative role gets alt="" (the template then treats it as presentation);
// a logo is described by the business name; otherwise alt is derived from the
// section the image illustrates (business, section, role, page). With none of
// these the build fails closed instead of shipping an identifier.

import { placementRole, placementSectionId, routeSlugFromPlacement } from "./ImageAssetPlanner.js";

export class MissingAltTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingAltTextError";
  }
}

/** Roles whose imagery carries no information (alt=""). */
export const DECORATIVE_ROLES: ReadonlySet<string> = new Set([
  "background",
  "decorative",
  "texture",
  "pattern",
]);

export interface AltSlot {
  id: string;
  placement: string;
}

/** The default brief intent the planner writes when a slot has none. */
function isPlaceholderIntent(text: string, slot: AltSlot): boolean {
  return text === `Image for ${slot.placement}` || /^image for [\w/:#-]+$/i.test(text);
}

/**
 * True when the text describes an image rather than naming it: not empty, not
 * the slot id or placement, and not shaped like a path, route or file name.
 */
export function isDescriptiveAlt(text: string | undefined, slot: AltSlot): text is string {
  const value = text?.trim();
  if (!value) return false;
  if (value === slot.id || value === slot.placement) return false;
  if (isPlaceholderIntent(value, slot)) return false;
  if (/[/\\]/.test(value) || /^[\w.-]+:[\w#/-]*$/.test(value)) return false;
  if (/\.(png|jpe?g|webp|avif|gif|svg|tiff?)$/i.test(value)) return false;
  return /[a-z]{2}/i.test(value);
}

export function isDecorativeSlot(slot: AltSlot): boolean {
  return DECORATIVE_ROLES.has(placementRole(slot.placement));
}

/** What the alt text may be derived from when no description was supplied. */
export interface AltContext {
  businessName?: string;
  /** Route slug → page title, for naming the page an image illustrates. */
  routes?: ReadonlyArray<{ slug: string; title?: string }>;
}

function words(value: string): string {
  return value.replace(/[-_]+/g, " ").trim();
}

function pageName(slot: AltSlot, routes: AltContext["routes"]): string | undefined {
  const slug = routeSlugFromPlacement(slot.placement);
  if (slug === undefined) return undefined;
  const titled = routes?.find((route) => route.slug === slug)?.title?.trim();
  if (titled) return titled;
  return slug === "/" ? "Home" : words(slug.split("/").filter(Boolean).at(-1) ?? "");
}

/**
 * Alt derived from the section the image illustrates: business, section and
 * visual role, and the page — e.g. "Acme Roofing installs service image,
 * Services page". Truthful (it names what the slot is for, not what is in the
 * picture) and never an identifier. Undefined without a business name.
 */
export function sectionAlt(slot: AltSlot, context: AltContext): string | undefined {
  const business = context.businessName?.trim();
  if (!business) return undefined;
  if (/logo/i.test(slot.placement) || /logo/i.test(slot.id)) return `${business} logo`;
  const role = words(placementRole(slot.placement));
  const section = placementSectionId(slot.placement);
  const subject = [section ? words(section) : undefined, role].filter(Boolean).join(" ");
  const page = pageName(slot, context.routes);
  const pageSuffix = page ? `, ${page} page` : "";
  return `${business} ${subject} image${pageSuffix}`;
}

/**
 * Resolve the alt text to ship for a slot: "" for a decorative role, else the
 * first descriptive candidate, else one derived from the section it
 * illustrates (a logo: "<business> logo"); throws MissingAltTextError when
 * nothing truthful is available.
 */
export function resolveAltText(
  slot: AltSlot,
  candidates: ReadonlyArray<string | undefined>,
  context: AltContext = {},
): string {
  if (isDecorativeSlot(slot)) return "";
  const described = candidates.find((candidate) => isDescriptiveAlt(candidate, slot));
  if (described) return described.trim();
  const derived = sectionAlt(slot, context);
  if (derived && isDescriptiveAlt(derived, slot)) return derived;
  throw new MissingAltTextError(
    `no alt text for image slot ${slot.id} (${slot.placement}): supply altText on the slot or image, or a generation subject; a slot id or path is never alt text`,
  );
}
