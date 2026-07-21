// L9_META: layer=validation, role=release_receipt_validator, status=active, version=2.0.0
import { validateReleaseReceipt as validateContract, type ReleaseReceipt } from '../pipeline/evidence/ReleaseReceipt.js';

const SENSITIVE_KEY = /(?:token|secret|password|authorization|cookie|api[_-]?key|deploy[_-]?hook)/i;
const SECRET_VALUE = /(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+\/-]+=*)/i;

function assertNoSecrets(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSecrets(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) throw new Error(`secret-bearing field is not allowed at ${path}.${key}`);
      assertNoSecrets(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE.test(value)) throw new Error(`secret-bearing value is not allowed at ${path}`);
}

/**
 * Validate the runtime receipt contract. The optional schema path is accepted for
 * backward compatibility with the prior validation harness; JSON Schema parity is
 * checked separately by scripts/validate-evidence-schemas.mjs.
 */
export function validateReleaseReceipt(value: unknown, _schemaPath?: string): asserts value is ReleaseReceipt {
  validateContract(value);
  assertNoSecrets(value);
}
