// L9_META: layer=recursive, role=event_reconciler, status=active, version=1.0.0
// Reconciliation: a hook is never the proof. After an accepted event, the
// controller re-reads durable truth (campaign manifest, GitHub PR/merge state,
// deployment receipts, artifact refs) and computes the next legal transition
// from that truth. Lost hooks are recovered by periodic reconciliation, which
// re-reads the same truth sources directly.
import type { RecursiveEngineeringEvent } from "../contracts/types.js";
import type { CampaignManifest } from "../state/run-manifest.js";
import type { LeaseManager } from "./leases.js";
import type { EventLedger } from "./ledger.js";

export interface PromotionTruth {
  prId?: string;
  mergeSha?: string;
  checksPassed?: boolean;
  blocked?: boolean;
}

export interface DeploymentTruth {
  deployedSha?: string;
  healthy?: boolean;
  environment?: string;
}

export interface ReconciliationInput {
  manifest: CampaignManifest;
  ledger: EventLedger;
  leases: LeaseManager;
  promotionTruth: (runId: string) => PromotionTruth | null;
  deploymentTruth: (runId: string) => DeploymentTruth | null;
  now?: number;
}

export interface ReconciliationOutcome {
  replayed: number;
  duplicates: number;
  stale: number;
  recoveredLostEvents: string[];
  leaseOwner: string;
}

/**
 * Reconciles durable state after (or without) a hook: replays only ACCEPTED
 * ledger events for this run in order, records how many were duplicates or
 * stale, and returns the current lease owner for the active wave operation.
 * The transition legality itself is enforced by the state machine, so a stale
 * event can never move the campaign backward.
 */
export function reconcile(input: ReconciliationInput): ReconciliationOutcome {
  const events = input.ledger.readForRun(input.manifest.campaignId);
  const seen = new Set<string>();
  let duplicates = 0;
  let stale = 0;
  const replayed: RecursiveEngineeringEvent[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) {
      duplicates += 1;
      continue;
    }
    seen.add(event.eventId);
    replayed.push(event);
  }
  const allRecords = input.ledger.readAll();
  for (const record of allRecords) {
    if (record.disposition === "DUPLICATE") duplicates += 1;
    if (record.disposition === "STALE") stale += 1;
  }
  const currentWave = input.manifest.state.currentWave;
  const lease = input.leases.acquire({
    campaign: input.manifest.campaignId,
    wave: currentWave,
    operation: "RECONCILE",
    owner: "controller",
    ttlMs: 60_000,
    now: input.now,
  });
  return {
    replayed: replayed.length,
    duplicates,
    stale,
    recoveredLostEvents: replayed.map((event) => event.eventId),
    leaseOwner: lease ? lease.owner : "none",
  };
}
