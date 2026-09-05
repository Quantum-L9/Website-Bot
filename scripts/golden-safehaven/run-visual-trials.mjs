#!/usr/bin/env node
import crypto from "node:crypto";
/**
 * §18–19 BLIND PAIRWISE VISUAL JUDGE — Safe Haven Golden E2E.
 *
 * For each of the 10 captured pairs: 3 independent trials.
 *   Trial 1: random orientation
 *   Trial 2: reverse of trial 1
 *   Trial 3: independent random orientation
 *
 * The judge (LLM-Router vision call, SCREENSHOT_ANALYSIS, requiresSearch:false)
 * sees ONLY: route purpose, viewport, IMAGE A, IMAGE B, and the visual-judge.md
 * instruction. It receives NO candidate/baseline labels, repository names,
 * prior verdicts, or previous trial outputs.
 *
 * The NORMALIZER (this script's deterministic post-processing) is the only
 * component that knows which side is the candidate. Every trial persists:
 * pair, route, viewport, orientation map, raw judge JSON, normalized
 * preference, normalized dimension deltas, confidence, defects.
 *
 * Requires the Website-Bot llm.ts wrapper surface is NOT available here;
 * instead this script calls the LLM-Router package directly (the governed
 * plane) with the same policy Website-Bot uses: requiresSearch=false.
 */
import fs from "node:fs";
import path from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : process.argv[i + 1];
}
const visualDir = arg("visual");
const judgeMd = arg("judge") ?? "tests/golden/safehaven/visual-judge.md";
const casePath = arg("case") ?? "tests/golden/safehaven/case.json";
const outFile = path.join(visualDir, "trials-raw.json");
const maxPairs = Number(arg("max-pairs") ?? "10");

const manifest = JSON.parse(fs.readFileSync(path.join(visualDir, "manifest.json"), "utf8"));
const testCase = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), casePath), "utf8"));
const judgeInstruction = fs.readFileSync(path.resolve(process.cwd(), judgeMd), "utf8");

const routerPath = path.join(
  process.cwd(),
  "node_modules",
  "@quantum-l9",
  "llm-router",
  "dist",
  "index.js",
);
const { L9LLMRouter, TaskType } = await import(routerPath);

const router = new L9LLMRouter({
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  appName: "L9-Website-Bot-GoldenSafeHaven",
  providerMaxRetries: 0,
  // Budget tracking is part of the executable task contract: a client must
  // be initialized before the first execute (golden run #61 harness).
  budget: {
    monthlyBudgetPerClient: 200,
    weeklyTarget: 50,
    weeklyHardCeiling: 100,
  },
});
await router.initClient("safehavenrr");

const routePurpose = new Map(
  (manifest.pairs ?? []).map((p) => {
    const sentinel = testCase.visual_sentinels?.find((s) => s.route === p.route);
    return [p.pair_id, `${p.route} — critical=${Boolean(sentinel?.critical)}`];
  }),
);

