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

function gitState(repoRoot) {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();
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
  const [hashing, rendered] = await Promise.all([
    load("src/services/hashing.ts"),
    load("src/validation/rendered-site.ts"),
  ]);
  return { hashing, rendered };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Re-verify a receipt against what is on disk now. Empty problems is the only
 * PASS. Every input and output the receipt names is re-read and re-hashed.
 */
export async function verifyReceipt(receipt, repoRoot = REPO_ROOT) {
  const problems = [];
  const { hashing, rendered } = await nativeModules(repoRoot);
  if (receipt?.schema !== PREVIEW_RECEIPT_SCHEMA) return ["unknown receipt schema"];
  if (receipt.remote_deploy !== "NOT_INVOKED")
    problems.push("receipt does not record NOT_INVOKED deploy");

  const spec = receipt.input?.spec_path;
  if (!spec || !existsSync(spec)) problems.push("input spec missing");
  else if (sha256(readFileSync(spec)) !== receipt.input.spec_sha256)
    problems.push("input spec changed since the receipt");

  const out = receipt.output ?? {};
  for (const check of REQUIRED_BUILD_CHECKS) {
    const verdict = (receipt.build?.checks ?? []).find((item) => item.name === check)?.status;
    if (verdict !== "passed") problems.push(`build check ${check}: ${verdict ?? "missing"}`);
  }
  if (!out.source_dir || !existsSync(out.source_dir)) problems.push("generated source missing");
  else if (
    hashing.digestDirectory(out.source_dir, { exclude: hashing.isSourceDigestExcluded }).digest !==
    out.source_digest
  )
    problems.push("generated source digest mismatch");
  if (!out.dist_dir || !existsSync(out.dist_dir)) problems.push("build output (dist) missing");
  else if (hashing.digestDirectory(out.dist_dir).digest !== out.dist_digest)
    problems.push("build output digest mismatch");
  if (
    out.source_digest !== receipt.build?.source_digest ||
    out.dist_digest !== receipt.build?.dist_digest
  )
    problems.push("receipt digests disagree with the build proof");

  const reportPath = receipt.browser?.report_path;
  let report;
  if (!reportPath || !existsSync(reportPath)) problems.push("browser report missing");
  else {
    report = readJson(reportPath);
    if (sha256(readFileSync(reportPath)) !== receipt.browser.report_sha256)
      problems.push("browser report changed since the receipt");
    if (report.schema !== rendered.RENDERED_SITE_VALIDATION_SCHEMA)
      problems.push("unknown browser report schema");
    if (report.status !== "PASS") problems.push(`browser report status ${report.status}`);
    if (report.build_id !== receipt.build_id)
      problems.push("browser report belongs to another build");
  }
  const routes = receipt.routes ?? [];
  const viewports = receipt.browser?.viewports ?? [];
  if (!routes.length || !viewports.length) problems.push("no routes or viewports recorded");
  const shots = receipt.browser?.screenshots ?? [];
  for (const route of routes) {
    for (const viewport of viewports) {
      const pair = `${route}@${viewport}`;
      const render = report?.routes?.find(
        (item) => item.route === route && item.viewport === viewport,
      );
      if (report && render?.status !== "PASS")
        problems.push(`${pair}: render ${render?.status ?? "missing"}`);
      const shot = shots.filter((item) => item.route === route && item.viewport === viewport);
      if (shot.length !== 1) {
        problems.push(`${pair}: ${shot.length} screenshots`);
        continue;
      }
      const path = shot[0].path;
      if (!inside(receipt.browser.screenshot_dir, path))
        problems.push(`${pair}: screenshot outside this run`);
      else if (!existsSync(path)) problems.push(`${pair}: screenshot missing`);
      else {
        const bytes = readFileSync(path);
        if (bytes.length === 0 || sha256(bytes) !== shot[0].sha256)
          problems.push(`${pair}: screenshot changed since the receipt`);
      }
    }
  }
  return problems;
}

function childEnv() {
  const env = {};
  const withheld = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (REMOTE_ENV.test(key)) withheld.push(key);
    else env[key] = value;
  }
  env.KEEP_SITE_FACTORY_VALIDATION_OUTPUT = "true";
  return { env, withheld: withheld.sort((a, b) => a.localeCompare(b)) };
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
    if (!existsSync(args.receiptPath)) {
      console.error(`site-preview: receipt ${args.receiptPath} does not exist`);
      console.log("STATUS: FAIL");
      process.exitCode = 1;
      return;
    }
    const receipt = readJson(args.receiptPath);
    const problems =
      receipt.status === "PASS" ? await verifyReceipt(receipt) : ["receipt was not PASS"];
    for (const problem of problems) console.log(`problem: ${problem}`);
    console.log(`STATUS: ${problems.length ? "FAIL" : "PASS"}`);
    process.exitCode = problems.length ? 1 : 0;
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
