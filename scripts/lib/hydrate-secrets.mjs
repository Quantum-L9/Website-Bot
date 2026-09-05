// L9_META: layer=configuration, role=secrets_hydrate_helper, status=active, version=1.1.0
/**
 * Shared Infisical bootstrap hydration for Website-Bot entrypoints.
 * Caller-supplied process.env wins (loadSecrets overwrite:false).
 * Returns minimal provenance metadata only — never secret values.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSecrets } from "@quantum-l9/infisical-config";

/**
 * @typedef {'process_env_only' | 'infisical_hydrated' | 'infisical_unavailable'} SourceMode
 * @typedef {{ bootstrap_present: boolean, source_mode: SourceMode }} HydrateSecretsMetadata
 */

function bootstrapPresent() {
  return Boolean(
    process.env.INFISICAL_CLIENT_ID &&
      process.env.INFISICAL_CLIENT_SECRET &&
      process.env.INFISICAL_PROJECT_ID,
  );
}

/**
 * Fail-soft local override (ADR-0009): load KEY=VALUE from .env.local without
 * overwriting vars already present in process.env. Never logs values.
 */
function loadDotEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Hydrate process.env from Infisical when INFISICAL_* bootstrap is present.
 * Fail-soft unless INFISICAL_REQUIRED / options.required makes loadSecrets throw.
 *
 * @param {import('@quantum-l9/infisical-config').LoadSecretsOptions} [options]
 * @returns {Promise<HydrateSecretsMetadata>}
 */
export async function hydrateSecretsIfConfigured(options = {}) {
  loadDotEnvLocal();
  const present = bootstrapPresent();
  // Never overwrite caller-set vars on the boot path.
  const result = await loadSecrets({ ...options, overwrite: false });

  /** @type {SourceMode} */
  let source_mode;
  if (!present) {
    source_mode = "process_env_only";
  } else if (result.loaded) {
    source_mode = "infisical_hydrated";
  } else {
    source_mode = "infisical_unavailable";
  }

  return {
    bootstrap_present: present,
    source_mode,
  };
}
