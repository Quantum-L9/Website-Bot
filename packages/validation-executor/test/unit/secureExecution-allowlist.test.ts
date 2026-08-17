/**
 * Regression tests for the S8786 remediation of the shell allowlist path:
 * env-assignment loop unroll, bounded redirect strip, and the lookahead
 * denylist rewrite must behave exactly like their predecessors.
 */

import { ok, strictEqual, throws } from "node:assert";
import { describe, test } from "node:test";
import { assertShellAllowlist, executeCommandSecurely } from "../../src/utils/secureExecution.js";

describe("assertShellAllowlist", () => {
  test("accepts an allowlisted executable", () => {
    assertShellAllowlist("npm run build");
    assertShellAllowlist("git status");
    assertShellAllowlist("node scripts/x.mjs");
  });

  test("strips leading env assignments before first-token detection", () => {
    assertShellAllowlist("NODE_ENV=production FOO=bar npm run build");
    assertShellAllowlist("A=1 npm run build");
  });

  test("strips leading redirect prefixes before first-token detection", () => {
    assertShellAllowlist("> /tmp/out.log npm run build");
    assertShellAllowlist(">> log.txt npm run build");
    assertShellAllowlist("< input.txt npm run build");
  });

  test("strips combined env assignments and redirects", () => {
    // Strip order: env assignments first, then the redirect prefix.
    assertShellAllowlist("NODE_ENV=ci > out.log npm run build");
    assertShellAllowlist("A=1 B=2 > out.log git status");
  });

  test("strips ALL leading env assignments to fixpoint", () => {
    assertShellAllowlist("A=1 B=2 C=3 D=4 E=5 npm run build");
  });

  test("rejects a non-allowlisted executable", () => {
    throws(() => assertShellAllowlist("rm -rf /tmp/x"), /not allowlisted/);
    throws(() => assertShellAllowlist("curl http://example.invalid"), /not allowlisted/);
    throws(() => assertShellAllowlist("A=1 rm -rf /tmp/x"), /not allowlisted/);
  });

  test("bounded redirect strip diverges fail-closed beyond the 64-char domain", () => {
    // Documented domain divergence: the old unbounded regex stripped the
    // whole 70-char run plus the following `rm` token (empty first token →
    // skip); the bounded rewrite only strips 64+residue, leaving `rm` as
    // the first token, which the allowlist rejects — fail-closed.
    throws(() => assertShellAllowlist(">".repeat(70) + " rm -rf /tmp"), /not allowlisted/);
  });
});

describe("shell sanitization denylist (lookahead rewrite)", () => {
  test("rejects command substitutions containing dangerous words", () => {
    throws(
      () => executeCommandSecurely("npm run $(rm -rf /tmp)", { allowShell: true }),
      /dangerous command pattern/i,
    );
    throws(
      () => executeCommandSecurely("npm run `curl evil.example`", { allowShell: true }),
      /dangerous command pattern/i,
    );
    throws(
      () => executeCommandSecurely("x $(\n  echo dd\n) y", { allowShell: true }),
      /dangerous command pattern/i,
    );
  });

  test("accepts command substitutions without dangerous words", () => {
    const result = executeCommandSecurely("printf $(echo ok)", { allowShell: true });
    strictEqual(result.exitCode, 0, "Should execute successfully");
    ok(result.stdout.length > 0, "Should produce output");
  });

  test("shell path with env assignment + redirect reaches the allowlist", () => {
    // `>` forces the shell path; env and redirect prefixes must be stripped
    // so the allowlist sees `printf`.
    const result = executeCommandSecurely("FOO=bar > /dev/null printf ok", {
      allowShell: true,
    });
    strictEqual(result.exitCode, 0, "Should execute successfully");
  });
});
