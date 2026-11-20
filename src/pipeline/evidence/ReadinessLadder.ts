// L9_META: layer=pipeline, role=readiness_ladder_contract, status=active, version=1.0.0
//
// Readiness ladder: what this build has actually been shown to be ready for.
// Six distinct, non-collapsible levels, each recorded on its own with its own
// evidence reference. A level is never inferred from another (L9-ASSURANCE-001:
// requirement, implementation and assurance states are distinct), and a level
// nothing in this build observed stays NOT_RUN with the reason, never PASS
// (L9-UNKNOWN-001). A PASS or FAIL names the evidence it rests on; that
// evidence attests only to what its own contract declares (L9-EVIDENCE-001).

export const READINESS_LEVELS = [
  "structural_ci",
  "replay_quality_gate",
  "live_provider_canary",
  "client_build_quality_check",
  "blind_judge_vs_baseline",
  "operator_deploy_approval",
] as const;

export type ReadinessLevel = (typeof READINESS_LEVELS)[number];
export type ReadinessState = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";

export interface ReadinessEntry {
  level: ReadinessLevel;
  state: ReadinessState;
  /** Evidence the state rests on: an evidence-store path, report path or URL. Required for PASS/FAIL. */
  evidence_ref: string | null;
  /** Why the level was not judged, or what blocked it. Required for NOT_RUN/BLOCKED. */
  reason?: string;
}

export interface ReadinessLadder {
  schema: "website-bot.readiness-ladder/v1";
  levels: ReadinessEntry[];
}

/** What a stage records for one level; the ladder fills the rest as NOT_RUN. */
export type ReadinessObservation = Omit<ReadinessEntry, "level">;
export type ReadinessObservations = Partial<Record<ReadinessLevel, ReadinessObservation>>;

const STATES = new Set<ReadinessState>(["PASS", "FAIL", "NOT_RUN", "BLOCKED"]);

/**
 * Why a level is NOT_RUN when no stage of this build observed it. These are
 * statements about this build's own evidence, not about the level's merit.
 */
const NOT_OBSERVED: Record<ReadinessLevel, string> = {
  structural_ci: "CI results are not observed inside a build; see the PR's CI checks",
  replay_quality_gate:
    "the replay site-quality gate runs in CI (site-quality.yml), not inside a build",
  live_provider_canary: "no live provider canary ran for this build",
  client_build_quality_check: "the rendered-site quality checker did not run on this build",
  blind_judge_vs_baseline: "the blind judge did not run on this build",
  operator_deploy_approval: "no operator deploy approval is recorded for this build",
};

/** The full ladder: every level once, in order; unobserved levels are NOT_RUN. */
export function buildReadinessLadder(observations: ReadinessObservations = {}): ReadinessLadder {
  return {
    schema: "website-bot.readiness-ladder/v1",
    levels: READINESS_LEVELS.map((level) => {
      const observed = observations[level];
      if (observed) return { level, ...observed };
      return { level, state: "NOT_RUN", evidence_ref: null, reason: NOT_OBSERVED[level] };
    }),
  };
}

/** Throws when a ladder is malformed: every rule here keeps the levels distinct and evidence-bound. */
export function validateReadinessLadder(ladder: unknown): asserts ladder is ReadinessLadder {
  const value = ladder as Partial<ReadinessLadder> | null;
  if (value?.schema !== "website-bot.readiness-ladder/v1" || !Array.isArray(value.levels))
    throw new Error("readiness ladder identity is invalid");
  if (value.levels.length !== READINESS_LEVELS.length)
    throw new Error(`readiness ladder must record all ${READINESS_LEVELS.length} levels`);
  value.levels.forEach((entry, index) => {
    const expected = READINESS_LEVELS[index];
    if (!entry || entry.level !== expected)
      throw new Error(`readiness ladder level ${index} must be ${expected}`);
    if (!STATES.has(entry.state))
      throw new Error(`readiness ${expected} state ${JSON.stringify(entry.state)} is invalid`);
    const hasEvidence = typeof entry.evidence_ref === "string" && entry.evidence_ref.trim() !== "";
    if (entry.evidence_ref !== null && !hasEvidence)
      throw new Error(`readiness ${expected} evidence_ref must be a non-empty string or null`);
    if ((entry.state === "PASS" || entry.state === "FAIL") && !hasEvidence)
      throw new Error(`readiness ${expected} is ${entry.state} without an evidence reference`);
    const hasReason = typeof entry.reason === "string" && entry.reason.trim() !== "";
    if ((entry.state === "NOT_RUN" || entry.state === "BLOCKED") && !hasReason)
      throw new Error(`readiness ${expected} is ${entry.state} without a reason`);
    if (entry.reason !== undefined && !hasReason)
      throw new Error(`readiness ${expected} reason must be a non-empty string`);
  });
}

/** One level's state, read directly: never derived from another level. */
export function readinessState(ladder: ReadinessLadder, level: ReadinessLevel): ReadinessState {
  const entry = ladder.levels.find((candidate) => candidate.level === level);
  if (!entry) throw new Error(`readiness ladder has no ${level} level`);
  return entry.state;
}
