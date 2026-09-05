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

import { realpathSync } from "node:fs";
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
 * Resolve `candidate` against `root` and prove the result stays inside it.
 *
 * @param {string} root absolute repository root
 * @param {string} candidate caller-supplied path, relative or absolute
 * @param {string} label name of the argument, for the error message
 * @returns {string} absolute, canonical path guaranteed to be within `root`
 * @throws {Error} when `candidate` resolves outside `root`
 */
export function resolveWithinRoot(root, candidate, label) {
  if (typeof candidate !== "string" || candidate === "") {
    throw new Error(`PATH_OUTSIDE_REPOSITORY: ${label} must be a non-empty path`);
  }
  const canonicalRoot = canonicalize(path.resolve(root));
  const resolved = canonicalize(path.resolve(canonicalRoot, candidate));
  const relative = path.relative(canonicalRoot, resolved);
  // `relative` is "" for the root itself, starts with ".." for anything above
  // it, and is absolute when the two live on different volumes.
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `PATH_OUTSIDE_REPOSITORY: ${label} must stay inside the repository root; ` +
        `refusing ${JSON.stringify(candidate)}`,
    );
  }
  return resolved;
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
