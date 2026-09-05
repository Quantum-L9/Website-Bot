import fs from "node:fs";
import path from "node:path";

export const root = process.cwd();
export const configPath = path.join(root, "config", "runtime-verification.config.json");

/**
 * Absolute path to a system command such as `git`.
 *
 * Spawning a bare name delegates the choice of binary to `$PATH`, so whatever
 * is earliest on it wins — and these verifiers report on the integrity of a
 * deployment, so a shim that answers on their behalf defeats the point of
 * running them. Resolution is restricted to root-owned system directories;
 * `$PATH` is never consulted. `<NAME>_BIN` (e.g. `GIT_BIN`) overrides it for
 * layouts these directories do not cover, and must itself be absolute.
 */
const SYSTEM_BIN_DIRS = ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"];

export function resolveSystemCommand(name) {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error(`${name.toUpperCase()}_BIN must be an absolute path`);
    }
    return override;
  }
  for (const dir of SYSTEM_BIN_DIRS) {
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here; try the next trusted directory
    }
  }
  throw new Error(
    `${name} not found in ${SYSTEM_BIN_DIRS.join(", ")}; ` +
      `set ${name.toUpperCase()}_BIN to its absolute path`,
  );
}

/**
 * Absolute path to a tool that ships with the running Node install (`npm`,
 * `npx`). Derived from `process.execPath` rather than `$PATH` so the tool
 * always matches the interpreter already executing this script.
 */
export function resolveNodeTool(name) {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error(`${name.toUpperCase()}_BIN must be an absolute path`);
    }
    return override;
  }
  const candidate = path.join(path.dirname(process.execPath), name);
  try {
    if (fs.statSync(candidate).isFile()) return candidate;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    `${name} not found next to ${process.execPath}; ` +
      `set ${name.toUpperCase()}_BIN to its absolute path`,
  );
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
 * Build a check-result row (S107: options object instead of 8 params).
 * This example-site copy is options-only: every caller in this site was
 * migrated, and the backward-compatibility shim for generated sites lives
 * in the template (astro_template/scripts/lib.mjs).
 */
export function result(options) {
  return {
    check_id: options.check_id,
    check_class: options.check_class,
    target_artifact: options.target_artifact,
    command_or_inspection_method: "node script inspection",
    expected_result: options.expected_result,
    actual_result: options.actual_result,
    status: options.status,
    severity: options.severity ?? "medium",
    remediation_if_failed: options.remediation_if_failed ?? "",
    evidence: options.target_artifact,
  };
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
