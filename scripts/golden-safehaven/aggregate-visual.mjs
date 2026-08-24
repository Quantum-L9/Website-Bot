#!/usr/bin/env node
/**
 * §20 VISUAL AGGREGATION — deterministic.
 *
 * Consumes trials-raw.json and oracle.json. Produces:
 *   normalized-results.json   — per-trial, per-pair normalization record
 *   aggregate.json            — pair majorities, vote counts, Wilson lower
 *                               bound, dimension means, weighted mean delta
 *                               (oracle weight map), critical-pair outcomes,
 *                               critical-dimension outcomes
 *
 * No LLM participates here. The orientation normalizer is exercised by the
 * unit tests (reversed orientation must reverse the normalized preference).
 */
import fs from "node:fs";
import path from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : process.argv[i + 1];
}
const visualDir = arg("visual");
const oraclePath = arg("oracle") ?? "tests/golden/safehaven/oracle.json";
const outRoot = path.join(visualDir, "aggregated");

const oracle = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), oraclePath), "utf8"));
const trialsFile = JSON.parse(fs.readFileSync(path.join(visualDir, "trials-raw.json"), "utf8"));
const trials = trialsFile.trials ?? [];

const vc = oracle.visual_oracle;
const pass = vc.pass;
const weights = vc.dimensions;
const criticalPairs = pass.critical_pairs_may_not_lose;
const criticalDims = pass.critical_dimensions_may_not_regress;

function wilsonLowerBound(successes, n, z = 1.96) {
  if (!n) return 0;
  const p = successes / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

// Pair-level aggregation
const byPair = new Map();
for (const t of trials) {
  if (!byPair.has(t.pair_id)) byPair.set(t.pair_id, []);
  byPair.get(t.pair_id).push(t);
}

const pairResults = [];
let candidateVotes = 0;
let totalVotes = 0;
let majorityWins = 0;
let majorityLosses = 0;
const dimSums = new Map();
let dimTrials = 0;

for (const [pairId, ts] of byPair) {
  let c = 0;
  let b = 0;
  for (const t of ts) {
    if (t.normalized_preference === "CANDIDATE") { c += 1; candidateVotes += 1; }
    else if (t.normalized_preference === "BASELINE") { b += 1; }
    totalVotes += 1;
    for (const [d, v] of Object.entries(t.normalized_candidate_delta ?? {})) {
      dimSums.set(d, (dimSums.get(d) ?? 0) + Number(v));
      dimTrials += 1;
    }
  }
  const majority = c >= 2 ? "CANDIDATE" : b >= 2 ? "BASELINE" : "NO_MAJORITY";
  if (majority === "CANDIDATE") majorityWins += 1;
  if (majority === "BASELINE") majorityLosses += 1;
  const key = `${ts[0].route}::${ts[0].viewport}`;
  pairResults.push({
    pair_id: pairId,
    key,
    candidate_votes: c,
    baseline_votes: b,
    ties: ts.length - c - b,
    majority,
    critical_pair: criticalPairs.includes(key),
    critical_pair_regressed: criticalPairs.includes(key) && majority === "BASELINE",
  });
}

const dimensionMeans = {};
const dimensionTrials = dimTrials;
for (const [d, sum] of dimSums) dimensionMeans[d] = sum / dimensionTrials;

let weightedMeanDelta = 0;
const weightSum = Object.values(weights).reduce((a, x) => a + x, 0);
for (const [d, w] of Object.entries(weights)) {
  weightedMeanDelta += (dimensionMeans[d] ?? 0) * w;
}
const weightSumValid = Math.abs(weightSum - 1.0) < 1e-9;

const lowerBound = wilsonLowerBound(candidateVotes, totalVotes);

const aggregate = {
  schema: "l9.golden-visual-aggregate/v1",
  run_id: trialsFile.run_id,
  pairs: pairResults,
  candidate_visual_votes: candidateVotes,
  total_visual_votes: totalVotes,
  majority_wins: majorityWins,
  majority_losses: majorityLosses,
  wilson_lower_bound: lowerBound,
  dimension_means: dimensionMeans,
  dimension_weights_used: weights,
  weight_sum: weightSum,
  weight_sum_valid: weightSumValid,
  weighted_mean_delta: weightedMeanDelta,
  critical_pairs: {
    required: criticalPairs,
    regressed: pairResults.filter((p) => p.critical_pair_regressed).map((p) => p.key),
  },
  critical_dimensions: {
    required: criticalDims,
    means: Object.fromEntries(criticalDims.map((d) => [d, dimensionMeans[d] ?? null])),
    regressed: criticalDims.filter((d) => (dimensionMeans[d] ?? null) !== null && dimensionMeans[d] < 0),
    unmeasured: criticalDims.filter((d) => !(d in dimensionMeans)),
  },
  gates: {
    min_pair_majority_wins: pass.minimum_pair_majority_wins,
    max_pair_majority_losses: pass.maximum_pair_majority_losses,
    min_candidate_votes: pass.minimum_candidate_votes,
    total_votes: pass.total_votes,
    wilson_lower_bound_must_exceed: pass.wilson_lower_bound_must_exceed,
    minimum_weighted_mean_delta: pass.minimum_weighted_mean_delta,
  },
};

fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(path.join(outRoot, "normalized-results.json"), `${JSON.stringify({ schema: "l9.golden-visual-normalized/v1", run_id: trialsFile.run_id, trials }, null, 2)}\n`);
fs.writeFileSync(path.join(outRoot, "aggregate.json"), `${JSON.stringify(aggregate, null, 2)}\n`);
console.log(JSON.stringify({
  candidate_visual_votes: candidateVotes,
  total_visual_votes: totalVotes,
  majority_wins: majorityWins,
  majority_losses: majorityLosses,
  wilson_lower_bound: Number(lowerBound.toFixed(4)),
  weighted_mean_delta: Number(weightedMeanDelta.toFixed(4)),
  weight_sum_valid: weightSumValid,
  critical_pair_regressions: aggregate.critical_pairs.regressed,
  critical_dimension_regressions: aggregate.critical_dimensions.regressed,
  unmeasured_critical_dimensions: aggregate.critical_dimensions.unmeasured,
}, null, 2));
process.exit(0);
