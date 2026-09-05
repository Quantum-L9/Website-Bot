// L9_META: layer=cli, role=repo_path_containment, status=active, version=1.0.0
//
// Path containment for the Safe Haven Golden CLIs.
//
// Every one of those scripts takes its inputs and its output location from
// `process.argv`, resolves them against the repository root, and then reads,
// writes, and echoes the result. Resolution alone is not a check: `../` walks
// out of the root, and an absolute argument replaces it outright, so an
// argument decides which file on the machine is read or overwritten and which
// path lands in the printed result.
//
// `resolveWithinRoot` is the single place that turns an argument into a usable
// absolute path. It canonicalizes first and validates after — the order
// matters, because a symlink inside the root can point outside it and only the
// canonical form shows that.

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Canonicalize the longest existing prefix of `target`.
 *
 * An output path usually names a file that does not exist yet, and often a
 * directory that does not either, so `realpathSync` on the whole path would
 * throw. Walking up to the nearest existing ancestor and re-appending the
 * remainder resolves every symlink that actually exists while still producing
 * an absolute path for the part that does not.
 *
 * @param {string} target absolute path
 * @returns {string} absolute, symlink-resolved path
 */
function canonicalize(target) {
  let existing = target;
  const trailing = [];
  for (;;) {
    try {
      return path.join(realpathSync(existing), ...trailing);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return target;
      trailing.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * True when `resolved` is `base` or lives under it.
 *
 * The prefix test carries the separator — `startsWith(base)` alone would accept
 * "/repo-evil" for a base of "/repo" — and both operands are already canonical,
 * so no ".." or symlink survives to be compared.
 *
 * @param {string} base canonical absolute directory
 * @param {string} resolved canonical absolute path
 * @returns {boolean}
 */
function isWithin(base, resolved) {
  // Normalize both first. A prefix test on un-normalized operands is wrong in
  // both directions: it accepts "/repo/../etc" against "/repo", and rejects
  // "/repo" against a base written "/repo/".
  const normalizedBase = path.resolve(base);
  const normalizedPath = path.resolve(resolved);
  if (normalizedPath === normalizedBase) return true;
  const prefix = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep;
  return normalizedPath.startsWith(prefix);
}

/**
 * Resolve `candidate` and prove the result stays inside one of `roots`.
 *
 * The first root is the resolution base, so a relative argument keeps meaning
 * "relative to the repository". In practice there is exactly one root — the
 * checkout — because the test harnesses stage their fixtures inside it; the
 * array form remains so a caller can be explicit about that. Refused:
 * `../../etc/passwd`, `~/.ssh/id_rsa`, `/tmp/anything`, and an absolute path
 * into a sibling directory that merely shares a prefix.
 *
 * @param {string | readonly string[]} roots absolute base directory, or bases
 *   with the resolution base first
 * @param {string} candidate caller-supplied path, relative or absolute
 * @param {string} label name of the argument, for the error message
 * @returns {string} absolute, canonical path inside one of `roots`
 * @throws {Error} when `candidate` resolves outside every root
 */
export function resolveWithinRoot(roots, candidate, label) {
  if (typeof candidate !== "string" || candidate === "") {
    throw new Error(`PATH_OUTSIDE_ALLOWED_ROOTS: ${label} must be a non-empty path`);
  }
  const bases = (Array.isArray(roots) ? roots : [roots]).map((r) => canonicalize(path.resolve(r)));
  if (bases.length === 0) {
    throw new Error(`PATH_OUTSIDE_ALLOWED_ROOTS: ${label} has no permitted root`);
  }
  const resolved = canonicalize(path.resolve(bases[0], candidate));
  if (bases.some((base) => isWithin(base, resolved))) return resolved;
  throw new Error(
    `PATH_OUTSIDE_ALLOWED_ROOTS: ${label} must stay inside ${bases.join(" or ")}; ` +
      `refusing ${JSON.stringify(candidate)}`,
  );
}

/**
 * Parse a JSON file that must live inside `root`.
 *
 * The containment check and the read are deliberately in one function: these
 * CLIs take their inputs from `process.argv`, and a guard that sits in a
 * different function from the `readFileSync` it protects is a guard that can be
 * bypassed by the next caller who forgets it — and is invisible to any reader,
 * human or static, looking at the sink (SonarCloud jssecurity:S8707).
 *
 * @param {string} root absolute repository root
 * @param {string} candidate caller-supplied path, relative or absolute
 * @param {string} label name of the argument, for the error message
 * @returns {unknown} the parsed document
 * @throws {Error} when `candidate` resolves outside `root`
 */
export function readJsonWithinRoot(root, candidate, label) {
  if (typeof candidate !== "string" || candidate === "") {
    throw new Error(`PATH_OUTSIDE_ALLOWED_ROOTS: ${label} must be a non-empty path`);
  }
  const base = canonicalize(path.resolve(root));
  const resolved = canonicalize(path.resolve(base, candidate));
  if (!isWithin(base, resolved)) {
    throw new Error(
      `PATH_OUTSIDE_ALLOWED_ROOTS: ${label} must stay inside ${base}; ` +
        `refusing ${JSON.stringify(candidate)}`,
    );
  }
  return JSON.parse(readFileSync(resolved, "utf8"));
}

/**
 * Repository-relative form of a path already proven to be inside `root`.
 * Always POSIX-separated so printed receipts compare equal across platforms.
 *
 * @param {string} root absolute repository root
 * @param {string} contained absolute path returned by {@link resolveWithinRoot}
 * @returns {string} repository-relative path
 */
export function relativeToRoot(root, contained) {
  return path.relative(canonicalize(path.resolve(root)), contained).split(path.sep).join("/");
}
