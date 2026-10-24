// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
//
// WB-FACTORY-06: every path that used to read as a visual QA pass must not.
// The verifier (scripts/verify-visual-qa.mjs) runs in-process with an
// injected browser and evaluator; VisualQAStage judges the report it wrote.
// Every site, route and finding here is synthetic.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { type BuildContext, clientAssetRoot } from "../../src/pipeline/BuildContext.js";
import {
  assessVisualQaReport,
  VISUAL_QA_VIEWPORTS,
  VisualQAStage,
  type VisualQaExec,
  type VisualQaRun,
} from "../../src/stages/VisualQAStage.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

const QA_SCRIPT = "scripts/verify-visual-qa.mjs";
const URL_BASE = "https://preview.example.com";
const PAGES = ["/", "/services", "/contact"];

interface Viewport {
  name: string;
  width: number;
  height: number;
}
interface Invocation {
  url: string;
  pages: string[];
  viewports: Viewport[];
  runId: string;
  reportPath: string;
  clientId: string;
}
interface Report {
  status: string;
  reasons: string[];
  run_id: string;
  coverage: { required: number; captured: number; approved: number };
  captures: Array<{ page: string; viewport: string; status: string; http_status: number }>;
  evaluations: Array<{ page: string; viewport: string; verdict: string }>;
}
interface QaModule {
  VIEWPORTS: Viewport[];
  EXIT_CODES: Record<string, number>;
  runVisualQa(invocation: Invocation, deps: object): Promise<Report>;
}
const qa = (await import(new URL(`../../${QA_SCRIPT}`, import.meta.url).href)) as QaModule;

interface FakeOptions {
  key?: string;
  fetch?: () => Promise<{ ok: boolean; status: number }>;
  launch?: () => Promise<never>;
  status?: (url: string) => number;
  screenshot?: (path: string, viewport: string) => void;
  evaluator?: "unavailable" | ((path: string) => Promise<unknown>);
}

function fakeDeps(options: FakeOptions = {}) {
  return {
    env: { OPENROUTER_API_KEY: options.key ?? "test-key" },
    fetch: options.fetch ?? (async () => ({ ok: true, status: 200 })),
    launchBrowser:
      options.launch ??
      (async () => ({
        version: "fake-chromium",
        async open(viewport: Viewport) {
          return {
            goto: async (url: string) => ({ status: options.status?.(url) ?? 200 }),
            screenshot: async (path: string) =>
              options.screenshot
                ? options.screenshot(path, viewport.name)
                : writeFileSync(path, `png:${path}`),
            close: async () => {},
          };
        },
        close: async () => {},
      })),
    loadEvaluator: async () => {
      if (options.evaluator === "unavailable")
        throw new Error("Cannot find module '../dist/services/llm.js'");
      const evaluate = options.evaluator ?? (async () => "Layout is clean.");
      return { validateLayout: (paths: string[]) => evaluate(paths[0]) };
    },
    now: () => new Date("2026-10-24T00:00:00.000Z"),
  };
}

function invocation(dir: string, runId = "run-1"): Invocation {
  return {
    url: URL_BASE,
    pages: PAGES,
    viewports: qa.VIEWPORTS,
    runId,
    reportPath: join(dir, runId, "report.json"),
    clientId: "negative-fixture-client",
  };
}

function run(inv: Invocation, exitedZero: boolean): VisualQaRun {
  return {
    runId: inv.runId,
    url: inv.url,
    pages: inv.pages,
    viewports: VISUAL_QA_VIEWPORTS,
    reportPath: inv.reportPath,
    exitedZero,
  };
}

