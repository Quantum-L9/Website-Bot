// L9_META: layer=test, role=astro_template_contract, status=active, version=1.0.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("canonical Astro template is versioned and exposes the required section registry", () => {
  const version = readFileSync(resolve("astro_template/TEMPLATE_VERSION"), "utf8").trim();
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const registry = readFileSync(
    resolve("astro_template/src/components/SectionRegistry.ts"),
    "utf8",
  );
  for (const component of ["hero", "process", "cta", "compliance_note", "faq", "contact_form"]) {
    assert.match(registry, new RegExp(`['"]${component}['"]`));
  }
  const renderer = readFileSync(
    resolve("astro_template/src/components/SectionRenderer.astro"),
    "utf8",
  );
  assert.match(renderer, /const registry/);
  assert.match(renderer, /ProseSection/);
});

test("Gallery section types its image array so empty text-only builds pass astro check", () => {
  // siteConfig is emitted `as const`; an empty galleryImages infers never[],
  // which made image.src/image.alt fail astro check (ts2339) in text-only builds.
  const gallery = readFileSync(
    resolve("astro_template/src/components/sections/Gallery.astro"),
    "utf8",
  );
  assert.match(
    gallery,
    /const gallery:\s*readonly\s+GalleryImage\[\]\s*=\s*siteConfig\.galleryImages/,
  );
});

test("BaseLayout links every route via a grouped footer nav and provides a skip link", () => {
  // F-12 regression: without the routes registry + footer nav, detail pages
  // (services/*, guides/*, service-areas/*) build but stay orphaned.
  const layout = readFileSync(resolve("astro_template/src/layouts/BaseLayout.astro"), "utf8");
  assert.match(layout, /footer-nav/);
  assert.match(layout, /routes\?: Array<\{ href: string; title: string \}>/);
  assert.match(layout, /href="#main-content" class="skip-link"/);
  assert.match(layout, /<main id="main-content">/);
});
