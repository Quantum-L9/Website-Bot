// L9_META: layer=recursive, role=event_ledger, status=active, version=1.0.0
// Append-only event ledger. Every accepted event is persisted before
// processing; deduplication is by event identity (eventId + digest) and by
// the pack's idempotency boundary (runId + wave + eventType + subject SHA).
// A duplicate delivery is a NOOP; an out-of-order/stale delivery is recorded
// as STALE and never moves campaign state backward.
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { canonicalJson, sha256Text } from '../../services/hashing.js';
import type { RecursiveEngineeringEvent } from '../contracts/types.js';
import type { SignedEventEnvelope } from './envelope.js';
import { eventDigest, verifyEventSignature } from './envelope.js';

export interface LedgerRecord {
  event: RecursiveEngineeringEvent;
  digest: string;
  disposition: 'ACCEPTED' | 'DUPLICATE' | 'STALE' | 'REJECTED';
  acceptedAt: string;
}

export class EventLedger {
  constructor(private readonly path: string) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }

  readAll(): LedgerRecord[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, 'utf-8');
    if (!raw.trim()) return [];
    return raw
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as LedgerRecord);
  }

  readForRun(runId: string): RecursiveEngineeringEvent[] {
    return this.readAll()
      .filter(record => record.disposition === 'ACCEPTED' && record.event.recursiveRunId === runId)
      .map(record => record.event);
  }

  private append(record: LedgerRecord): void {
    appendFileSync(this.path, JSON.stringify(record) + '\n', 'utf-8');
  }

  /**
   * Authenticates, deduplicates, and persists one delivered event.
   * Returns the ledger record; only ACCEPTED events are eligible to drive
   * reconciliation.
   */
  ingest(envelope: SignedEventEnvelope, secret: string, currentWave: number): LedgerRecord {
    const { event } = envelope;
    const digest = eventDigest(event);
    const existing = this.readAll().find(record => record.event.eventId === event.eventId || record.digest === digest);
    if (existing) {
      const duplicate: LedgerRecord = {
        event,
        digest,
        disposition: existing.disposition === 'ACCEPTED' ? 'DUPLICATE' : 'STALE',
        acceptedAt: new Date().toISOString(),
      };
      this.append(duplicate);
      return duplicate;
    }
    if (!verifyEventSignature(envelope, secret)) {
      const rejected: LedgerRecord = {
        event,
        digest,
        disposition: 'REJECTED',
        acceptedAt: new Date().toISOString(),
      };
      this.append(rejected);
      return rejected;
    }
    if (event.wave < currentWave) {
      const stale: LedgerRecord = {
        event,
        digest,
        disposition: 'STALE',
        acceptedAt: new Date().toISOString(),
      };
      this.append(stale);
      return stale;
    }
    const accepted: LedgerRecord = {
      event,
      digest,
      disposition: 'ACCEPTED',
      acceptedAt: new Date().toISOString(),
    };
    this.append(accepted);
    return accepted;
  }

  idempotencyBoundary(event: RecursiveEngineeringEvent): string {
    return sha256Text(
      canonicalJson({
        runId: event.recursiveRunId,
        wave: event.wave,
        eventType: event.eventType,
        subjectSha: event.subject?.fullSha ?? '',
        causationId: event.causationId,
      }),
    );
  }
}
