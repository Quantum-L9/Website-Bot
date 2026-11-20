// L9_META: layer=script, role=stage_version_manifest_cli, status=active, version=1.0.0
//
// Check or update config/stage-version-manifest.json
// (src/pipeline/stageVersionManifest.ts).
//
//   npx tsx scripts/stage-version-manifest.ts            check; exit 1 on drift
//   npx tsx scripts/stage-version-manifest.ts --update   record version bumps
//   npx tsx scripts/stage-version-manifest.ts --update --unchanged Name="reason"
//       record a source change that leaves the stage's output semantics as
//       they were, with the reason, at the same version
//
// --update refuses (exit 1, manifest untouched) a stage whose output-shaping
// source changed while its version did not, unless --unchanged names it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  manifestProblems,
  readManifest,
  repoRoot,
  STAGE_VERSION_MANIFEST_PATH,
  updateManifest,
} from "../src/pipeline/stageVersionManifest.js";

const root = repoRoot();
const args = process.argv.slice(2);
const manifest = readManifest(root);

if (!args.includes("--update")) {
  const problems = manifestProblems(root, manifest);
  for (const problem of problems) console.error(`stage-version-manifest: ${problem}`);
  console.log(problems.length ? "STATUS: FAIL" : "STATUS: PASS");
  process.exitCode = problems.length ? 1 : 0;
} else {
  const unchanged: Record<string, string> = {};
  for (const [index, arg] of args.entries()) {
    let value: string | undefined;
    if (arg === "--unchanged") value = args[index + 1];
    else if (arg.startsWith("--unchanged=")) value = arg.slice("--unchanged=".length);
    if (value === undefined) continue;
    const separator = value.indexOf("=");
    if (separator <= 0)
      throw new Error(`--unchanged expects Name="reason", got ${JSON.stringify(value)}`);
    unchanged[value.slice(0, separator)] = value.slice(separator + 1);
  }
  const result = updateManifest(root, manifest, unchanged);
  for (const line of result.changed) console.log(`updated: ${line}`);
  for (const line of result.refused) console.error(`refused: ${line}`);
  if (result.refused.length) {
    console.log("STATUS: FAIL (manifest not written)");
    process.exitCode = 1;
  } else {
    writeFileSync(
      join(root, STAGE_VERSION_MANIFEST_PATH),
      `${JSON.stringify(result.manifest, null, 2)}\n`,
      "utf-8",
    );
    console.log(`STATUS: PASS (${result.changed.length} change(s) written)`);
  }
}
