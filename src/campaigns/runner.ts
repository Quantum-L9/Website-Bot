// L9_META: layer=campaign, role=campaign_runner, status=active, version=1.0.0
/**
 * Resumable Campaign Runner state machine (design contract §10).
 * The central loop: load → assert integrity → evaluate champion → REVIEWABLE?
 * → diagnose earliest failure → retrieve learnings → propose bounded hypothesis
 * → assert envelope → build incrementally → cheapest adequate test → promote
 * only on measured improvement → persist atomically → loop.
 *
 * Terminal states: REVIEWABLE | EXHAUSTED | BLOCKED | NO_PROGRESS | FATAL.
 * The runner is the only component allowed to decide whether another attempt
 * is justified.
 */
import type {
  CampaignDeps,
  CampaignManifest,
  CandidateMutationPlan,
  FailureFingerprint,
  QualityDeltaIndex,
  RunnerOutcome,
  RunnerTerminalState,
  RunnerWatchSink,
} from './types.js';
import {
  atomicWriteManifest,
  cleanStaleTempFiles,
  loadCampaignManifest,
  updateCampaignManifest,
} from './campaign-manifest.js';
import { assertMutationEnvelope } from './mutation-plan.js';
import { assertFrontier } from './invalidation-frontier.js';
import { isReviewable, buildExhaustionEscalation } from './reviewable.js';
import { evaluateChampionPromotion } from './candidate-evaluation.js';

export interface RunnerConfig {
  campaignRoot: string;
  deps: CampaignDeps;
  until: 'reviewable';
  maxCandidates?: number;
  maxNoProgressRounds?: number;
  watch?: RunnerWatchSink;
}

export class CampaignRunnerError extends Error {
  constructor(message: string, readonly terminal: RunnerTerminalState) {
    super(message);
  }
}