async function withDir(action: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "visual-qa-negative-"));
  try {
    await action(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The verifier's verdict must not be PASS, and the stage must agree on the same report. */
async function assertNotPass(
  options: FakeOptions,
  expected: { status: "FAIL" | "BLOCKED"; reason: string },
): Promise<void> {
  await withDir(async (dir) => {
    const inv = invocation(dir);
    const report = await qa.runVisualQa(inv, fakeDeps(options));
    assert.equal(report.status, expected.status);
    assert.ok(report.reasons.includes(expected.reason), `${report.reasons} has ${expected.reason}`);
    assert.notEqual(qa.EXIT_CODES[report.status], 0);
    const onDisk = JSON.parse(readFileSync(inv.reportPath, "utf-8"));
    assert.ok(assessVisualQaReport(onDisk, run(inv, false)).problems.length > 0);
  });
}

void test("the complete synthetic run is the only PASS, and the stage agrees with it", async () => {
  await withDir(async (dir) => {
    const inv = invocation(dir);
    const report = await qa.runVisualQa(inv, fakeDeps());
    assert.equal(report.status, "PASS");
    assert.deepEqual(report.reasons, []);
    assert.deepEqual(report.coverage, { required: 15, captured: 15, approved: 15 });
    const onDisk = JSON.parse(readFileSync(inv.reportPath, "utf-8"));
    assert.deepEqual(assessVisualQaReport(onDisk, run(inv, true)), {
      problems: [],
      critical: false,
    });
    // The same report with a non-zero exit is not a pass either.
    assert.ok(assessVisualQaReport(onDisk, run(inv, false)).problems.length > 0);
  });
});

void test("NEGATIVE no credentials: screenshots are captured but nothing is approved", async () => {
  await withDir(async (dir) => {
    const report = await qa.runVisualQa(invocation(dir), fakeDeps({ key: "" }));
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.reasons.includes("MISSING_EVALUATOR_CREDENTIALS"));
    assert.equal(report.coverage.captured, 15);
    assert.equal(report.coverage.approved, 0);
    assert.ok(report.evaluations.every((evaluation) => evaluation.verdict === "not_run"));
  });
});

void test("NEGATIVE plan-only: no Playwright means no screenshots and no pass", async () => {
  await assertNotPass(
    { launch: async () => Promise.reject(new Error("Cannot find package 'playwright'")) },
    { status: "BLOCKED", reason: "MISSING_DEPENDENCY" },
  );
});

void test("NEGATIVE evaluator unavailable (the dist/ import that silently failed)", async () => {
  await assertNotPass(
    { evaluator: "unavailable" },
    { status: "BLOCKED", reason: "EVALUATOR_UNAVAILABLE" },
  );
});

void test("NEGATIVE evaluator throw on one screenshot", async () => {
  await assertNotPass(
    {
      evaluator: async (path) => {
        if (path.includes("_services_ipad")) throw new Error("vision provider 503");
        return "Layout is clean.";
      },
    },
    { status: "BLOCKED", reason: "EVALUATION_FAILED" },
  );
});

void test("NEGATIVE inconclusive evaluator output", async () => {
  await assertNotPass(
    { evaluator: async () => "   " },
    { status: "BLOCKED", reason: "EVALUATION_INCONCLUSIVE" },
  );
});

void test("NEGATIVE reachable site with a 404 route", async () => {
  await assertNotPass(
    { status: (url) => (url.endsWith("/contact") ? 404 : 200) },
    { status: "FAIL", reason: "HTTP_NOT_OK" },
  );
});

void test("NEGATIVE unreachable target and rejected reachability probe", async () => {
  await assertNotPass(
    { fetch: async () => ({ ok: false, status: 503 }) },
    { status: "BLOCKED", reason: "TARGET_UNREACHABLE" },
  );
  await assertNotPass(
    { fetch: async () => Promise.reject(new Error("ECONNREFUSED")) },
    { status: "BLOCKED", reason: "TARGET_UNREACHABLE" },
  );
});

void test("NEGATIVE zero-byte and failed screenshots", async () => {
  await assertNotPass(
    { screenshot: (path) => writeFileSync(path, "") },
    { status: "FAIL", reason: "CAPTURE_FAILED" },
  );
  await assertNotPass(
    {
      screenshot: (path, viewport) => {
        if (viewport === "pixel_7") throw new Error("page crashed");
        writeFileSync(path, `png:${path}`);
      },
    },
    { status: "FAIL", reason: "CAPTURE_FAILED" },
  );
});

void test("NEGATIVE a critical evaluator finding fails and is flagged for the stage", async () => {
  await withDir(async (dir) => {
    const inv = invocation(dir);
    const report = await qa.runVisualQa(
      inv,
      fakeDeps({ evaluator: async () => "Navigation overlaps the hero: critical." }),
    );
    assert.equal(report.status, "FAIL");
    const onDisk = JSON.parse(readFileSync(inv.reportPath, "utf-8"));
    assert.equal(assessVisualQaReport(onDisk, run(inv, false)).critical, true);
  });
});

void test("NEGATIVE stale report: a rerun into the same directory never inherits a prior PASS", async () => {
  await withDir(async (dir) => {
    const inv = invocation(dir);
    assert.equal((await qa.runVisualQa(inv, fakeDeps())).status, "PASS");
    const rerun = await qa.runVisualQa(inv, fakeDeps({ key: "" }));
    assert.equal(rerun.status, "BLOCKED");
    const onDisk = JSON.parse(readFileSync(inv.reportPath, "utf-8"));
    assert.equal(onDisk.status, "BLOCKED");
  });
});

void test("a rerun clears only its own run-scoped captures, never a sibling directory", async () => {
  await withDir(async (dir) => {
    const inv = { ...invocation(dir), reportPath: join(dir, "report.json") };
    const keep = join(dir, "screenshots", "keep.png");
    mkdirSync(dirname(keep), { recursive: true });
    writeFileSync(keep, "human-kept");
    await qa.runVisualQa(inv, fakeDeps());
    await qa.runVisualQa(inv, fakeDeps());
    assert.equal(readFileSync(keep, "utf-8"), "human-kept");
  });
});

void test("NEGATIVE a report for another run, URL or route set is rejected by the stage", async () => {
  await withDir(async (dir) => {
    const inv = invocation(dir);
    await qa.runVisualQa(inv, fakeDeps());
    const pass = JSON.parse(readFileSync(inv.reportPath, "utf-8"));
    const expect = run(inv, true);
    const problems = (mutated: object, against = expect) =>
      assessVisualQaReport({ ...pass, ...mutated }, against).problems;
    assert.match(problems({ run_id: "older-run" }).join(), /different run/);
    assert.match(problems({ target_url: "https://other.example.com" }).join(), /different URL/);
    // Partial route coverage: the report covers fewer routes than the spec.
    assert.match(
      problems({ requested: { ...pass.requested, pages: ["/"] } }).join(),
      /different routes/,
    );
    const partial = {
      captures: pass.captures.filter((capture: { page: string }) => capture.page !== "/contact"),
      evaluations: pass.evaluations.filter(
        (evaluation: { page: string }) => evaluation.page !== "/contact",
      ),
    };
    assert.match(problems(partial).join(), /\/contact@desktop_1920: 0 captures/);
    assert.match(problems({ status: "PLAN_ONLY" }).join(), /verifier status PLAN_ONLY/);
    assert.match(problems({ captures: [], evaluations: [] }).join(), /0 captures/);
    assert.match(
      problems({
        evaluations: pass.evaluations.map((evaluation: object) => ({
          ...evaluation,
          verdict: "not_run",
        })),
      }).join(),
      /evaluator verdict not_run/,
    );
    assert.deepEqual(assessVisualQaReport(null, expect).problems, ["report is not an object"]);
  });
});

void test("NEGATIVE tampered or missing screenshots are rejected by the stage", async () => {
  await withDir(async (dir) => {
    const inv = invocation(dir);
    await qa.runVisualQa(inv, fakeDeps());
    const pass = JSON.parse(readFileSync(inv.reportPath, "utf-8"));
    const shot = pass.captures[0].screenshot.path as string;
    writeFileSync(shot, "different bytes");
    assert.match(
      assessVisualQaReport(pass, run(inv, true)).problems.join(),
      /screenshot digest mismatch/,
    );
    rmSync(shot);
    assert.match(
      assessVisualQaReport(pass, run(inv, true)).problems.join(),
      /screenshot missing on disk/,
    );
    // A screenshot borrowed from another run's directory cannot certify this one.
    const elsewhere = join(dir, "other-run", "shot.png");
    mkdirSync(dirname(elsewhere), { recursive: true });
    writeFileSync(elsewhere, "png");
    pass.captures[0].screenshot.path = elsewhere;
    assert.match(
      assessVisualQaReport(pass, run(inv, true)).problems.join(),
      /screenshot outside this run/,
    );
  });
});

void test("NEGATIVE stage: a PASS report left by an earlier run cannot certify a new run", async () => {
  const ctx = fixtureContext();
  ctx.evidenceStore.requireDeploymentEvidence = (async () => ({
    value: { deploymentUrl: URL_BASE },
  })) as typeof ctx.evidenceStore.requireDeploymentEvidence;
  const exec: VisualQaExec = () => "STATUS: PASS";
  try {
    // An earlier, genuinely passing run.
    const earlier = await qa.runVisualQa(
      {
        ...invocation(resolve(clientAssetRoot(ctx), "visual-qa"), "earlier-run"),
        pages: ctx.domainSpec.routes.map((route) => route.slug),
      },
      fakeDeps(),
    );
    assert.equal(earlier.status, "PASS");
    // This run gets a fresh id, and the verifier (stubbed) wrote nothing for it.
    await new VisualQAStage(exec, QA_SCRIPT, () => "new-run").run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, "failed");
    assert.equal(ctx.visualQaPassed, false);
  } finally {
    rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
    cleanupContext(ctx);
  }
});

