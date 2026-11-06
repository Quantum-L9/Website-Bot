// L9_META: layer=test, role=astro_template_contract, status=active, version=1.0.0

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
  // WB-QAP-01: opt-in static layout variants are part of the registry contract.
  assert.match(registry, /SECTION_LAYOUT_VARIANTS = \["editorial", "diagram"\] as const/);
  assert.match(registry, /LAYOUT_TEMPLATE_PREFIX = "layout:"/);
  for (const component of ["EditorialSection", "DiagramSection"]) {
    assert.match(renderer, new RegExp(`import ${component} from "./sections/${component}.astro"`));
  }
  // WB-QAP-02: sections with a noncritical visual region render inside an
  // optional enhancement slot that passes the static section through unchanged.
  assert.match(renderer, /import VisualEnhancementSlot from "\.\/VisualEnhancementSlot\.astro"/);
  assert.match(renderer, /const visualSlot = slotForSection\(name\)/);
  assert.match(
    renderer,
    /<VisualEnhancementSlot slot=\{visualSlot\}>\s*<Component name=\{name\} content=\{content\} structured=\{structured\} \/>\s*<\/VisualEnhancementSlot>/,
  );
});

test("the section renderer shows the image the assembler bound to each section", () => {
  const renderer = readFileSync(
    resolve("astro_template/src/components/SectionRenderer.astro"),
    "utf8",
  );
  // The binding arrives as a prop and resolves only through the one published
  // image registry; there is no second lookup and no filename guessing.
  assert.match(renderer, /imagePlacement\?: string \| null;/);
  assert.match(
    renderer,
    /const \{ name, content, layout, imagePlacement, structured \} = Astro\.props;/,
  );
  // WB-GLUE-01: the accepted structured section reaches every component.
  assert.match(renderer, /structured\?: StructuredSectionView;/);
  assert.match(renderer, /import \{ siteConfig \} from "\.\.\/lib\/siteConfig";/);
  assert.match(renderer, /const image = imagePlacement \? images\[imagePlacement\] : undefined;/);
  // A binding the registry does not publish fails the build instead of vanishing.
  assert.match(
    renderer,
    /if \(imagePlacement && !image\) \{\s*throw new Error\(\s*`unpublished-image-placement:/,
  );
  // Hero.astro keeps sole ownership of the hero image (no duplicate render),
  // and the gallery receives its bound image through a prop.
  assert.match(
    renderer,
    /const contentImage = name === "hero" \|\| name === "gallery" \? undefined : image;/,
  );
  assert.match(
    renderer,
    /<Component name=\{name\} content=\{content\} structured=\{structured\} image=\{galleryImage\} \/>/,
  );
  // Bound content images render beside the section, lazily, with real dimensions.
  assert.match(renderer, /<figure class="content-block__visual">/);
  assert.match(
    renderer,
    /<img src=\{contentImage\.src\} alt=\{contentImage\.alt\} width=\{contentImage\.width\} height=\{contentImage\.height\} loading="lazy" decoding="async"/,
  );
  // The image-less branch stays the unwrapped section.
  assert.match(
    renderer,
    /\) : \(\s*<Component name=\{name\} content=\{content\} structured=\{structured\} \/>\s*\)\}\s*$/,
  );

  const gallery = readFileSync(
    resolve("astro_template/src/components/sections/Gallery.astro"),
    "utf8",
  );
  assert.match(gallery, /image\?: GalleryImage;/);
  assert.match(gallery, /for \(const candidate of image \? \[image, \.\.\.gallery\] : gallery\)/);
  // The see-all link renders only when the site publishes a /gallery route.
  assert.match(gallery, /\{hasGalleryRoute && \(\s*<a class="gallery-cta" href="\/gallery">/);

  const styles = readFileSync(resolve("astro_template/src/styles/global.css"), "utf8");
  for (const selector of [
    ".content-block {",
    ".content-block__visual img {",
    ".content-block--split",
  ]) {
    assert.ok(styles.includes(selector), `global.css defines ${selector}`);
  }
});

test("visual enhancement allowlists are compile-time constants that ship empty", () => {
  const allowlist = readFileSync(resolve("astro_template/src/lib/visualEnhancements.ts"), "utf8");
  assert.match(
    allowlist,
    /export const ENHANCER_MODULES: Readonly<Record<string, EnhancerModuleEntry>> = \{\};/,
  );
  assert.match(
    allowlist,
    /export const ENABLED_SLOTS: Readonly<Partial<Record<VisualSlotId, string>>> = \{\};/,
  );
  // The allowlist module stays import-free so it runs in the build, the browser and tests alike.
  assert.doesNotMatch(allowlist, /^import /m);
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

// Framework syntax, not an L9 inline metadata carrier, is authoritative for Astro.
test("every Astro component starts with its real frontmatter, without inline L9_META", () => {
  const root = resolve("astro_template/src");
  const visit = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = join(directory, entry.name);
      return entry.isDirectory() ? visit(file) : entry.name.endsWith(".astro") ? [file] : [];
    });
  const files = visit(root);
  assert.ok(files.length >= 17, "missing static layouts or template components");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /^---\r?\n/, `${file} frontmatter must start at byte zero`);
    assert.doesNotMatch(source, /<!--\s*L9_META/, `${file} must not contain retired inline header`);
  }
  const assembler = readFileSync(resolve("src/stages/SiteAssemblerStage.ts"), "utf8");
  assert.doesNotMatch(assembler, /<!--\s*L9_META: layer=generated_site/);
});
