// L9_META: layer=test, role=design_system_rendered, status=active, version=1.0.0
//
// Design system v2, rendered for real: the fixture redesign site is assembled,
// type-checked and built with astro, then opened in Chromium. It proves the
// three defects the design-system lane closes, in the browser rather than in
// CSS text:
//   1. the chosen fonts actually load (self-hosted, no CDN, not a fallback);
//   2. the ghost phone button on the primary CTA band is legible (it used to be
//      primary-coloured text on a primary background, i.e. invisible);
//   3. at 390px the header is one row with an accessible menu toggle
//      (aria-expanded, Escape closes) instead of a nav wrapped into a column.
// The palette deliberately uses a light primary where white text fails WCAG AA,
// the case that broke button contrast before. Requires the Playwright chromium
// binary; its absence fails this test, never skips it.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import type { BuildContext } from "../../../src/pipeline/BuildContext.js";
import {
  deriveContrastTokens,
  deriveDesignSystem,
  normalizeDesignTokens,
} from "../../../src/stages/DesignIntelligenceStage.js";
import { RenderedSiteValidationStage } from "../../../src/stages/RenderedSiteValidationStage.js";
import { SiteAssemblerStage } from "../../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../../src/stages/SiteBuildStage.js";
import { StaticDistServer } from "../../../src/validation/rendered-site.js";
import { redesignContext } from "../../helpers/redesignAssemblyFixture.js";
import { cleanupContext } from "../../helpers/siteFactoryFixture.js";

// Synthetic test palette (not a client's): a light amber primary where white
// fails AA, so the design system must derive a dark on-primary foreground.
const PALETTE = {
  primary: "#f2b134",
  secondary: "#1d2a35",
  accent: "#2a6f97",
  background: "#fbfaf7",
  text: "#1b1f24",
};
// Reserved fictional number range; a test fixture value, not contact data.
const FIXTURE_PHONE = "(555) 010-0199";

let ctx: BuildContext;
let browser: Browser;
let server: { baseUrl: string; close: () => Promise<void> };

before(
  async () => {
    ctx = await redesignContext({
      provided: [
        { id: "brand-logo", intendedPlacement: "global:logo" },
        { id: "storefront", intendedPlacement: "/:hero" },
        { id: "repair-van", intendedPlacement: "/:service#repairs" },
      ],
    });
    ctx.domainSpec.seo_contract = { ...ctx.domainSpec.seo_contract, phone: FIXTURE_PHONE };
    const tokens = normalizeDesignTokens(PALETTE, { heading: "Space Grotesk", body: "Inter" });
    ctx.designTokens = {
      ...tokens,
      ...deriveDesignSystem(["bold", "confident"]),
      ...deriveContrastTokens(tokens),
    };
    await new SiteAssemblerStage().run(ctx);
    await new SiteBuildStage().run(ctx);
    assert.ok(ctx.distDir, "astro check + astro build produced dist");
    // The site must still pass the real rendered-site gate (no off-screen or
    // obstructed CTA, no clipped heading, no broken image) at both viewports.
    await new RenderedSiteValidationStage().run(ctx);
    server = await new StaticDistServer().start(ctx.distDir);
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
  },
  { timeout: 900_000 },
);

after(async () => {
  await browser?.close();
  await server?.close();
  if (ctx) cleanupContext(ctx);
});

async function open(width: number, route = "/"): Promise<{ page: Page; fonts: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const fonts: string[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith(".woff2")) fonts.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    assert.equal(url.origin, server.baseUrl, `off-origin request: ${request.url()}`);
  });
  await page.goto(`${server.baseUrl}${route}`, { waitUntil: "load" });
  await page.evaluate("document.fonts.ready.then(() => true)");
  return { page, fonts };
}

/** WCAG contrast of two computed rgb()/rgba() colours (alpha ignored: both must be opaque). */
const CONTRAST = `(fg, bg) => {
  const lum = (value) => {
    const [r, g, b] = value.match(/[\\d.]+/g).slice(0, 3).map(Number).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}`;

