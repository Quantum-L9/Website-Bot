// L9_META: layer=test, role=visual_reference_approval_cli, status=active, version=1.0.0
//
// The only way a visual reference is created or replaced (V4-01, V4-04,
// V4-06). Two explicit steps by a person, never by the pipeline, a test or CI:
//
//   1. npm run visual:approve
//        builds the reference fixture for real, requires the real browser gate
//        to pass, captures candidate screenshots into
//        build/visual-candidates/<design>/ and prints their digest. Nothing is
//        approved. Look at every PNG listed.
//   2. npm run visual:approve -- --approver "Your Name" --reason "why" \
//        --confirm <digest> [--replace]
//        re-checks the candidate files are byte-for-byte what step 1 wrote,
//        refuses in CI, refuses an agent/bot approver, refuses to overwrite
//        approved references without --replace, then copies the candidates
//        into tests/visual/references/<design>/ with an approval.json naming
//        you, and marks the design approved in registry.json.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  approvalRecord,
  approvalRefusals,
  CANDIDATE_MANIFEST,
  type CandidateManifest,
  candidateSetDigest,
  captureScreenshots,
  sha256,
} from "../../src/validation/visual-regression.js";
import { cleanupContext } from "../helpers/siteFactoryFixture.js";
import {
  buildReferenceSite,
  referenceDir,
  VISUAL_DESIGN_ID,
  VISUAL_FONT_DIR,
  VISUAL_REFERENCE_ROOT,
  VISUAL_ROUTES,
} from "../helpers/visualReferenceFixture.js";
import { readRegistry, writeRegistry } from "./registry.js";

const { values } = parseArgs({
  options: {
    approver: { type: "string" },
    reason: { type: "string" },
    confirm: { type: "string" },
    replace: { type: "boolean", default: false },
  },
});

const candidateDir = resolve("build/visual-candidates", VISUAL_DESIGN_ID);
const fail = (lines: string[]): never => {
  for (const line of lines) process.stderr.write(`REFUSED: ${line}\n`);
  process.exit(1);
};

async function captureCandidates(): Promise<void> {
  const site = await buildReferenceSite();
  try {
    rmSync(candidateDir, { recursive: true, force: true });
    const capture = await captureScreenshots({
      distDir: site.distDir,
      routes: VISUAL_ROUTES,
      outDir: candidateDir,
      fontDir: VISUAL_FONT_DIR,
    });
    const manifest: CandidateManifest = {
      design_id: VISUAL_DESIGN_ID,
      fixture: "tests/helpers/visualReferenceFixture.ts",
      git_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim(),
      rendered_site_validation: site.renderedSiteValidation,
      renderer: capture.renderer,
      screenshots: capture.screenshots,
    };
    writeFileSync(join(candidateDir, CANDIDATE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    if (site.renderedSiteValidation !== "PASS") {
      fail([
        `rendered-site validation failed; these candidates cannot be approved: ${site.renderedSiteError}`,
      ]);
    }
    process.stdout.write(
      `Candidates for ${VISUAL_DESIGN_ID} (${capture.renderer.engine} ${capture.renderer.version}):\n${capture.screenshots
        .map((shot) => `  ${join(candidateDir, shot.file)}  ${shot.width}x${shot.height}`)
        .join(
          "\n",
        )}\n\nReview every image. To approve exactly these files:\n  npm run visual:approve -- --approver "<your name>" --reason "<why>" --confirm ${candidateSetDigest(manifest)}\n`,
    );
  } finally {
    cleanupContext(site.ctx);
  }
}

function readCandidate(): CandidateManifest | undefined {
  const path = join(candidateDir, CANDIDATE_MANIFEST);
  if (!existsSync(path)) return undefined;
  const manifest = JSON.parse(readFileSync(path, "utf-8")) as CandidateManifest;
  for (const shot of manifest.screenshots) {
    const file = join(candidateDir, shot.file);
    if (!existsSync(file) || sha256(readFileSync(file)) !== shot.sha256) {
      fail([`${shot.file} changed after capture; recapture and review again`]);
    }
  }
  return manifest;
}

function approve(): void {
  const target = referenceDir(VISUAL_DESIGN_ID);
  const candidate = readCandidate();
  const refusals = approvalRefusals({
    approver: values.approver,
    reason: values.reason,
    confirm: values.confirm,
    replace: values.replace ?? false,
    env: process.env,
    candidate,
    referencesExist: existsSync(join(target, "approval.json")),
  });
  if (refusals.length > 0 || !candidate) fail(refusals);
  const approved = candidate as CandidateManifest;
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(target)) rmSync(join(target, file));
  for (const shot of approved.screenshots) {
    copyFileSync(join(candidateDir, shot.file), join(target, shot.file));
  }
  const record = approvalRecord(
    approved,
    values.approver as string,
    values.reason as string,
    new Date(),
  );
  writeFileSync(join(target, "approval.json"), `${JSON.stringify(record, null, 2)}\n`);
  const registry = readRegistry(VISUAL_REFERENCE_ROOT);
  writeRegistry(VISUAL_REFERENCE_ROOT, {
    ...registry,
    designs: registry.designs.map((design) =>
      design.design_id === VISUAL_DESIGN_ID ? { ...design, status: "approved" } : design,
    ),
  });
  process.stdout.write(
    `Approved ${approved.screenshots.length} references for ${VISUAL_DESIGN_ID} as ${record.approved_by}.\nCommit tests/visual/references/ for review.\n`,
  );
}

if (values.confirm === undefined && values.approver === undefined) await captureCandidates();
else approve();
