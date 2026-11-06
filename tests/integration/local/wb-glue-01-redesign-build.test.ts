// L9_META: layer=test, role=redesign_blueprint_build_proof, status=active, version=1.0.0
//
// WB-GLUE-01 build proof: the REDESIGN_IMPROVE assembly — blueprint section
// order, accepted structured copy, client-first images — passes `astro check`
// and `astro build`, and the built HTML carries the structured content as real
// semantic elements with exactly one H1 and each planned image once. This runs
// the real SiteBuildStage (npm install + astro check + astro build); no browser.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SiteAssemblerStage } from "../../../src/stages/SiteAssemblerStage.js";
import { SiteBuildStage } from "../../../src/stages/SiteBuildStage.js";
import { LEAD_FORM, redesignContext, sha256 } from "../../helpers/redesignAssemblyFixture.js";
import { cleanupContext } from "../../helpers/siteFactoryFixture.js";

const count = (html: string, pattern: RegExp): number => html.match(pattern)?.length ?? 0;
const occurrences = (html: string, literal: string): number => html.split(literal).length - 1;

void test("a REDESIGN_IMPROVE site builds and renders structured copy semantically, in blueprint order", {
  timeout: 900_000,
}, async () => {
  const ctx = await redesignContext({
    provided: [
      { id: "brand-logo", intendedPlacement: "global:logo" },
      { id: "storefront", intendedPlacement: "/:hero" },
      { id: "repair-van", intendedPlacement: "/:service#repairs" },
      { id: "new-heater", intendedPlacement: "/:service#installs" },
      { id: "crew-photo", intendedPlacement: "/:team#story" },
    ],
  });
  try {
    await new SiteAssemblerStage().run(ctx);
    await new SiteBuildStage().run(ctx);
    assert.ok(ctx.distDir, "astro check + astro build produced dist");
    const html = readFileSync(join(ctx.distDir, "index.html"), "utf-8");

    // Exactly one H1 — the approved hero heading — and no duplicate hero image.
    assert.equal(count(html, /<h1[\s>]/g), 1);
    assert.match(html, /<h1[^>]*>Fixture Plumbing That Shows Up<\/h1>/);
    for (const placement of ["/:hero", "/:service#repairs", "/:service#installs", "/:team#story"]) {
      const asset = ctx.resolvedImages?.get(placement);
      assert.ok(asset, placement);
      assert.equal(
        occurrences(html, `src="/images/${asset.outputFileName}"`),
        1,
        `${placement} renders exactly once`,
      );
      // Published bytes equal the client's original bytes.
      assert.equal(
        sha256(readFileSync(join(ctx.distDir, "images", asset.outputFileName))),
        sha256(readFileSync(asset.originalPath ?? "")),
      );
    }
    // The provided logo replaces the wordmark, unchanged.
    const logo = ctx.resolvedImages?.get("global:logo");
    assert.ok(logo);
    const logoLink = html.slice(html.indexOf('class="site-logo"'));
    assert.ok(html.includes('class="site-logo"'), "the logo link renders");
    assert.ok(
      logoLink
        .slice(0, logoLink.indexOf("</a>"))
        .includes(`<img src="/images/${logo.outputFileName}"`),
      "the logo link shows the provided logo",
    );

    // Blueprint order, by section identity.
    const order = [...html.matchAll(/data-section-id="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(order, [
      "hero",
      "how",
      "repairs",
      "installs",
      "story",
      "proof",
      "questions",
      "closing",
    ]);

    // Semantic structures, text unchanged.
    assert.match(html, /<ul[^>]*>\s*<li[^>]*>Leaks<\/li>\s*<li[^>]*>Clogs<\/li>\s*<\/ul>/);
    assert.match(
      html,
      /<ol class="process__steps"[^>]*>[\s\S]*?<p[^>]*>Call us<\/p>[\s\S]*?<p[^>]*>We fix it<\/p>[\s\S]*?<\/ol>/,
    );
    assert.match(
      html,
      /<blockquote[^>]*>\s*<p[^>]*>They fixed it the same day\.<\/p>\s*<footer[^>]*><cite[^>]*>A\. Customer<\/cite><\/footer>\s*<\/blockquote>/,
    );
    assert.match(
      html,
      /<details class="faq__item"[^>]*>\s*<summary[^>]*>Do you work weekends\?<\/summary>\s*<p[^>]*>Yes, by appointment\.<\/p>/,
    );
    // Verified CTAs only; the unverified "call_now" and external actions render no link.
    assert.match(html, /href="\/contact#quote"[^>]*>[\s\S]*?Request a quote/);
    // The external "Book a repair" CTA only renders as a link, so its absent label proves it.
    for (const absent of ["Call now", "Book a repair"]) {
      assert.ok(!html.includes(absent), `${absent} must not render`);
    }
    // Internal links resolve only to published routes.
    assert.match(
      html,
      /<nav class="related-links" aria-label="Related pages">[\s\S]*?href="\/contact"[^>]*>Contact our team<\/a>/,
    );
    assert.doesNotMatch(html, /\/nowhere/);

    // A trust section renders its accepted bullets semantically, with no template heading.
    assert.match(html, /<ul[^>]*>\s*<li[^>]*>Licensed<\/li>\s*<li[^>]*>Insured<\/li>\s*<\/ul>/);
    assert.match(html, /<h2[^>]*>Why neighbors trust us<\/h2>/);
    assert.doesNotMatch(html, /The Safe Haven Standard/);
    // Two services sections on one route: the service-card grid renders once.
    assert.equal(count(html, /class="service-card"/g), 1);
    // (The layout's route footer links the page too; only service cards are counted.)
    assert.equal(count(html, /<a class="service-card"[^>]*href="\/services\/drains"/g), 1);

    // The contact section's structured copy renders above the verified form.
    const contact = readFileSync(join(ctx.distDir, "contact", "index.html"), "utf-8");
    assert.match(contact, /data-section-id="form"/);
    assert.match(contact, /<h2[^>]*>Contact us<\/h2>\s*<p[^>]*>Tell us what you need\.<\/p>/);
    assert.ok(contact.includes(`<form method="post" action="${LEAD_FORM}"`));
    assert.equal(count(contact, /<h1[\s>]/g), 1);
  } finally {
    cleanupContext(ctx);
  }
});
