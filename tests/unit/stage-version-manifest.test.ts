// L9_META: layer=test, role=stage_version_manifest, status=active, version=1.0.0
//
// Checkpoint version discipline (L9-COORD-001: a checkpoint is a derived
// result valid only against its declared coordinates). The committed
// config/stage-version-manifest.json must describe every stage as it is now;
// a change to a stage's output-shaping source fails this suite until the
// stage's version is bumped or an explicit output_unchanged reason is
// recorded. The mechanism itself is exercised on a scratch copy of the stages.

import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  historyProblems,
  manifestProblems,
  readManifest,
  repoRoot,
  STAGE_VERSION_MANIFEST_PATH,
  stageIdentity,
  stageModules,
  stageSources,
  updateManifest,
} from "../../src/pipeline/stageVersionManifest.js";

const ROOT = repoRoot();

test("the committed manifest describes every stage at its current source", () => {
  const problems = manifestProblems(ROOT, readManifest(ROOT));
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every stage declares a version, so resume can key on it", () => {
  for (const module of stageModules(ROOT)) {
    const identity = stageIdentity(ROOT, module);
    assert.ok(identity.version, `${module} declares no version`);
  }
});

test("output-shaping sources follow non-type imports and declared extras", () => {
  const manifest = readManifest(ROOT);
  const assembler = stageSources(
    ROOT,
    "src/stages/SiteAssemblerStage.ts",
    manifest,
    "site-assembler",
  );
  assert.ok(assembler.includes("src/stages/SiteAssemblerStage.ts"));
  assert.ok(
    assembler.some((path) => path.startsWith("astro_template/src/components/")),
    "the Astro template shapes the assembler's output",
  );
  for (const infra of manifest.non_output_shaping)
    assert.ok(!assembler.includes(infra), `${infra} is excluded as non-output-shaping`);
});

/** A scratch repository holding two stages, one importing a helper. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "stage-manifest-"));
  mkdirSync(join(root, "src", "stages"), { recursive: true });
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "src", "lib", "shape.ts"), "export const shape = (x: string) => x;\n");
  writeFileSync(join(root, "src", "lib", "log.ts"), "export const log = () => {};\n");
  writeFileSync(
    join(root, "src", "stages", "AlphaStage.ts"),
    [
      'import { log } from "../lib/log.js";',
      'import { shape } from "../lib/shape.js";',
      'import type { Unused } from "../lib/types.js";',
      "export class AlphaStage {",
      '  name = "alpha";',
      '  version = "1.0.0";',
      '  run() { log(); return shape("a"); }',
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src", "stages", "BetaStage.ts"),
    'export class BetaStage {\n  name = "beta";\n  version = "2.0.0";\n}\n',
  );
  writeFileSync(
    join(root, STAGE_VERSION_MANIFEST_PATH),
    JSON.stringify({
      schema: "website-bot.stage-version-manifest/v1",
      non_output_shaping: ["src/lib/log.ts"],
      extra_sources: {},
      stages: {},
    }),
  );
  const seeded = updateManifest(root, readManifest(root));
  assert.deepEqual(seeded.refused, []);
  writeFileSync(join(root, STAGE_VERSION_MANIFEST_PATH), JSON.stringify(seeded.manifest));
  return root;
}

function edit(root: string, path: string, from: string, to: string): void {
  const full = join(root, path);
  writeFileSync(full, readFileSync(full, "utf-8").replace(from, to));
}

test("a changed output-shaping dependency fails until the version is bumped", () => {
  const root = scratch();
  try {
    assert.deepEqual(manifestProblems(root, readManifest(root)), []);
    edit(root, "src/lib/shape.ts", "x;", "x.trim();");
    const problems = manifestProblems(root, readManifest(root));
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0] ?? "", /^alpha: output-shaping source changed/);
    // Without a bump or a reason the update refuses and writes nothing.
    const refused = updateManifest(root, readManifest(root));
    assert.equal(refused.refused.length, 1);
    assert.match(refused.refused[0] ?? "", /bump the version or pass --unchanged alpha/);
    // With a bump the update records it and the check passes.
    edit(root, "src/stages/AlphaStage.ts", 'version = "1.0.0"', 'version = "1.1.0"');
    const bumped = updateManifest(root, readManifest(root));
    assert.deepEqual(bumped.refused, []);
    assert.deepEqual(
      bumped.manifest.stages.alpha?.history.map((entry) => entry.version),
      ["1.0.0", "1.1.0"],
    );
    assert.deepEqual(manifestProblems(root, bumped.manifest), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit output_unchanged reason records a change at the same version", () => {
  const root = scratch();
  try {
    edit(root, "src/stages/AlphaStage.ts", "run() {", "run() { // comment only\n");
    const updated = updateManifest(root, readManifest(root), {
      alpha: "comment only; output identical",
    });
    assert.deepEqual(updated.refused, []);
    const latest = updated.manifest.stages.alpha?.history.at(-1);
    assert.equal(latest?.version, "1.0.0");
    assert.equal(latest?.output_unchanged, "comment only; output identical");
    assert.deepEqual(manifestProblems(root, updated.manifest), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-output-shaping and type-only imports do not move the fingerprint", () => {
  const root = scratch();
  try {
    edit(root, "src/lib/log.ts", "{}", "{ /* noisy */ }");
    assert.deepEqual(manifestProblems(root, readManifest(root)), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stage without a version, a stale entry and a hand-edited history all fail", () => {
  const root = scratch();
  try {
    edit(root, "src/stages/BetaStage.ts", '  version = "2.0.0";\n', "");
    const manifest = readManifest(root);
    manifest.stages.ghost = structuredClone(manifest.stages.alpha as never);
    const problems = manifestProblems(root, manifest).join("\n");
    assert.match(problems, /beta \(src\/stages\/BetaStage\.ts\): declares no version/);
    assert.match(problems, /ghost: in the manifest but no stage declares it/);
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const other = `sha256:${"b".repeat(64)}`;
    assert.match(
      historyProblems("alpha", [
        { version: "1.0.0", fingerprint },
        { version: "1.0.0", fingerprint: other },
      ]).join("\n"),
      /without an output_unchanged reason/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the repository's own manifest refuses an unversioned source change", () => {
  // The same mechanism on a copy of the real stages: any edit to a stage
  // module without a bump is caught by name.
  const root = mkdtempSync(join(tmpdir(), "stage-manifest-real-"));
  try {
    for (const path of [
      "src",
      "astro_template/src",
      "astro_template/package.json",
      "astro_template/astro.config.mjs",
      "config",
    ])
      cpSync(join(ROOT, path), join(root, path), { recursive: true });
    edit(
      root,
      "src/stages/ImageAssetPlanningStage.ts",
      "class ImageAssetPlanningStage",
      "class ImageAssetPlanningStage /* changed */",
    );
    const problems = manifestProblems(root, readManifest(root));
    // The changed module and the stage that imports it are both caught.
    assert.deepEqual(
      problems.map((problem) => problem.split(":")[0]),
      ["image-asset-planning", "image-generation"],
      problems.join("\n"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
