// L9_META: layer=service, role=deterministic_hashing, status=active, version=1.0.0
import { createHash } from 'crypto';
import { lstatSync, readFileSync, readdirSync } from 'fs';
import { relative, resolve, sep } from 'path';
import { BuildError } from '../pipeline/BuildError.js';

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
  '.l9/assembly-manifest.json',
  '.l9/build-proof.json',
  '.l9/publication-evidence.json',
  '.l9/deployment-evidence.json',
]);

export function normalizeRelativePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isSourceDigestExcluded(path: string): boolean {
  const normalized = normalizeRelativePath(path);
  const root = normalized.split('/')[0];
  return root === 'node_modules' || root === 'dist' || root === '.astro' || root === '.git' || root === '.l9';
}

export function isPublicationExcluded(path: string): boolean {
  const normalized = normalizeRelativePath(path);
  const root = normalized.split('/')[0];
  return root === 'node_modules' || root === 'dist' || root === '.astro' || root === '.git' || LOCAL_EVIDENCE_PATHS.has(normalized);
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Text(value: string): string {
  return sha256Bytes(Buffer.from(value, 'utf-8'));
}

export function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
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

export function gitBlobSha(content: Uint8Array): string {
  const header = Buffer.from(`blob ${content.byteLength}\0`, 'utf-8');
  return createHash('sha1').update(header).update(content).digest('hex');
}

export function collectRegularFiles(root: string, options: CollectFilesOptions = {}): string[] {
  const absoluteRoot = resolve(root);
  const files: string[] = [];
  let totalBytes = 0;
  const maxFiles = options.maxFiles ?? Number.POSITIVE_INFINITY;
  const maxFileBytes = options.maxFileBytes ?? Number.POSITIVE_INFINITY;
  const maxTotalBytes = options.maxTotalBytes ?? Number.POSITIVE_INFINITY;

  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const absolutePath = resolve(directory, name);
      if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
        throw new BuildError('VALIDATION_FAILED', `Path escaped root during file collection: ${absolutePath}`);
      }
      const relativePath = normalizeRelativePath(relative(absoluteRoot, absolutePath));
      if (options.exclude?.(relativePath)) continue;
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new BuildError('VALIDATION_FAILED', `Symbolic links are forbidden: ${relativePath}`);
      if (stat.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!stat.isFile()) throw new BuildError('VALIDATION_FAILED', `Unsupported filesystem entry: ${relativePath}`);
      if (stat.size > maxFileBytes) throw new BuildError('SOURCE_PUBLISH_FAILED', `File exceeds publication limit: ${relativePath}`);
      totalBytes += stat.size;
      if (totalBytes > maxTotalBytes) throw new BuildError('SOURCE_PUBLISH_FAILED', 'Generated source exceeds total publication size limit');
      files.push(absolutePath);
      if (files.length > maxFiles) throw new BuildError('SOURCE_PUBLISH_FAILED', 'Generated source exceeds publication file-count limit');
    }
  };

  walk(absoluteRoot);
  return files;
}

export function digestDirectory(root: string, options: CollectFilesOptions = {}): DirectoryDigest {
  const absoluteRoot = resolve(root);
  const files = collectRegularFiles(absoluteRoot, options).map(absolutePath => {
    const content = readFileSync(absolutePath);
    return {
      path: normalizeRelativePath(relative(absoluteRoot, absolutePath)),
      sha256: sha256Bytes(content),
      bytes: content.byteLength,
    } satisfies HashedFile;
  });
  const digest = sha256Text(files.map(file => `${file.path}\0${file.sha256}\0${file.bytes}\n`).join(''));
  return { digest, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}
