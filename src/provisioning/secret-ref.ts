// L9_META: layer=provisioning, role=secret_reference_resolver, status=active, version=1.0.0

const ENV_REF = /^env:\/\/[A-Z][A-Z0-9_]*$/;

export function assertEnvRef(value: string, field: string): void {
  if (!ENV_REF.test(value)) throw new Error(`${field} must be env://NAME`);
}

export function resolveEnvRef(value: string, field: string): string {
  assertEnvRef(value, field);
  const key = value.slice('env://'.length);
  const resolved = process.env[key];
  if (!resolved) throw new Error(`${field} references unset environment variable ${key}`);
  return resolved;
}
