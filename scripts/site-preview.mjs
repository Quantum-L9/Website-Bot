// L9_META: layer=script, role=local_site_preview_receipt, status=active, version=1.0.0
//
// Local preview + evidence handoff (WB-FACTORY-08). A thin wrapper around the
// native validator: `scripts/validate-site-factory.ts --build` assembles the
// site, runs the real npm install / astro check / astro build (SiteBuildStage)
// and renders every route in Chromium (RenderedSiteValidationStage). This
// script generates nothing itself. It keeps that run's output, then writes a
// receipt binding the exact input to the measured output, and re-verifies it
// against what is on disk.
//
//   node scripts/site-preview.mjs --spec=fixtures/wb-factory-07-editorial.yaml
//   node scripts/site-preview.mjs --verify=build/site-preview/<run>/receipt.json
//
// Exit codes: 0 PASS, 1 FAIL (a receipt with status FAIL is written), 2 BLOCKED
// (invalid invocation; nothing runs). Content is the validator's deterministic
// fixture copy: a preview is never evidence of SEO-Bot or LLM output, a
// deployment, or client-site readiness. Nothing here deploys or publishes.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PREVIEW_RECEIPT_SCHEMA = "website-bot.local-preview-receipt/v1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = "scripts/validate-site-factory.ts";
const REQUIRED_BUILD_CHECKS = ["install", "astro-check", "astro-build", "route-assertion"];
// Anything that could reach a deploy, publish or provider stays out of the child.
const REMOTE_ENV =
  /VERCEL|DEPLOY|PUBLISH|GITHUB|GH_TOKEN|SEO_BOT|OPENROUTER|PERPLEXITY|GEMINI|INFISICAL|POSTHOG|CRM_/i;
const REMOTE_FLAGS = /^--(deploy|publish|push|mode|vercel|release)\b/;
const SCOPE =
  "Local fixture preview only: deterministic test-supplied content built and rendered by the native " +
  "SiteBuildStage and RenderedSiteValidationStage. Not SEO-Bot or LLM content, not a deployment, " +
  "not SEO approval, and not client-site or production readiness.";

export class PreviewUsageError extends Error {}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

/** Resolve the invocation. An invalid one is a usage error and nothing runs. */
export function parsePreviewArgs(argv, repoRoot = REPO_ROOT) {
  const remote = argv.filter((argument) => REMOTE_FLAGS.test(argument));
  if (remote.length)
    throw new PreviewUsageError(`remote/deploy options are not accepted: ${remote.join(" ")}`);
  const value = (name) =>
    argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
  const unknown = argv.filter((argument) => !/^--(spec|verify)=/.test(argument));
  if (unknown.length) throw new PreviewUsageError(`unknown arguments: ${unknown.join(" ")}`);
  const verify = value("verify");
  if (verify) return { mode: "verify", receiptPath: resolve(verify) };
  const raw = value("spec");
  if (!raw)
    throw new PreviewUsageError(
      "--spec=<path to a DomainSpec .yaml inside this repository> is required",
    );
  const spec = resolve(repoRoot, raw);
  if (!inside(repoRoot, spec))
    throw new PreviewUsageError(`spec ${raw} is outside this repository`);
  if (![".yaml", ".yml"].includes(extname(spec)))
    throw new PreviewUsageError(`spec ${raw} is not a .yaml/.yml file`);
  if (!existsSync(spec) || !statSync(spec).isFile())
    throw new PreviewUsageError(`spec ${raw} does not exist`);
  return { mode: "build", spec };
}

// git is called by a fixed absolute path, never resolved through PATH; with no
// known install the provenance is recorded as UNKNOWN rather than guessed.
const GIT_CANDIDATES = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

function gitState(repoRoot) {
  const git = GIT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!git) return { head: "UNKNOWN", tracked_changes: "UNKNOWN" };
  try {
    const run = (args) => execFileSync(git, args, { cwd: repoRoot, encoding: "utf-8" }).trim();
    const head = run(["rev-parse", "HEAD"]);
    const dirty = run(["status", "--porcelain", "--untracked-files=no"]);
    return {
      head: /^[0-9a-f]{40}$/.test(head) ? head : "UNKNOWN",
      tracked_changes: dirty.length > 0,
    };
  } catch {
    return { head: "UNKNOWN", tracked_changes: "UNKNOWN" };
  }
}

