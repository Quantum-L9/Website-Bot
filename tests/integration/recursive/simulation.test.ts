// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
// Simulated three-wave proof (integration). Fully controlled and
// non-production: real controller, harvest, registry, compiler, executor,
// verifier, promotion, and deployment modules run unmodified against a local
// bare repository and a local deployment directory. No real Safe Haven
// campaign, no GitHub, no Vercel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSimulatedThreeWaveProof } from '../../../src/recursive/simulation/simulate.js';
import { assertSchemaConformance } from '../../../src/recursive/contracts/validate.js';

test('simulated three-wave proof: E2E1-V0→V1, E2E2-V1→V2, E2E3-V2→V3, no wave four', async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), 'recursive-sim-state-'));
  try {
    const receipt = await runSimulatedThreeWaveProof({ stateRoot });

    // The final receipt must conform to the bound run schema exactly as emitted.
    assertSchemaConformance('recursive-engineering-run', receipt);

    // Exact three-wave trajectory.
    assert.equal(receipt.policy.targetWaves, 3);
    assert.equal(receipt.policy.hardMaxWaves, 3);
    assert.equal(receipt.waves.length, 3);
    assert.deepEqual(receipt.waves.map(wave => wave.wave), [1, 2, 3]);

    // E2E_1 tests V0; E2E_2 tests exactly deployed V1; E2E_3 tests exactly
    // deployed V2 (the previous wave's promoted SHA).
    const [v0] = receipt.trajectory.testedVersions;
    assert.equal(receipt.waves[0].inputCode.fullSha, v0);
    assert.equal(receipt.waves[1].inputCode.fullSha, receipt.trajectory.producedVersions[0]);
    assert.equal(receipt.waves[2].inputCode.fullSha, receipt.trajectory.producedVersions[1]);
    assert.equal(receipt.trajectory.testedVersions.length, 3);
    assert.equal(receipt.trajectory.producedVersions.length, 3);
    assert.equal(new Set(receipt.trajectory.testedVersions).size, 3);

    // Terminal semantics: normal three-wave completion.
    assert.equal(receipt.terminalState, 'WAVE_LIMIT_REACHED');
    assert.equal(receipt.nextAction, 'START_NEXT_RUN_WITH_FINAL_SHA');
    assert.equal(receipt.executionCounts.fullE2Es, 3);
    assert.equal(receipt.executionCounts.codeImprovementLoops, 3);
    assert.equal(receipt.executionCounts.autonomousMerges, 3);
    assert.equal(receipt.executionCounts.deployments, 3);
    assert.equal(receipt.executionCounts.rollbacks, 0);

    // V3 is engineering- and deployment-validated but NOT full-E2E validated.
    assert.equal(receipt.finalVersion.engineeringValidated, true);
    assert.equal(receipt.finalVersion.deploymentValidated, true);
    assert.equal(receipt.finalVersion.fullE2EValidated, false);

    // Invariants: every autonomy invariant held.
    assert.deepEqual(receipt.invariants, {
      waveFourExecuted: false,
      controlPlaneMutated: false,
      acceptanceContractMutatedAfterFreeze: false,
      coderSelfCertified: false,
      unverifiedCodeMerged: false,
      wrongShaTested: false,
    });

    // Each wave receipt conforms to the bound wave schema.
    for (const wave of receipt.waves) assertSchemaConformance('recursive-engineering-wave', wave);
    // Each wave was promoted: merge and deployment receipts exist.
    for (const wave of receipt.waves) {
      assert.ok(wave.promotion, `wave ${wave.wave} promotion missing`);
      assert.equal(wave.status, 'WAVE_COMPLETE');
    }
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('simulation is deterministic: two runs produce the same trajectory shape', async () => {
  const firstRoot = mkdtempSync(join(tmpdir(), 'recursive-sim-a-'));
  const secondRoot = mkdtempSync(join(tmpdir(), 'recursive-sim-b-'));
  try {
    const first = await runSimulatedThreeWaveProof({ stateRoot: firstRoot });
    const second = await runSimulatedThreeWaveProof({ stateRoot: secondRoot });
    assert.deepEqual(
      first.trajectory.reviewabilityByE2E.map(item => item.wave),
      second.trajectory.reviewabilityByE2E.map(item => item.wave),
    );
    assert.equal(first.terminalState, second.terminalState);
    assert.equal(first.waves.length, second.waves.length);
    assert.equal(first.executionCounts.fullE2Es, second.executionCounts.fullE2Es);
  } finally {
    rmSync(firstRoot, { recursive: true, force: true });
    rmSync(secondRoot, { recursive: true, force: true });
  }
});
