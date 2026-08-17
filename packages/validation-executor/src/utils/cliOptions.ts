/**
 * Shared CLI option schema for the validation-executor CLI and its
 * repository-specific wrappers (e.g. scripts/validation-executor.ts).
 *
 * Both entry points feed this schema to `parseArgs` from `node:util`.
 * Callers pass their own defaults for the few fields that vary per
 * repository (evidence-root, output, and the optional repository-type
 * discriminator) instead of re-declaring the full option table.
 */

export interface ValidationCliDefaults {
  /** Default evidence-root directory. */
  evidenceRoot: string;
  /** Default output-report path. */
  output: string;
  /**
   * When present, include the `repository-type` string flag with this
   * default. When omitted, the flag is not registered for the caller.
   */
  repositoryType?: string;
}

/**
 * Build the `parseArgs` options table used by every validation-executor
 * entry point. Keep this the single source of truth for CLI shape so
 * SonarCloud does not flag the schema as duplicated new code (S4144).
 */
export function buildValidationCliOptions(defaults: ValidationCliDefaults) {
  const options: Record<
    string,
    {
      type: "string" | "boolean";
      short?: string;
      default?: string | boolean;
      description?: string;
    }
  > = {
    profile: {
      type: "string",
      short: "p",
      default: "default",
    },
    environment: {
      type: "string",
      short: "e",
    },
    "evidence-root": {
      type: "string",
      default: defaults.evidenceRoot,
    },
    output: {
      type: "string",
      short: "o",
      default: defaults.output,
    },
    timeout: {
      type: "string",
      default: "300000", // 5 minutes
    },
    "fail-fast": {
      type: "boolean",
      default: false,
    },
    verbose: {
      type: "boolean",
      short: "v",
      default: false,
    },
    help: {
      type: "boolean",
      short: "h",
      default: false,
    },
  };

  if (defaults.repositoryType !== undefined) {
    options["repository-type"] = {
      type: "string",
      default: defaults.repositoryType,
      description: "Repository type (auto, website-bot, seo-bot, default)",
    };
  }

  return options;
}