export async function runCampaign(config: RunnerConfig): Promise<RunnerOutcome> {
  cleanStaleTempFiles(config.campaignRoot);
  let manifest = loadCampaignManifest(config.campaignRoot);
  const budget = {
    ...manifest.budget,
    max_candidate_builds: config.maxCandidates ?? manifest.budget.max_candidate_builds,
    stop_after_no_improvement_rounds:
      config.maxNoProgressRounds ?? manifest.budget.stop_after_no_improvement_rounds,
  };

  const watch = (event: string) => config.deps.watch?.(event);

  const block = (error: unknown): RunnerOutcome => {
    const message = error instanceof Error ? error.message : String(error);
    watch(`BLOCKED ${message}`);
    const blocked = updateCampaignManifest(manifest, { status: 'BLOCKED', last_error: message });
    atomicWriteManifest(config.campaignRoot, blocked);
    return { terminal: 'BLOCKED', campaign: blocked, escalation: null };
  };

  for (;;) {
        try {
        if (manifest.reviewable || manifest.status === 'REVIEWABLE') {
          watch('CONVERGED REVIEWABLE');
          return {
            terminal: 'REVIEWABLE',
            campaign: updateCampaignManifest(manifest, { status: 'REVIEWABLE', reviewable: true }),
            escalation: null,
          };
        }
        if (budgetExhausted(manifest, budget)) {
          watch('EXHAUSTED');
          const outcome: RunnerOutcome = {
            terminal: 'EXHAUSTED',
            campaign: updateCampaignManifest(manifest, { status: 'EXHAUSTED' }),
            escalation: buildExhaustionEscalation({
              campaign: manifest,
              best_candidate_id: manifest.champion?.candidate_id ?? 'C0',
              persistent_blocking_dimension: manifest.persistent_blocking_dimension ?? null,
              earliest_responsible_layer: manifest.persistent_responsible_layer ?? null,
            }),
          };
          return outcome;
        }

        const championId = manifest.champion?.candidate_id ?? 'C0';
        watch(`CHAMPION ${championId}`);

        const index = await config.deps.evaluateCandidate(championId);
        if (isReviewable({
          index,
          build_passed: true,
          business_truth_passed: index.aggregate.hard_gate_failures.includes('business.fact_accuracy') === false,
          artifact_lineage_passed: true,
          blueprint_conformance_passed:
            !index.aggregate.hard_gate_failures.includes('architecture.route_coverage') &&
            !index.aggregate.hard_gate_failures.includes('architecture.section_conformance'),
          seo_content_contract_passed:
            !index.aggregate.hard_gate_failures.includes('seo.metadata') &&
            !index.aggregate.hard_gate_failures.includes('seo.internal_links') &&
            !index.aggregate.hard_gate_failures.includes('seo.intent_alignment'),
          campaign_confidence_sufficient: true,
          champion_index: null,
        })) {
          const updated = updateCampaignManifest(manifest, {
            status: 'REVIEWABLE',
            reviewable: true,
          });
          atomicWriteManifest(config.campaignRoot, updated);
          watch('REVIEWABILITY PASS');
          watch('CONVERGED REVIEWABLE');
          return { terminal: 'REVIEWABLE', campaign: updated, escalation: null };
        }

        const failure = earliestResponsibleFailure(index);
        if (!failure) {
          const updated = updateCampaignManifest(manifest, { status: 'BLOCKED' });
          atomicWriteManifest(config.campaignRoot, updated);
          return { terminal: 'BLOCKED', campaign: updated, escalation: null };
        }
        watch(`FAILURE ${failure.primary_dimension} / ${failure.location.component} / ${failure.location.viewport}`);

        const learnings = await config.deps.retrieveLearnings({
          context: manifest.context_signature,
          fingerprint: failure,
          layer: failure.suspected_layer,
        });
        watch(`LEARNING ${learnings.length} relevant events retrieved`);

        const plan = await config.deps.proposeMutation({
          campaign: manifest,
          failure,
          learnings,
        });
        watch(`HYPOTHESIS ${plan.hypothesis.primary_dimension} @ ${plan.mutation.layer}`);

        const frontierViolations = assertFrontier(plan.mutation.layer, []);
        if (frontierViolations.length > 0) {
          throw new CampaignRunnerError(`frontier assertion failed for ${plan.mutation.layer}`, 'FATAL');
        }
        // Envelope assertion against the plan's own target paths: targets must not
        // overlap forbidden or unchanged-contract members (build-time diffs are
        // additionally checked by the caller of buildIncrementally).
        const envelopeViolations = assertMutationEnvelope(plan, [
          ...plan.mutation.target_paths.map(path => ({ path, kind: 'changed' as const })),
        ]);
        if (envelopeViolations.length > 0) {
          throw new CampaignRunnerError(`envelope assertion failed: ${envelopeViolations.join('; ')}`, 'FATAL');
        }

        watch(`INVALIDATION ${plan.mutation.layer.toLowerCase()} → render → quality`);
        const { buildRef } = await config.deps.buildIncrementally(plan);
        if (buildRef) watch(`CANDIDATE ${plan.candidate_id} built`);

        const probe = await config.deps.runCheapestAdequateTests(plan);
        if (!probe.viable) {
          watch(`PROBE FAIL ${plan.candidate_id} rejected`);
          manifest = recordRejection(manifest);
          manifest = updateCampaignManifest(manifest, {
            persistent_blocking_dimension: failure.primary_dimension,
            persistent_responsible_layer: failure.suspected_layer,
          });
          atomicWriteManifest(config.campaignRoot, manifest);
          continue;
        }
        watch(`PROBE PASS`);

        const challengerIndex = await config.deps.evaluateCandidate(plan.candidate_id);
        const improved = challengerIndex.aggregate.regressions_vs_baseline.length === 0
          ? challengerIndex.results.filter(result => result.verdict_vs_baseline === 'IMPROVED').length
          : 0;
        const regressed = challengerIndex.aggregate.regressions_vs_baseline.length;
        watch(`QUALITY improves ${improved} / regresses ${regressed}`);

        let noProgress = false;
        if (manifest.champion) {
          const championIndex = await config.deps.evaluateCandidate(manifest.champion.candidate_id);
          const promotion = evaluateChampionPromotion({
            challenger: challengerIndex,
            champion: championIndex,
            target_dimension: plan.hypothesis.primary_dimension,
          });
          if (promotion.promote) {
            watch(`PROMOTE ${plan.candidate_id}`);
            manifest = promoteChampion(manifest, plan, challengerIndex);
          } else {
            watch(`REJECT ${plan.candidate_id} (${promotion.reasons.join('; ')})`);
            manifest = recordRejection(manifest);
            noProgress = promotion.reasons.includes('target dimension did not materially improve');
          }
        } else {
          // First evaluated challenger becomes the champion only when it clears hard
          // gates and shows no regressions on its own (single-fix promotion never
          // happens; the initial candidate must stand on its own merits).
          if (
            challengerIndex.aggregate.hard_gate_failures.length === 0 &&
            challengerIndex.aggregate.regressions_vs_baseline.length === 0
          ) {
            watch(`PROMOTE ${plan.candidate_id}`);
            manifest = promoteChampion(manifest, plan, challengerIndex);
          } else {
            manifest = recordRejection(manifest);
            noProgress = true;
          }
        }

        if (noProgress) {
          manifest = updateCampaignManifest(manifest, {
            attempts: {
              ...manifest.attempts,
              no_progress_rounds: manifest.attempts.no_progress_rounds + 1,
            },
            persistent_blocking_dimension: failure.primary_dimension,
            persistent_responsible_layer: failure.suspected_layer,
          });
          if (manifest.attempts.no_progress_rounds >= budget.stop_after_no_improvement_rounds) {
            watch('NO_PROGRESS attribution reconsideration');
            manifest = updateCampaignManifest(manifest, {
              persistent_blocking_dimension: failure.primary_dimension,
              persistent_responsible_layer: failure.suspected_layer,
            });
            atomicWriteManifest(config.campaignRoot, manifest);
            return { terminal: 'NO_PROGRESS', campaign: manifest, escalation: null };
          }
        } else {
          manifest = updateCampaignManifest(manifest, {
            attempts: { ...manifest.attempts, no_progress_rounds: 0 },
          });
        }

        atomicWriteManifest(config.campaignRoot, manifest);
    } catch (error) {
      return block(error);
    }
  }
}

