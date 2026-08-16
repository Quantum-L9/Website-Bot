// L9_META: layer=recursive, role=fenced_leases, status=active, version=1.0.0
// Fenced leases around expensive transitions: only the active generation may
// commit transition results; expired/stale workers are rejected. Two workers
// can never both believe they own the same wave operation.
import { canonicalJson, sha256Text } from "../../services/hashing.js";
import type { JsonStore } from "../storage/json-store.js";

export interface Lease {
  campaign: string;
  wave: number;
  operation: string;
  owner: string;
  generation: number;
  expiresAt: number;
}

export class LeaseManager {
  constructor(private readonly store: JsonStore) {}

  private pathFor(campaign: string, wave: number, operation: string): string {
    return `leases/${campaign}/${wave}-${operation}.json`;
  }

  /**
   * Acquires the lease if it is free or expired, otherwise fails. A fresh
   * acquisition bumps the generation so the previous owner is fenced out.
   */
  acquire(input: {
    campaign: string;
    wave: number;
    operation: string;
    owner: string;
    ttlMs: number;
    now?: number;
  }): Lease | null {
    const now = input.now ?? Date.now();
    const path = this.pathFor(input.campaign, input.wave, input.operation);
    if (this.store.has(path)) {
      const existing = this.store.read<Lease>(path);
      if (existing.expiresAt > now && existing.owner !== input.owner) return null;
    }
    const lease: Lease = {
      campaign: input.campaign,
      wave: input.wave,
      operation: input.operation,
      owner: input.owner,
      generation: this.store.has(path) ? this.store.read<Lease>(path).generation + 1 : 1,
      expiresAt: now + input.ttlMs,
    };
    this.store.write(path, lease);
    return lease;
  }

  /**
   * Validates that the caller holds the active generation. Returns false for
   * missing, expired, or superseded leases — the caller must not commit state.
   */
  validate(input: {
    campaign: string;
    wave: number;
    operation: string;
    owner: string;
    now?: number;
  }): boolean {
    const now = input.now ?? Date.now();
    const path = this.pathFor(input.campaign, input.wave, input.operation);
    if (!this.store.has(path)) return false;
    const lease = this.store.read<Lease>(path);
    if (lease.owner !== input.owner) return false;
    if (lease.expiresAt <= now) return false;
    return true;
  }

  release(input: { campaign: string; wave: number; operation: string; owner: string }): void {
    const path = this.pathFor(input.campaign, input.wave, input.operation);
    if (!this.store.has(path)) return;
    const lease = this.store.read<Lease>(path);
    if (lease.owner !== input.owner) return;
    lease.expiresAt = 0;
    this.store.write(path, lease);
  }

  leaseDigest(lease: Lease): string {
    return sha256Text(canonicalJson(lease));
  }
}