async function nativeModules(repoRoot) {
  const { register } = await import("tsx/esm/api");
  register();
  const load = (path) => import(pathToFileURL(resolve(repoRoot, path)).href);
  const [hashing, rendered, specs, codec, yaml] = await Promise.all([
    load("src/services/hashing.ts"),
    load("src/validation/rendered-site.ts"),
    load("src/pipeline/validateDomainSpec.ts"),
    load("src/pipeline/evidence/EvidenceCodec.ts"),
    import("yaml"),
  ]);
  return { hashing, rendered, specs, codec, yaml };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function inputProblems(receipt) {
  const spec = receipt.input?.spec_path;
  if (!spec || !existsSync(spec)) return ["input spec missing"];
  return sha256(readFileSync(spec)) === receipt.input.spec_sha256
    ? []
    : ["input spec changed since the receipt"];
}

/** Build verdicts, and source/dist digests recomputed with the native hashing SiteBuildStage uses. */
function buildProblems(receipt, hashing) {
  const problems = [];
  const out = receipt.output ?? {};
  for (const check of REQUIRED_BUILD_CHECKS) {
    const verdict = (receipt.build?.checks ?? []).find((item) => item.name === check)?.status;
    if (verdict !== "passed") problems.push(`build check ${check}: ${verdict ?? "missing"}`);
  }
  const digestOf = (dir, options) => hashing.digestDirectory(dir, options).digest;
  if (!out.source_dir || !existsSync(out.source_dir)) problems.push("generated source missing");
  else if (
    digestOf(out.source_dir, { exclude: hashing.isSourceDigestExcluded }) !== out.source_digest
  )
    problems.push("generated source digest mismatch");
  if (!out.dist_dir || !existsSync(out.dist_dir)) problems.push("build output (dist) missing");
  else if (digestOf(out.dist_dir) !== out.dist_digest)
    problems.push("build output digest mismatch");
  if (
    out.source_digest !== receipt.build?.source_digest ||
    out.dist_digest !== receipt.build?.dist_digest
  )
    problems.push("receipt digests disagree with the build proof");
  return problems;
}

function reportProblems(receipt, rendered) {
  const reportPath = receipt.browser?.report_path;
  if (!reportPath || !existsSync(reportPath))
    return { report: undefined, problems: ["browser report missing"] };
  const report = readJson(reportPath);
  const problems = [];
  if (sha256(readFileSync(reportPath)) !== receipt.browser.report_sha256)
    problems.push("browser report changed since the receipt");
  if (report.schema !== rendered.RENDERED_SITE_VALIDATION_SCHEMA)
    problems.push("unknown browser report schema");
  if (report.status !== "PASS") problems.push(`browser report status ${report.status}`);
  if (report.build_id !== receipt.build_id)
    problems.push("browser report belongs to another build");
  return { report, problems };
}

function screenshotProblem(receipt, shots, route, viewport) {
  const matches = shots.filter((item) => item.route === route && item.viewport === viewport);
  if (matches.length !== 1) return `${matches.length} screenshots`;
  const { path, sha256: recorded } = matches[0];
  if (!inside(receipt.browser.screenshot_dir, path)) return "screenshot outside this run";
  if (!existsSync(path)) return "screenshot missing";
  const bytes = readFileSync(path);
  return bytes.length === 0 || sha256(bytes) !== recorded
    ? "screenshot changed since the receipt"
    : undefined;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The coverage a receipt must prove, derived from native artifacts, never
 * from the receipt: routes from the re-validated spec (cross-checked against
 * the build proof's builtRoutes), viewports from the browser report.
 */
function expectedCoverage(receipt, report, natives) {
  const problems = [];
  let routes;
  try {
    const path = receipt.input?.spec_path;
    const spec = natives.specs.validateDomainSpec(
      natives.yaml.parse(readFileSync(path, "utf-8")),
      path,
    );
    routes = spec.routes.map((route) => route.slug);
  } catch (error) {
    problems.push(
      `input spec does not validate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const proofPath =
    receipt.output?.evidence_dir && resolve(receipt.output.evidence_dir, "build-proof.json");
  if (!proofPath || !existsSync(proofPath)) problems.push("native build proof missing");
  else {
    const proof = natives.codec.decodeEvidenceArtifact("build", readJson(proofPath));
    if (proof.buildId !== receipt.build_id) problems.push("build proof belongs to another build");
    if (
      proof.distDigest !== receipt.output?.dist_digest ||
      proof.sourceDigest !== receipt.output?.source_digest
    )
      problems.push("build proof digests disagree with the receipt");
    if (routes && !same(proof.builtRoutes, routes))
      problems.push("build proof routes differ from the spec");
  }
  const viewports = (report?.viewports ?? []).map((viewport) => viewport.name);
  if (report && !viewports.length) problems.push("browser report declares no viewports");
  return { routes: routes ?? [], viewports, problems };
}

/**
 * Exactly one PASS render and one unchanged screenshot for every expected
 * route x viewport, and nothing else: the receipt's own route, viewport and
 * screenshot lists must equal the native coverage, so deleting, reordering,
 * duplicating or adding rows in a receipt cannot narrow what it proves.
 */
function coverageProblems(receipt, report, expected) {
  const { routes, viewports } = expected;
  const problems = [...expected.problems];
  if (!routes.length || !viewports.length) return [...problems, "no expected routes or viewports"];
  if (!same(receipt.routes, routes)) problems.push("receipt routes differ from the spec");
  if (!same(receipt.browser?.viewports, viewports))
    problems.push("receipt viewports differ from the browser report");
  const pairs = routes.length * viewports.length;
  const renders = report?.routes ?? [];
  const shots = receipt.browser?.screenshots ?? [];
  if (report && renders.length !== pairs)
    problems.push(`browser report has ${renders.length} renders, expected ${pairs}`);
  if (shots.length !== pairs)
    problems.push(`receipt has ${shots.length} screenshots, expected ${pairs}`);
  if (report && report.summary?.renders !== pairs)
    problems.push("browser report summary disagrees with its coverage");
  for (const route of routes) {
    for (const viewport of viewports) {
      const pair = `${route}@${viewport}`;
      const matches = renders.filter((item) => item.route === route && item.viewport === viewport);
      if (report && (matches.length !== 1 || matches[0].status !== "PASS"))
        problems.push(
          `${pair}: ${matches.length} renders, status ${matches[0]?.status ?? "missing"}`,
        );
      const shot = screenshotProblem(receipt, shots, route, viewport);
      if (shot) problems.push(`${pair}: ${shot}`);
      else if (matches.length === 1) {
        const recorded = shots.find((item) => item.route === route && item.viewport === viewport);
        if (recorded.path !== matches[0].screenshot_path)
          problems.push(`${pair}: screenshot is not the one the browser report recorded`);
      }
    }
  }
  return problems;
}

/**
 * Re-verify a receipt against what is on disk now. Empty problems is the only
 * PASS. Every input and output the receipt names is re-read and re-hashed, and
 * the coverage it must prove comes from the native artifacts.
 */
export async function verifyReceipt(receipt, repoRoot = REPO_ROOT) {
  if (receipt?.schema !== PREVIEW_RECEIPT_SCHEMA) return ["unknown receipt schema"];
  const natives = await nativeModules(repoRoot);
  const { report, problems: reportIssues } = reportProblems(receipt, natives.rendered);
  return [
    ...(receipt.remote_deploy === "NOT_INVOKED"
      ? []
      : ["receipt does not record NOT_INVOKED deploy"]),
    ...inputProblems(receipt),
    ...buildProblems(receipt, natives.hashing),
    ...reportIssues,
    ...coverageProblems(receipt, report, expectedCoverage(receipt, report, natives)),
  ];
}

function childEnv() {
  const env = {};
  const withheld = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (REMOTE_ENV.test(key)) withheld.push(key);
    else env[key] = value;
  }
  env.KEEP_SITE_FACTORY_VALIDATION_OUTPUT = "true";
  return { env, withheld: withheld.toSorted((a, b) => a.localeCompare(b)) };
}

/** Run the native validator for one spec and write this run's receipt. */
export async function buildPreview(spec, repoRoot = REPO_ROOT) {
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDir = resolve(repoRoot, "build", "site-preview", runId);
  mkdirSync(runDir, { recursive: true });
  const resultPath = resolve(runDir, "validation-result.json");
  const logPath = resolve(runDir, "validator.log");
  const receiptPath = resolve(runDir, "receipt.json");
  const specBytes = readFileSync(spec);
  const { env, withheld } = childEnv();
  const generator = gitState(repoRoot);

  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", VALIDATOR, `--spec=${spec}`, "--build", `--result=${resultPath}`],
    { cwd: repoRoot, env, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );
  writeFileSync(logPath, `${child.stdout ?? ""}${child.stderr ?? ""}`, "utf-8");

  const receipt = {
    schema: PREVIEW_RECEIPT_SCHEMA,
    run_id: runId,
    created_at: new Date().toISOString(),
    status: "FAIL",
    problems: [],
    scope: SCOPE,
    remote_deploy: "NOT_INVOKED",
    withheld_env: withheld,
    generator: { repository_head: generator.head, tracked_changes: generator.tracked_changes },
    input: { spec_path: spec, spec_sha256: sha256(specBytes) },
    validator: {
      command: `node --import tsx ${VALIDATOR} --spec=<spec> --build`,
      exit_code: child.status,
      log_path: logPath,
    },
  };

  if (child.status !== 0 || !existsSync(resultPath)) {
    receipt.problems.push(
      child.error
        ? `validator could not start: ${child.error.message}`
        : `validator exited ${child.status ?? child.signal}; see ${logPath}`,
    );
  } else {
    const result = readJson(resultPath);
    const report =
      result.renderedSiteValidation && existsSync(result.renderedSiteValidation)
        ? readJson(result.renderedSiteValidation)
        : undefined;
    Object.assign(receipt, {
      build_id: result.buildId,
      client_id: result.clientId,
      routes: result.routeSlugs,
      // Which design the preview used: the native stage's tokens, or the validator's fixed
      // tokens for a pending design (which needs an LLM this offline path does not run).
      design: { source: result.designSource, tokens: result.designTokens },
      build: {
        proof_id: result.buildProof?.proofId,
        checks: result.buildProof?.checks ?? [],
        source_digest: result.buildProof?.sourceDigest,
        dist_digest: result.buildProof?.distDigest,
      },
      output: {
        source_dir: result.outputDir,
        source_digest: result.sourceDigest,
        dist_dir: result.distDir,
        dist_digest: result.distDigest,
        evidence_dir: result.evidenceDir,
      },
      browser: {
        engine: report?.browser?.engine,
        version: report?.browser?.version,
        viewports: (report?.viewports ?? []).map((viewport) => viewport.name),
        report_path: result.renderedSiteValidation,
        report_sha256: report ? sha256(readFileSync(result.renderedSiteValidation)) : undefined,
        screenshot_dir: result.screenshotDir,
        renders: report?.summary?.renders,
        screenshots: (report?.routes ?? []).map((render) => ({
          route: render.route,
          viewport: render.viewport,
          path: render.screenshot_path,
          sha256:
            render.screenshot_path && existsSync(render.screenshot_path)
              ? sha256(readFileSync(render.screenshot_path))
              : null,
        })),
      },
    });
    receipt.problems.push(...(await verifyReceipt(receipt, repoRoot)));
  }
  if (receipt.problems.length === 0) receipt.status = "PASS";
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
  return { receipt, receiptPath };
}

/** `--verify`: re-check a recorded receipt; exit code 0 only when it is still PASS. */
async function verifyCli(receiptPath) {
  if (!existsSync(receiptPath)) {
    console.error(`site-preview: receipt ${receiptPath} does not exist`);
    console.log("STATUS: FAIL");
    return 1;
  }
  const receipt = readJson(receiptPath);
  const problems =
    receipt.status === "PASS" ? await verifyReceipt(receipt) : ["receipt was not PASS"];
  for (const problem of problems) console.log(`problem: ${problem}`);
  console.log(`STATUS: ${problems.length ? "FAIL" : "PASS"}`);
  return problems.length ? 1 : 0;
}

async function cli() {
  let args;
  try {
    args = parsePreviewArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`site-preview: ${error.message}`);
    console.log("STATUS: BLOCKED");
    process.exitCode = 2;
    return;
  }
  if (args.mode === "verify") {
    process.exitCode = await verifyCli(args.receiptPath);
    return;
  }
  const { receipt, receiptPath } = await buildPreview(args.spec);
  console.log(`receipt: ${receiptPath}`);
  if (receipt.output?.dist_dir) console.log(`built site: ${receipt.output.dist_dir}`);
  if (receipt.browser?.screenshot_dir)
    console.log(`screenshots: ${receipt.browser.screenshot_dir}`);
  for (const problem of receipt.problems) console.log(`problem: ${problem}`);
  console.log(`STATUS: ${receipt.status}`);
  process.exitCode = receipt.status === "PASS" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await cli().catch((error) => {
    console.error(`site-preview: unexpected failure: ${error?.stack ?? error}`);
    console.log("STATUS: FAIL");
    process.exitCode = 1;
  });
}
