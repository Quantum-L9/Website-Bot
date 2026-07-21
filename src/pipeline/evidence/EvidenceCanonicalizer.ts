// L9_META: layer=pipeline, role=evidence_canonicalizer, status=active, version=1.0.0
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string { return JSON.stringify(stable(value)); }
export function sha256Text(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function sha256File(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
export function evidenceDigest(value: unknown): string { return sha256Text(canonicalJson(value)); }

const SECRET_VALUE = /(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+\/-]+=*|https:\/\/[^\s/]+@)/gi;
const SENSITIVE_KEY = /(?:token|secret|password|authorization|cookie|api[_-]?key|deploy[_-]?hook)/i;

export function sanitizeEvidenceText(value: string): string {
  return value.replace(SECRET_VALUE, '[REDACTED]').slice(0, 8_000);
}

export function sanitizeEvidenceDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeEvidenceDetails);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeEvidenceDetails(child),
    ]));
  }
  if (typeof value === 'string') return sanitizeEvidenceText(value);
  return value;
}
