// L9_META: layer=test, role=site_quality_blind_judge, status=active, version=1.0.0
//
// scripts/quality/judge.ts with an injected capture and evaluator: no paid API
// is called. Absent keys are NOT_RUN, unusable output is BLOCKED, and only a
// decisive, blind, candidate-preferred result is a PASS.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import {
  aggregate,
  DIMENSIONS,
  type JudgeDeps,
  type JudgeInvocation,
  normalizeTrial,
  orientations,
  parseJudgeArgs,
  runJudge,
  wilsonLowerBound,
} from "../../scripts/quality/judge.js";

const work = mkdtempSync(join(tmpdir(), "wb-quality-judge-"));
test.after(() => rmSync(work, { recursive: true, force: true }));

function verdict(preference: "A" | "B" | "TIE", score: number, defectsA: string[] = ["NONE"]) {
  return JSON.stringify({
    preference,
    confidence: 0.8,
    dimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, score])),
    critical_defects_a: defectsA,
    critical_defects_b: ["NONE"],
    short_reason: "synthetic",
  });
}

function invocation(name: string): JudgeInvocation {
  return {
    candidate: { url: "https://candidate.example" },
    baseline: { url: "https://baseline.example" },
    pages: ["/", "/contact"],
    viewports: ["desktop_1440", "iphone_14"],
    trials: 3,
    runId: name,
    clientId: "judge-fixture",
    reportPath: join(work, name, "report.json"),
  };
}

/** The judge sees images [A, B]; `prefers` picks which file it prefers. */
function deps(prefers: (images: [string, string]) => string, env = { DEEPSEEK_API_KEY: "k" }) {
  const calls: Array<{ prompt: string; images: [string, string] }> = [];
  const captured: string[] = [];
  const value: JudgeDeps & { calls: typeof calls; captured: string[] } = {
    env,
    calls,
    captured,
    capture: async (url, _viewport, file) => {
      captured.push(url);
      writeFileSync(file, url);
    },
    loadJudge: async () => ({
      judge: async (_instruction, prompt, images) => {
        calls.push({ prompt, images });
        return prefers(images);
      },
    }),
  };
  return value;
}

const candidateIsA = (images: [string, string]) => basename(images[0]).startsWith("candidate");

test("absent evaluator credentials are NOT_RUN: nothing captured, nothing judged", async () => {
  const fake = deps(() => verdict("A", 1), {} as { DEEPSEEK_API_KEY: string });
  const report = await runJudge(invocation("no-key"), fake);
  assert.equal(report.status, "NOT_RUN");
  assert.deepEqual(report.reasons, ["MISSING_EVALUATOR_CREDENTIALS"]);
  assert.equal(fake.captured.length, 0);
  assert.equal(fake.calls.length, 0);
});

test("a judge that always prefers the candidate PASSES, blind to which side it is", async () => {
  const fake = deps((images) =>
    verdict(candidateIsA(images) ? "A" : "B", candidateIsA(images) ? -2 : 2),
  );
  const report = await runJudge(invocation("candidate-wins"), fake);
  assert.equal(report.status, "PASS", report.reasons.join(","));
  assert.equal(report.trials.length, 12);
  assert.equal(report.aggregate.candidate_wins, 12);
  assert.ok((report.aggregate.wilson_lower_bound ?? 0) > 0.5);
  assert.equal(report.aggregate.mean_delta.visual_hierarchy, 2);
  // Both orientations were used, and no prompt names a side.
  assert.ok(report.trials.some((trial) => trial.candidate_side === "A"));
  assert.ok(report.trials.some((trial) => trial.candidate_side === "B"));
  for (const call of fake.calls) assert.doesNotMatch(call.prompt, /candidate|baseline/i);
});

