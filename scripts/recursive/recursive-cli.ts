// L9_META: layer=recursive, role=operator_cli_entrypoint, status=active, version=1.0.0
// Operator surface for bounded recursive engineering runs.
//   npm run recursive:improve -- --source <SOURCE_URL> --waves 3
//   npm run recursive:status  [--run <id>]
//   npm run recursive:resume  -- --run <id>
//   npm run recursive:simulate
// Hard rule: --waves accepts only 3 (the pack's absolute runtime limit); mode
// is DEVELOPMENT_RECURSIVE only; no real Safe Haven campaign is launched here.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { TRUSTED_PATH } from '../../src/recursive/exec.js';

const STATE_ROOT = resolve('.l9/recursive');

function usage(): never {
  console.error('usage: recursive-cli.ts <improve|status|resume|simulate> [options]');
  console.error('  improve --source <URL> --waves 3');
  console.error('  status  [--run <id>]');
  console.error('  resume  --run <id>');
  console.error('  simulate');
  process.exit(2);
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

async function runIdFor(sourceUrl: string): Promise<string> {
  const { sha256Text } = await import('../../src/services/hashing.js');
  return `recursive-${sha256Text(sourceUrl).slice(0, 12)}`;
}

function statePath(runId: string, relative: string): string {
  const absolute = resolve(STATE_ROOT, runId, relative);
  if (!absolute.startsWith(resolve(STATE_ROOT))) throw new Error('path escapes recursive state root');
  return absolute;
}

async function writeSourceSpec(runId: string, sourceUrl: string): Promise<string> {
  const { parse, stringify } = await import('yaml');
  const fixture = readFileSync(resolve('fixtures/ci-test-spec.yaml'), 'utf-8');
  const spec = parse(fixture) as Record<string, unknown>;
  const assets = (spec.assets ?? {}) as Record<string, unknown>;
  const sourceSite = (assets.sourceSite ?? {}) as Record<string, unknown>;
  spec.client_id = process.env.CLIENT_ID ?? 'recursive-client';
  spec.seo_contract = { ...(spec.seo_contract as Record<string, unknown>), site_url: new URL(sourceUrl).hostname };
  assets.sourceSite = { ...sourceSite, url: sourceUrl, enabled: true, maxPages: 3, maxDepth: 1 };
  spec.assets = assets;
  const path = statePath(runId, 'domain-spec.yaml');
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, stringify(spec), 'utf-8');
  return path;
}

async function runRealE2E(specPath: string, runId: string): Promise<void> {
  console.error(`[recursive] running real E2E with spec ${specPath}`);
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/run-pipeline.ts', '--mode=end-to-end', `--spec=${specPath}`],
    { stdio: 'inherit', env: { ...process.env, PATH: TRUSTED_PATH } },
  );
  const report = { command: 'npm run pipeline:end-to-end', exitCode: result.status ?? null, ranAt: new Date().toISOString() };
  writeFileSync(statePath(runId, 'e2e-run-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf-8');
  if ((result.status ?? 1) !== 0) {
    console.error('[recursive] E2E failed; failure evidence is preserved for the engineering harvest');
  }
}

async function commandImprove(args: string[]): Promise<void> {
  const sourceUrl = argValue(args, '--source');
  const waves = argValue(args, '--waves');
  if (!sourceUrl) {
    console.error('--source <SOURCE_URL> is required');
    process.exit(2);
  }
  if (waves !== undefined && waves !== '3') {
    console.error(`wave budget is immutable: --waves must be 3, got ${waves}`);
    process.exit(2);
  }
  const parsedSource = new URL(sourceUrl);
  if (parsedSource.protocol !== 'http:' && parsedSource.protocol !== 'https:') {
    console.error('--source must be an http(s) URL');
    process.exit(2);
  }
  const runId = await runIdFor(parsedSource.href);
  mkdirSync(statePath(runId, ''), { recursive: true });
  const specPath = await writeSourceSpec(runId, sourceUrl);
  await runRealE2E(specPath, runId);
  console.error(`[recursive] run ${runId} started; use 'npm run recursive:status -- --run ${runId}'`);
}

async function commandStatus(args: string[]): Promise<void> {
  const runId = argValue(args, '--run');
  const root = runId ? resolve(STATE_ROOT, runId) : resolve(STATE_ROOT);
  if (!existsSync(root)) {
    console.error('no recursive runs recorded yet');
    process.exit(1);
  }
  const entries = runId ? [runId] : [...readdirSync(root)].sort((left, right) => left.localeCompare(right));
  for (const entry of entries) {
    const manifestPath = resolve(STATE_ROOT, entry, 'campaign-manifest.json');
    const receiptPath = resolve(STATE_ROOT, entry, 'run-receipt.json');
    if (!existsSync(manifestPath)) {
      console.log(JSON.stringify({ runId: entry, state: 'no-manifest' }));
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf-8')) : null;
    console.log(JSON.stringify({
      runId: entry,
      currentWave: manifest.state?.currentWave,
      status: manifest.state?.status,
      terminalState: receipt?.terminalState ?? null,
      nextAction: receipt?.nextAction ?? null,
      finalVersion: receipt?.finalVersion ?? null,
    }, null, 2));
  }
}

async function commandResume(args: string[]): Promise<void> {
  const runId = argValue(args, '--run');
  if (!runId) {
    console.error('--run <id> is required');
    process.exit(2);
  }
  const { EventLedger } = await import('../../src/recursive/events/ledger.js');
  const { rebuildManifestFromLedger } = await import('../../src/recursive/state/resume.js');
  const { JsonStore } = await import('../../src/recursive/storage/json-store.js');
  const store = new JsonStore(STATE_ROOT);
  const manifestPath = statePath(runId, 'campaign-manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`no manifest for run ${runId}`);
    process.exit(1);
  }
  const manifest = store.read<import('../../src/recursive/state/run-manifest.js').CampaignManifest>(`${runId}/campaign-manifest.json`);
  const ledger = new EventLedger(join(STATE_ROOT, runId, 'events.jsonl'));
  const rebuilt = rebuildManifestFromLedger(manifest, ledger);
  console.log(JSON.stringify({
    runId,
    rebuiltFromLedger: true,
    replayedEvents: rebuilt.replayedEvents,
    finalPhaseState: rebuilt.finalPhaseState,
    status: rebuilt.manifest.state.status,
  }, null, 2));
}

async function commandSimulate(): Promise<void> {
  const { runSimulatedThreeWaveProof } = await import('../../src/recursive/simulation/simulate.js');
  const receipt = await runSimulatedThreeWaveProof({ stateRoot: STATE_ROOT });
  console.log(JSON.stringify(receipt, null, 2));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'improve':
      return commandImprove(args);
    case 'status':
      return commandStatus(args);
    case 'resume':
      return commandResume(args);
    case 'simulate':
      return commandSimulate();
    default:
      usage();
  }
}

main().catch(error => {
  console.error(String(error?.stack ?? error));
  process.exit(1);
});
