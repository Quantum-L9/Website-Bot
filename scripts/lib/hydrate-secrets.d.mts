export type SourceMode = 'process_env_only' | 'infisical_hydrated' | 'infisical_unavailable';

export interface HydrateSecretsMetadata {
  bootstrap_present: boolean;
  source_mode: SourceMode;
}

export function hydrateSecretsIfConfigured(
  options?: Record<string, unknown>,
): Promise<HydrateSecretsMetadata>;
