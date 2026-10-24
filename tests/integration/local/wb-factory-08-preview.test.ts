// L9_META: layer=test, role=local_preview_receipt_integration, status=active, version=1.0.0
//
// WB-FACTORY-08: scripts/site-preview.mjs drives the native validator
// (scripts/validate-site-factory.ts --build: SiteAssemblerStage, SiteBuildStage
// with real npm install / astro check / astro build, RenderedSiteValidationStage
// in real Chromium) and writes a receipt it re-verifies against disk. Specs are
// throwaway copies of the fictional WB-FACTORY-07 fixtures with their own client
// ids, written under the gitignored build/ tree; tracked fixtures are never
// edited. Requires network for the generated site's npm install and the
// Playwright chromium binary; absence fails this gate (CI Gate 5 provides both).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const REPO = resolve(".");
const WORK = resolve("build", "wb08-preview-test");
const PREVIEW = "scripts/site-preview.mjs";
const VALIDATOR = "scripts/validate-site-factory.ts";

interface Receipt {
  schema: string;
  status: string;
  problems: string[];
  remote_deploy: string;
  withheld_env: string[];
  build_id: string;
  client_id: string;
  routes: string[];
  generator: { repository_head: string; tracked_changes: boolean | string };
  input: { spec_path: string; spec_sha256: string };
  build: { checks: Array<{ name: string; status: string }>; dist_digest: string };
  output: { source_dir: string; dist_dir: string; dist_digest: string; evidence_dir: string };
  browser: {
    report_path: string;
    screenshot_dir: string;
    viewports: string[];
    renders: number;
    screenshots: Array<{ route: string; viewport: string; path: string; sha256: string }>;
  };
}
interface PreviewModule {
  verifyReceipt(receipt: unknown, repoRoot?: string): Promise<string[]>;
}
const preview = (await import(
  new URL(`../../../${PREVIEW}`, import.meta.url).href
)) as PreviewModule;

const cleanup = new Set<string>([WORK]);
test.after(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true });
});