test("a judge that prefers the baseline FAILS (the 2/30 golden outcome)", async () => {
  const report = await runJudge(
    invocation("baseline-wins"),
    deps((images) => verdict(candidateIsA(images) ? "B" : "A", candidateIsA(images) ? 2 : -2)),
  );
  assert.equal(report.status, "FAIL");
  assert.ok(report.reasons.includes("CANDIDATE_NOT_PREFERRED"));
  assert.equal(report.aggregate.candidate_wins, 0);
});

test("a candidate critical defect FAILS even when preferred", async () => {
  const report = await runJudge(
    invocation("critical"),
    deps((images) =>
      candidateIsA(images)
        ? verdict("A", -1, ["BROKEN_IMAGE"])
        : JSON.stringify({ ...JSON.parse(verdict("B", 1)), critical_defects_b: ["BROKEN_IMAGE"] }),
    ),
  );
  assert.equal(report.status, "FAIL");
  assert.ok(report.reasons.includes("CANDIDATE_CRITICAL_DEFECT"));
});

test("unparseable judge output is BLOCKED, never PASS", async () => {
  const report = await runJudge(
    invocation("prose"),
    deps(() => "Image B looks better overall."),
  );
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.reasons.includes("VERDICT_INVALID"));
});

test("an evaluator error is BLOCKED", async () => {
  const fake = deps(() => {
    throw new Error("DeepSeek 503");
  });
  const report = await runJudge(invocation("eval-error"), fake);
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.reasons.includes("EVALUATION_FAILED"));
});

test("a missing baseline screenshot is BLOCKED", async () => {
  const inv = { ...invocation("shots"), baseline: { screenshots: join(work, "no-shots") } };
  const report = await runJudge(
    inv,
    deps(() => verdict("A", 0)),
  );
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.reasons.includes("CAPTURE_FAILED"));
});

test("normalization maps B-relative scores to candidate-relative", () => {
  const asB = normalizeTrial(verdict("B", 2), "B");
  assert.equal(asB.candidate_preference, "CANDIDATE");
  assert.equal(asB.candidate_delta.visual_hierarchy, 2);
  const asA = normalizeTrial(verdict("B", 2), "A");
  assert.equal(asA.candidate_preference, "BASELINE");
  assert.equal(asA.candidate_delta.visual_hierarchy, -2);
  assert.equal(
    normalizeTrial(`\`\`\`json\n${verdict("TIE", 0)}\n\`\`\``, "A").candidate_preference,
    "TIE",
  );
  assert.equal(
    normalizeTrial(JSON.stringify({ preference: "A" }), "A").candidate_preference,
    "INVALID",
  );
});

test("orientation: trial 2 reverses trial 1 and the sequence is seeded", () => {
  const sides = orientations("run:/::desktop_1440", 3);
  assert.notEqual(sides[0], sides[1]);
  assert.deepEqual(orientations("run:/::desktop_1440", 3), sides);
});

test("Wilson lower bound and aggregation", () => {
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.ok(wilsonLowerBound(2, 30) < 0.05);
  assert.ok(wilsonLowerBound(30, 30) > 0.88);
  assert.equal(aggregate([]).win_rate, null);
});

test("argument parsing requires a candidate, a baseline and pages", () => {
  assert.throws(() => parseJudgeArgs(["--baseline-url", "https://b", "--pages", "/"]), /candidate/);
  assert.throws(() => parseJudgeArgs(["--candidate-url", "https://c", "--pages", "/"]), /baseline/);
  assert.throws(
    () => parseJudgeArgs(["--candidate-url", "https://c", "--baseline-url", "https://b"]),
    /--pages/,
  );
  const parsed = parseJudgeArgs([
    "--candidate-dist",
    "build/x",
    "--baseline-screenshots",
    "shots",
    "--pages",
    "/,contact",
  ]);
  assert.deepEqual(parsed.pages, ["/", "/contact"]);
  assert.deepEqual(parsed.viewports, ["desktop_1440", "iphone_14"]);
  assert.equal(parsed.trials, 3);
});
