// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { BuildError } from "../../src/pipeline/BuildError.js";
import { SiteAssemblerStage } from "../../src/stages/SiteAssemblerStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

void test("materializes the fixture into a client-specific Astro project", async () => {
  const ctx = fixtureContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    assert.ok(existsSync(join(ctx.outputDir, "src/pages/index.astro")));
    assert.ok(existsSync(join(ctx.outputDir, "src/pages/services/index.astro")));
    assert.ok(existsSync(join(ctx.outputDir, "src/pages/contact/index.astro")));
    assert.ok(existsSync(join(ctx.outputDir, ".l9/assembly-manifest.json")));
    const config = readFileSync(join(ctx.outputDir, "src/lib/siteConfig.ts"), "utf-8");
    assert.match(config, /https:\/\/ci-test\.example\.com/);
    // F-12 regression: every published route must be in the siteConfig routes
    // registry so the layout footer can link it (no orphaned pages).
    assert.match(config, /"routes": \[\s*\{\s*"href": "\/"/);
    assert.match(config, /"href": "\/services"/);
    assert.match(config, /"href": "\/contact"/);
    const contact = readFileSync(join(ctx.outputDir, "src/pages/contact/index.astro"), "utf-8");
    assert.match(contact, /contact_form/);
    assert.match(contact, /fixture content/);
    // L2-S16-001: a route without a hero section still gets exactly one H1 —
    // the layout renders the route title; a hero route must not get a second.
    assert.match(contact, /pageHeading=\{"Contact"\}/);
    const services = readFileSync(join(ctx.outputDir, "src/pages/services/index.astro"), "utf-8");
    assert.match(services, /pageHeading=\{"Services"\}/);
    const home = readFileSync(join(ctx.outputDir, "src/pages/index.astro"), "utf-8");
    assert.doesNotMatch(home, /pageHeading=/);
    const layout = readFileSync(join(ctx.outputDir, "src/layouts/BaseLayout.astro"), "utf-8");
    assert.match(layout, /pageHeading && <h1 class="page-title">/);
    assert.match(ctx.assemblyManifest?.sourceDigest ?? "", /^[0-9a-f]{64}$/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("restores the prior site and cleans temp/backup state when the atomic swap fails", async () => {
  const ctx = fixtureContext();
  const originalOutput = ctx.outputDir;
  // Isolate the output parent so the staging (.tmp) assertions cannot race other files' assembler runs.
  const parent = mkdtempSync(join(tmpdir(), "assembler-rollback-"));
  const outputDir = join(parent, "site");
  mkdirSync(outputDir, { recursive: true });
  ctx.outputDir = outputDir;
  // Seed an existing, human-owned site that must survive a failed replacement byte-for-byte.
  const sentinelPath = join(outputDir, "HUMAN_KEEP.txt");
  const sentinel = "human authored notes — must survive rollback\n";
  writeFileSync(sentinelPath, sentinel, "utf-8");

  // Inject a single failure on the temp → output move; the backup move and restore delegate normally.
  let failedOnce = false;
  const rename = (from: string, to: string): void => {
    if (!failedOnce && from.includes(`${dirname(outputDir)}/.tmp/`) && to === outputDir) {
      failedOnce = true;
      throw new Error("injected atomic swap failure");
    }
    renameSync(from, to);
  };

  try {
    await assert.rejects(
      () => new SiteAssemblerStage(rename).run(ctx),
      (error: unknown) => error instanceof BuildError && error.code === "SITE_ASSEMBLY_FAILED",
    );
    assert.equal(failedOnce, true, "the injected swap failure must have fired");

    // Original site is restored, unchanged, and the generated project never landed.
    assert.ok(existsSync(sentinelPath));
    assert.equal(readFileSync(sentinelPath, "utf-8"), sentinel);
    assert.equal(existsSync(join(outputDir, "src/pages/index.astro")), false);

    // No backup directory is left behind alongside the output.
    const siblings = readdirSync(dirname(outputDir));
    assert.equal(
      siblings.some((name) => name.startsWith(`${basename(outputDir)}.backup-`)),
      false,
    );

    // The temporary staging directory for this build was removed.
    const tmpParent = join(dirname(outputDir), ".tmp");
    const tmpLeftovers = existsSync(tmpParent)
      ? readdirSync(tmpParent).filter((name) => name.includes(ctx.buildId))
      : [];
    assert.deepEqual(tmpLeftovers, []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(originalOutput, { recursive: true, force: true });
    cleanupContext(ctx);
  }
});

void test("serializes route data through Astro expressions instead of raw HTML attributes", async () => {
  const ctx = fixtureContext({
    business_name: 'CI "Quoted" Business',
    routes: [{ slug: "/", title: 'Home "Quoted"', components: ["hero"] }],
  });
  ctx.generatedContent.set("/", "unused");
  ctx.generatedContent.set(
    "/:hero",
    'Copy with "quotes", <angle brackets>, and\n\nmultiple paragraphs.',
  );
  try {
    await new SiteAssemblerStage().run(ctx);
    const page = readFileSync(join(ctx.outputDir, "src/pages/index.astro"), "utf-8");
    assert.match(page, /const sections = \[/);
    assert.match(page, /title=\{"Home \\"Quoted\\""\}/);
    assert.match(page, /content=\{section\.content\}/);
    assert.doesNotMatch(page, /<Section name="[^"]+" content="/);
  } finally {
    cleanupContext(ctx);
  }
});
