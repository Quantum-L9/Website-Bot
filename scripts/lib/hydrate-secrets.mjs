// L9_META: layer=configuration, role=secrets_hydrate_helper, status=active, version=1.0.0
/**
 * Shared Infisical bootstrap hydration for Website-Bot entrypoints.
 * Caller-supplied process.env wins (loadSecrets overwrite:false).
 * Returns minimal provenance metadata only — never secret values.
 */
import { loadSecrets } from '@quantum-l9/infisical-config';

/**
 * @typedef {'process_env_only' | 'infisical_hydrated' | 'infisical_unavailable'} SourceMode
 * @typedef {{ bootstrap_present: boolean, source_mode: SourceMode }} HydrateSecretsMetadata
 */

function bootstrapPresent() {
  return Boolean(
    process.env.INFISICAL_CLIENT_ID
    && process.env.INFISICAL_CLIENT_SECRET
    && process.env.INFISICAL_PROJECT_ID,
  );
}

/**
 * Hydrate process.env from Infisical when INFISICAL_* bootstrap is present.
 * Fail-soft unless INFISICAL_REQUIRED / options.required makes loadSecrets throw.
 *
 * @param {import('@quantum-l9/infisical-config').LoadSecretsOptions} [options]
 * @returns {Promise<HydrateSecretsMetadata>}
 */
export async function hydrateSecretsIfConfigured(options = {}) {
  const present = bootstrapPresent();
  // Never overwrite caller-set vars on the boot path.
  const result = await loadSecrets({ ...options, overwrite: false });

  /** @type {SourceMode} */
  let source_mode;
  if (!present) {
    source_mode = 'process_env_only';
  } else if (result.loaded) {
    source_mode = 'infisical_hydrated';
  } else {
    source_mode = 'infisical_unavailable';
  }

  return {
    bootstrap_present: present,
    source_mode,
  };
}
