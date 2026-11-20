// L9_META: layer=script, role=site_quality_blind_judge, status=active, version=1.0.0
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

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serveDirectory } from "./extract-page.js";

export const JUDGE_REPORT_SCHEMA = "website-bot.blind-judge-report/v1";
export const EXIT_CODES = { PASS: 0, FAIL: 1, BLOCKED: 2, NOT_RUN: 2 } as const;
export const JUDGE_CREDENTIALS = ["DEEPSEEK_API_KEY"];
const JUDGE_INSTRUCTION = resolve(
  import.meta.dirname,
  "..",
  "..",
  "tests",
  "golden",
  "safehaven",
  "visual-judge.md",
);

export const VIEWPORTS = {
  desktop_1440: { width: 1440, height: 900 },
  iphone_14: { width: 390, height: 844 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

export const DIMENSIONS = [
  "visual_hierarchy",
  "brand_coherence",
  "conversion_clarity",
  "trust_and_credibility",
  "authentic_imagery",
  "content_readability",
  "information_density",
  "spacing_and_rhythm",
  "mobile_usability",
  "professional_polish",
] as const;

export interface JudgeInvocation {
  candidate: { dist?: string; url?: string };
  baseline: { url?: string; screenshots?: string };
  pages: string[];
  viewports: ViewportName[];
  trials: number;
  runId: string;
  clientId: string;
  reportPath: string;
}

export interface JudgeDeps {
  env: NodeJS.ProcessEnv;
  /** Screenshot `url` at `viewport` into `file`. */
  capture(url: string, viewport: ViewportName, file: string): Promise<void>;
  loadJudge(clientId: string): Promise<{
    judge(instruction: string, userPrompt: string, images: [string, string]): Promise<string>;
  }>;
}

export interface Trial {
  pair: string;
  trial: number;
  candidate_side: "A" | "B";
  raw_preference: string | null;
  candidate_preference: "CANDIDATE" | "BASELINE" | "TIE" | "INVALID";
  candidate_delta: Record<string, number>;
  candidate_critical_defects: string[];
  error?: string;
}

export interface JudgeReport {
  schema: typeof JUDGE_REPORT_SCHEMA;
  run_id: string;
  status: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
  reasons: string[];
  candidate: string;
  baseline: string;
  pairs: number;
  trials: Trial[];
  aggregate: {
    decisive: number;
    candidate_wins: number;
    win_rate: number | null;
    wilson_lower_bound: number | null;
    mean_delta: Record<string, number>;
  };
  instruction_sha256: string | null;
  errors: string[];
}

export function pageFileName(page: string): string {
  return page === "/" ? "_index" : page.replaceAll("/", "_");
}

/** Deterministic xorshift PRNG seeded from a string (same as the golden trials). */
export function makeRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (const char of seed) {
    h ^= char.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

/** Candidate side per trial: random, the reverse, then random again. */
export function orientations(seed: string, trials: number): Array<"A" | "B"> {
  const rng = makeRng(seed);
  const sides: Array<"A" | "B"> = [];
  for (let index = 0; index < trials; index += 1) {
    const previous = sides[index - 1];
    sides.push(
      index % 3 === 1 && previous ? (previous === "A" ? "B" : "A") : rng() < 0.5 ? "A" : "B",
    );
  }
  return sides;
}

/** Wilson score lower bound (95%) for `wins` out of `n`. */
export function wilsonLowerBound(wins: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - margin) / denominator;
}

/** Normalize one blind verdict back to candidate-vs-baseline orientation. */
export function normalizeTrial(
  raw: string,
  candidateSide: "A" | "B",
): Omit<Trial, "pair" | "trial"> {
  let parsed: Record<string, unknown>;
  try {
    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/, "")
      .trim();
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("not an object");
    parsed = value as Record<string, unknown>;
  } catch {
    return {
      candidate_side: candidateSide,
      raw_preference: null,
      candidate_preference: "INVALID",
      candidate_delta: {},
      candidate_critical_defects: [],
      error: "unparseable judge output",
    };
  }
  const preference = parsed.preference;
  const dims = (parsed.dimensions ?? {}) as Record<string, unknown>;
  const delta: Record<string, number> = {};
  for (const dimension of DIMENSIONS) {
    const value = Number(dims[dimension]);
    if (Number.isFinite(value) && value >= -2 && value <= 2)
      // Scores are B relative to A: keep them when the candidate is B.
      delta[dimension] = candidateSide === "B" ? value : -value;
  }
  const validPreference = preference === "A" || preference === "B" || preference === "TIE";
  const complete = Object.keys(delta).length === DIMENSIONS.length;
  const defects = parsed[candidateSide === "A" ? "critical_defects_a" : "critical_defects_b"];
  return {
    candidate_side: candidateSide,
    raw_preference: typeof preference === "string" ? preference : null,
    candidate_preference:
      !validPreference || !complete
        ? "INVALID"
        : preference === "TIE"
          ? "TIE"
          : preference === candidateSide
            ? "CANDIDATE"
            : "BASELINE",
    candidate_delta: delta,
    candidate_critical_defects: Array.isArray(defects)
      ? defects.filter((item): item is string => typeof item === "string" && item !== "NONE")
      : [],
    ...(!validPreference || !complete
      ? { error: "judge output missing preference or a dimension" }
      : {}),
  };
}

export function aggregate(trials: Trial[]): JudgeReport["aggregate"] {
  const decisive = trials.filter(
    (trial) =>
      trial.candidate_preference === "CANDIDATE" || trial.candidate_preference === "BASELINE",
  );
  const wins = decisive.filter((trial) => trial.candidate_preference === "CANDIDATE").length;
  const valid = trials.filter((trial) => trial.candidate_preference !== "INVALID");
  const mean: Record<string, number> = {};
  for (const dimension of DIMENSIONS) {
    const values = valid.map((trial) => trial.candidate_delta[dimension] ?? 0);
    mean[dimension] = values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
      : 0;
  }
  return {
    decisive: decisive.length,
    candidate_wins: wins,
    win_rate: decisive.length ? wins / decisive.length : null,
    wilson_lower_bound: decisive.length ? wilsonLowerBound(wins, decisive.length) : null,
    mean_delta: mean,
  };
}

function flag(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

export function parseJudgeArgs(argv: string[]): JudgeInvocation {
  const candidateDist = flag(argv, "candidate-dist");
  const candidateUrl = flag(argv, "candidate-url");
  if (!candidateDist === !candidateUrl)
    throw new Error("exactly one of --candidate-dist or --candidate-url is required");
  const baselineUrl = flag(argv, "baseline-url");
  const baselineShots = flag(argv, "baseline-screenshots");
  if (!baselineUrl === !baselineShots)
    throw new Error("exactly one of --baseline-url or --baseline-screenshots is required");
  const pages = (flag(argv, "pages") ?? "")
    .split(",")
    .map((page) => page.trim())
    .filter(Boolean)
    .map((page) => (page.startsWith("/") ? page : `/${page}`));
  if (!pages.length) throw new Error("--pages is required");
  const viewports = (flag(argv, "viewports") ?? "desktop_1440,iphone_14").split(",").map((name) => {
    if (!(name in VIEWPORTS)) throw new Error(`unknown viewport ${JSON.stringify(name)}`);
    return name as ViewportName;
  });
  const trials = Number(flag(argv, "trials") ?? "3");
  if (!Number.isInteger(trials) || trials < 1 || trials > 9)
    throw new Error("--trials must be 1..9");
  const runId = flag(argv, "run-id") ?? `judge-${Date.now()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId))
    throw new Error("--run-id is not a safe identifier");
  return {
    candidate: candidateDist ? { dist: resolve(candidateDist) } : { url: candidateUrl },
    baseline: baselineShots ? { screenshots: resolve(baselineShots) } : { url: baselineUrl },
    pages,
    viewports,
    trials,
    runId,
    clientId: flag(argv, "client-id") ?? "quality-judge",
    reportPath: resolve(
      flag(argv, "report") ?? join("build", "quality-judge", runId, "report.json"),
    ),
  };
}

export function defaultJudgeDeps(env: NodeJS.ProcessEnv = process.env): JudgeDeps {
  return {
    env,
    async capture(url, viewport, file) {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: VIEWPORTS[viewport] });
        const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
        const status = response?.status() ?? 0;
        if (status < 200 || status > 299) throw new Error(`${url} returned HTTP ${status}`);
        await page.screenshot({ path: file, fullPage: true });
      } finally {
        await browser.close();
      }
    },
    async loadJudge(clientId) {
      const { createWebsiteFactoryLLM, TaskComplexity, TaskType } = await import(
        "../../src/services/llm.js"
      );
      const llm = createWebsiteFactoryLLM(clientId, { env });
      return {
        judge: (instruction, userPrompt, images) =>
          llm.strategize(
            {
              type: TaskType.SCREENSHOT_ANALYSIS,
              complexity: TaskComplexity.HIGH,
              requiresSearch: false,
              description: "[quality-judge] blind_pairwise",
            },
            instruction,
            userPrompt,
            images,
          ),
      };
    },
  };
}

/** Run the blind judge and write its report. An outcome is reported, never thrown. */
export async function runJudge(invocation: JudgeInvocation, deps: JudgeDeps): Promise<JudgeReport> {
  const reasons = new Set<string>();
  const errors: string[] = [];
  const trials: Trial[] = [];
  let instructionSha: string | null = null;
  const candidateLabel = invocation.candidate.dist ?? invocation.candidate.url ?? "";
  const baselineLabel = invocation.baseline.screenshots ?? invocation.baseline.url ?? "";
  const pairs = invocation.pages.length * invocation.viewports.length;

  const missing = JUDGE_CREDENTIALS.filter((name) => !deps.env[name]?.trim());
  if (missing.length) {
    reasons.add("MISSING_EVALUATOR_CREDENTIALS");
    errors.push(`evaluator credentials missing: ${missing.join(", ")}`);
  } else {
    let server: { url: string; close(): Promise<void> } | undefined;
    try {
      const instruction = readFileSync(JUDGE_INSTRUCTION, "utf-8");
      instructionSha = createHash("sha256").update(instruction).digest("hex");
      const runDir = join(resolve(invocation.reportPath, ".."), `captures-${invocation.runId}`);
      mkdirSync(runDir, { recursive: true });
      let candidateBase = invocation.candidate.url;
      if (invocation.candidate.dist) {
        server = await serveDirectory(invocation.candidate.dist);
        candidateBase = server.url;
      }
      const judge = await deps.loadJudge(invocation.clientId);
      for (const page of invocation.pages)
        for (const viewport of invocation.viewports) {
          const pair = `${page}::${viewport}`;
          const name = `${pageFileName(page)}_${viewport}.png`;
          const candidateFile = join(runDir, `candidate${name}`);
          let baselineFile = join(runDir, `baseline${name}`);
          try {
            await deps.capture(
              `${candidateBase?.replace(/\/+$/, "")}${page}`,
              viewport,
              candidateFile,
            );
            if (invocation.baseline.screenshots) {
              baselineFile = join(invocation.baseline.screenshots, name);
              if (!existsSync(baselineFile))
                throw new Error(`baseline screenshot ${baselineFile} is missing`);
            } else
              await deps.capture(
                `${invocation.baseline.url?.replace(/\/+$/, "")}${page}`,
                viewport,
                baselineFile,
              );
          } catch (error) {
            reasons.add("CAPTURE_FAILED");
            errors.push(`${pair}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
          }
          const sides = orientations(`${invocation.runId}:${pair}`, invocation.trials);
          for (const [index, side] of sides.entries()) {
            const images: [string, string] =
              side === "A" ? [candidateFile, baselineFile] : [baselineFile, candidateFile];
            const userPrompt = [
              `ROUTE PURPOSE: ${page === "/" ? "home page" : `${page} page`}`,
              `VIEWPORT: ${viewport}`,
              "Evaluate IMAGE A and IMAGE B below.",
            ].join("\n");
            try {
              const raw = await judge.judge(instruction, userPrompt, images);
              const trial = { pair, trial: index + 1, ...normalizeTrial(raw, side) };
              if (trial.candidate_preference === "INVALID") reasons.add("VERDICT_INVALID");
              trials.push(trial);
            } catch (error) {
              reasons.add("EVALUATION_FAILED");
              errors.push(
                `${pair}#${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
    } catch (error) {
      reasons.add("UNEXPECTED_ERROR");
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      await server?.close().catch(() => undefined);
    }
  }

  const summary = aggregate(trials);
  if (!missing.length && trials.length !== pairs * invocation.trials)
    reasons.add("INCOMPLETE_COVERAGE");
  const criticalDefects = trials.some((trial) => trial.candidate_critical_defects.length > 0);
  if (criticalDefects) reasons.add("CANDIDATE_CRITICAL_DEFECT");
  let status: JudgeReport["status"];
  if (missing.length) status = "NOT_RUN";
  else if (
    [
      "CAPTURE_FAILED",
      "EVALUATION_FAILED",
      "VERDICT_INVALID",
      "UNEXPECTED_ERROR",
      "INCOMPLETE_COVERAGE",
    ].some((reason) => reasons.has(reason))
  )
    status = "BLOCKED";
  else if (summary.decisive === 0) {
    reasons.add("NO_DECISIVE_TRIALS");
    status = "FAIL";
  } else if ((summary.wilson_lower_bound ?? 0) <= 0.5 || criticalDefects) {
    if ((summary.wilson_lower_bound ?? 0) <= 0.5) reasons.add("CANDIDATE_NOT_PREFERRED");
    status = "FAIL";
  } else status = "PASS";

  const report: JudgeReport = {
    schema: JUDGE_REPORT_SCHEMA,
    run_id: invocation.runId,
    status,
    reasons: [...reasons].sort(),
    candidate: candidateLabel,
    baseline: baselineLabel,
    pairs,
    trials,
    aggregate: summary,
    instruction_sha256: instructionSha,
    errors,
  };
  mkdirSync(resolve(invocation.reportPath, ".."), { recursive: true });
  writeFileSync(invocation.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return report;
}

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
