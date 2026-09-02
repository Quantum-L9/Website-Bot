// L9_META: layer=source, role=tracked_file, status=active, version=1.1.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  WEBSITE_BOT_VALIDATION_PROFILES,
  SITE_TEMPLATE_VALIDATION_PROFILES,
  UNIMPLEMENTED_SITE_PROFILES,
  collectWebsiteBotConfigErrors,
  resolveProfileRun,
} from '../../scripts/lib/validation-profiles.mjs';

const PACKAGE_VERIFY_PROFILE_SCRIPTS = [
  'verify:preflight',
  'verify:source',
  'verify:build',
  'verify:smoke',
  'verify:form',
  'verify:analytics',
  'verify:crm',
  'verify:seo',
  'verify:rollback',
] as const;

void test('package.json verify:* profiles are in the Website-Bot SSOT allowlist', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  for (const scriptName of PACKAGE_VERIFY_PROFILE_SCRIPTS) {
    assert.ok(pkg.scripts?.[scriptName], `missing package script ${scriptName}`);
    const profile = scriptName.replace(/^verify:/, '');
    assert.ok(
      WEBSITE_BOT_VALIDATION_PROFILES.includes(profile),
      `${profile} from ${scriptName} must be in WEBSITE_BOT_VALIDATION_PROFILES`,
    );
    const errors = collectWebsiteBotConfigErrors({ profile, timeout: '300000' });
    assert.equal(errors.length, 0, `config boundary must accept ${profile}: ${errors.join('; ')}`);
  }
});

void test('resolveProfileRun returns RUN for factory and site-template profiles', () => {
  for (const profile of [
    'default',
    'preflight',
    'source',
    'build',
    'smoke',
    ...SITE_TEMPLATE_VALIDATION_PROFILES,
  ]) {
    const result = resolveProfileRun(profile);
    assert.equal(result.status, 'RUN', profile);
    assert.equal(result.exitCode, 0, profile);
    assert.equal(result.nonEvidence, false, profile);
  }
});

void test('UNIMPLEMENTED_SITE_PROFILES is empty after site-template activation', () => {
  assert.deepEqual(UNIMPLEMENTED_SITE_PROFILES, []);
});

void test('resolveProfileRun rejects unknown profiles', () => {
  const result = resolveProfileRun('ci');
  assert.equal(result.status, 'INVALID_PROFILE');
  assert.equal(result.exitCode, 1);
  assert.equal(result.nonEvidence, true);
});

void test('collectWebsiteBotConfigErrors rejects env-named profile values', () => {
  for (const profile of ['ci', 'development', 'staging', 'production', 'test', 'factory', 'site']) {
    const errors = collectWebsiteBotConfigErrors({ profile, timeout: '300000' });
    assert.ok(errors.some((e: string) => e.includes('Unknown Website-Bot profile')), profile);
  }
});

void test('spawned site-template profiles do not exit INCOMPLETE non-evidence', () => {
  for (const profile of SITE_TEMPLATE_VALIDATION_PROFILES) {
    const result = spawnSync(
      'npx',
      ['tsx', 'scripts/validation-executor.ts', 'run', '--profile', profile],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: { ...process.env, npm_config_yes: 'true' },
      },
    );
    const out = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 2, `${profile} must not exit INCOMPLETE; stderr=${result.stderr}`);
    assert.doesNotMatch(out, /site_level_validation_unimplemented/);
    assert.doesNotMatch(out, /"non_evidence": true/);
  }
});
