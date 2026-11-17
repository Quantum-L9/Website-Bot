// L9_META: layer=test, role=resume_and_build_budget_contract, status=active, version=1.0.0
//
// wb-resume-budget: `--resume <buildId>` continues a build from its first
// non-completed stage without re-executing (or re-paying for) completed
// stages, fails closed on missing/corrupt checkpoints, refuses reuse when a
// stage's version/spec/dependency digest changed, and enforces one persisted
// per-build spend cap across resumes with a typed BUDGET_EXCEEDED failure.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BuildContext } from "../../src/pipeline/BuildContext.js";
import { BuildError } from "../../src/pipeline/BuildError.js";
import {
  BUILD_ECONOMICS_FILE,
  type BuildEconomics,
} from "../../src/pipeline/evidence/BuildEconomics.js";
import { PipelineRunner, type Stage } from "../../src/pipeline/PipelineRunner.js";
import {
  parseResumeArgument,
  resolveResumeTarget,
  specDigest,
} from "../../src/pipeline/ResumeTarget.js";
import { SpendLedger } from "../../src/pipeline/SpendLedger.js";
import type { UsageRecord, WebsiteFactoryLLM } from "../../src/services/llm.js";
import { cleanupContext, fixtureContext } from "../helpers/siteFactoryFixture.js";

process.env.BUILD_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "wb-budget-db-")), "build.db");

const SPEC_DIGEST = specDigest({ spec: "v1" });

/** A fake LLM adapter whose every call reports `costUsd` like the real adapter does. */
function fakeLLM(costUsd: number): WebsiteFactoryLLM & { calls: number } {
  const buffer: UsageRecord[] = [];
  const llm = {
    calls: 0,
    async generateContent() {
      llm.calls += 1;
      buffer.push({
        stage: "content",
        taskType: "page_copy",
        provider: "deepseek",
        model: "fake",
        inputTokens: 1,
        outputTokens: 1,
        costUsd,
        status: "success",
        recordedAt: new Date().toISOString(),
      });
      return "ok";
    },
    designReasoning: async () => "ok",
    generateSchema: async () => "ok",
    validateLayout: async () => "ok",
    strategize: async () => "ok",
    recordUsage() {},
    flushUsage: () => buffer.splice(0, buffer.length),
  };
  return llm;
}

interface Counter {
  runs: number;
}

/** A stage that pays for one LLM call; resumable stages declare it. */
function paidStage(
  name: string,
  counter: Counter,
  options: { resumable?: boolean; version?: string } = {},
): Stage {
  return {
    name,
    version: options.version ?? "1.0.0",
    evidence: {
      inputs: () => [],
      outputs: () => [],
      resumable: options.resumable ?? true,
      externalMutation: false,
    },
    async run(ctx) {
      counter.runs += 1;
      await ctx.llm.generateContent("prompt");
    },
  };
}

function failingOnce(name: string, counter: Counter): Stage {
  return {
    name,
    version: "1.0.0",
    evidence: { inputs: () => [], outputs: () => [], resumable: true, externalMutation: false },
    async run() {
      counter.runs += 1;
      if (counter.runs === 1)
        throw new BuildError("INTELLIGENCE_UNAVAILABLE", "transient upstream failure");
    },
  };
}

function openLedger(ctx: BuildContext, resume: boolean, capUsd?: number): SpendLedger {
  return SpendLedger.open({
    buildId: ctx.buildId,
    clientId: ctx.clientId,
    mode: ctx.mode,
    buildIntent: ctx.buildIntent,
    specPath: "fixtures/spec.yaml",
    specDigest: SPEC_DIGEST,
    rootDir: ctx.evidenceStore.rootDir,
    capUsd,
    resume,
  });
}

async function runOnce(ctx: BuildContext, stages: Stage[]): Promise<BuildError | undefined> {
  const runner = new PipelineRunner();
  for (const stage of stages) runner.register(stage);
  ctx.stageResults = new Map();
  try {
    await runner.run(ctx);
    return undefined;
  } catch (error) {
    assert.ok(error instanceof BuildError, `typed failure, got ${String(error)}`);
    return error;
  }
}

function economics(ctx: BuildContext): BuildEconomics {
  return JSON.parse(readFileSync(join(ctx.evidenceStore.rootDir, BUILD_ECONOMICS_FILE), "utf-8"));
}

