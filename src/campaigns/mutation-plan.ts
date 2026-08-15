// L9_META: layer=campaign, role=candidate_mutation_plan, status=active, version=1.0.0
/**
 * CandidateMutationPlan + assertMutationEnvelope (design contract §4.2).
 * The plan is the experiment definition: what may change, what must not, and the
 * causal hypothesis. The envelope assertion rejects any build whose diff touches
 * a forbidden path or a member of unchanged_contract.
 */
import type { ArtifactRef } from '@quantum-l9/bot-interop';
import type { ArtifactRefLike, LearningArtifactRef } from './types.js';
import { payloadDigestOf } from './semantic-digest.js';
import { MUTATION_LAYERS, type CandidateMutationPlan, type MutationLayer, type MutationSignature } from './types.js';
import { assertQualityDimension } from './quality-dimensions.js';

export interface PlanMutationInput {
  candidate_id: string;
  parent_candidate_id: string | null;
  layer: string;
  target_paths: string[];
  forbidden_paths: string[];
  unchanged_contract: string[];
  primary_dimension: string;
  guardrail_dimensions: string[];
  expected_causal_path: string[];
  expected_effects: Record<string, string>;
  confidence_before: number;
  inherited_artifacts: Record<string, ArtifactRefLike>;
  experimental_control: {
    inherited_exact: ArtifactRefLike[];
    changed: string[];
  };
  mutation_signature: MutationSignature;
}

export function buildCandidateMutationPlan(input: PlanMutationInput): CandidateMutationPlan {
  const errors = validateCandidateMutationPlanInput(input);
  if (errors.length > 0) throw new Error(`Invalid CandidateMutationPlan: ${errors.join('; ')}`);
  const payload: Omit<CandidateMutationPlan, 'integrity'> = {
    schema: 'website-bot.candidate-mutation-plan/v1',
    schema_version: '1.0.0',
    artifact_type: 'CandidateMutationPlan',
    candidate_id: input.candidate_id,
    parent_candidate_id: input.parent_candidate_id,
    mutation: {
      layer: input.layer as MutationLayer,
      target_paths: [...input.target_paths],
      forbidden_paths: [...input.forbidden_paths],
      unchanged_contract: [...input.unchanged_contract],
    },
    hypothesis: {
      primary_dimension: assertQualityDimension(input.primary_dimension),
      guardrail_dimensions: input.guardrail_dimensions.map(dimension => assertQualityDimension(dimension)),
    },
    expected_causal_path: [...input.expected_causal_path],
    expected_effects: Object.fromEntries(
      Object.entries(input.expected_effects).map(([dimension, verdict]) => [assertQualityDimension(dimension), verdict]),
    ) as CandidateMutationPlan['expected_effects'],
    confidence_before: input.confidence_before,
    inherited_artifacts: { ...input.inherited_artifacts },
    experimental_control: input.experimental_control,
    mutation_signature: input.mutation_signature,
  };
  const digest = payloadDigestOf({
    protocol: 'l9.website-bot.learning-plane',
    protocol_version: '1',
    artifact_type: 'CandidateMutationPlan',
    input_refs: [],
    payload,
  });
  return { ...payload, integrity: { algorithm: 'sha256', payload_digest: digest } };
}

export function validateCandidateMutationPlanInput(input: PlanMutationInput): string[] {
  const errors: string[] = [];
  if (!input.candidate_id) errors.push('candidate_id required');
  if (!(MUTATION_LAYERS as readonly string[]).includes(input.layer)) errors.push(`layer must be one of ${MUTATION_LAYERS.join('|')}`);
  if (!input.primary_dimension) errors.push('hypothesis.primary_dimension required');
  if (input.guardrail_dimensions.length === 0) errors.push('hypothesis.guardrail_dimensions must not be empty');
  if (typeof input.confidence_before !== 'number' || input.confidence_before < 0 || input.confidence_before > 1) {
    errors.push('confidence_before must be a number in [0, 1]');
  }
  if (input.experimental_control.inherited_exact.length === 0 && input.experimental_control.changed.length === 0) {
    errors.push('experimental_control must record inherited_exact or changed');
  }
  if (input.target_paths.length === 0) errors.push('mutation.target_paths must not be empty');
  for (const forbidden of input.forbidden_paths) {
    if (input.target_paths.includes(forbidden)) errors.push(`path ${forbidden} is both target and forbidden`);
  }
  return errors;
}

/** A build diff entry: which paths changed on disk or in the artifact tree. */
export interface BuildDiffEntry {
  path: string;
  kind: 'changed' | 'added' | 'removed';
}

function pathTouches(path: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}/`));
}

/**
 * assertMutationEnvelope: returns violations when a build diff touches a forbidden
 * path or a member of unchanged_contract. Empty array means the envelope holds.
 */
export function assertMutationEnvelope(plan: CandidateMutationPlan, diff: BuildDiffEntry[]): string[] {
  const violations: string[] = [];
  for (const entry of diff) {
    if (pathTouches(entry.path, plan.mutation.forbidden_paths)) {
      violations.push(`forbidden path touched: ${entry.path}`);
    }
    if (pathTouches(entry.path, plan.mutation.unchanged_contract)) {
      violations.push(`unchanged_contract member touched: ${entry.path}`);
    }
  }
  return violations;
}

/** artifact_id for the plan, matching the observed `${artifact_type}:${payload_digest}` convention. */
export function candidateMutationPlanArtifactId(plan: CandidateMutationPlan): string {
  return `CandidateMutationPlan:${plan.integrity.payload_digest}`;
}

export function candidateMutationPlanRef(plan: CandidateMutationPlan): LearningArtifactRef {
  return {
    artifact_type: 'CandidateMutationPlan',
    artifact_id: candidateMutationPlanArtifactId(plan),
    payload_digest: plan.integrity.payload_digest,
  };
}
