// L9_META: layer=test, role=cta_truthfulness_contract, status=active, version=1.0.0
//
// WB-QAP-03: CTA labels come only from conversion_authority; destinations are
// verified independently (a real route rendering a verified lead form); a
// missing action is omitted or explicitly gated, never faked.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import type { BuildContext, DomainSpec } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const ACTION = "https://forms.example.com/submit";
const LABEL = "Request a Claim Review";
const ROUTES: DomainSpec["routes"] = [
  { slug: "/", title: "Home", components: ["hero", "cta"] },
  { slug: "/contact", title: "Contact", components: ["contact_form"] },
];

function context(overrides: Partial<DomainSpec>): BuildContext {
  const ctx = fixtureContext({ routes: ROUTES, ...overrides });
  for (const route of ctx.domainSpec.routes)
    for (const component of route.components)
      ctx.generatedContent.set(`${route.slug}:${component}`, `${route.title} ${component} copy.`);
  return ctx;
}

const spec = (leadFormAction?: string, primaryAction?: string): Partial<DomainSpec> => ({
  seo_contract: {
    site_url: "ci-test.example.com",
    ...(leadFormAction ? { lead_form_action: leadFormAction } : {}),
  },
  ...(primaryAction
    ? {
        conversion_authority: {
          primary_action: primaryAction,
          secondary_actions: [],
          cta_library: [],
        },
      }
    : {}),
});

async function assemble(overrides: Partial<DomainSpec>) {
  const ctx = context(overrides);
  try {
    await new SiteAssemblerStage().run(ctx);
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    const primaryCta = JSON.parse(
      /primaryCta: ([\s\S]*?) as \{ label: string; href: string \} \| null,/.exec(config)?.[1] ??
        "undefined",
    ) as { label: string; href: string } | null;
    const leadFormAction = JSON.parse(
      /leadFormAction: (".*") as string,/.exec(config)?.[1] ?? '""',
    );
    const phone = JSON.parse(/phone: (".*") as string,/.exec(config)?.[1] ?? '""');
    const sources = collectSources(join(ctx.outputDir, "src"));
    return { primaryCta, leadFormAction, phone, sources };
  } finally {
    cleanupContext(ctx);
  }
}

function collectSources(dir: string): string {
  let text = "";
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) text += collectSources(path);
    else if (/\.(astro|ts)$/.test(name)) text += readFileSync(path, "utf-8");
  }
  return text;
}

async function rejects(overrides: Partial<DomainSpec>, message: RegExp): Promise<void> {
  const ctx = context(overrides);
  try {
    await assert.rejects(
      () => new SiteAssemblerStage().run(ctx),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "VALIDATION_FAILED" &&
        message.test(error.message),
    );
  } finally {
    cleanupContext(ctx);
  }
}

void test("a verified lead form and an operator label yield a CTA to the real form route", async () => {
  const site = await assemble(spec(ACTION, LABEL));
  assert.deepEqual(site.primaryCta, { label: LABEL, href: "/contact#quote" });
  assert.equal(site.leadFormAction, ACTION);
});

void test("a label alone never manufactures a destination", async () => {
  const site = await assemble(spec(undefined, LABEL));
  assert.equal(site.primaryCta, null);
  assert.equal(site.leadFormAction, "");
});

void test("a verified action without an operator label gets no default offer text", async () => {
  const site = await assemble(spec(ACTION));
  assert.equal(site.primaryCta, null);
});

void test("a label and action with no route rendering the form have no destination", async () => {
  const site = await assemble({
    ...spec(ACTION, LABEL),
    routes: [{ slug: "/", title: "Home", components: ["hero", "cta"] }],
  });
  assert.equal(site.primaryCta, null);
});

void test("an invalid external form destination is rejected, never linked", async () => {
  for (const action of ["http://forms.example.com/submit", "javascript:alert(1)", "not a url"])
    await rejects(
      spec(action, LABEL),
      /seo_contract\.lead_form_action must (use HTTPS|be a valid URL)/,
    );
});

void test("a confirmation page without a verified form action is a pretend inquiry and fails", async () => {
  const routes: DomainSpec["routes"] = [
    ...ROUTES,
    { slug: "/thank-you", title: "Thank you", components: ["confirmation"], noindex: true },
  ];
  await rejects(
    { ...spec(undefined, LABEL), routes },
    /^pretend-inquiry: domainSpec\.routes\[2\] \(\/thank-you\) renders a confirmation section/,
  );
  // With a verified action the confirmation page is legitimate.
  const site = await assemble({ ...spec(ACTION, LABEL), routes });
  assert.deepEqual(site.primaryCta, { label: LABEL, href: "/contact#quote" });
});

void test("no phone means no phone value is invented", async () => {
  const site = await assemble(spec(ACTION, LABEL));
  assert.equal(site.phone, "");
  assert.doesNotMatch(site.sources, /tel:\+?\d/);
});

void test("templates carry no roofing offer, no dead #quote link and no fake submit", () => {
  const read = (path: string) => readFileSync(resolve("astro_template/src", path), "utf8");
  const hero = read("components/sections/Hero.astro");
  const banner = read("components/sections/CtaBanner.astro");
  const form = read("components/LeadForm.astro");
  for (const source of [hero, banner, form]) {
    assert.doesNotMatch(
      source,
      /Free Quote|Free Roof|Free Inspection|Request Inspection|Within 24 Hours/i,
    );
    // The only #quote reference is the form section's own id, set only when a form renders.
    assert.doesNotMatch(source, /href="#quote"/);
  }
  // Links exist only for a verified CTA; the label is never paired with a literal href.
  assert.match(
    hero,
    /\{cta && <a class="btn btn--primary" href=\{cta\.href\}>\{cta\.label\}<\/a>\}/,
  );
  assert.match(banner, /\{cta \? \(\s*<a class="cta-banner__link" href=\{cta\.href\}/);
  // Missing action: no form, no submit, an explicit notice instead; no build-time throw.
  assert.doesNotMatch(form, /throw new Error/);
  assert.match(form, /\{action \? \(\s*<form method="post" action=\{action\} data-lead-form>/);
  assert.match(form, /Online inquiries are not yet enabled in this preview\./);
  assert.match(form, /<section id=\{action \? "quote" : undefined\}/);
  // Legacy verified path: the form posts to the verified action with a neutral fallback label.
  assert.match(
    form,
    /<button class="btn" type="submit" data-cta>\{cta\?\.label \?\? "Submit"\}<\/button>/,
  );
});
