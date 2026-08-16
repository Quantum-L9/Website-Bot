// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { isInsideRoot, walkRoots } from "../../scripts/validate-l9-boundaries.mjs";

void test("isInsideRoot rejects sibling prefix false positives", () => {
  const root = "/repo/foo";
  assert.equal(isInsideRoot(root, "/repo/foo"), true);
  assert.equal(isInsideRoot(root, "/repo/foo/bar"), true);
  assert.equal(isInsideRoot(root, "/repo/foo2"), false);
  assert.equal(isInsideRoot(root, "/repo/foo2/x"), false);
  assert.equal(isInsideRoot(root, "/repo"), false);
});

void test("walkRoots skips dangling symlinks and does not follow symlink directories", () => {
  const base = mkdtempSync(join(tmpdir(), "l9-boundaries-"));
  const root = join(base, "root");
  const external = join(base, "external");
  mkdirSync(root);
  mkdirSync(external);
  writeFileSync(join(root, "ok.ts"), "export const ok = 1;\n");
  writeFileSync(join(external, "secret.ts"), "export const leaked = 1;\n");
  symlinkSync(join(root, "missing-target"), join(root, "dangling"));
  symlinkSync(external, join(root, "link-out"));

  const seen: string[] = [];
  const stats = walkRoots([root], {
    onFile(p: string) {
      seen.push(p);
    },
  });

  assert.equal(seen.length, 1);
  assert.ok(seen[0].endsWith("ok.ts"));
  assert.ok(stats.skipped_symlinks >= 2);
  assert.equal(
    seen.some((p) => p.includes("secret.ts")),
    false,
    "must not read through symlink-dir to external",
  );

  rmSync(base, { recursive: true, force: true });
});

void test("walkRoots skips a symlink supplied as a scan root", () => {
  const base = mkdtempSync(join(tmpdir(), "l9-boundaries-root-"));
  const real = join(base, "real");
  const linkRoot = join(base, "link-root");
  mkdirSync(real);
  writeFileSync(join(real, "hidden.ts"), "export const x = 1;\n");
  symlinkSync(real, linkRoot);

  const seen: string[] = [];
  const stats = walkRoots([linkRoot], {
    onFile(p: string) {
      seen.push(p);
    },
  });

  assert.equal(seen.length, 0);
  assert.equal(stats.skipped_symlink_roots, 1);

  rmSync(base, { recursive: true, force: true });
});

void test("walkRoots containment keeps traversal under the intended root", () => {
  const base = mkdtempSync(join(tmpdir(), "l9-boundaries-contain-"));
  const foo = join(base, "foo");
  const foo2 = join(base, "foo2");
  mkdirSync(foo);
  mkdirSync(foo2);
  writeFileSync(join(foo, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(foo2, "b.ts"), "export const b = 1;\n");

  const seen: string[] = [];
  walkRoots([foo], {
    onFile(p: string) {
      seen.push(resolve(p));
    },
  });

  assert.equal(seen.length, 1);
  assert.ok(seen[0].endsWith(`${join("foo", "a.ts")}`) || seen[0].endsWith("/foo/a.ts"));
  assert.equal(
    seen.some((p) => p.includes("foo2")),
    false,
  );

  rmSync(base, { recursive: true, force: true });
});
