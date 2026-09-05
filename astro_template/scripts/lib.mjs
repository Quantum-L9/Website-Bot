import fs from "node:fs";
import path from "node:path";

export const root = process.cwd();
export const configPath = path.join(root, "config", "runtime-verification.config.json");

/**
 * Absolute path to a system command such as `git`.
 *
 * Spawning a bare name delegates the choice of binary to `$PATH`, so whatever
 * is earliest on it wins — and these verifiers report on the integrity of a
 * deployment, so a shim answering on their behalf defeats the point of running
 * them. Resolution is restricted to root-owned system directories; `$PATH` is
 * never consulted. `GIT_BIN` and friends override it for layouts these
 * directories do not cover, and must be absolute.
 */
export function resolveSystemCommand(name) {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) {
    if (!path.isAbsolute(override)) throw new Error(`${name.toUpperCase()}_BIN must be absolute`);
    return override;
  }
  for (const dir of ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"]) {
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here; try the next trusted directory
    }
  }
  throw new Error(`${name} not found in a trusted system directory`);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

export function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

export function listFiles(dir, matcher = () => true) {
  const base = path.join(root, dir);
  const out = [];
  if (!fs.existsSync(base)) return out;
  const walk = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else {
        const rel = path.relative(root, full).replaceAll(path.sep, "/");
        if (matcher(rel)) out.push(rel);
      }
    }
  };
  walk(base);
  return out.sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}

export function parseEnvExample() {
  const text = fs.existsSync(path.join(root, ".env.example")) ? readText(".env.example") : "";
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    values[key.trim()] = rest.join("=").trim();
  }
  return values;
}

/**
 * Keys from .env.example whose lowercased name contains any of the given
 * keywords (e.g. ["analytics", "gtag"]). Shared by the verify-*.mjs scripts.
 */
export function envVarsMatching(...keywords) {
  const envVars = parseEnvExample();
  return Object.keys(envVars).filter((key) => {
    const lowered = key.toLowerCase();
    return keywords.some((keyword) => lowered.includes(keyword));
  });
}

/**
 * Build a check-result row (S107: options object instead of 8 params).
 *
 * Preferred form: result({ check_id, check_class, target_artifact,
 *   expected_result, actual_result, status, severity, remediation_if_failed })
 *
 * Positional calls are still accepted for backward compatibility with
 * generated sites that copy this script verbatim; the shim maps the legacy
 * argument order onto the options object.
 */
export function result(optionsOrCheckId, ...legacyArgs) {
  const {
    check_id,
    check_class,
    target_artifact,
    expected_result,
    actual_result,
    status,
    severity = "medium",
    remediation_if_failed = "",
  } =
    typeof optionsOrCheckId === "object" && optionsOrCheckId !== null
      ? optionsOrCheckId
      : {
          check_id: optionsOrCheckId,
          check_class: legacyArgs[0],
          target_artifact: legacyArgs[1],
          expected_result: legacyArgs[2],
          actual_result: legacyArgs[3],
          status: legacyArgs[4],
          severity: legacyArgs[5] ?? "medium",
          remediation_if_failed: legacyArgs[6] ?? "",
        };

  return {
    check_id,
    check_class,
    target_artifact,
    command_or_inspection_method: "node script inspection",
    expected_result,
    actual_result,
    status,
    severity,
    remediation_if_failed,
    evidence: target_artifact,
  };
}

/**
 * Standard "dist/ build output is required before this check" row.
 * Shared by the verify-*.mjs scripts instead of repeated result() blocks.
 */
export function buildRequiredResult(checkId, expectedResult, actualResult, status = "BLOCKED") {
  return result({
    check_id: checkId,
    check_class: "prerequisite",
    target_artifact: "dist/",
    expected_result: expectedResult,
    actual_result: actualResult,
    status,
    severity: "medium",
    remediation_if_failed: "Run npm run build first",
  });
}

/** Standard "could not read a built file" row for check-file catch blocks. */
export function fileReadErrorResult(checkId, targetArtifact, checkLabel, error) {
  return result({
    check_id: checkId,
    check_class: "file_access",
    target_artifact: targetArtifact,
    expected_result: `${checkLabel} check completed`,
    actual_result: `Error reading file: ${error.message}`,
    status: "UNKNOWN",
    severity: "low",
    remediation_if_failed: "Ensure build output is readable",
  });
}

/** Standard build-output existence row (dist/ and dist/index.html checks). */
export function fileExistenceResult(
  checkId,
  targetArtifact,
  expectedResult,
  foundText,
  missingText,
  remediationIfFailed,
) {
  return existenceCheckResult({
    checkId,
    checkClass: "build_output",
    targetArtifact,
    expectedResult,
    foundText,
    missingText,
    remediationIfFailed,
  });
}

/**
 * Generic "does path exist on disk" check-result row. Consolidates the
 * PASS/FAIL and expected/found/missing wording that would otherwise be
 * duplicated across preflight and verify-* scripts (SonarCloud S4144 —
 * duplicated blocks on new code).
 */
export function existenceCheckResult({
  checkId,
  checkClass = "file_existence",
  targetArtifact,
  expectedResult,
  foundText,
  missingText,
  severity = "high",
  remediationIfFailed,
}) {
  const present = exists(targetArtifact);
  return result({
    check_id: checkId,
    check_class: checkClass,
    target_artifact: targetArtifact,
    expected_result: expectedResult,
    actual_result: present ? foundText : missingText,
    status: present ? "PASS" : "FAIL",
    severity,
    remediation_if_failed: remediationIfFailed,
  });
}

export function writeJsonl(relativePath, rows) {
  fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  fs.writeFileSync(
    path.join(root, relativePath),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

export function statusFromRows(rows) {
  if (rows.some((row) => row.status === "FAIL")) return "FAIL";
  if (rows.some((row) => row.status === "BLOCKED")) return "BLOCKED";
  if (rows.some((row) => row.status === "UNKNOWN")) return "PASS_WITH_UNKNOWNS";
  return "PASS";
}