void test("NEGATIVE stage: the verifier rejecting (non-zero exit) is not a pass even with a PASS report", async () => {
  const ctx: BuildContext = fixtureContext();
  ctx.evidenceStore.requireDeploymentEvidence = (async () => ({
    value: { deploymentUrl: URL_BASE },
  })) as typeof ctx.evidenceStore.requireDeploymentEvidence;
  const exec: VisualQaExec = () => {
    throw new Error("Command failed (exit 2)");
  };
  try {
    await qa.runVisualQa(
      {
        ...invocation(resolve(clientAssetRoot(ctx), "visual-qa"), "rejecting-run"),
        pages: ctx.domainSpec.routes.map((route) => route.slug),
      },
      fakeDeps(),
    );
    await new VisualQAStage(exec, QA_SCRIPT, () => "rejecting-run").run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, "failed");
    assert.equal(ctx.visualQaPassed, false);
  } finally {
    rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
    cleanupContext(ctx);
  }
});

function cli(args: string[], env: Record<string, string> = {}): { code: number; stdout: string } {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of ["SITE_URL", "QA_PAGES", "SPEC_PATH", "OPENROUTER_API_KEY"])
    if (!(key in env)) delete childEnv[key];
  try {
    const stdout = execFileSync(process.execPath, [QA_SCRIPT, ...args], {
      encoding: "utf-8",
      stdio: "pipe",
      env: childEnv,
    });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { status: number; stdout: string };
    return { code: failure.status, stdout: failure.stdout };
  }
}

void test("NEGATIVE CLI: incomplete invocations are BLOCKED with a non-zero exit and no default routes", () => {
  for (const args of [
    [],
    ["--url", URL_BASE],
    ["--url", "not a url", "--pages", "/"],
    ["--url", "https://user:secret@example.com", "--pages", "/"],
    ["--url", `${URL_BASE}/?q=1`, "--pages", "/"],
    ["--url", URL_BASE, "--pages", "/../etc"],
    ["--url", URL_BASE, "--pages", "/", "--viewports", "watch"],
    ["--url", URL_BASE, "--pages", "/", "--run-id", "../escape"],
  ]) {
    const result = cli(args);
    assert.equal(result.code, 2, `${args.join(" ")} exits 2`);
    assert.match(result.stdout, /STATUS: BLOCKED/);
    assert.doesNotMatch(result.stdout, /STATUS: PASS/);
  }
});
