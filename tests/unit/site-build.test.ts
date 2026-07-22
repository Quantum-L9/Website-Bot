// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { SiteAssemblerStage } from '../../src/stages/SiteAssemblerStage.js';
import { SiteBuildStage, type CommandResult, type CommandRunner } from '../../src/stages/SiteBuildStage.js';
import { distPathForRoute } from '../../src/validation/validate-generated-site.js';
import { cleanupContext, fixtureContext } from '../helpers/siteFactoryFixture.js';

class FakeRunner implements CommandRunner {
  commands: string[][] = [];
  constructor(private readonly routes: string[]) {}
  async run(command: string, args: string[], options: { cwd: string }): Promise<CommandResult> {
    this.commands.push([command, ...args]);
    if (command === 'npm' && args[0] === 'run' && args[1] === 'build') {
      for (const route of this.routes) {
        const path = join(options.cwd, 'dist', distPathForRoute(route));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, '<!doctype html><title>fixture</title>', 'utf-8');
      }
      writeFileSync(join(options.cwd, 'dist', 'sitemap-index.xml'), '<sitemapindex/>', 'utf-8');
    }
    return { stdout: command === 'npm' && args[0] === '--version' ? '10.9.2\n' : '', stderr: '', durationMs: 1 };
  }
}

void test('requires check and build before producing immutable local proof', async () => {
  const ctx = fixtureContext();
  const runner = new FakeRunner(ctx.domainSpec.routes.map(route => route.slug));
  try {
    await new SiteAssemblerStage().run(ctx);
    await new SiteBuildStage(runner).run(ctx);
    assert.deepEqual(runner.commands.slice(0, 3).map(command => command.slice(0, 3)), [
      ['npm', 'install', '--no-audit'],
      ['npm', 'run', 'check'],
      ['npm', 'run', 'build'],
    ]);
    assert.equal(ctx.buildProof?.status, 'passed');
    assert.equal(ctx.buildProof?.sourceDigest, ctx.assemblyManifest?.sourceDigest);
    assert.match(ctx.buildProof?.distDigest ?? '', /^[0-9a-f]{64}$/);
  } finally {
    cleanupContext(ctx);
  }
});
