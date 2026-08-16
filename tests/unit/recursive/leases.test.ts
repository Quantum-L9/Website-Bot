// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { LeaseManager } from "../../../src/recursive/events/leases.js";
import { JsonStore } from "../../../src/recursive/storage/json-store.js";

function fresh(): { root: string; store: JsonStore; leases: LeaseManager } {
  const root = `/tmp/recursive-leases-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const store = new JsonStore(root);
  return { root, store, leases: new LeaseManager(store) };
}

test("only the active generation may hold a live lease", () => {
  const { root, leases } = fresh();
  try {
    const workerA = leases.acquire({
      campaign: "c",
      wave: 1,
      operation: "PATCH",
      owner: "worker-a",
      ttlMs: 60_000,
      now: 1_000,
    });
    assert.ok(workerA);
    const workerB = leases.acquire({
      campaign: "c",
      wave: 1,
      operation: "PATCH",
      owner: "worker-b",
      ttlMs: 60_000,
      now: 2_000,
    });
    assert.equal(workerB, null);
    assert.equal(
      leases.validate({
        campaign: "c",
        wave: 1,
        operation: "PATCH",
        owner: "worker-a",
        now: 2_000,
      }),
      true,
    );
    assert.equal(
      leases.validate({
        campaign: "c",
        wave: 1,
        operation: "PATCH",
        owner: "worker-b",
        now: 2_000,
      }),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expired lease is re-acquirable and the new generation fences the stale worker", () => {
  const { root, leases } = fresh();
  try {
    leases.acquire({
      campaign: "c",
      wave: 1,
      operation: "DEPLOY",
      owner: "worker-a",
      ttlMs: 100,
      now: 0,
    });
    assert.equal(
      leases.validate({ campaign: "c", wave: 1, operation: "DEPLOY", owner: "worker-a", now: 200 }),
      false,
    );
    const revived = leases.acquire({
      campaign: "c",
      wave: 1,
      operation: "DEPLOY",
      owner: "worker-b",
      ttlMs: 60_000,
      now: 300,
    });
    assert.ok(revived);
    assert.equal(revived.generation, 2);
    // The stale worker's validation now fails even though its lease file was
    // overwritten: the owner no longer matches.
    assert.equal(
      leases.validate({ campaign: "c", wave: 1, operation: "DEPLOY", owner: "worker-a", now: 300 }),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release clears the lease and a new owner can acquire", () => {
  const { root, leases } = fresh();
  try {
    leases.acquire({
      campaign: "c",
      wave: 2,
      operation: "MERGE",
      owner: "worker-a",
      ttlMs: 60_000,
      now: 0,
    });
    leases.release({ campaign: "c", wave: 2, operation: "MERGE", owner: "worker-a" });
    assert.equal(
      leases.validate({ campaign: "c", wave: 2, operation: "MERGE", owner: "worker-a", now: 1 }),
      false,
    );
    const next = leases.acquire({
      campaign: "c",
      wave: 2,
      operation: "MERGE",
      owner: "worker-c",
      ttlMs: 60_000,
      now: 2,
    });
    assert.ok(next);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
