// L9_META: layer=validation, role=generated_site_validator, status=active, version=1.0.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, normalize, resolve, sep } from 'path';
import { BuildError } from '../pipeline/BuildError.js';
import type { AssemblyManifest } from '../pipeline/evidence/AssemblyManifest.js';
import { digestDirectory, isSourceDigestExcluded, normalizeRelativePath } from '../services/hashing.js';

export interface RouteContract {
  slug: string;
  title: string;
  components: string[];
  noindex?: boolean;
}

const REQUIRED_FILES = [
  'package.json',
  'astro.config.mjs',
  'tsconfig.json',
  'vercel.json',
  'public/robots.txt',
  'src/layouts/BaseLayout.astro',
  'src/lib/siteConfig.ts',
  'src/styles/global.css',
  'src/styles/tokens.css',
];

const UNRESOLVED_MARKERS = [
  /\{\{\s*[A-Za-z_][A-Za-z0-9_.-]*\s*\}\}/,
  /__PLACEHOLDER__/,
  /<%[=-]?/,
  /REPLACE_ME/,
];

export function safePathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new BuildError('VALIDATION_FAILED', `${label} must be a safe path segment: ${JSON.stringify(value)}`);
  }
  return trimmed;
}

export function normalizeRouteSlug(slug: string): string {
  if (slug === '/') return '/';
  if (!slug.startsWith('/') || slug.includes('\\') || slug.includes('\0') || slug.includes('?') || slug.includes('#') || slug.split('/').some(part => part === '.' || part === '..')) {
    throw new BuildError('VALIDATION_FAILED', `Invalid route slug: ${JSON.stringify(slug)}`);
  }
  const normalized = normalize(slug).replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some(part => part === '.' || part === '..' || !/^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(part))) {
    throw new BuildError('VALIDATION_FAILED', `Unsafe route slug: ${JSON.stringify(slug)}`);
  }
  return `/${parts.join('/')}`;
}

export function normalizeComponentName(component: string): string {
  const normalized = component.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalized) throw new BuildError('VALIDATION_FAILED', `Invalid component name: ${JSON.stringify(component)}`);
  return normalized;
}

export function normalizeSiteUrl(value: string): string {
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try { parsed = new URL(candidate); }
  catch { throw new BuildError('VALIDATION_FAILED', `Invalid site URL: ${value}`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BuildError('VALIDATION_FAILED', `Unsupported site URL protocol: ${parsed.protocol}`);
  }
  if (!parsed.hostname) throw new BuildError('VALIDATION_FAILED', `Site URL is missing a hostname: ${value}`);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

export function safeChild(root: string, relativePath: string): string {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, relativePath);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) {
    throw new BuildError('SITE_ASSEMBLY_FAILED', `Generated path escaped output directory: ${relativePath}`);
  }
  return candidate;
}

export function pagePathForRoute(slug: string): string {
  const normalized = normalizeRouteSlug(slug);
  return normalized === '/' ? 'src/pages/index.astro' : `src/pages${normalized}/index.astro`;
}

export function distPathForRoute(slug: string): string {
  const normalized = normalizeRouteSlug(slug);
  return normalized === '/' ? 'index.html' : `${normalized.slice(1)}/index.html`;
}

export function validateRouteContracts(routes: RouteContract[]): string[] {
  if (routes.length === 0) throw new BuildError('MISSING_INPUT', 'domainSpec.routes must contain at least one route');
  const seen = new Set<string>();
  return routes.map((route, index) => {
    const slug = normalizeRouteSlug(route.slug);
    if (seen.has(slug)) throw new BuildError('VALIDATION_FAILED', `Duplicate normalized route slug: ${slug}`);
    seen.add(slug);
    if (!route.title.trim()) throw new BuildError('VALIDATION_FAILED', `routes[${index}].title must be non-empty`);
    if (!Array.isArray(route.components)) throw new BuildError('VALIDATION_FAILED', `routes[${index}].components must be an array`);
    route.components.forEach(normalizeComponentName);
    return slug;
  });
}

export function validateGeneratedSite(root: string, routes: RouteContract[]): void {
  const absoluteRoot = resolve(root);
  for (const relativePath of REQUIRED_FILES) {
    if (!existsSync(safeChild(absoluteRoot, relativePath))) {
      throw new BuildError('SITE_ASSEMBLY_FAILED', `Generated site is missing required file: ${relativePath}`);
    }
  }
  const normalizedRoutes = validateRouteContracts(routes);
  for (const slug of normalizedRoutes) {
    const pagePath = pagePathForRoute(slug);
    if (!existsSync(safeChild(absoluteRoot, pagePath))) {
      throw new BuildError('SITE_ASSEMBLY_FAILED', `Generated site is missing route page: ${pagePath}`);
    }
  }

  const digest = digestDirectory(absoluteRoot, { exclude: isSourceDigestExcluded });
  for (const file of digest.files) {
    if (!/\.(?:astro|css|html|js|json|mjs|ts|txt)$/i.test(file.path)) continue;
    const text = readFileSync(safeChild(absoluteRoot, file.path), 'utf-8');
    const marker = UNRESOLVED_MARKERS.find(pattern => pattern.test(text));
    if (marker) throw new BuildError('SITE_ASSEMBLY_FAILED', `Unresolved template marker in ${file.path}: ${String(marker)}`);
  }
}

export function buildAssemblyManifest(
  root: string,
  buildId: string,
  clientId: string,
  generatorVersion: string,
  routes: RouteContract[],
): AssemblyManifest {
  validateGeneratedSite(root, routes);
  const digest = digestDirectory(root, { exclude: isSourceDigestExcluded });
  return {
    schema: 'website-bot.assembly-manifest/v1',
    buildId,
    clientId,
    generatorVersion,
    routes: routes.map(route => normalizeRouteSlug(route.slug)),
    files: digest.files.map(file => ({ ...file, owner: 'website-bot' as const })),
    sourceDigest: digest.digest,
  };
}

export function writeAssemblyManifest(root: string, manifest: AssemblyManifest): string {
  const path = safeChild(root, '.l9/assembly-manifest.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  return path;
}

export function readAssemblyManifest(root: string): AssemblyManifest {
  const path = safeChild(root, '.l9/assembly-manifest.json');
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf-8')); }
  catch (error) { throw new BuildError('ASSEMBLY_PROOF_FAILED', `Cannot read assembly manifest: ${String(error)}`); }
  if (!parsed || typeof parsed !== 'object' || (parsed as { schema?: unknown }).schema !== 'website-bot.assembly-manifest/v1') {
    throw new BuildError('ASSEMBLY_PROOF_FAILED', 'Assembly manifest schema is invalid');
  }
  return parsed as AssemblyManifest;
}

export function refreshAssemblyManifest(
  root: string,
  buildId: string,
  clientId: string,
  generatorVersion: string,
  routes: RouteContract[],
): AssemblyManifest {
  const manifest = buildAssemblyManifest(root, buildId, clientId, generatorVersion, routes);
  writeAssemblyManifest(root, manifest);
  return manifest;
}

export function normalizeManagedPath(path: string): string {
  const normalized = normalizeRelativePath(path);
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '..' || part === '.')) {
    throw new BuildError('SOURCE_PUBLISH_FAILED', `Unsafe managed path: ${JSON.stringify(path)}`);
  }
  return normalized;
}
