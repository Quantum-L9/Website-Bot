// L9_META: layer=source, role=tracked_file, status=active, version=2.0.0
//
// VisualQAStage drives scripts/verify-visual-qa.mjs and re-verifies the report
// it wrote. Reports here are produced by the verifier's own runVisualQa with
// an injected browser and evaluator, so stage and script are held to the same
// outcome rather than to hand-written JSON.

import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { type BuildContext, clientAssetRoot } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  VISUAL_QA_VIEWPORTS,
  VisualQAStage,
  type VisualQaExec,
} from "../../src/stages/VisualQAStage.js";
import { cleanupContext, fixtureContext, withEnv } from "../helpers/siteFactoryFixture.js";

const QA_SCRIPT = "scripts/verify-visual-qa.mjs";
const DEPLOY_URL = "https://preview.example.com";
const RUN_ID = "visual-qa-unit-run";

interface Invocation {
  url: string;
  pages: string[];
  viewports: Array<{ name: string; width: number; height: number }>;
  runId: string;
  reportPath: string;
  clientId: string;
}
interface QaModule {
  VIEWPORTS: Invocation["viewports"];
  runVisualQa(invocation: Invocation, deps: object): Promise<{ status: string }>;
}
const qa = (await import(new URL(`../../${QA_SCRIPT}`, import.meta.url).href)) as QaModule;

/** The evaluator's strict JSON result (src/services/llm.ts validateLayout). */
const PASS_VERDICT = JSON.stringify({ verdict: "pass", defects: [], summary: "Layout is clean." });
const CRITICAL_VERDICT = JSON.stringify({
  verdict: "fail",
  defects: [{ severity: "critical", description: "Hero text overflows its container." }],
  summary: "Critical overflow.",
});

/** A deployed site where every page renders and the evaluator reports `analysis`. */
function fakeDeps(analysis: string) {
  return {
    env: { OPENROUTER_API_KEY: "test-key", PERPLEXITY_API_KEY: "test-key" },
    fetch: async () => ({ ok: true, status: 200 }),
    async launchBrowser() {
      return {
        version: "fake-chromium",
        async open() {
          return {
            goto: async (url: string) => ({ status: 200, url }),
            screenshot: async (path: string) => writeFileSync(path, `png:${path}`),
            close: async () => {},
          };
        },
        close: async () => {},
      };
    },
    loadEvaluator: async () => ({ validateLayout: async () => analysis }),
    now: () => new Date("2026-10-24T00:00:00.000Z"),
  };
}

/** Produce the verifier's real report for the invocation the stage will make. */
async function verifierReport(ctx: BuildContext, analysis: string): Promise<{ status: string }> {
  return qa.runVisualQa(
    {
      url: DEPLOY_URL,
      pages: ctx.domainSpec.routes.map((route) => route.slug),
      viewports: qa.VIEWPORTS,
      runId: RUN_ID,
      reportPath: resolve(clientAssetRoot(ctx), "visual-qa", RUN_ID, "report.json"),
      clientId: ctx.clientId,
    },
    fakeDeps(analysis),
  );
}

interface ExecCall {
  command: string;
  args: string[];
  options: { encoding: "utf-8"; timeout: number; stdio: "pipe" };
}

/** Records every invocation; a non-PASS verifier exits non-zero, which execFileSync throws. */
function recordingExec(behaviour: { exitZero?: boolean; output?: string } = {}) {
  const calls: ExecCall[] = [];
  const exec: VisualQaExec = (command, args, options) => {
    calls.push({ command, args, options });
    if (behaviour.exitZero === false) throw new Error("Command failed (exit 1)");
    return behaviour.output ?? "STATUS: PASS";
  };
  return { exec, calls };
}

function stubDeploymentUrl(ctx: BuildContext, deploymentUrl: string): void {
  ctx.evidenceStore.requireDeploymentEvidence = (async () => ({
    value: { deploymentUrl },
  })) as typeof ctx.evidenceStore.requireDeploymentEvidence;
}

function cleanup(ctx: BuildContext): void {
  rmSync(clientAssetRoot(ctx), { recursive: true, force: true });
  cleanupContext(ctx);
}

const stage = (exec: VisualQaExec, script = QA_SCRIPT) =>
  new VisualQAStage(exec, script, () => RUN_ID);

