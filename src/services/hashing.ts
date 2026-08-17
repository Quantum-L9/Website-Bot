// L9_META: layer=service, role=deterministic_hashing, status=active, version=1.0.0
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { BuildError } from "../pipeline/BuildError.js";

export interface HashedFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface DirectoryDigest {
  digest: string;
  files: HashedFile[];
  totalBytes: number;
}

export interface CollectFilesOptions {
  exclude?: (relativePath: string) => boolean;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export const LOCAL_EVIDENCE_PATHS = new Set([
  ".l9/assembly-manifest.json",
  ".l9/build-proof.json",
  ".l9/publication-evidence.json",
  ".l9/deployment-evidence.json",
]);

export function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isSourceDigestExcluded(path: string): boolean {
  const normalized = normalizeRelativePath(path);
  const root = normalized.split("/")[0];
  return (
    root === "node_modules" ||
    root === "dist" ||
    root === ".astro" ||
    root === ".git" ||
    root === ".l9"
  );
}

export function isPublicationExcluded(path: string): boolean {
  const normalized = normalizeRelativePath(path);
  const root = normalized.split("/")[0];
  return (
    root === "node_modules" ||
    root === "dist" ||
    root === ".astro" ||
    root === ".git" ||
    LOCAL_EVIDENCE_PATHS.has(normalized)
  );
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Text(value: string): string {
  return sha256Bytes(Buffer.from(value, "utf-8"));
}

export function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

/**
 * Deterministic, locale-independent path comparator (UTF-16 code-unit order).
 *
 * Manifest and evidence digests must be byte-stable across machines and
 * locales, so path ordering intentionally uses code-unit comparison rather
 * than `localeCompare` (whose collation varies by runtime ICU configuration).
 */
export function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Computes the Git blob object ID for the given content.
 *
 * SHA-1 is mandated here by the Git object model itself: GitHub's Git Data API
 * identifies every blob by its SHA-1 object ID, and this function exists solely
 * to compare local content against remote `git/trees` blob SHAs to skip
 * unchanged uploads. It is a protocol-compatibility identifier, not a security
 * control; integrity of published sources is separately enforced with SHA-256
 * digests (see `sha256Text` / `digestDirectory`).
 */
export function gitBlobSha(content: Uint8Array): string {
  const header = Buffer.from(`blob ${content.byteLength}\0`, "utf-8");
  return createHash("sha1").update(header).update(content).digest("hex"); // NOSONAR typescript:S4790 -- Git blob IDs are SHA-1 by protocol definition; not used as a security hash
}

export function collectRegularFiles(root: string, options: CollectFilesOptions = {}): string[] {
  const absoluteRoot = resolve(root);
  const limits = {
    maxFiles: options.maxFiles ?? Number.POSITIVE_INFINITY,
    maxFileBytes: options.maxFileBytes ?? Number.POSITIVE_INFINITY,
    maxTotalBytes: options.maxTotalBytes ?? Number.POSITIVE_INFINITY,
    exclude: options.exclude,
  };
  const state: { files: string[]; totalBytes: number } = { files: [], totalBytes: 0 };
  collectEntry(absoluteRoot, absoluteRoot, limits, state);
  return state.files;
}

function collectEntry(
  absoluteRoot: string,
  directory: string,
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    exclude?: (relativePath: string) => boolean;
  },
  state: { files: string[]; totalBytes: number },
): void {
  for (const name of readdirSync(directory).sort()) {
    const absolutePath = resolve(directory, name);
    if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
      throw new BuildError(
        "VALIDATION_FAILED",
        `Path escaped root during file collection: ${absolutePath}`,
      );
    }
    const relativePath = normalizeRelativePath(relative(absoluteRoot, absolutePath));
    if (limits.exclude?.(relativePath)) continue;
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink())
      throw new BuildError("VALIDATION_FAILED", `Symbolic links are forbidden: ${relativePath}`);
    if (stat.isDirectory()) {
      collectEntry(absoluteRoot, absolutePath, limits, state);
      continue;
    }
    if (!stat.isFile())
      throw new BuildError("VALIDATION_FAILED", `Unsupported filesystem entry: ${relativePath}`);
    if (stat.size > limits.maxFileBytes)
      throw new BuildError(
        "SOURCE_PUBLISH_FAILED",
        `File exceeds publication limit: ${relativePath}`,
      );
    state.totalBytes += stat.size;
    if (state.totalBytes > limits.maxTotalBytes)
      throw new BuildError(
        "SOURCE_PUBLISH_FAILED",
        "Generated source exceeds total publication size limit",
      );
    state.files.push(absolutePath);
    if (state.files.length > limits.maxFiles)
      throw new BuildError(
        "SOURCE_PUBLISH_FAILED",
        "Generated source exceeds publication file-count limit",
      );
  }
}

export function digestDirectory(root: string, options: CollectFilesOptions = {}): DirectoryDigest {
  const absoluteRoot = resolve(root);
  const files = collectRegularFiles(absoluteRoot, options)
    .map((absolutePath) => {
      const content = readFileSync(absolutePath);
      return {
        path: normalizeRelativePath(relative(absoluteRoot, absolutePath)),
        sha256: sha256Bytes(content),
        bytes: content.byteLength,
      } satisfies HashedFile;
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const digest = sha256Text(
    files.map((file) => `${file.path}\0${file.sha256}\0${file.bytes}\n`).join(""),
  );
  return { digest, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}
