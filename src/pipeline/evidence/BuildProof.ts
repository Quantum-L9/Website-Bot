// L9_META: layer=pipeline, role=local_build_proof_contract, status=active, version=2.1.0
export type BuildCheckName = 'install' | 'astro-check' | 'astro-build' | 'route-assertion' | 'sitemap-assertion';

export interface BuildProofCheck {
  name: BuildCheckName;
  status: 'passed';
  durationMs: number;
}

export interface BuildProof {
  schema: 'website-bot.build-proof/v1';
  proofId: string;
  buildId: string;
  clientId: string;
  assemblyManifestSha256: string;
  sourceDir: string;
  distDir: string;
  sourceDigest: string;
  distDigest: string;
  packageManager: 'npm';
  packageManagerVersion: string;
  installCommand: string[];
  checkCommand: string[];
  buildCommand: string[];
  checks: BuildProofCheck[];
  builtRoutes: string[];
  startedAt: string;
  completedAt: string;
  status: 'passed';
}

const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_CHECKS: BuildCheckName[] = ['install', 'astro-check', 'astro-build', 'route-assertion', 'sitemap-assertion'];

export function validateBuildProof(value: unknown): asserts value is BuildProof {
  if (!value || typeof value !== 'object') throw new Error('build proof must be an object');
  const proof = value as Partial<BuildProof>;
  if (proof.schema !== 'website-bot.build-proof/v1' || proof.status !== 'passed' || !proof.proofId || !proof.buildId || !proof.clientId) {
    throw new Error('build proof identity or status is invalid');
  }
  if (!SHA256.test(String(proof.assemblyManifestSha256)) || !SHA256.test(String(proof.sourceDigest)) || !SHA256.test(String(proof.distDigest))) {
    throw new Error('build proof digest is invalid');
  }
  if (proof.packageManager !== 'npm' || !proof.packageManagerVersion) throw new Error('build proof runtime is incomplete');
  for (const command of [proof.installCommand, proof.checkCommand, proof.buildCommand]) {
    if (!Array.isArray(command) || command.length < 2 || command.some(part => typeof part !== 'string' || !part)) {
      throw new Error('build proof command is invalid');
    }
  }
  if (!Array.isArray(proof.checks)) throw new Error('build proof checks are missing');
  const names = new Set(proof.checks.map(check => check.name));
  for (const required of REQUIRED_CHECKS) if (!names.has(required)) throw new Error(`build proof missing ${required}`);
  if (proof.checks.some(check => check.status !== 'passed' || !Number.isFinite(check.durationMs) || check.durationMs < 0)) {
    throw new Error('build proof check result is invalid');
  }
  if (!Array.isArray(proof.builtRoutes) || proof.builtRoutes.length === 0) throw new Error('build proof routes are missing');
  if (!proof.startedAt || Number.isNaN(Date.parse(proof.startedAt)) || !proof.completedAt || Number.isNaN(Date.parse(proof.completedAt))) {
    throw new Error('build proof timestamps are invalid');
  }
}
