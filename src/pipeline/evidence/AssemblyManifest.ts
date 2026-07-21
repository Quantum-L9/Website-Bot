// L9_META: layer=pipeline, role=assembly_evidence_contract, status=active, version=2.1.0
import { sha256Text } from './EvidenceCanonicalizer.js';

export interface AssemblyManifestFile {
  path: string;
  sha256: string;
  owner: 'website-bot';
  bytes: number;
}

export interface AssemblyManifest {
  schema: 'website-bot.assembly-manifest/v1';
  buildId: string;
  clientId: string;
  generatorVersion: string;
  routes: string[];
  files: AssemblyManifestFile[];
  sourceDigest: string;
  generatedAt?: string;
  outputDir?: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function computeAssemblySourceDigest(files: AssemblyManifestFile[]): string {
  const lines = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(file => `${file.path}\0${file.sha256}\0${file.bytes}\n`)
    .join('');
  return sha256Text(lines);
}

export function validateAssemblyManifest(value: unknown): asserts value is AssemblyManifest {
  if (!value || typeof value !== 'object') throw new Error('assembly manifest must be an object');
  const manifest = value as Partial<AssemblyManifest>;
  if (manifest.schema !== 'website-bot.assembly-manifest/v1' || !manifest.buildId || !manifest.clientId || !manifest.generatorVersion) {
    throw new Error('assembly manifest identity is invalid');
  }
  if (!Array.isArray(manifest.routes) || manifest.routes.length === 0 || manifest.routes.some(route => typeof route !== 'string')) {
    throw new Error('assembly manifest routes are invalid');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('assembly manifest files are missing');
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!file.path || file.path.startsWith('/') || file.path.split('/').some(part => part === '..' || part === '.')) {
      throw new Error(`unsafe assembly path: ${file.path}`);
    }
    if (paths.has(file.path)) throw new Error(`duplicate assembly path: ${file.path}`);
    paths.add(file.path);
    if (!SHA256.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0 || file.owner !== 'website-bot') {
      throw new Error(`invalid assembly file: ${file.path}`);
    }
  }
  if (!SHA256.test(String(manifest.sourceDigest))) throw new Error('assembly source digest is invalid');
  if (computeAssemblySourceDigest(manifest.files) !== manifest.sourceDigest) throw new Error('assembly source digest does not match files');
  if (manifest.generatedAt && Number.isNaN(Date.parse(manifest.generatedAt))) throw new Error('assembly generatedAt is invalid');
}
