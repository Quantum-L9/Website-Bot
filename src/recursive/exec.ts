// L9_META: layer=recursive, role=trusted_exec, status=active, version=1.0.0
// Resolve OS commands to absolute paths in fixed, unwriteable directories and
// pin PATH to those directories. Bare-name execFileSync/spawnSync is a Sonar
// S4036 (CWE-426/427) finding on this PR.
import { type ExecFileSyncOptionsWithStringEncoding, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const TRUSTED_BIN_DIRS = [
  "/usr/bin",
  "/bin",
  "/usr/local/bin",
  "/usr/sbin",
  "/sbin",
  "/opt/homebrew/bin",
] as const;
export const TRUSTED_PATH = TRUSTED_BIN_DIRS.join(":");

export function resolveTrustedExecutable(name: string): string {
  if (name.includes("/") && existsSync(name)) return name;
  for (const dir of TRUSTED_BIN_DIRS) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`trusted executable not found: ${name}`);
}

export function trustedEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, PATH: TRUSTED_PATH };
}

export function execTrusted(
  name: string,
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding = { encoding: "utf-8" },
): string {
  const result = execFileSync(resolveTrustedExecutable(name), args, {
    ...options,
    encoding: options.encoding ?? "utf-8",
    env: trustedEnv(options.env as NodeJS.ProcessEnv | undefined),
  });
  return result ?? "";
}