void test("invokes the verifier without a shell for every spec route and viewport, then passes on a complete report", async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, `${DEPLOY_URL}/`);
  const { exec, calls } = recordingExec();
  try {
    assert.equal((await verifierReport(ctx, PASS_VERDICT)).status, "PASS");
    await withEnv({ LLM_PROVIDER_TIMEOUT_MS: undefined }, () => stage(exec).run(ctx));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args, [
      QA_SCRIPT,
      "--url",
      DEPLOY_URL,
      "--pages",
      "/,/services,/contact",
      "--viewports",
      VISUAL_QA_VIEWPORTS.join(","),
      "--report",
      resolve(clientAssetRoot(ctx), "visual-qa", RUN_ID, "report.json"),
      "--run-id",
      RUN_ID,
      "--client-id",
      ctx.clientId,
    ]);
    // 120s overhead + 15 serial pairs x (45s navigation + 5s screenshot + 60s evaluator).
    assert.equal(calls[0].options.timeout, 1_770_000);
    assert.equal(calls[0].options.stdio, "pipe");
    assert.equal(calls[0].options.encoding, "utf-8");
    assert.equal(ctx.visualQaPassed, true);
    assert.equal(ctx.qualityEvidence.visualQa, "passed");
  } finally {
    cleanup(ctx);
  }
});

void test("the stage requires every viewport the verifier knows", () => {
  assert.deepEqual(
    VISUAL_QA_VIEWPORTS,
    qa.VIEWPORTS.map((viewport) => viewport.name),
  );
});

void test("an evaluator critical finding fails the gate hard", async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, DEPLOY_URL);
  const { exec } = recordingExec({ exitZero: false });
  try {
    assert.equal((await verifierReport(ctx, CRITICAL_VERDICT)).status, "FAIL");
    await assert.rejects(
      () => stage(exec).run(ctx),
      (error: unknown) => error instanceof BuildError && error.code === "VISUAL_QA_FAILED",
    );
    assert.equal(ctx.qualityEvidence.visualQa, "failed");
    assert.equal(ctx.visualQaPassed, false);
  } finally {
    cleanup(ctx);
  }
});

void test("clean verifier stdout without a report is not a pass", async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, DEPLOY_URL);
  const { exec } = recordingExec({ output: "Visual review complete: no defects found." });
  try {
    await stage(exec).run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, "failed");
    assert.equal(ctx.visualQaPassed, false);
  } finally {
    cleanup(ctx);
  }
});

void test("a verifier execution failure marks the gate failed without throwing", async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, DEPLOY_URL);
  const { exec } = recordingExec({ exitZero: false });
  try {
    await stage(exec).run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, "failed");
    assert.equal(ctx.visualQaPassed, false);
  } finally {
    cleanup(ctx);
  }
});

void test("an absent QA script fails the gate without invoking the verifier", async () => {
  const ctx = fixtureContext();
  const { exec, calls } = recordingExec();
  try {
    await stage(exec, "scripts/does-not-exist-visual-qa.mjs").run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, "failed");
    assert.equal(ctx.visualQaPassed, false);
    assert.equal(calls.length, 0);
  } finally {
    cleanup(ctx);
  }
});

void test("dry-run stays NOT_RUN (skipped) without invoking the verifier", async () => {
  const ctx = fixtureContext();
  ctx.dryRun = true;
  const { exec, calls } = recordingExec();
  try {
    await stage(exec).run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, "skipped");
    assert.equal(ctx.visualQaPassed, false);
    assert.equal(calls.length, 0);
  } finally {
    cleanup(ctx);
  }
});

void test("a deployment without a URL fails the gate without invoking the verifier", async () => {
  const ctx = fixtureContext();
  stubDeploymentUrl(ctx, "");
  const { exec, calls } = recordingExec();
  try {
    await stage(exec).run(ctx);
    assert.equal(ctx.qualityEvidence.visualQa, "failed");
    assert.equal(calls.length, 0);
  } finally {
    cleanup(ctx);
  }
});

void test("the stage version moves past the release that passed on stdout", () => {
  // 3.1.0 marked PASS whenever stdout lacked "CRITICAL".
  assert.notEqual(new VisualQAStage().version, "3.1.0");
});
