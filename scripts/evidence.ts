// L9_META: layer=cli, role=evidence_operator, status=active, version=1.0.0
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { FileEvidenceStore } from '../src/pipeline/evidence/FileEvidenceStore.js';
import type { ExecutionMode } from '../src/pipeline/BuildContext.js';

const argv = process.argv.slice(2);
const command = argv[0];
const valueOf = (name: string): string | undefined => argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const buildId = valueOf('build-id');
const clientId = valueOf('client-id');
const mode = (valueOf('mode') ?? 'end-to-end') as ExecutionMode;
const evidenceDir = valueOf('evidence-dir');
const json = flag('json');
const validCommands = ['show', 'validate', 'resume', 'repair-index', 'verify-external'];
const validModes: ExecutionMode[] = ['plan', 'local-proof', 'publish-proof', 'end-to-end'];

if (!validCommands.includes(command ?? '')) throw new Error(`command must be one of ${validCommands.join(', ')}`);
if (!buildId || !clientId) throw new Error('--build-id and --client-id are required');
if (!validModes.includes(mode)) throw new Error(`--mode must be one of ${validModes.join(', ')}`);
const rootDir = resolve(evidenceDir ?? `build/evidence/${clientId}/${buildId}`);
const store = new FileEvidenceStore({ rootDir, buildId, clientId, mode });

function print(value: unknown): void {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

if (command === 'show') {
  const index = await store.readIndex();
  print({ rootDir, index, checkpoints: existsSync(resolve(rootDir, 'checkpoints')) ? readdirSync(resolve(rootDir, 'checkpoints')).sort() : [] });
} else if (command === 'validate') {
  const validation = await store.validateChain(mode);
  print({ rootDir, validation });
  if (!validation.valid) process.exitCode = 1;
} else if (command === 'repair-index') {
  print({ rootDir, index: await store.repairIndex() });
} else if (command === 'verify-external') {
  const publication = await store.readPublication();
  const deployment = await store.readDeployment();
  const result = {
    rootDir,
    publication: publication ? { commitSha: publication.value.commitSha, repository: publication.value.repository, branch: publication.value.branch, referenceValid: await store.verifyReference({ kind: publication.record.kind, schema: publication.record.schema, logical_id: publication.record.logicalId, relative_path: publication.record.relativePath, sha256: publication.record.sha256 }) } : null,
    deployment: deployment ? { deploymentId: deployment.value.deploymentId, observedCommitSha: deployment.value.observedCommitSha, state: deployment.value.state, referenceValid: await store.verifyReference({ kind: deployment.record.kind, schema: deployment.record.schema, logical_id: deployment.record.logicalId, relative_path: deployment.record.relativePath, sha256: deployment.record.sha256 }) } : null,
    providerReverification: 'requires run-pipeline --resume with GitHub/Vercel credentials',
  };
  print(result);
  if (!publication || (mode === 'end-to-end' && !deployment)) process.exitCode = 1;
} else if (command === 'resume') {
  const from = valueOf('from');
  const spec = valueOf('spec') ?? 'examples/supplemental-insurance-pros/domain_spec.normalized.yaml';
  if (!from) throw new Error('resume requires --from=<stage|auto>');
  const ordered = [
    'domain-spec-loader', 'provision-client', 'unknown-resolver', 'design-intelligence', 'content-generation',
    'schema-generator', 'site-assembler', 'posthog-snippet', 'site-build', 'client-source-publish',
    'vercel-deploy', 'release-receipt', 'seo-baseline', 'visual-qa', 'release-receipt-finalizer', 'handoff-emitter',
  ];
  if (from !== 'auto' && !ordered.includes(from)) throw new Error(`unknown resume stage: ${from}`);
  const skipped = from === 'auto' ? [] : ordered.slice(0, ordered.indexOf(from));
  const args = [
    '--import', 'tsx', 'scripts/run-pipeline.ts', `--mode=${mode}`, '--resume', `--build-id=${buildId}`,
    `--evidence-dir=${rootDir}`, `--spec=${spec}`,
    ...(skipped.length ? [`--skip=${skipped.join(',')}`] : []),
  ];
  if (flag('auto-register-seo-bot')) args.push('--auto-register-seo-bot');
  if (flag('provision')) args.push('--provision');
  if (json) print({ command: process.execPath, args, rootDir });
  const result = spawnSync(process.execPath, args, { stdio: json ? ['ignore', 'inherit', 'inherit'] : 'inherit', env: process.env });
  process.exitCode = result.status ?? 1;
}