void test("resume continues from the failed stage without re-executing or re-paying completed stages", async () => {
  const ctx = fixtureContext();
  const llm = fakeLLM(0.4);
  const first: Counter = { runs: 0 };
  const flaky: Counter = { runs: 0 };
  const last: Counter = { runs: 0 };
  const stages = () => [
    paidStage("research", first),
    failingOnce("authority", flaky),
    paidStage("assemble", last),
  ];
  try {
    ctx.llm = llm;
    ctx.spendLedger = openLedger(ctx, false);
    const failure = await runOnce(ctx, stages());
    assert.equal(failure?.code, "INTELLIGENCE_UNAVAILABLE");
    assert.equal(llm.calls, 1);

    ctx.resume = true;
    ctx.spendLedger = openLedger(ctx, true);
    assert.equal(await runOnce(ctx, stages()), undefined);

    assert.equal(first.runs, 1, "completed stage was not re-executed");
    assert.equal(ctx.stageResults.get("research")?.skipped, true);
    assert.equal(flaky.runs, 2, "failed stage re-ran");
    assert.equal(last.runs, 1);
    assert.equal(llm.calls, 2, "only the not-yet-completed paid stage paid again");

    const record = economics(ctx);
    assert.equal(record.totals.runs, 2);
    assert.equal(record.totals.by_class.llm, 0.8);
    assert.deepEqual(record.runs[1]?.reused_stages, ["research"]);
    assert.equal(record.runs[1]?.resumed_from, "authority");
    assert.equal(record.runs[1]?.status, "success");
    const authority = record.stages.find((stage) => stage.stage === "authority");
    assert.equal(authority?.attempts, 2);
    assert.equal(authority?.last_error_code, undefined);
    assert.equal(record.stages.find((stage) => stage.stage === "research")?.reuses, 1);
    assertMatchesSchema(record);
  } finally {
    cleanupContext(ctx);
  }
});

void test("resume fails closed when a completed stage's checkpoint is missing or corrupt", async () => {
  for (const damage of ["missing", "corrupt"] as const) {
    const ctx = fixtureContext();
    const counter: Counter = { runs: 0 };
    try {
      ctx.llm = fakeLLM(0.1);
      ctx.spendLedger = openLedger(ctx, false);
      await runOnce(ctx, [paidStage("research", counter), failingOnce("authority", { runs: 0 })]);
      const checkpoint = join(ctx.evidenceStore.rootDir, "checkpoints", "research.json");
      if (damage === "missing") rmSync(checkpoint);
      else writeFileSync(checkpoint, "{not json");

      ctx.resume = true;
      ctx.spendLedger = openLedger(ctx, true);
      await assert.rejects(
        () => new PipelineRunner().register(paidStage("research", counter)).run(ctx),
        (error: unknown) =>
          error instanceof BuildError &&
          error.code === "CHECKPOINT_INVALID" &&
          error.message.includes("research"),
      );
      assert.equal(counter.runs, 1, `${damage}: nothing re-executed`);
    } finally {
      cleanupContext(ctx);
    }
  }
});

void test("resume refuses reuse of a stage whose version changed and names it", async () => {
  const ctx = fixtureContext();
  const counter: Counter = { runs: 0 };
  try {
    ctx.llm = fakeLLM(0.1);
    ctx.spendLedger = openLedger(ctx, false);
    await runOnce(ctx, [paidStage("research", counter), failingOnce("authority", { runs: 0 })]);
    ctx.resume = true;
    ctx.spendLedger = openLedger(ctx, true);
    assert.equal(
      await runOnce(ctx, [
        paidStage("research", counter, { version: "2.0.0" }),
        failingOnce("authority", { runs: 1 }),
      ]),
      undefined,
    );
    assert.equal(counter.runs, 2, "the changed stage re-executed");
    const refused = economics(ctx).runs[1]?.refused_stages ?? [];
    assert.equal(refused[0]?.stage, "research");
    assert.match(refused[0]?.reason ?? "", /version changed 1\.0\.0 -> 2\.0\.0/);
  } finally {
    cleanupContext(ctx);
  }
});

