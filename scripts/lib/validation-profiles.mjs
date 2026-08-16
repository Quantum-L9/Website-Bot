// L9_META: layer=validation, role=profile_ssot, status=active, version=1.0.0
/**
 * Canonical Website-Bot validation profile SSOT.
 * Tests assert package.json verify:* parity independently — do not mirror that list here.
 */

export const IMPLEMENTED_VALIDATION_PROFILES = ["preflight", "source", "build", "smoke"];

export const UNIMPLEMENTED_SITE_PROFILES = ["form", "analytics", "crm", "seo", "rollback"];

export const WEBSITE_BOT_VALIDATION_PROFILES = [
  "default",
  ...IMPLEMENTED_VALIDATION_PROFILES,
  ...UNIMPLEMENTED_SITE_PROFILES,
];

/**
 * Pure profile policy — no process.exit.
 *
 * @param {string | undefined} profile
 * @returns {{ status: 'INVALID_PROFILE' | 'INCOMPLETE' | 'RUN', exitCode: number, nonEvidence: boolean, reason: string | null }}
 */
export function resolveProfileRun(profile) {
  if (!profile || !WEBSITE_BOT_VALIDATION_PROFILES.includes(profile)) {
    return {
      status: "INVALID_PROFILE",
      exitCode: 1,
      nonEvidence: true,
      reason: "unknown_profile",
    };
  }
  if (UNIMPLEMENTED_SITE_PROFILES.includes(profile)) {
    return {
      status: "INCOMPLETE",
      exitCode: 2,
      nonEvidence: true,
      reason: "site_level_validation_unimplemented",
    };
  }
  return {
    status: "RUN",
    exitCode: 0,
    nonEvidence: false,
    reason: null,
  };
}

/**
 * Collect Website-Bot CLI configuration errors (pure — no process.exit).
 *
 * @param {{ profile?: string, environment?: string, timeout?: string }} options
 * @returns {string[]}
 */
export function collectWebsiteBotConfigErrors(options = {}) {
  const errors = [];

  const timeout = Number.parseInt(options.timeout ?? "300000", 10);
  if (Number.isNaN(timeout)) {
    errors.push(`Invalid timeout value '${options.timeout}': must be a number`);
  } else if (timeout < 1000) {
    errors.push(`Timeout ${timeout}ms is too low: minimum is 1000ms (1 second)`);
  } else if (timeout > 1800000) {
    errors.push(`Timeout ${timeout}ms is too high: maximum is 1800000ms (30 minutes)`);
  }

  if (options.profile && !WEBSITE_BOT_VALIDATION_PROFILES.includes(options.profile)) {
    errors.push(
      `Unknown Website-Bot profile '${options.profile}': valid profiles are ${WEBSITE_BOT_VALIDATION_PROFILES.join(", ")}`,
    );
  }

  const validEnvironments = ["development", "staging", "production", "test", "ci"];
  if (options.environment && !validEnvironments.includes(options.environment)) {
    errors.push(
      `Unknown environment '${options.environment}': valid environments are ${validEnvironments.join(", ")}`,
    );
  }

  return errors;
}
