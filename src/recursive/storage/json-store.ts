// L9_META: layer=recursive, role=durable_json_store, status=active, version=1.0.0
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Durable JSON persistence for recursive-run state, matching the repo's
 * evidence-store convention (JSON files under a gitignored root). Writes are
 * atomic: content lands in a temp file and is renamed over the target so a
 * crash can never leave a half-written document behind.
 */
export class JsonStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  pathFor(relativePath: string): string {
    const absolute = resolve(this.root, relativePath);
    if (!absolute.startsWith(resolve(this.root))) throw new Error(`path escapes store root: ${relativePath}`);
    return absolute;
  }

  has(relativePath: string): boolean {
    return existsSync(this.pathFor(relativePath));
  }

  read<T>(relativePath: string): T {
    return JSON.parse(readFileSync(this.pathFor(relativePath), 'utf-8')) as T;
  }

  write(relativePath: string, value: unknown): void {
    const target = this.pathFor(relativePath);
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    renameSync(temporary, target);
  }

  list(relativeDirectory: string): string[] {
    const absolute = this.pathFor(relativeDirectory);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute).sort();
  }
}
