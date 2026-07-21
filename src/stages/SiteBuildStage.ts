// L9_META: layer=stage, role=local_site_build_gate, stage_index=8, status=active, version=2.0.0
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import { writeStageCheckpoint } from '../pipeline/StageCheckpoint.js';
import type { BuildContext } from '../pipeline/BuildContext.js';
import type { BuildProof } from '../pipeline/evidence/BuildProof.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { recordToReference } from '../pipeline/evidence/EvidenceReference.js';
import { sha256Text } from '../pipeline/evidence/EvidenceCanonicalizer.js';
import { digestDirectory, isSourceDigestExcluded } from '../services/hashing.js';
import { distPathForRoute, refreshAssemblyManifest, safeChild } from '../validation/validate-generated-site.js';

const logger = createModuleLogger('stage:site-build');

export interface CommandResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CommandRunner {
  run(command: string, args: string[], options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<CommandResult>;
}

export class SpawnCommandRunner implements CommandRunner {
  async run(command: string, args: string[], options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<CommandResult> {
    return await new Promise((resolvePromise, reject) => {
      const started = Date.now();
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', chunk => { stdout += String(chunk); process.stdout.write(chunk); });
      child.stderr?.on('data', chunk => { stderr += String(chunk); process.stderr.write(chunk); });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }, options.timeoutMs);
      timer.unref();
      child.once('error', error => {
        clearTimeout(timer);
        reject(new BuildError('BUILD_FAILED', `${command} failed to start: ${error.message}`));
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        const durationMs = Date.now() - started;
        if (code === 0) resolvePromise({ stdout, stderr, durationMs });
        else reject(new BuildError('BUILD_FAILED', `${command} ${args.join(' ')} failed (code=${String(code)}, signal=${String(signal)})`, false, { stderr: stderr.slice(-2_000) }));
      });
    });
  }
}

export class SiteBuildStage implements Stage {
  name = 'site-build';
  version = '3.0.0';
  evidence = { inputs: (_ctx: BuildContext) => ['assembly' as const], outputs: (_ctx: BuildContext) => ['build' as const], resumable: true, externalMutation: false };

  constructor(
    private readonly runner: CommandRunner = new SpawnCommandRunner(),
    private readonly timeoutMs = Number(process.env.SITE_BUILD_TIMEOUT_MS ?? 900_000),
  ) {}

  async run(ctx: BuildContext): Promise<void> {
    if (ctx.dryRun) {
      logger.info({ outputDir: ctx.outputDir }, '[dry-run] Would install dependencies, run Astro check, and build');
      return;
    }
    const storedAssembly = await ctx.evidenceStore.readAssembly();
    if (!storedAssembly) throw new BuildError('EVIDENCE_ARTIFACT_MISSING', 'SiteBuildStage requires persisted assembly evidence');
    ctx.assemblyManifest = storedAssembly.value;
    const packagePath = join(ctx.outputDir, 'package.json');
    if (!existsSync(packagePath)) throw new BuildError('BUILD_FAILED', `Generated package.json not found in ${ctx.outputDir}`);
    try { JSON.parse(readFileSync(packagePath, 'utf-8')); }
    catch (error) { throw new BuildError('BUILD_FAILED', `Generated package.json is invalid: ${String(error)}`); }

    const ignoreScripts = process.env.SITE_BUILD_IGNORE_SCRIPTS === 'true';
    const common = ['--no-audit', '--no-fund'];
    if (ignoreScripts) common.push('--ignore-scripts');
    const lockExists = existsSync(join(ctx.outputDir, 'package-lock.json'));
    const installCommand = ['npm', lockExists ? 'ci' : 'install', ...common];
    const checkCommand = ['npm', 'run', 'check'];
    const buildCommand = ['npm', 'run', 'build'];
    const startedAt = new Date().toISOString();
    const environment = { ...process.env, CI: 'true', ASTRO_TELEMETRY_DISABLED: '1' };

    const installResult = await this.runner.run(installCommand[0], installCommand.slice(1), { cwd: ctx.outputDir, timeoutMs: this.timeoutMs, env: environment });
    const generatorVersion = ctx.assemblyManifest?.generatorVersion ?? 'Unknown';
    ctx.assemblyManifest = refreshAssemblyManifest(ctx.outputDir, ctx.buildId, ctx.clientId, generatorVersion, ctx.domainSpec.routes);
    ctx.assemblyManifest.generatedAt = new Date().toISOString();
    ctx.assemblyManifest.outputDir = ctx.outputDir;
    const assemblyRecord = await ctx.evidenceStore.writeAssembly(ctx.assemblyManifest);
    const checkResult = await this.runner.run(checkCommand[0], checkCommand.slice(1), { cwd: ctx.outputDir, timeoutMs: this.timeoutMs, env: environment });
    const buildResult = await this.runner.run(buildCommand[0], buildCommand.slice(1), { cwd: ctx.outputDir, timeoutMs: this.timeoutMs, env: environment });

    const distDir = join(ctx.outputDir, 'dist');
    if (!existsSync(distDir) || !statSync(distDir).isDirectory()) throw new BuildError('BUILD_FAILED', `Astro build completed without dist/: ${distDir}`);
    const builtRoutes: string[] = [];
    for (const route of ctx.domainSpec.routes) {
      const relativePath = distPathForRoute(route.slug);
      const absolutePath = safeChild(distDir, relativePath);
      if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        throw new BuildError('BUILD_FAILED', `Astro build is missing route output: ${relativePath}`);
      }
      builtRoutes.push(route.slug);
    }
    if (!existsSync(join(distDir, 'index.html'))) throw new BuildError('BUILD_FAILED', 'Astro dist/ has no HTML entrypoint');
    const sitemapPath = join(distDir, 'sitemap-index.xml');
    if (!existsSync(sitemapPath)) throw new BuildError('BUILD_FAILED', 'Astro dist/ is missing sitemap-index.xml');

