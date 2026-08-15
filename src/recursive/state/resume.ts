// L9_META: layer=recursive, role=crash_safe_resume, status=active, version=1.0.0
// Crash-safe resume: the event ledger is the durable spine. Resuming a run
// replays accepted events in order (deduplicated by event identity) and then
// reconciles the manifest against the reconstructed phase state, so an
// interrupted run never repeats a completed semantic operation.
import type { RecursiveEngineeringEvent } from '../contracts/types.js';
import type { EventLedger } from '../events/ledger.js';
import type { CampaignManifest } from './run-manifest.js';
import { applyTransition, type TransitionAction } from './transitions.js';

/**
 * Maps a bound event to the transition actions it implies. A
 * verification.completed event implies both the bounded patch step and the
 * passed verification (the bound event list has no separate patch event, so
 * the ledger stays the complete durable spine for crash-safe resume).
 */
export function transitionsForEvent(event: RecursiveEngineeringEvent): TransitionAction[] {
  switch (event.eventType) {
    case 'e2e.completed':
      return [
        {
          kind: 'E2E_COMPLETED',
          reviewable: false,
          e2eReceiptRef: event.evidenceRefs[0]?.refId ?? `${event.eventType}:${event.eventId}`,
          deployedSha: event.subject?.fullSha ?? '',
        },
      ];
    case 'engineering_harvest.completed':
      return [
        {
          kind: 'HARVEST_COMPLETED',
          harvestRef: event.evidenceRefs[0]?.refId ?? `${event.eventType}:${event.eventId}`,
          materialActionableSignal: true,
        },
      ];
    case 'pe_pack.ready':
      return [
        {
          kind: 'PE_PACK_COMPILED',
          pePackRef: event.evidenceRefs[0]?.refId ?? `${event.eventType}:${event.eventId}`,
          clusterId: event.causationId,
        },
      ];
    case 'verification.completed':
      return [
        { kind: 'PATCH_APPLIED', codeChangeRef: event.evidenceRefs[0]?.refId ?? `${event.eventType}:${event.eventId}` },
        { kind: 'VERIFICATION_PASSED' },
      ];
    case 'pr.merged':
      return [{ kind: 'MERGED', promotionRef: event.evidenceRefs[0]?.refId ?? `${event.eventType}:${event.eventId}` }];
    case 'deployment.succeeded':
      return [{ kind: 'DEPLOYED', deployedSha: event.subject?.fullSha ?? '' }];
    case 'deployment.failed':
      return [{ kind: 'DEPLOYMENT_VERIFICATION_FAILED' }];
    case 'rollback.completed':
      return []; // rollback is recorded in receipts; it does not advance the wave
    case 'wave.completed':
      return [{ kind: 'WAVE_COMPLETED' }];
    default:
      return [];
  }
}

/** @deprecated use transitionsForEvent (multi-action mapping) */
export function transitionForEvent(event: RecursiveEngineeringEvent): TransitionAction | null {
  return transitionsForEvent(event)[0] ?? null;
}

export interface ResumeResult {
  manifest: CampaignManifest;
  replayedEvents: number;
  finalPhaseState: string;
}

/**
 * Replays the deduplicated event ledger into a manifest copy. The replay is
 * deterministic: same ledger + same starting manifest -> same result.
 */
export function rebuildManifestFromLedger(manifest: CampaignManifest, ledger: EventLedger, now?: string): ResumeResult {
  const events = ledger.readForRun(manifest.campaignId);
  let replayed = 0;
  for (const event of events) {
    const actions = transitionsForEvent(event);
    for (const action of actions) {
      const result = applyTransition(manifest, action, now);
      if (result.applied) replayed += 1;
    }
  }
  const phase = manifest.state.phases.find(item => item.wave === manifest.state.currentWave);
  return {
    manifest,
    replayedEvents: replayed,
    finalPhaseState: phase ? `${phase.wave}:${phase.phase}` : `${manifest.state.currentWave}:E2E`,
  };
}
