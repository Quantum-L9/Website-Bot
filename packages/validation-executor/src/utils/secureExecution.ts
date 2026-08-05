/**
 * Secure command execution utilities
 * Replaces shell execution with direct process spawning to prevent injection attacks
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fixed, non-writable system directories trusted to resolve executables from.
 * Spawning by bare name (e.g. 'git', 'sh') lets the OS search the ambient PATH,
 * which may include attacker-writable directories (CWE-426/427). Resolving
 * against this fixed allowlist first avoids relying on that ambient PATH.
 */
const TRUSTED_BIN_DIRS = ['/usr/bin', '/bin', '/usr/local/bin', '/usr/sbin', '/sbin', '/opt/homebrew/bin'];

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
}

/**
 * Safely execute a command with direct process spawning
 * Falls back to shell execution only for commands that require shell features
 */
export function executeCommandSecurely(
  command: string, 
  options: ExecutionOptions = {}
): CommandResult {
  const startTime = Date.now();
  
  // Check if command requires shell features
  if (requiresShellExecution(command)) {
    // Use shell execution for commands that need shell features
    // but sanitize the command first
    const sanitizedCommand = sanitizeShellCommand(command);
    return executeWithShell(sanitizedCommand, options, startTime);
  }
  
  // Parse command for direct execution
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
    '[',     // Globbing
    '~',     // Home directory expansion
    '$'      // Environment variable expansion (if not at start of word)
  ];
  
  return shellFeatures.some(feature => command.includes(feature));
}

/**
 * Sanitize shell command to prevent injection while preserving functionality
 */
function sanitizeShellCommand(command: string): string {
  // Remove dangerous patterns while preserving legitimate shell features
  let sanitized = command;
  
  // Remove command injection attempts
  const dangerousPatterns = [
    /[;&|]{1,2}\s*rm\s/gi,          // rm commands after separators (;, &, &&, |, ||)
    /[;&|]{1,2}\s*dd\s/gi,          // dd commands after separators
    /[;&|]{1,2}\s*curl\s/gi,        // curl commands after separators
    /[;&|]{1,2}\s*wget\s/gi,        // wget commands after separators
    /[;&|]{1,2}\s*nc\s/gi,          // netcat commands after separators
    /[;&|]{1,2}\s*bash\s/gi,        // bash execution after separators
    /[;&|]{1,2}\s*sh\s/gi,          // sh execution after separators
    /\$\([^)]*rm[^)]*\)/gi,         // rm in command substitution
    /\$\([^)]*dd[^)]*\)/gi,         // dd in command substitution
    /\$\([^)]*curl[^)]*\)/gi,       // curl in command substitution
    /`[^`]*rm[^`]*`/gi,             // rm in backtick substitution
    /`[^`]*dd[^`]*`/gi,             // dd in backtick substitution
    /`[^`]*curl[^`]*`/gi,           // curl in backtick substitution
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      throw new Error(`Potentially dangerous command pattern detected: ${command}`);
    }
  }
  
  return sanitized;
}

/**
 * Parse a simple command into executable and arguments
 */
function parseCommand(command: string): { executable: string; args: string[] } {
  // Simple command parsing - split on whitespace
  // This handles basic cases but doesn't parse complex quoting
  const parts = command.trim().split(/\s+/);
  
  if (parts.length === 0) {
    throw new Error('Empty command');
  }
  
  const executable = parts[0];
  const args = parts.slice(1);
  
  return { executable, args };
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
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: options.encoding || 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    timeout: options.timeout
  });
  
  const duration = Date.now() - startTime;
  let exitCode: number;
  if (result.status !== null) {
    exitCode = result.status;
  } else {
    exitCode = result.error ? 127 : 0;
  }
  return {
    exitCode,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
    duration
  };
}

/**
 * Execute command with shell (for commands that require shell features)
 */
function executeWithShell(
  command: string,
  options: ExecutionOptions,
  startTime: number
): CommandResult {
  const result = spawnSync(resolveTrustedExecutable('sh'), ['-c', command], {
    cwd: options.cwd,
    encoding: options.encoding || 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    timeout: options.timeout
  });
  
  const duration = Date.now() - startTime;
  let exitCode: number;
  if (result.status !== null) {
    exitCode = result.status;
  } else {
    exitCode = result.error ? 127 : 0;
  }
  return {
    exitCode,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
    duration
  };
}