/** A throwaway copy of a fictional WB-07 fixture under build/, with its own client id. */
function specCopy(
  fixture: "editorial" | "industrial",
  clientId: string,
  edit = (text: string) => text,
) {
  const source = readFileSync(`fixtures/wb-factory-07-${fixture}.yaml`, "utf-8");
  const path = join(WORK, `${clientId}.yaml`);
  mkdirSync(WORK, { recursive: true });
  writeFileSync(path, edit(source.replace(/^client_id: .*$/m, `client_id: ${clientId}`)));
  for (const dir of [
    resolve("build", "validation", clientId),
    resolve("build", "validation-evidence", clientId),
    resolve("build", "assets", clientId),
  ])
    cleanup.add(dir);
  return path;
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}, unset: string[] = []) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of unset) delete childEnv[key];
  const result = spawnSync(
    process.execPath,
    [...(script.endsWith(".ts") ? ["--import", "tsx"] : []), script, ...args],
    {
      cwd: REPO,
      encoding: "utf-8",
      env: childEnv,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function receiptFrom(out: string): { path: string; receipt: Receipt } {
  const path = out.match(/^receipt: (.+)$/m)?.[1];
  assert.ok(path, `a receipt path is printed:\n${out.slice(-2000)}`);
  cleanup.add(dirname(path));
  return { path, receipt: JSON.parse(readFileSync(path, "utf-8")) as Receipt };
}

let primary: { path: string; receipt: Receipt; spec: string } | undefined;

void test("NEGATIVE invocation: bad, out-of-scope or remote invocations are BLOCKED before anything runs", () => {
  const cases = [
    [],
    ["--spec=fixtures/does-not-exist.yaml"],
    ["--spec=../outside-repo.yaml"],
    ["--spec=package.json"],
    ["--spec=fixtures/wb-factory-07-editorial.yaml", "--deploy"],
    ["--spec=fixtures/wb-factory-07-editorial.yaml", "--mode=end-to-end"],
    ["--spec=fixtures/wb-factory-07-editorial.yaml", "--publish=vercel"],
    ["--spec=fixtures/wb-factory-07-editorial.yaml", "--extra"],
  ];
  for (const args of cases) {
    const { code, out } = run(PREVIEW, args);
    assert.equal(code, 2, `${args.join(" ")} exits 2`);
    assert.match(out, /STATUS: BLOCKED/);
    assert.doesNotMatch(out, /^receipt: /m, "no receipt is written");
  }
});

void test("NEGATIVE malformed spec: the native validator rejects it and the receipt is FAIL", () => {
  const spec = specCopy("editorial", "wb08-malformed", (text) =>
    text.replace(/^routes:[\s\S]*?^seo_contract:/m, "seo_contract:"),
  );
  const { code, out } = run(PREVIEW, [`--spec=${spec}`], {
    VERCEL_TOKEN: "must-not-reach-the-child",
  });
  assert.equal(code, 1);
  const { receipt } = receiptFrom(out);
  assert.equal(receipt.status, "FAIL");
  assert.match(receipt.problems.join(), /validator exited 1/);
  assert.ok(
    receipt.withheld_env.includes("VERCEL_TOKEN"),
    "deploy credentials never reach the validator",
  );
  assert.equal(receipt.remote_deploy, "NOT_INVOKED");
  assert.equal(receipt.build_id, undefined);
});

void test("a fictional spec builds and renders through the native stages into one verifiable PASS receipt", async () => {
  const spec = specCopy("editorial", "wb08-preview-a");
  const { code, out } = run(PREVIEW, [`--spec=${spec}`]);
  assert.equal(code, 0, out.slice(-3000));
  const { path, receipt } = receiptFrom(out);
  primary = { path, receipt, spec };
  assert.equal(receipt.status, "PASS", receipt.problems.join("; "));
  assert.deepEqual(receipt.problems, []);
  assert.equal(receipt.client_id, "wb08-preview-a");
  assert.deepEqual(receipt.routes, [
    "/",
    "/journal",
    "/journal/paper-grain",
    "/workshops",
    "/contact",
  ]);
  assert.match(receipt.input.spec_sha256, /^[0-9a-f]{64}$/);
  assert.match(receipt.generator.repository_head, /^([0-9a-f]{40}|UNKNOWN)$/);
  for (const check of ["install", "astro-check", "astro-build", "route-assertion"])
    assert.equal(receipt.build.checks.find((item) => item.name === check)?.status, "passed");
  assert.match(receipt.output.dist_digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(receipt.browser.viewports, ["desktop", "mobile"]);
  assert.equal(receipt.browser.renders, 10);
  assert.equal(receipt.browser.screenshots.length, 10);
  // KEEP retains this run's evidence: the report and every screenshot are still on disk.
  assert.ok(existsSync(receipt.browser.report_path));
  for (const shot of receipt.browser.screenshots) assert.ok(existsSync(shot.path), shot.path);
  assert.ok(existsSync(join(receipt.output.dist_dir, "index.html")));
  assert.equal(receipt.remote_deploy, "NOT_INVOKED");
  const verified = run(PREVIEW, [`--verify=${path}`]);
  assert.equal(verified.code, 0, verified.out);
  assert.match(verified.out, /STATUS: PASS/);
});

/** Apply a disk mutation, re-verify the PASS receipt, then undo it. */
async function problemsWhile(mutate: () => () => void): Promise<string[]> {
  assert.ok(primary, "the PASS receipt from the previous test");
  const undo = mutate();
  try {
    return await preview.verifyReceipt(primary.receipt);
  } finally {
    undo();
  }
}

function moveAside(path: string): () => void {
  const aside = `${path}.aside`;
  renameSync(path, aside);
  return () => renameSync(aside, path);
}

void test("NEGATIVE verify: tampered or missing build, report, screenshot or input never stays PASS", async () => {
  assert.ok(primary);
  const { receipt, spec } = primary;
  const page = join(receipt.output.dist_dir, "index.html");
  const original = readFileSync(page);
  assert.match(
    (
      await problemsWhile(() => {
        writeFileSync(page, `${original}<!-- tampered -->`);
        return () => writeFileSync(page, original);
      })
    ).join(),
    /build output digest mismatch/,
  );
  assert.match(
    (await problemsWhile(() => moveAside(receipt.output.dist_dir))).join(),
    /build output \(dist\) missing/,
  );
  assert.match(
    (await problemsWhile(() => moveAside(receipt.browser.report_path))).join(),
    /browser report missing/,
  );
  const shot = receipt.browser.screenshots[3].path;
  assert.match((await problemsWhile(() => moveAside(shot))).join(), /screenshot missing/);
  const specBytes = readFileSync(spec);
  assert.match(
    (
      await problemsWhile(() => {
        writeFileSync(spec, `${specBytes}\n# edited`);
        return () => writeFileSync(spec, specBytes);
      })
    ).join(),
    /input spec changed/,
  );
  // A receipt whose recorded digest conflicts with its own build proof.
  const conflicting = structuredClone(receipt);
  conflicting.build.dist_digest = "0".repeat(64);
  assert.match((await preview.verifyReceipt(conflicting)).join(), /disagree with the build proof/);
  // Everything restored: the untouched receipt verifies again.
  assert.deepEqual(await preview.verifyReceipt(receipt), []);
});

void test("NEGATIVE stale receipt: after a rebuild from changed input, the earlier receipt fails", async () => {
  assert.ok(primary);
  writeFileSync(
    primary.spec,
    readFileSync(primary.spec, "utf-8").replace("title: Workshops", "title: Studio Workshops"),
  );
  const { code, out } = run(PREVIEW, [`--spec=${primary.spec}`]);
  assert.equal(code, 0, out.slice(-3000));
  assert.equal(receiptFrom(out).receipt.status, "PASS");
  const stale = run(PREVIEW, [`--verify=${primary.path}`]);
  assert.equal(stale.code, 1);
  assert.match(stale.out, /input spec changed/);
  assert.match(stale.out, /digest mismatch/);
  assert.match(stale.out, /STATUS: FAIL/);
});

void test("NEGATIVE no browser: a missing Chromium yields a FAIL receipt, never PASS", () => {
  const spec = specCopy("industrial", "wb08-no-browser");
  const { code, out } = run(PREVIEW, [`--spec=${spec}`], {
    PLAYWRIGHT_BROWSERS_PATH: join(WORK, "no-browsers-here"),
  });
  assert.equal(code, 1);
  const { receipt } = receiptFrom(out);
  assert.equal(receipt.status, "FAIL");
  assert.match(
    readFileSync(join(dirname(receiptFrom(out).path), "validator.log"), "utf-8"),
    /browser unavailable|Executable doesn't exist|RENDERED_SITE_VALIDATION_FAILED/,
  );
});

void test("without KEEP the validator removes only this run's output; other clients' output survives", () => {
  const unrelated = [
    resolve("build", "validation", "wb08-unrelated-client", "KEEP.txt"),
    resolve("build", "validation-evidence", "wb08-unrelated-client", "older-run", "KEEP.txt"),
    resolve("build", "assets", "wb08-unrelated-client", "older-run", "KEEP.txt"),
  ];
  for (const path of unrelated) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "unrelated client output");
  }
  for (const root of ["validation", "validation-evidence", "assets"])
    cleanup.add(resolve("build", root, "wb08-unrelated-client"));
  const spec = specCopy("industrial", "wb08-keep-off");
  const result = join(WORK, "keep-off-result.json");
  const { code, out } = run(VALIDATOR, [`--spec=${spec}`, "--build", `--result=${result}`], {}, [
    "KEEP_SITE_FACTORY_VALIDATION_OUTPUT",
  ]);
  assert.equal(code, 0, out.slice(-3000));
  const summary = JSON.parse(readFileSync(result, "utf-8"));
  assert.equal(summary.status, "passed");
  for (const path of [summary.outputDir, summary.evidenceDir, summary.screenshotDir])
    assert.equal(existsSync(path), false, `${path} is cleaned without KEEP`);
  // Emptied per-client parents are removed too; non-empty ones are left alone.
  for (const root of ["validation-evidence", "assets"])
    assert.equal(existsSync(resolve("build", root, "wb08-keep-off")), false);
  for (const path of unrelated)
    assert.equal(readFileSync(path, "utf-8"), "unrelated client output");
  for (const path of unrelated) unlinkSync(path);
});
