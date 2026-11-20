// L9_META: layer=test, role=cta_no_duplicate_call_rendered, status=active, version=1.0.0
//
// One call action, not two. With no verified lead form the assembler's primary
// CTA falls back to calling the business (SiteAssemblerStage.phoneCta, a tel:
// link). Hero and CtaBanner used to render the ghost phone button beside it,
// so a visitor saw two adjacent buttons that do the same thing. Built with
// astro and opened in Chromium, both ways:
//   - primary CTA is tel:  -> the hero and the banner carry one call action;
//   - primary CTA is the verified form -> the phone stays as the ghost button.
// The header keeps the number in both. Requires the Playwright chromium binary;
// its absence fails this test, never skips it.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright";
import type { BuildContext, DomainSpec } from "../../../src/pipeline/BuildContext.js";
import { SiteAssemblerStage } from "../../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../../src/stages/SiteBuildStage.js";
import { StaticDistServer } from "../../../src/validation/rendered-site.js";
import {
  attachVerifiedLeadCapture,
  cleanupContext,
  fixtureContext,
} from "../../helpers/siteFactoryFixture.js";

// Reserved fictional number range; a test fixture value, not contact data.
const FIXTURE_PHONE = "(555) 010-0199";
const TEL = "tel:5550100199";
const ROUTES: DomainSpec["routes"] = [
  { slug: "/", title: "Home", components: ["hero", "cta"] },
  { slug: "/contact", title: "Contact", components: ["contact_form"] },
];

interface Actions {
  heroLinks: Array<{ href: string; text: string; ghost: boolean }>;
  bannerLinks: Array<{ href: string; text: string; ghost: boolean }>;
  headerTel: number;
}

const contexts: BuildContext[] = [];
let browser: Browser;

async function build(withVerifiedForm: boolean): Promise<string> {
  const ctx = fixtureContext({
    routes: ROUTES,
    seo_contract: {
      site_url: "ci-test.example.com",
      phone: FIXTURE_PHONE,
      ...(withVerifiedForm ? { lead_form_action: "https://forms.example.com/submit" } : {}),
    },
    ...(withVerifiedForm
      ? {
          conversion_authority: {
            primary_action: "Request service",
            secondary_actions: [],
            cta_library: [],
          },
        }
      : {}),
  });
  contexts.push(ctx);
  if (withVerifiedForm) attachVerifiedLeadCapture(ctx);
  await new SiteAssemblerStage().run(ctx);
  await new SiteBuildStage().run(ctx);
  assert.ok(ctx.distDir, "astro build produced dist");
  return ctx.distDir;
}

async function actions(distDir: string): Promise<Actions> {
  const server = await new StaticDistServer().start(distDir);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(`${server.baseUrl}/`, { waitUntil: "load" });
    return (await page.evaluate(`(() => {
      const links = (selector) =>
        [...document.querySelectorAll(selector + " a[href]")].map((a) => ({
          href: a.getAttribute("href"),
          text: a.innerText.trim(),
          ghost: a.classList.contains("btn--ghost"),
        }));
      return {
        heroLinks: links(".hero .hero__actions"),
        bannerLinks: links(".cta-banner"),
        headerTel: document.querySelectorAll("header a[href^='tel:']").length,
      };
    })()`)) as Actions;
  } finally {
    await page.close();
    await server.close();
  }
}

let telFallback: Actions;
let verifiedForm: Actions;

before(
  async () => {
    const [telDist, formDist] = [await build(false), await build(true)];
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    telFallback = await actions(telDist);
    verifiedForm = await actions(formDist);
  },
  { timeout: 900_000 },
);

after(async () => {
  await browser?.close();
  for (const ctx of contexts) cleanupContext(ctx);
});

const telCount = (links: Actions["heroLinks"]) => links.filter((link) => link.href === TEL).length;

void test("a tel: primary CTA is the only call action in the hero and the banner", () => {
  assert.deepEqual(
    telFallback.heroLinks.map((link) => [link.href, link.ghost]),
    [[TEL, false]],
    JSON.stringify(telFallback.heroLinks),
  );
  assert.match(telFallback.heroLinks[0]?.text ?? "", /Call \(555\) 010-0199/);
  assert.equal(telCount(telFallback.bannerLinks), 1, JSON.stringify(telFallback.bannerLinks));
  assert.ok(
    telFallback.bannerLinks.every((link) => !link.ghost),
    "no ghost phone button beside a call CTA",
  );
  assert.ok(telFallback.headerTel >= 1, "the header keeps the phone number");
});

void test("a verified form CTA keeps the phone as the secondary ghost button", () => {
  assert.deepEqual(
    verifiedForm.heroLinks.map((link) => [link.href, link.ghost]),
    [
      ["/contact#quote", false],
      [TEL, true],
    ],
    JSON.stringify(verifiedForm.heroLinks),
  );
  assert.ok(
    verifiedForm.bannerLinks.some((link) => link.href === "/contact#quote"),
    JSON.stringify(verifiedForm.bannerLinks),
  );
  assert.ok(
    verifiedForm.bannerLinks.some((link) => link.href === TEL && link.ghost),
    "the banner keeps the ghost phone button",
  );
  assert.ok(verifiedForm.headerTel >= 1, "the header keeps the phone number");
});
