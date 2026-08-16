// L9_META: layer=recursive, role=event_envelope_auth, status=active, version=1.0.0
// Event law: hook delivery is NOT authority. Every event is authenticated,
// persisted before processing, and deduplicated. Signature verification uses
// an HMAC over the canonical event payload with a per-run secret read from the
// environment at run start (never echoed, never persisted in plaintext).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, sha256Text } from '../../services/hashing.js';
import type { RecursiveEngineeringEvent } from '../contracts/types.js';

export interface SignedEventEnvelope {
  event: RecursiveEngineeringEvent;
  signature: string;
}

export function signEvent(event: RecursiveEngineeringEvent, secret: string): SignedEventEnvelope {
  const payload = canonicalJson(event);
  return { event, signature: createHmac('sha256', secret).update(payload).digest('hex') };
}

export function verifyEventSignature(envelope: SignedEventEnvelope, secret: string): boolean {
  const payload = canonicalJson(envelope.event);
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const received = Buffer.from(envelope.signature, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  if (received.length !== wanted.length) return false;
  return timingSafeEqual(received, wanted);
}

export function eventDigest(event: RecursiveEngineeringEvent): string {
  return sha256Text(canonicalJson(event));
}

export function buildEvent(input: {
  eventType: RecursiveEngineeringEvent['eventType'];
  recursiveRunId: string;
  wave: 1 | 2 | 3;
  correlationId: string;
  causationId: string;
  source: string;
  evidenceRefs?: RecursiveEngineeringEvent['evidenceRefs'];
  subject?: RecursiveEngineeringEvent['subject'];
  occurredAt?: string;
}): RecursiveEngineeringEvent {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  return {
    schema: 'l9.recursive-engineering-event/v1',
    eventId: `evt_${sha256Text(canonicalJson({ ...input, occurredAt })).slice(0, 24)}`,
    eventType: input.eventType,
    recursiveRunId: input.recursiveRunId,
    wave: input.wave,
    correlationId: input.correlationId,
    causationId: input.causationId,
    source: input.source,
    occurredAt,
    evidenceRefs: input.evidenceRefs ?? [],
    ...(input.subject ? { subject: input.subject } : {}),
  };
}
