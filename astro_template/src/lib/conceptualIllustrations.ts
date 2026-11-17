// L9_META: layer=template, role=conceptual_illustration_catalog, status=active, version=1.0.0
/**
 * Built-in static conceptual illustrations (operator decision D1, 2026-11-17).
 *
 * The required home hero may be filled by a labelled conceptual diagram when no
 * client or authorized source-site image exists and image generation cannot run.
 * It is not a photo and never stands in for a factual visual (logo, team, work,
 * credentials): the image planner only assigns it to "/:hero".
 *
 * Each illustration is a fixed, inline SVG: no raster, no script, no WebGL, no
 * animation (nothing to reduce under prefers-reduced-motion). Colors come only
 * from the site's palette tokens (CSS custom properties written from the spec's
 * design tokens), applied by the classes styled in global.css.
 *
 * This module has no imports and uses only erasable TypeScript so the same
 * source runs in the Astro build and in Node tests.
 */

export const CONCEPTUAL_ILLUSTRATION_LABEL = "Conceptual illustration";

export interface ConceptualIllustration {
  readonly id: string;
  /** Accessible name (SVG <title>). */
  readonly title: string;
  /** Accessible description (SVG <desc>). */
  readonly description: string;
  readonly body: string;
}

const ROW_CENTERS = [112, 150, 188, 226, 264] as const;
const NODES = [
  [372, 100],
  [512, 92],
  [532, 214],
  [456, 292],
  [362, 252],
] as const;
const HUB = [448, 184] as const;

function crmToGraphBody(): string {
  const rows = ROW_CENTERS.map(
    (center) =>
      `<rect class="ci-row" x="24" y="${center - 14}" width="200" height="28" rx="4"/>` +
      `<rect class="ci-cell" x="34" y="${center - 4}" width="58" height="8" rx="2"/>` +
      `<rect class="ci-cell" x="102" y="${center - 4}" width="50" height="8" rx="2"/>` +
      `<rect class="ci-cell" x="162" y="${center - 4}" width="50" height="8" rx="2"/>`,
  ).join("");
  // Each CRM row becomes one node of the graph.
  const links = ROW_CENTERS.map(
    (center, index) =>
      `<line class="ci-link" x1="224" y1="${center}" x2="${NODES[index][0]}" y2="${NODES[index][1]}"/>`,
  ).join("");
  const edges = [
    ...NODES.map(
      ([x, y]) => `<line class="ci-edge" x1="${HUB[0]}" y1="${HUB[1]}" x2="${x}" y2="${y}"/>`,
    ),
    `<line class="ci-edge" x1="${NODES[0][0]}" y1="${NODES[0][1]}" x2="${NODES[1][0]}" y2="${NODES[1][1]}"/>`,
    `<line class="ci-edge" x1="${NODES[2][0]}" y1="${NODES[2][1]}" x2="${NODES[3][0]}" y2="${NODES[3][1]}"/>`,
  ].join("");
  const nodes = NODES.map(([x, y]) => `<circle class="ci-node" cx="${x}" cy="${y}" r="14"/>`).join(
    "",
  );
  return (
    `<text class="ci-caption" x="24" y="40">CRM records</text>` +
    `<text class="ci-caption" x="340" y="40">Relationship graph</text>` +
    `<rect class="ci-panel" x="16" y="52" width="216" height="236" rx="10"/>` +
    `<rect class="ci-head" x="24" y="60" width="200" height="24" rx="4"/>` +
    rows +
    `<g class="ci-links">${links}</g>` +
    `<g class="ci-edges">${edges}</g>` +
    `<circle class="ci-node ci-node--hub" cx="${HUB[0]}" cy="${HUB[1]}" r="24"/>` +
    nodes +
    `<path class="ci-flow" d="M244 176h44v-10l18 18-18 18v-10h-44z"/>`
  );
}

export const CONCEPTUAL_ILLUSTRATIONS: Readonly<Record<string, ConceptualIllustration>> = {
  "crm-to-graph": {
    id: "crm-to-graph",
    title: "Conceptual illustration: CRM records becoming a relationship graph",
    description:
      "Rows of a customer relationship management table, each linked to a node in a connected graph of contacts, companies and deals arranged around a central account.",
    body: crmToGraphBody(),
  },
};

export function isConceptualIllustration(id: string): boolean {
  return Object.hasOwn(CONCEPTUAL_ILLUSTRATIONS, id);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The complete, static markup of an illustration for a placement: a figure
 * holding an accessible inline SVG (role="img", named by <title>, described by
 * <desc>) and a visible "Conceptual illustration" label. Undefined for an
 * unknown illustration id.
 */
export function conceptualIllustrationMarkup(id: string, slot: string): string | undefined {
  if (!isConceptualIllustration(id)) return undefined;
  const illustration = CONCEPTUAL_ILLUSTRATIONS[id];
  const prefix = `ci-${
    slot
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "slot"
  }`;
  return (
    `<figure class="hero__illustration" data-illustration="${escapeAttribute(id)}" data-asset-source="static-illustration" data-image-slot="${escapeAttribute(slot)}">` +
    `<svg class="ci" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 320" role="img" focusable="false" aria-labelledby="${prefix}-title ${prefix}-desc">` +
    `<title id="${prefix}-title">${escapeText(illustration.title)}</title>` +
    `<desc id="${prefix}-desc">${escapeText(illustration.description)}</desc>` +
    illustration.body +
    `</svg>` +
    `<figcaption class="hero__illustration-label">${CONCEPTUAL_ILLUSTRATION_LABEL}</figcaption>` +
    `</figure>`
  );
}
