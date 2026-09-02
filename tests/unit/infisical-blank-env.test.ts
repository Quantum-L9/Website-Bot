// L9_META: layer=test, role=infisical_blank_env, status=active, version=1.0.0
import assert from "node:assert/strict";
import test from "node:test";
import {
  decideSecretInject,
  isBlankEnvValue,
  unsetBlankProcessEnv,
} from "../../packages/infisical-config/src/secrets.ts";

void test("blank env values are unset, not present", () => {
  assert.equal(isBlankEnvValue(undefined), true);
  assert.equal(isBlankEnvValue(""), true);
  assert.equal(isBlankEnvValue("   "), true);
  assert.equal(isBlankEnvValue("token"), false);
});

void test("unsetBlankProcessEnv deletes KEY= placeholders and keeps real values", () => {
  const env: NodeJS.ProcessEnv = {
    L9_MEMORY_TOKEN: "",
    L9_MEMORY_URL: "   ",
    OPENROUTER_API_KEY: "sk-keep",
  };
  const removed = unsetBlankProcessEnv(env);
  assert.deepEqual(removed.sort(), ["L9_MEMORY_TOKEN", "L9_MEMORY_URL"]);
  assert.equal(env.L9_MEMORY_TOKEN, undefined);
  assert.equal(env.L9_MEMORY_URL, undefined);
  assert.equal(env.OPENROUTER_API_KEY, "sk-keep");
});

void test("empty Infisical L9_MEMORY_TOKEN is not injected over a blank placeholder", () => {
  assert.equal(decideSecretInject("", "", false), "skip-blank");
  assert.equal(decideSecretInject(undefined, "", false), "skip-blank");
  assert.equal(decideSecretInject("", "real-token", false), "inject");
  assert.equal(decideSecretInject("already-set", "other", false), "skip-existing");
  assert.equal(decideSecretInject("already-set", "other", true), "inject");
});
