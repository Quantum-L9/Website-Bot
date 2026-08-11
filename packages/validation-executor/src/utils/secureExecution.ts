/**
 * Secure command execution utilities
 * Prefer direct process spawning; shell only with explicit opt-in + allowlist.
 *
 * Website-Bot#53: Sonar flags `sh -c` as a security hotspot. We keep a narrow
 * shell path for validation specs that need pipes/redirects/chaining, but:
 * - callers must set `allowShell: true`
 * - every shell segment's executable must be allowlisted
 * - dangerous denylist patterns still throw
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Fixed, non-writable system directories trusted to resolve executables from.
 * Spawning by bare name (e.g. 'git', 'sh') lets the OS search the ambient PATH,
 * which may include attacker-writable directories (CWE-426/427). Resolving
 * against this fixed allowlist first avoids relying on that ambient PATH.
 */
const TRUSTED_BIN_DIRS = ['/usr/bin', '/bin', '/usr/local/bin', '/usr/sbin', '/sbin', '/opt/homebrew/bin'];

/** Executables permitted when `allowShell: true` (Website-Bot#53). */
const SHELL_ALLOWED_EXECUTABLES = new Set([
  'echo', 'printf', 'ls', 'cat', 'grep', 'egrep', 'fgrep', 'wc', 'pwd',
  'test', '[', 'true', 'false', 'sleep', 'mkdir', 'cp', 'mv', 'find',
  'head', 'tail', 'sort', 'uniq', 'basename', 'dirname', 'xargs', 'tr',
  'cut', 'awk', 'sed', 'tee', 'diff', 'which', 'env', 'cd',
  'npm', 'npx', 'node', 'pnpm', 'yarn', 'git', 'tsc', 'vitest',
  'python', 'python3', 'pip', 'pip3',
]);

/** Shell keywords / builtins that are not filesystem executables. */
const SHELL_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'in', '!', '{', '}',
]);

/**
 * Resolve an executable to an absolute path within a trusted, unwriteable
 * system directory. Falls back to the bare name (previous behavior) only
 * when the executable cannot be found in any trusted directory.
 */
export function resolveTrustedExecutable(name: string): string {
  for (const dir of TRUSTED_BIN_DIRS) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return name;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface ExecutionOptions {
  cwd?: string;
  timeout?: number;
  encoding?: BufferEncoding;
  /**
   * Explicit opt-in for shell features (pipes, redirects, chaining).
   * Default false: shell-feature commands throw instead of spawning `sh -c`.
   */
  allowShell?: boolean;
}

/**
 * Safely execute a command with direct process spawning.
 * Shell path requires `allowShell: true` + allowlisted executables.
 */
export function executeCommandSecurely(
  command: string,
  options: ExecutionOptions = {}
): CommandResult {
  const startTime = Date.now();

  if (requiresShellExecution(command)) {
    if (!options.allowShell) {
      throw new Error(
        `Command requires shell features but allowShell was not set: ${command}`
      );
    }
    const sanitizedCommand = sanitizeShellCommand(command);
    assertShellAllowlist(sanitizedCommand);
    return executeWithShell(sanitizedCommand, options, startTime);
  }

  const { executable, args } = parseCommand(command);
  return executeDirectly(executable, args, options, startTime);
}

/**
 * Check if a command requires shell features
 */
function requiresShellExecution(command: string): boolean {
  const shellFeatures = [
    '|',     // Pipes
    '>',     // Redirection
    '>>',    // Append redirection
    '<',     // Input redirection
    '&&',    // Command chaining (AND)
    '||',    // Command chaining (OR)
    ';',     // Command separator
    '`',     // Command substitution
    '$(',    // Command substitution
    '*',     // Globbing
    '?',     // Globbing
    '[',     // Globbing / test — also matches `[ -d` test form
    '~',     // Home directory expansion
    '$'      // Environment variable expansion
  ];

  return shellFeatures.some(feature => command.includes(feature));
}

/**
 * Sanitize shell command to prevent injection while preserving functionality
 */
function sanitizeShellCommand(command: string): string {
  let sanitized = command;

  const dangerousPatterns = [
    /[;&|]{1,2}\s*rm\s/gi,
    /[;&|]{1,2}\s*dd\s/gi,
    /[;&|]{1,2}\s*curl\s/gi,
    /[;&|]{1,2}\s*wget\s/gi,
    /[;&|]{1,2}\s*nc\s/gi,
    /[;&|]{1,2}\s*bash\s/gi,
    /[;&|]{1,2}\s*sh\s/gi,
    /\$\([^)]*rm[^)]*\)/gi,
    /\$\([^)]*dd[^)]*\)/gi,
    /\$\([^)]*curl[^)]*\)/gi,
    /`[^`]*rm[^`]*`/gi,
    /`[^`]*dd[^`]*`/gi,
    /`[^`]*curl[^`]*`/gi,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      throw new Error(`Potentially dangerous command pattern detected: ${command}`);
    }
  }

  return sanitized;
}