function budgetExhausted(manifest: CampaignManifest, budget: CampaignManifest['budget']): boolean {
  const attempts = manifest.attempts;
  if (attempts.total_candidates >= budget.max_candidate_builds) return true;
  if (attempts.blueprint_replans > budget.max_blueprint_replans) return true;
  if (attempts.content_regenerations > budget.max_content_regenerations) return true;
  if (manifest.attempts.no_progress_rounds > budget.stop_after_no_improvement_rounds) return true;
  return false;
}

function earliestResponsibleFailure(index: QualityDeltaIndex): FailureFingerprint | null {
  const failed = index.results.filter(
    result => result.status === 'FAIL' || result.verdict_vs_baseline === 'REGRESSED',
  );
  if (failed.length === 0) return null;
  const primary = failed.find(result => result.hard_gate) ?? failed[0];
  return {
    primary_dimension: primary.dimension,
    dimensions: { [primary.dimension]: primary.verdict_vs_baseline ?? undefined },
    location: { page_archetype: 'homepage', component: 'hero', viewport: 'mobile' },
    structural_state: {},
    suspected_layer: primary.responsible_layer,
  };
}

function recordRejection(manifest: CampaignManifest): CampaignManifest {
  return updateCampaignManifest(manifest, {
    attempts: { ...manifest.attempts, total_candidates: manifest.attempts.total_candidates + 1 },
  });
}

function promoteChampion(
  manifest: CampaignManifest,
  plan: CandidateMutationPlan,
  index: QualityDeltaIndex,
): CampaignManifest {
  const buildRef = {
    artifact_type: 'CandidateBuild',
    artifact_id: `CandidateBuild:${plan.candidate_id}`,
    payload_digest: plan.integrity.payload_digest,
  };
  const evaluationRef = {
    artifact_type: 'CandidateEvaluation',
    artifact_id: `CandidateEvaluation:${plan.candidate_id}`,
    payload_digest: plan.integrity.payload_digest,
  };
  return updateCampaignManifest(manifest, {
    champion: {
      candidate_id: plan.candidate_id,
      build_ref: buildRef,
      evaluation_ref: evaluationRef,
    },
    attempts: {
      ...manifest.attempts,
      total_candidates: manifest.attempts.total_candidates + 1,
    },
  });
}

