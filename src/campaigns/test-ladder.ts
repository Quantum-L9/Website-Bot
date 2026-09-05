// L9_META: layer=campaign, role=test_ladder, status=active, version=1.0.0
/**
 * Test ladder Levels 0–4 with early rejection (design contract §11).
 * Any failed level stops that challenger. Level 0 is artifact/lineage/business
 * facts/route compatibility/content slots/forbidden claims validation;
 * Levels 1–4 compose probe providers over QualityDimensionResults and evidence
 * refs. Probe providers for full rendering are campaign-runtime concerns.
 */

import { type AttemptedStage, assertFrontier } from "./invalidation-frontier.js";
import { assertMutationEnvelope, type BuildDiffEntry } from "./mutation-plan.js";
import type { CandidateMutationPlan, QualityDeltaIndex } from "./types.js";

export type LadderLevel = 0 | 1 | 2 | 3 | 4;

export interface LadderLevelResult {
  level: LadderLevel;
  passed: boolean;
  notes: string[];
}

export interface LadderEvidence {
  build_passed: boolean;
  business_facts_passed: boolean;
  artifact_lineage_passed: boolean;
  blueprint_conformance_passed: boolean;
  seo_content_contract_passed: boolean;
  forbidden_claims_present: string[];
  content_slots_missing: string[];
  diff: BuildDiffEntry[];
  attempted_stages: AttemptedStage[];
}

export interface LadderProbeInput {
  level: LadderLevel;
  plan: CandidateMutationPlan;
  index: QualityDeltaIndex | null;
}

export type LadderProbeProvider = (
  input: LadderProbeInput,
) => Promise<{ passed: boolean; notes: string[] }>;

export interface RunTestLadderInput {
  plan: CandidateMutationPlan;
  evidence: LadderEvidence;
  index?: QualityDeltaIndex | null;
  providers?: Partial<Record<LadderLevel, LadderProbeProvider>>;
}

/**
 * Runs the ladder from Level 0 upward and stops at the first failed level.
 * Level 0 is always the deterministic artifact/lineage validation.
 */
export async function runTestLadder(input: RunTestLadderInput): Promise<LadderLevelResult[]> {
  const results: LadderLevelResult[] = [];

  const level0 = runLevel0(input.plan, input.evidence);
  results.push(level0);
  if (!level0.passed) return results;

  const providers = input.providers ?? {};
  for (const level of [1, 2, 3] as const) {
    const provider = providers[level] ?? defaultProvider;
    const result = await provider({ level, plan: input.plan, index: input.index ?? null });
    results.push({ level, ...result });
    if (!result.passed) return results;
  }

  const level4Provider = providers[4] ?? defaultProvider;
  const level4 = await level4Provider({ level: 4, plan: input.plan, index: input.index ?? null });
  results.push({ level: 4, ...level4 });
  return results;
}

export function runLevel0(
  plan: CandidateMutationPlan,
  evidence: LadderEvidence,
): LadderLevelResult {
  const notes: string[] = [];

  const envelopeViolations = assertMutationEnvelope(plan, evidence.diff);
  if (envelopeViolations.length > 0) {
    notes.push(...envelopeViolations.map((violation) => `envelope: ${violation}`));
  }
  const frontierViolations = assertFrontier(plan.mutation.layer, evidence.attempted_stages);
  if (frontierViolations.length > 0) {
    notes.push(
      ...frontierViolations.map(({ stage }) => `frontier: reused stage recomputed: ${stage}`),
    );
  }
  if (!evidence.build_passed) notes.push("artifact: build did not pass");
  if (!evidence.business_facts_passed) notes.push("lineage: business facts did not pass");
  if (!evidence.artifact_lineage_passed) notes.push("lineage: artifact lineage did not pass");
  if (!evidence.blueprint_conformance_passed)
    notes.push("contract: blueprint conformance did not pass");
  if (!evidence.seo_content_contract_passed)
    notes.push("contract: seo content contract did not pass");
  if (evidence.forbidden_claims_present.length > 0) {
    notes.push(`forbidden claims present: ${evidence.forbidden_claims_present.join(", ")}`);
  }
  if (evidence.content_slots_missing.length > 0) {
    notes.push(`content slots missing: ${evidence.content_slots_missing.join(", ")}`);
  }

  return { level: 0, passed: notes.length === 0, notes };
}

/** Default probes for Levels 1–4: dimension-based gating over available results. */
async function defaultProvider(
  input: LadderProbeInput,
): Promise<{ passed: boolean; notes: string[] }> {
  const index = input.index;
  if (!index) {
    return {
      passed: false,
      notes: [`level ${input.level}: no QualityDeltaIndex available for evaluation`],
    };
  }
  const notes: string[] = [];
  const failed = index.aggregate.hard_gate_failures;
  if (failed.length > 0) {
    notes.push(`level ${input.level}: hard-gate failures: ${failed.join(", ")}`);
    return { passed: false, notes };
  }
  if (input.level >= 2 && index.aggregate.inconclusive.length > 0) {
    notes.push(
      `level ${input.level}: inconclusive dimensions: ${index.aggregate.inconclusive.join(", ")}`,
    );
    return { passed: false, notes };
  }
  if (input.level === 4 && index.aggregate.regressions_vs_champion.length > 0) {
    notes.push(
      `level 4: regressions vs champion: ${index.aggregate.regressions_vs_champion.join(", ")}`,
    );
    return { passed: false, notes };
  }
  return { passed: true, notes };
}