    const source = digestDirectory(ctx.outputDir, { exclude: isSourceDigestExcluded });
    if (source.digest !== ctx.assemblyManifest.sourceDigest) {
      throw new BuildError('ASSEMBLY_PROOF_FAILED', 'Source digest does not match refreshed assembly manifest');
    }
    const dist = digestDirectory(distDir);
    const versionResult = await this.runner.run('npm', ['--version'], { cwd: ctx.outputDir, timeoutMs: 30_000, env: environment });
    const proof: BuildProof = {
      schema: 'website-bot.build-proof/v1',
      proofId: `build_${sha256Text(`${ctx.buildId}\0${source.digest}\0${dist.digest}`).slice(0, 32)}`,
      buildId: ctx.buildId,
      clientId: ctx.clientId,
      assemblyManifestSha256: assemblyRecord.sha256,
      sourceDir: ctx.outputDir,
      distDir,
      sourceDigest: source.digest,
      distDigest: dist.digest,
      packageManager: 'npm',
      packageManagerVersion: versionResult.stdout.trim() || 'Unknown',
      installCommand,
      checkCommand,
      buildCommand,
      checks: [
        { name: 'install', status: 'passed', durationMs: installResult.durationMs },
        { name: 'astro-check', status: 'passed', durationMs: checkResult.durationMs },
        { name: 'astro-build', status: 'passed', durationMs: buildResult.durationMs },
        { name: 'route-assertion', status: 'passed', durationMs: 0 },
        { name: 'sitemap-assertion', status: 'passed', durationMs: 0 },
      ],
      builtRoutes,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'passed',
    };
    const proofPath = join(ctx.outputDir, '.l9/build-proof.json');
    mkdirSync(dirname(proofPath), { recursive: true });
    writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf-8');
    ctx.distDir = distDir;
    ctx.buildProof = proof;
    const buildRecord = await ctx.evidenceStore.writeBuild(proof);
    await writeStageCheckpoint(ctx, {
      stage: this.name,
      inputEvidence: [recordToReference(assemblyRecord)],
      outputEvidence: [recordToReference(buildRecord)],
      inputDigest: assemblyRecord.sha256,
      outputDigest: buildRecord.sha256,
      status: 'passed', attempt: 1, startedAt, completedAt: new Date().toISOString(),
    });
    logger.info({ distDir, sourceDigest: source.digest, distDigest: dist.digest, routes: builtRoutes.length }, 'Astro local proof passed');
  }
}
