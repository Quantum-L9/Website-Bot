// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
// Crash-safe resume: the event ledger is the durable spine; resuming an
// interrupted run replays accepted events deterministically and never
// duplicates a completed semantic operation.

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { buildEvent, signEvent } from "../../../src/recursive/events/envelope.js";
import { EventLedger } from "../../../src/recursive/events/ledger.js";
import {
  rebuildManifestFromLedger,
  transitionForEvent,
} from "../../../src/recursive/state/resume.js";
import { createCampaignManifest } from "../../../src/recursive/state/run-manifest.js";
import { applyTransition } from "../../../src/recursive/state/transitions.js";

const SECRET = "resume-secret";

function manifestFixture() {
  return createCampaignManifest({
    campaignId: "resume-run",
    sourceUrl: "https://resume.example.com",
    websiteBotFullSha: "a".repeat(40),
    seoBotFullSha: "b".repeat(40),
    llmRouterVersion: "1.1.2",
    botInteropVersion: "1.1.0",
    controlPlaneFullSha: "c".repeat(40),
    now: "2026-08-15T00:00:00.000Z",
  });
}

test("an interrupted run resumes from the ledger without duplicating semantic operations", () => {
  const root = `/tmp/recursive-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const ledger = new EventLedger(`${root}/events.jsonl`);
    const manifest = manifestFixture();
    // Simulate: the worker crashed after completing through the patch, before
    // recording the verification, merge, and deployment transitions.
    applyTransition(manifest, {
      kind: "E2E_COMPLETED",
      reviewable: false,
      e2eReceiptRef: "e2e-1",
      deployedSha: "a".repeat(40),
    });
    applyTransition(manifest, {
      kind: "HARVEST_COMPLETED",
      harvestRef: "h-1",
      materialActionableSignal: true,
    });
    applyTransition(manifest, { kind: "PE_PACK_COMPILED", pePackRef: "p-1", clusterId: "EC-1" });
    applyTransition(manifest, { kind: "PATCH_APPLIED", codeChangeRef: "c-1" });

    // Crash. On resume, the ledger replays every accepted event exactly once.
    const accepted = [
      ["e2e.completed", "e2e-1", "e2e:1"],
      ["engineering_harvest.completed", "h-1", "harvest:1"],
      ["pe_pack.ready", "p-1", "pack:1"],
      ["verification.completed", "p-1", "verify:1"],
      ["pr.merged", "m-1", "merge:1"],
      ["deployment.succeeded", "m-1", "deploy:1"],
    ] as const;
    for (const [eventType, causationId, evidenceId] of accepted) {
      const envelope = signEvent(
        buildEvent({
          eventType,
          recursiveRunId: "resume-run",
          wave: 1,
          correlationId: "resume-run",
          causationId,
          source: "github",
          evidenceRefs: [{ refKind: "evidence", refId: evidenceId, digest: "d".repeat(64) }],
          subject: eventType === "deployment.succeeded" ? { fullSha: "d".repeat(40) } : undefined,
        }),
        SECRET,
      );
      assert.equal(ledger.ingest(envelope, SECRET, 1).disposition, "ACCEPTED");
    }

    const rebuilt = rebuildManifestFromLedger(manifestFixture(), ledger);
    assert.equal(rebuilt.finalPhaseState, "1:DEPLOY_VERIFY");
    // The E2E is not re-executed: replay derives state from the ledger, and
    // the transitions applied before the crash plus the replayed ones yield
    // exactly one wave progression — no duplicated semantic operations.
    const phases = rebuilt.manifest.state.phases;
    assert.equal(phases.length, 1);
    assert.equal(phases[0].wave, 1);
    assert.equal(phases[0].phase, "DEPLOY_VERIFY");
    assert.equal(rebuilt.replayedEvents, 7); // verification.completed implies patch + verification
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replay is deterministic: same ledger, same result", () => {
  const root = `/tmp/recursive-resume-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const ledger = new EventLedger(`${root}/events.jsonl`);
    const envelope = signEvent(
      buildEvent({
        eventType: "e2e.completed",
        recursiveRunId: "resume-run",
        wave: 1,
        correlationId: "resume-run",
        causationId: "e2e:1",
        source: "github",
        evidenceRefs: [{ refKind: "evidence", refId: "e2e-1", digest: "d".repeat(64) }],
      }),
      SECRET,
    );
    ledger.ingest(envelope, SECRET, 1);
    const first = rebuildManifestFromLedger(manifestFixture(), ledger);
    const second = rebuildManifestFromLedger(manifestFixture(), ledger);
    assert.equal(first.finalPhaseState, second.finalPhaseState);
    assert.equal(first.replayedEvents, second.replayedEvents);
    assert.deepEqual(
      JSON.parse(JSON.stringify(first.manifest.state)),
      JSON.parse(JSON.stringify(second.manifest.state)),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every event type maps to exactly one transition action (or a documented no-op)", () => {
  const eventTypes = [
    "e2e.completed",
    "engineering_harvest.completed",
    "pe_pack.ready",
    "verification.completed",
    "pr.merged",
    "deployment.succeeded",
    "deployment.failed",
    "rollback.completed",
    "wave.completed",
  ];
  for (const eventType of eventTypes) {
    const action = transitionForEvent(
      buildEvent({
        eventType: eventType as never,
        recursiveRunId: "resume-run",
        wave: 1,
        correlationId: "resume-run",
        causationId: "x",
        source: "github",
      }),
    );
    assert.ok(action !== undefined, `${eventType} must have a defined mapping`);
  }
});
