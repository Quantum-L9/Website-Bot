// L9_META: layer=recursive, role=control_plane_constants, status=active, version=1.0.0
// Runtime control plane. Immutable during a recursive run; a coding agent that
// mutates these values is a MUTATION_ENVELOPE_VIOLATION (control-plane paths
// are on every PE Pack's forbiddenPaths).

export const TARGET_WAVES = 3 as const;
export const HARD_MAX_WAVES = 3 as const;
export const MAX_PATCH_ATTEMPTS_PER_WAVE = 1 as const;
export const MAX_VALIDATION_REPAIR_ATTEMPTS_PER_WAVE = 1 as const;
export const INITIAL_ENGINEERING_MUTATION_STREAMS = 1 as const;

export const CONTROL_PLANE_PATHS: readonly string[] = [
  'src/recursive/state/constants.ts',
  'src/recursive/state/transitions.ts',
  'src/recursive/pepack/',
  'src/recursive/verifier/',
  'src/recursive/events/',
  'src/recursive/contracts/',
  'src/recursive/holdout/',
  'schemas/recursive/',
  'tests/unit/recursive/',
  'tests/integration/recursive/',
  '.l9/recursive/',
];
