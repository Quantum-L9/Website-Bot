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
 * "relative to the repository". The rest only widen what is *accepted*: these
 * CLIs are driven by tests that build a mutated fixture in `os.tmpdir()` and
 * hand it to the verifier, which is a supported way to call them, so the temp
 * directory is a legitimate second base. What stays refused is everything
 * else — `../../etc/passwd`, `~/.ssh/id_rsa`, an absolute path into another
 * checkout — which is the actual finding.
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