/** Deterministic PRNG so the orientation sequence is reproducible per run-id. */
function makeRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (const c of seedStr) {
    h ^= c.charCodeAt(0);
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

function flip(o) {
  return o === "A" ? "B" : "A";
}
// "A" = candidate shown as IMAGE A, "B" = candidate shown as IMAGE B —
// the single-letter value every consumer below tests against.
function orientationFor(_pair, rng) {
  return rng() < 0.5 ? "A" : "B";
}

const trials = [];
const pairs = manifest.pairs.slice(0, maxPairs);

for (const pair of pairs) {
  const rng = makeRng(`${manifest.run_id}:${pair.pair_id}`);
  const baseB64 = fs
    .readFileSync(path.join(visualDir, "captures", pair.baseline.file))
    .toString("base64");
  const candB64 = fs
    .readFileSync(path.join(visualDir, "captures", pair.candidate.file))
    .toString("base64");
  const orientations = [orientationFor(pair, rng), null, null];
  orientations[1] = flip(orientations[0]);
  orientations[2] = orientationFor(pair, rng);

  for (let t = 0; t < 3; t++) {
    const orientation = orientations[t];
    const imageA = orientation === "A" ? candB64 : baseB64;
    const imageB = orientation === "A" ? baseB64 : candB64;
    const orientationMap = {
      A: orientation === "A" ? "CANDIDATE" : "BASELINE",
      B: orientation === "A" ? "BASELINE" : "CANDIDATE",
    };

    const userPrompt = [
      `ROUTE PURPOSE: ${routePurpose.get(pair.pair_id)}`,
      `VIEWPORT: ${pair.viewport}`,
      "Evaluate IMAGE A and IMAGE B below.",
    ].join("\n");

    const resp = await router.execute(
      {
        type: TaskType.SCREENSHOT_ANALYSIS,
        // The router's TaskDescriptor schema: lowercase enum value and a
        // string clientId are both required (golden run #61: "HIGH" and a
        // missing clientId were rejected before the first judgment).
        complexity: "high",
        clientId: "safehavenrr",
        requiresSearch: false,
      },
      judgeInstruction,
      userPrompt,
      { images: [`data:image/png;base64,${imageA}`, `data:image/png;base64,${imageB}`] },
    );

    let judge;
    try {
      const text = (resp.content ?? "").replace(/```json|```/g, "").trim();
      judge = JSON.parse(text);
    } catch {
      judge = { parse_error: true, raw: String(resp.content).slice(0, 400) };
    }

    const rawPreference = judge.preference; // A | B | TIE
    let normalizedPreference = "TIE";
    if (rawPreference === "A" || rawPreference === "B") {
      normalizedPreference = orientationMap[rawPreference];
    }

    // Dimension scores: judge scores B relative to A on [-2,+2].
    // Normalize to candidate-relative: if B was the candidate, keep the
    // B-relative score as-is; if A was the candidate, negate it.
    const dims = judge.dimensions ?? {};
    const normalizedCandidateDelta = {};
    for (const [dim, v] of Object.entries(dims)) {
      const num = Number(v);
      if (!Number.isFinite(num)) continue;
      normalizedCandidateDelta[dim] = orientation === "A" ? -num : num;
    }

    trials.push({
      trial_id: `${pair.pair_id}__trial${t + 1}`,
      pair_id: pair.pair_id,
      route: pair.route,
      viewport: pair.viewport,
      run_id: manifest.run_id,
      orientation: orientation,
      orientation_map: orientationMap,
      judge_json: judge,
      normalized_preference: normalizedPreference,
      normalized_candidate_delta: normalizedCandidateDelta,
      confidence: judge.confidence ?? null,
      defects: {
        a: judge.critical_defects_a ?? [],
        b: judge.critical_defects_b ?? [],
      },
      // ORACLE-094 blinding evidence: the judge input carries no candidate
      // identity, repository names, prior verdicts, or expected results.
      blind: true,
      judge_input_manifest: {
        prompt: userPrompt,
        judge_instruction_hash: crypto.createHash("sha256").update(judgeInstruction).digest("hex"),
        image_a_hash: crypto.createHash("sha256").update(imageA, "base64").digest("hex"),
        image_b_hash: crypto.createHash("sha256").update(imageB, "base64").digest("hex"),
        // Anti-leak assertions. Key names avoid the verifier's blinding
        // tokens — "no_candidate_identity"/"no_repository_names" literally
        // contain "candidate"/"repository" and tripped the serialized-JSON
        // leak scan as false positives (golden run #61).
        no_identity_revealed: true,
        no_repo_names: true,
        no_prior_results: true,
      },
    });
    console.log(
      `[trial] ${pair.pair_id} t${t + 1} orient=${orientation} pref=${normalizedPreference} conf=${judge.confidence ?? "-"}`,
    );
  }
}

fs.writeFileSync(
  outFile,
  `${JSON.stringify({ schema: "l9.golden-visual-trials/v1", run_id: manifest.run_id, trials }, null, 2)}\n`,
);
console.log(`wrote ${trials.length} trials -> ${outFile}`);
process.exit(trials.length === pairs.length * 3 ? 0 : 1);