void test("the chosen heading and body fonts load from the site itself, not a fallback", async () => {
  for (const width of [1440, 390]) {
    const { page, fonts } = await open(width);
    const state = (await page.evaluate(`({
      heading: getComputedStyle(document.querySelector("h1")).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
      loaded: [...document.fonts]
        .filter((face) => face.status === "loaded")
        .map((face) => face.family.replace(/["']/g, "")),
      grotesk: document.fonts.check("700 40px 'Space Grotesk'"),
      inter: document.fonts.check("400 16px Inter"),
    })`)) as { heading: string; body: string; loaded: string[]; grotesk: boolean; inter: boolean };
    assert.match(state.heading, /^["']?Space Grotesk/, `h1 font-family at ${width}px`);
    assert.match(state.body, /^["']?Inter/, `body font-family at ${width}px`);
    assert.ok(state.loaded.includes("Space Grotesk"), `Space Grotesk loaded: ${state.loaded}`);
    assert.ok(state.loaded.includes("Inter"), `Inter loaded: ${state.loaded}`);
    assert.ok(state.grotesk && state.inter, "document.fonts reports both faces available");
    assert.ok(
      fonts.some((entry) => /^200 .*\/fonts\/space-grotesk-latin-wght\.woff2$/.test(entry)),
      `font served by the site: ${fonts.join(", ")}`,
    );
    await page.close();
  }
});

void test("the ghost phone button is legible on the primary CTA band and on the page", async () => {
  const { page } = await open(1440);
  const pairs = await page.evaluate(`(() => {
    const contrast = ${CONTRAST};
    const read = (selector, surfaceSelector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const surface = element.closest(surfaceSelector);
      return {
        variant: surface.getAttribute("data-variant"),
        fg: getComputedStyle(element).color,
        bg: getComputedStyle(surface).backgroundColor,
        ratio: contrast(getComputedStyle(element).color, getComputedStyle(surface).backgroundColor),
      };
    };
    return {
      bandGhost: read(".cta-banner .btn--ghost", ".cta-banner"),
      bandHeading: read(".cta-banner h2", ".cta-banner"),
      heroGhost: read(".hero .btn--ghost", "body"),
    };
  })()`);
  const typed = pairs as Record<
    string,
    { fg: string; bg: string; ratio: number; variant: string } | null
  >;
  assert.ok(typed.bandGhost, "the CTA banner renders the phone as a ghost button");
  assert.equal(typed.bandGhost.variant, "band", "bold direction selects the full-bleed band");
  for (const [name, pair] of Object.entries(typed)) {
    assert.ok(pair, `${name} rendered`);
    assert.ok(pair.ratio >= 4.5, `${name}: ${pair.fg} on ${pair.bg} is ${pair.ratio.toFixed(2)}:1`);
  }
  // Solid buttons carry their own fill: their text is judged against it (it
  // inverts on the band, so a light primary gets dark text and vice versa).
  for (const selector of [".hero .btn:not(.btn--ghost)", ".cta-banner .btn:not(.btn--ghost)"]) {
    const ratio = (await page.evaluate(`(() => {
      const contrast = ${CONTRAST};
      const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
      return contrast(style.color, style.backgroundColor);
    })()`)) as number;
    assert.ok(ratio >= 4.5, `${selector} text on its own fill is ${ratio.toFixed(2)}:1`);
  }
  await page.close();
});

void test("at 390px the header is one row with an accessible menu toggle", async () => {
  const { page } = await open(390);
  const header = (await page.evaluate(`({
    height: document.querySelector(".site-header__inner").getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    navDisplay: getComputedStyle(document.querySelector("#site-nav")).display,
  })`)) as { height: number; overflow: number; navDisplay: string };
  assert.ok(header.height <= 72, `header bar is a single row (${header.height}px)`);
  assert.ok(header.overflow <= 0, `no horizontal scroll (${header.overflow}px)`);
  assert.equal(header.navDisplay, "none", "the nav is collapsed behind the toggle");
  const toggle = page.locator(".site-menu-toggle");
  assert.ok(await toggle.isVisible(), "menu toggle is visible");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await toggle.getAttribute("aria-controls"), "site-nav");
  assert.equal(await toggle.evaluate((element) => element.tagName), "BUTTON");
  // Keyboard: focus and Enter open it, links are on screen, Escape closes and returns focus.
  await toggle.focus();
  await page.keyboard.press("Enter");
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  const links = (await page.evaluate(`[...document.querySelectorAll("#site-nav a")].map((link) => {
    const rect = link.getBoundingClientRect();
    return { left: rect.left, right: rect.right, height: rect.height, shown: rect.width > 0 };
  })`)) as Array<{ left: number; right: number; height: number; shown: boolean }>;
  assert.ok(links.length > 0, "nav has links");
  for (const link of links) {
    assert.ok(
      link.shown && link.left >= 0 && link.right <= 390,
      `link on screen ${JSON.stringify(link)}`,
    );
    assert.ok(link.height >= 44, `touch target ${link.height}px`);
  }
  await page.keyboard.press("Escape");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate("document.activeElement.className"), "site-menu-toggle");
  assert.equal(
    await page.evaluate(`getComputedStyle(document.querySelector("#site-nav")).display`),
    "none",
  );
  await page.close();
});

void test("at 1440px the nav is inline and the toggle is not shown", async () => {
  const { page } = await open(1440);
  assert.equal(await page.locator(".site-menu-toggle").isVisible(), false);
  assert.ok(await page.locator("#site-nav a").first().isVisible());
  const overflow = (await page.evaluate(
    "document.documentElement.scrollWidth - window.innerWidth",
  )) as number;
  assert.ok(overflow <= 0, `no horizontal scroll (${overflow}px)`);
  await page.close();
});