void test("resume refuses a changed spec, naming the completed stages bound to it", async () => {
  const ctx = fixtureContext();
  try {
    ctx.llm = fakeLLM(0.1);
    ctx.spendLedger = openLedger(ctx, false);
    await runOnce(ctx, [paidStage("research", { runs: 0 }), failingOnce("authority", { runs: 0 })]);
    assert.throws(
      () =>
        SpendLedger.open({
          buildId: ctx.buildId,
          clientId: ctx.clientId,
          mode: ctx.mode,
          buildIntent: ctx.buildIntent,
          specPath: "fixtures/spec.yaml",
          specDigest: specDigest({ spec: "v2" }),
          rootDir: ctx.evidenceStore.rootDir,
          resume: true,
        }),
      (error: unknown) =>
        error instanceof BuildError &&
        error.code === "RESUME_INPUT_CHANGED" &&
        /spec digest changed/.test(error.message) &&
        error.message.includes("research"),
    );
    assert.throws(
      () =>
        SpendLedger.open({
          buildId: "never-started",
          clientId: ctx.clientId,
          mode: ctx.mode,
          buildIntent: ctx.buildIntent,
          specPath: "fixtures/spec.yaml",
          specDigest: SPEC_DIGEST,
          rootDir: join(ctx.evidenceStore.rootDir, "nowhere"),
          resume: true,
        }),
      (error: unknown) => error instanceof BuildError && error.code === "RESUME_STATE_MISSING",
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("the cap is enforced across resumes and stops before the call with a typed failure", async () => {
  const ctx = fixtureContext();
  const llm = fakeLLM(0.6);
  const counter: Counter = { runs: 0 };
  try {
    ctx.llm = llm;
    ctx.spendLedger = openLedger(ctx, false, 1);
    await runOnce(ctx, [paidStage("research", { runs: 0 }), failingOnce("authority", { runs: 0 })]);
    assert.equal(economics(ctx).totals.spend_usd, 0.6);

    // The resumed run has $0.40 left; the paid stage after the frontier fits
    // its reserve, spends $0.60, and the next paid call is refused before dispatch.
    ctx.resume = true;
    ctx.spendLedger = openLedger(ctx, true);
    const failure = await runOnce(ctx, [
      paidStage("research", { runs: 0 }),
      failingOnce("authority", { runs: 1 }),
      paidStage("assemble", counter),
      paidStage("polish", counter),
    ]);
    assert.equal(failure?.code, "BUDGET_EXCEEDED");
    assert.match(failure?.message ?? "", /class llm/);
    assert.equal(llm.calls, 2, "the refused call never reached the provider");

    const record = economics(ctx);
    assert.equal(record.runs[1]?.status, "budget_exceeded");
    assert.equal(record.budget_failure?.spend_class, "llm");
    assert.equal(record.budget_failure?.stage, "polish");
    assert.equal(record.budget_failure?.cap_usd, 1);
    assert.equal(record.budget_failure?.spent_total_usd, 1.2);
    const failureEvidence = JSON.parse(
      readFileSync(join(ctx.evidenceStore.rootDir, "failures", "active.json"), "utf-8"),
    ) as { code: string };
    assert.equal(failureEvidence.code, "BUDGET_EXCEEDED");

    // Raising the cap deliberately lets the same build resume from the refused stage.
    ctx.spendLedger = openLedger(ctx, true, 5);
    const before = counter.runs;
    assert.equal(
      await runOnce(ctx, [
        paidStage("research", { runs: 0 }),
        failingOnce("authority", { runs: 1 }),
        paidStage("assemble", counter),
        paidStage("polish", counter),
      ]),
      undefined,
    );
    assert.equal(counter.runs, before + 1, "only the refused stage ran");
    assertMatchesSchema(economics(ctx));
  } finally {
    cleanupContext(ctx);
  }
});

void test("a stage that re-wraps the denial still fails BUDGET_EXCEEDED", async () => {
  const ctx = fixtureContext();
  try {
    ctx.llm = fakeLLM(0.1);
    ctx.spendLedger = openLedger(ctx, false, 0.01);
    const wrapping: Stage = {
      name: "wrapper",
      async run(context) {
        try {
          await context.llm.generateContent("x");
        } catch (error) {
          throw new BuildError("CONTENT_GENERATION_FAILED", `wrapped: ${String(error)}`);
        }
      },
    };
    const failure = await runOnce(ctx, [wrapping]);
    assert.equal(failure?.code, "BUDGET_EXCEEDED");
  } finally {
    cleanupContext(ctx);
  }
});

void test("SEO-Bot paid stages are admitted at the DataForSEO reserve before they run", async () => {
  const ctx = fixtureContext();
  const counter: Counter = { runs: 0 };
  const competitive: Stage = {
    name: "competitive-intelligence",
    async run() {
      counter.runs += 1;
      throw new BuildError("INTELLIGENCE_UNAVAILABLE", "upstream failed after billing");
    },
  };
  try {
    ctx.buildIntent = "REDESIGN_IMPROVE";
    ctx.llm = fakeLLM(0);
    ctx.spendLedger = openLedger(ctx, false, 3);
    assert.equal((await runOnce(ctx, [competitive]))?.code, "INTELLIGENCE_UNAVAILABLE");
    const charged = economics(ctx);
    assert.equal(charged.totals.by_class.dataforseo, 2);
    assert.equal(charged.charges[0]?.basis, "upper_bound");

    ctx.resume = true;
    ctx.spendLedger = openLedger(ctx, true);
    const failure = await runOnce(ctx, [competitive]);
    assert.equal(failure?.code, "BUDGET_EXCEEDED");
    assert.match(failure?.message ?? "", /class dataforseo spent \$2\.0000 \+ requested \$2\.0000/);
    assert.equal(counter.runs, 1, "the second SEO-Bot call was never made");
  } finally {
    cleanupContext(ctx);
  }
});

void test("--resume argument forms and evidence-root resolution", () => {
  assert.equal(parseResumeArgument(["--mode=end-to-end"]), undefined);
  assert.equal(parseResumeArgument(["--resume", "qap-e2e-001"]), "qap-e2e-001");
  assert.equal(parseResumeArgument(["--resume=qap-e2e-001"]), "qap-e2e-001");
  assert.equal(parseResumeArgument(["--resume", "--build-id=qap-e2e-001"]), "qap-e2e-001");
  assert.throws(() => parseResumeArgument(["--resume"]), /requires a build id/);
  assert.throws(() => parseResumeArgument(["--resume", "a", "--build-id=b"]), /conflicts/);
  assert.throws(() => parseResumeArgument(["--resume=../x"]), /invalid build id/);

  const root = mkdtempSync(join(tmpdir(), "wb-resume-root-"));
  try {
    const dir = join(root, "client-a", "qap-e2e-001");
    mkdirSync(dir, { recursive: true });
    const ledger = SpendLedger.open({
      buildId: "qap-e2e-001",
      clientId: "client-a",
      mode: "end-to-end",
      buildIntent: "REDESIGN_IMPROVE",
      specPath: "inputs/qap.yaml",
      specDigest: SPEC_DIGEST,
      rootDir: dir,
      resume: false,
    });
    ledger.beginRun(false);
    const target = resolveResumeTarget({ buildId: "qap-e2e-001", evidenceRoot: root });
    assert.equal(target.rootDir, dir);
    assert.equal(target.economics.spec_path, "inputs/qap.yaml");
    assert.equal(target.economics.mode, "end-to-end");
    assert.throws(
      () => resolveResumeTarget({ buildId: "unknown-build", evidenceRoot: root }),
      (error: unknown) => error instanceof BuildError && error.code === "RESUME_STATE_MISSING",
    );
    writeFileSync(join(dir, BUILD_ECONOMICS_FILE), "{}");
    assert.throws(
      () => resolveResumeTarget({ buildId: "qap-e2e-001", evidenceRoot: root }),
      (error: unknown) => error instanceof BuildError && error.code === "CHECKPOINT_INVALID",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- minimal JSON Schema 2020-12 check for the persisted record -----------

type JsonSchema = {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  pattern?: string;
  minimum?: number;
  minLength?: number;
  format?: string;
};

function assertMatchesSchema(record: unknown): void {
  const root = JSON.parse(
    readFileSync(join(process.cwd(), "schemas", "build-economics.schema.json"), "utf-8"),
  ) as JsonSchema & { $defs: Record<string, JsonSchema> };
  const check = (schema: JsonSchema, value: unknown, path: string): void => {
    if (schema.$ref) {
      check(root.$defs[schema.$ref.replace("#/$defs/", "")] as JsonSchema, value, path);
      return;
    }
    if ("const" in schema) assert.equal(value, schema.const, path);
    if (schema.enum) assert.ok(schema.enum.includes(value), `${path} in enum`);
    if (schema.type === "object") {
      assert.ok(value && typeof value === "object" && !Array.isArray(value), `${path} object`);
      const object = value as Record<string, unknown>;
      for (const key of schema.required ?? []) assert.ok(key in object, `${path}.${key} required`);
      if (schema.additionalProperties === false)
        for (const key of Object.keys(object))
          assert.ok(key in (schema.properties ?? {}), `${path}.${key} allowed`);
      for (const [key, child] of Object.entries(schema.properties ?? {}))
        if (key in object) check(child, object[key], `${path}.${key}`);
    }
    if (schema.type === "array") {
      assert.ok(Array.isArray(value), `${path} array`);
      for (const [index, item] of (value as unknown[]).entries())
        check(schema.items ?? {}, item, `${path}[${index}]`);
    }
    if (schema.type === "string") {
      assert.equal(typeof value, "string", path);
      if (schema.pattern) assert.match(value as string, new RegExp(schema.pattern), path);
      if (schema.format === "date-time")
        assert.ok(!Number.isNaN(Date.parse(value as string)), path);
    }
    if (schema.type === "number" || schema.type === "integer") {
      assert.equal(typeof value, "number", path);
      if (schema.type === "integer") assert.ok(Number.isInteger(value), path);
      if (schema.minimum !== undefined) assert.ok((value as number) >= schema.minimum, path);
    }
    if (schema.type === "boolean") assert.equal(typeof value, "boolean", path);
  };
  check(root, record, "$");
}
