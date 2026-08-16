// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { buildEvent, signEvent, verifyEventSignature } from '../../../src/recursive/events/envelope.js';
import { EventLedger } from '../../../src/recursive/events/ledger.js';
import { JsonStore } from '../../../src/recursive/storage/json-store.js';
import { LeaseManager } from '../../../src/recursive/events/leases.js';
import { reconcile } from '../../../src/recursive/events/reconciler.js';
import { createCampaignManifest } from '../../../src/recursive/state/run-manifest.js';

const SECRET = 'test-event-secret';

function ledgerPath(): { root: string; ledger: EventLedger } {
  const root = `/tmp/recursive-events-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { root, ledger: new EventLedger(`${root}/events.jsonl`) };
}

function event(overrides: Partial<Parameters<typeof buildEvent>[0]> = {}) {
  return buildEvent({
    eventType: 'e2e.completed',
    recursiveRunId: 'evt-run',
    wave: 1,
    correlationId: 'evt-run',
    causationId: 'e2e:1',
    source: 'github',
    evidenceRefs: [],
    ...overrides,
  });
}

test('event signature verifies and rejects tampering', () => {
  const original = event();
  const signed = signEvent(original, SECRET);
  assert.equal(verifyEventSignature(signed, SECRET), true);
  const tampered = signEvent(original, SECRET);
  tampered.event.subject = { fullSha: 'f'.repeat(40) };
  assert.equal(verifyEventSignature(tampered, SECRET), false);
});

test('duplicate delivery is a NOOP disposition and never drives state twice', () => {
  const { root, ledger } = ledgerPath();
  try {
    // The same semantic event delivered twice: same identity, same digest.
    const delivered = event({ occurredAt: '2026-08-15T00:00:00.000Z' });
    const first = ledger.ingest(signEvent(delivered, SECRET), SECRET, 1);
    assert.equal(first.disposition, 'ACCEPTED');
    const duplicate = ledger.ingest(signEvent(delivered, SECRET), SECRET, 1);
    assert.equal(duplicate.disposition, 'DUPLICATE');
    const accepted = ledger.readForRun('evt-run');
    assert.equal(accepted.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('out-of-order (stale) event is recorded STALE and never accepted', () => {
  const { root, ledger } = ledgerPath();
  try {
    const stale = ledger.ingest(signEvent(event({ wave: 1 }), SECRET), SECRET, 2);
    assert.equal(stale.disposition, 'STALE');
    assert.equal(ledger.readForRun('evt-run').length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unauthenticated event is rejected', () => {
  const { root, ledger } = ledgerPath();
  try {
    const signed = signEvent(event(), SECRET);
    const forged = { ...signed, signature: '0'.repeat(64) };
    const rejected = ledger.ingest(forged, SECRET, 1);
    assert.equal(rejected.disposition, 'REJECTED');
    assert.equal(ledger.readForRun('evt-run').length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lost events are recovered by reconciliation (durable ledger is the truth)', () => {
  const { root, ledger } = ledgerPath();
  try {
    const store = new JsonStore(root);
    const leases = new LeaseManager(store);
    const manifest = createCampaignManifest({
      campaignId: 'evt-run',
      sourceUrl: 'https://evt.example.com',
      websiteBotFullSha: 'a'.repeat(40),
      seoBotFullSha: 'b'.repeat(40),
      llmRouterVersion: '1.1.2',
      botInteropVersion: '1.1.0',
      controlPlaneFullSha: 'c'.repeat(40),
    });
    // Simulate a lost hook: the event was accepted before the crash but no
    // transition was applied; reconciliation replays it from the ledger.
    ledger.ingest(signEvent(event({ eventType: 'e2e.completed' }), SECRET), SECRET, 1);
    ledger.ingest(signEvent(event({ eventType: 'engineering_harvest.completed', causationId: 'harvest:1' }), SECRET), SECRET, 1);
    const outcome = reconcile({
      manifest,
      ledger,
      leases,
      promotionTruth: () => null,
      deploymentTruth: () => null,
    });
    assert.equal(outcome.replayed, 2);
    assert.equal(outcome.duplicates, 0);
    assert.equal(outcome.stale, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('event envelope is stable (deterministic identity for the same semantic operation)', () => {
  const first = event({ occurredAt: '2026-08-15T00:00:00.000Z' });
  const second = event({ occurredAt: '2026-08-15T00:00:00.000Z' });
  assert.equal(first.eventId, second.eventId);
  const third = event({ occurredAt: '2026-08-15T00:00:00.000Z', causationId: 'other' });
  assert.notEqual(first.eventId, third.eventId);
});
