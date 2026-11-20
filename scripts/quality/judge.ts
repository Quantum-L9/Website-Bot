// L9_META: layer=script, role=site_quality_blind_judge, status=active, version=1.1.0
//
// Blind pairwise visual judge: a built candidate against a baseline (the
// client's current site URL, or a committed screenshot set), page by page and
// viewport by viewport. It reuses the existing judge machinery:
//
//   instruction   tests/golden/safehaven/visual-judge.md (blind A/B, 10 dims)
//   orientation   3 trials per pair: random, reversed, random (seeded per run)
//   evaluator     src/services/llm.ts strategize — the one sanctioned DeepSeek
//                 adapter (ADR-0020); no router, no fallback provider
//
// The judge core lives in src/validation/blind-judge.ts (shared with the
// pre-deploy stage); this file is its CLI.
//
// The judge never sees which image is the candidate; only this script's
// normalizer does. Aggregation: candidate win rate over decisive trials with
// a Wilson lower bound; PASS needs the bound > 0.5 and no candidate critical
// defect.
//
// Outcomes and exit codes: PASS 0, FAIL 1, BLOCKED 2, NOT_RUN 2.
//   NOT_RUN  the evaluator credential (DEEPSEEK_API_KEY) is absent — nothing
//            is captured or sent, and nothing is approved.
//   BLOCKED  inputs, capture or the evaluator failed, or a verdict was
//            unparseable. Never a PASS.
// This makes paid API calls; it is not wired into CI.
//
// Usage:
//   npx tsx scripts/quality/judge.ts --candidate-dist <dir> | --candidate-url <url>
//     (--baseline-url <url> | --baseline-screenshots <dir>)
//     --pages /,/contact [--viewports desktop_1440,iphone_14] [--trials 3]
//     [--run-id <id>] [--client-id <id>] [--report <path>]
// --baseline-screenshots expects <dir>/<page-name>_<viewport>.png, where the
// page name is "_index" for "/" and the path with "/" replaced by "_".

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultJudgeDeps,
  EXIT_CODES,
  type JudgeInvocation,
  parseJudgeArgs,
  runJudge,
} from "../../src/validation/blind-judge.js";

export * from "../../src/validation/blind-judge.js";

async function cli(): Promise<void> {
  let invocation: JudgeInvocation;
  try {
    invocation = parseJudgeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`quality-judge: ${error instanceof Error ? error.message : String(error)}`);
    console.log("STATUS: BLOCKED");
    process.exitCode = EXIT_CODES.BLOCKED;
    return;
  }
  const report = await runJudge(invocation, defaultJudgeDeps());
  const { aggregate: summary } = report;
  console.log(
    `trials: ${report.trials.length}; candidate wins ${summary.candidate_wins}/${summary.decisive} decisive; Wilson LB ${summary.wilson_lower_bound ?? "n/a"}`,
  );
  if (report.reasons.length) console.log(`reasons: ${report.reasons.join(", ")}`);
  for (const error of report.errors) console.error(`error: ${error}`);
  console.log(`quality-judge report: ${invocation.reportPath}`);
  console.log(`STATUS: ${report.status}`);
  process.exitCode = EXIT_CODES[report.status];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await cli();
