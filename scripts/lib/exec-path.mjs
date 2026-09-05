// L9_META: layer=cli, role=executable_resolution, status=active, version=1.0.0
//
// Absolute-path resolution for the external commands this repo shells out to.
//
// Spawning a bare name ("git") delegates the choice of binary to `$PATH`, so
// whatever is earliest on it wins. That is a real hazard here rather than a
// theoretical one: the identity fields in a Golden receipt are whatever `git`
// prints, so a `git` earlier on `$PATH` than the system one forges the SHA and
// the worktree state that the receipt is supposed to attest.
//
// Resolution is therefore restricted to a fixed set of absolute directories.
// `$PATH` is never consulted, and a command that is not in one of them fails
// loudly instead of resolving to something unexpected.

import { statSync } from "node:fs";
import path from "node:path";

/**
 * Directories a system command may come from, in preference order. These are
 * root-owned on a normal install; a writable directory must never appear here.
 * `/opt/homebrew/bin` and `/usr/local/bin` cover macOS developer machines,
 * where git is not under `/usr/bin`.
 */
const SYSTEM_BIN_DIRS = Object.freeze([
  "/usr/bin",
  "/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
]);

/** @param {string} candidate @returns {boolean} */
function isExecutableFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Absolute path to a system command.
 *
 * `<NAME>_BIN` (e.g. `GIT_BIN`) overrides the search for environments whose
 * layout is not covered above — a Nix store, a container with a relocated
 * toolchain. The override must itself be absolute, so it cannot reintroduce
 * `$PATH` lookup by another name.
 *
 * @param {string} name bare command name, e.g. "git"
 * @returns {string} absolute path to the executable
 * @throws {Error} when the command is not found in a trusted directory
 */
export function resolveSystemCommand(name) {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error(
        `COMMAND_NOT_RESOLVED: ${name.toUpperCase()}_BIN must be an absolute path, got ${JSON.stringify(override)}`,
      );
    }
    if (!isExecutableFile(override)) {
      throw new Error(`COMMAND_NOT_RESOLVED: ${name.toUpperCase()}_BIN does not name a file: ${override}`);
    }
    return override;
  }
  for (const dir of SYSTEM_BIN_DIRS) {
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  throw new Error(
    `COMMAND_NOT_RESOLVED: ${name} not found in ${SYSTEM_BIN_DIRS.join(", ")}; ` +
      `set ${name.toUpperCase()}_BIN to its absolute path`,
  );
}

/**
 * Absolute path to a tool that ships with the running Node install (`npm`,
 * `npx`). Derived from `process.execPath`, not `$PATH`, so the tool always
 * belongs to the interpreter already executing this script — which is also
 * what makes the result stable under nvm, corepack, and Homebrew, where the
 * `npx` first on `$PATH` need not match the running node.
 *
 * @param {string} name "npm" or "npx"
 * @returns {string} absolute path to the tool
 * @throws {Error} when the tool is not next to the running interpreter
 */
export function resolveNodeTool(name) {
  const override = process.env[`${name.toUpperCase()}_BIN`];
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error(
        `COMMAND_NOT_RESOLVED: ${name.toUpperCase()}_BIN must be an absolute path, got ${JSON.stringify(override)}`,
      );
    }
    return override;
  }
  const candidate = path.join(path.dirname(process.execPath), name);
  if (isExecutableFile(candidate)) return candidate;
  throw new Error(
    `COMMAND_NOT_RESOLVED: ${name} not found next to ${process.execPath}; ` +
      `set ${name.toUpperCase()}_BIN to its absolute path`,
  );
}