/**
 * Fail closed unless every shell segment starts with an allowlisted executable.
 */
export function assertShellAllowlist(command: string): void {
  const segments = command.split(/(?:&&|\|\||[;|])/);
  for (const segment of segments) {
    let trimmed = segment.trim();
    if (!trimmed) continue;
    // Strip leading redirects / env assignments for first-token detection
    trimmed = trimmed.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, '');
    trimmed = trimmed.replace(/^[<>]+\s*\S+\s*/, '');
    const rawFirst = trimmed.split(/\s+/)[0] ?? '';
    const first = rawFirst.replace(/^[()]+/, '');
    if (!first || SHELL_KEYWORDS.has(first)) continue;
    const base = basename(first);
    if (!SHELL_ALLOWED_EXECUTABLES.has(base)) {
      throw new Error(`Shell executable not allowlisted: ${base}`);
    }
  }
}

/**
 * Parse a simple command into executable and arguments
 */
function parseCommand(command: string): { executable: string; args: string[] } {
  const parts = command.trim().split(/\s+/);

  if (parts.length === 0) {
    throw new Error('Empty command');
  }

  const executable = parts[0];
  const args = parts.slice(1);

  return { executable, args };
}

function spawnSyncOptions(options: ExecutionOptions) {
  return {
    cwd: options.cwd,
    encoding: (options.encoding || 'utf8') as BufferEncoding,
    stdio: ['inherit', 'pipe', 'pipe'] as Array<'inherit' | 'pipe'>,
    timeout: options.timeout,
  };
}

function toCommandResult(
  result: SpawnSyncReturns<string>,
  startTime: number
): CommandResult {
  const duration = Date.now() - startTime;
  const exitCode =
    result.status !== null ? result.status : result.error ? 127 : 0;
  return {
    exitCode,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
    duration,
  };
}

/**
 * Execute command directly without shell
 */
function executeDirectly(
  executable: string,
  args: string[],
  options: ExecutionOptions,
  startTime: number
): CommandResult {
  const resolved = resolveTrustedExecutable(executable);
  return toCommandResult(
    spawnSync(resolved, args, spawnSyncOptions(options)),
    startTime
  );
}

/**
 * Execute command with shell (opt-in only; allowlisted executables).
 */
function executeWithShell(
  command: string,
  options: ExecutionOptions,
  startTime: number
): CommandResult {
  // Trusted absolute sh path; command already sanitized + allowlisted.
  return toCommandResult(
    spawnSync(resolveTrustedExecutable('sh'), ['-c', command], spawnSyncOptions(options)),
    startTime
  );
}

/**
 * Adapter-facing shell-capable execution (opt-in allowShell + allowlist).
 * Shared by WebsiteBot / SeoBot adapters to avoid call-site duplication.
 */
export function executeAdapterCommand(
  command: string,
  workingDir: string,
  timeoutMs = 300_000
): CommandResult {
  return executeCommandSecurely(command, {
    cwd: workingDir,
    encoding: 'utf8',
    timeout: timeoutMs,
    allowShell: true,
  });
}
