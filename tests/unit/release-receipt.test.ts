import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReleaseReceipt } from '../../src/pipeline/evidence/ReleaseReceipt.js';
import { validateReleaseReceipt } from '../../src/validation/validate-release-receipt.js';

const digest = (character: string) => character.repeat(64);
const commit = 'e'.repeat(40);
const reference = (kind: 'assembly' | 'build' | 'publication' | 'deployment', character: string) => ({
  kind,
  schema: `website-bot.${kind}/v1`,
  logical_id: `${kind}-1`,
  relative_path: `${kind}.json`,
  sha256: digest(character),
});

function validReceipt(): ReleaseReceipt {
  return {
    schema: 'website-bot.release-receipt/v1',
    receipt_id: 'receipt_1234567890abcdef',
    build_id: 'build-1',
    client_id: 'client-1',
    mode: 'end-to-end',
    status: 'succeeded',
    missing_gates: [],
    evidence: {
      assembly: reference('assembly', 'a'),
      build: reference('build', 'b'),
      publication: reference('publication', 'c'),
      deployment: reference('deployment', 'd'),
    },
    correlation: {
      source_digest: digest('1'),
      dist_digest: digest('2'),
      commit_sha: commit,
      deployment_id: 'dpl_1',
      all_required_identities_match: true,
    },
    qa: { seo_baseline: 'skipped', visual_qa: 'passed' },
    created_at: '2026-07-20T00:00:00.000Z',
    finalized_at: '2026-07-20T00:00:01.000Z',
  };
}

void test('accepts a complete reference-based release receipt', () => {
  assert.doesNotThrow(() => validateReleaseReceipt(validReceipt()));
});

void test('rejects a succeeded receipt with missing evidence or correlation', () => {
  const missing = validReceipt();
  delete missing.evidence.deployment;
  assert.throws(() => validateReleaseReceipt(missing), /requires build, publication, and deployment/);

  const uncorrelated = validReceipt();
  uncorrelated.correlation.all_required_identities_match = false;
  assert.throws(() => validateReleaseReceipt(uncorrelated), /correlation is incomplete/);
});

void test('rejects secret-bearing fields even when the receipt shape is otherwise valid', () => {
  const secretBearing = { ...validReceipt(), githubToken: `ghp_${'a'.repeat(30)}` };
  assert.throws(() => validateReleaseReceipt(secretBearing), /secret-bearing/);
});

void test('requires partial receipts to name missing gates', () => {
  const partial = validReceipt();
  partial.mode = 'local-proof';
  partial.status = 'partial';
  partial.missing_gates = [];
  partial.qa.visual_qa = 'pending';
  delete partial.evidence.publication;
  delete partial.evidence.deployment;
  delete partial.correlation.commit_sha;
  delete partial.correlation.deployment_id;
  partial.correlation.all_required_identities_match = true;
  assert.throws(() => validateReleaseReceipt(partial), /partial receipt must name missing gates/);
});
