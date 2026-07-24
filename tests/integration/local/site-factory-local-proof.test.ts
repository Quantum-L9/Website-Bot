// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { SiteAssemblerStage } from '../../../src/stages/SiteAssemblerStage.js';
import { SiteBuildStage, type CommandResult, type CommandRunner } from '../../../src/stages/SiteBuildStage.js';
import { distPathForRoute } from '../../../src/validation/validate-generated-site.js';
import { cleanupContext, fixtureContext } from '../../helpers/siteFactoryFixture.js';

class LocalProofRunner implements CommandRunner {
  async run(command: string, args: string[], options: { cwd: string }): Promise<CommandResult> {
    if (command === 'npm' && args[0] === 'install') {
      // Real npm install creates a lockfile when the assembler emits only package.json.
      // Model that mutation so the integration test exercises manifest refresh semantics.
      writeFileSync(
        join(options.cwd, 'package-lock.json'),
        `${JSON.stringify({ name: 'fixture-client-site', lockfileVersion: 3, requires: true, packages: {} }, null, 2)}\n`,
        'utf-8',
      );
    }
    if (command === 'npm' && args.join(' ') === 'run build') {
      for (const route of ['/', '/services', '/contact']) {
        const output = join(options.cwd, 'dist', distPathForRoute(route));
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, '<!doctype html><html><body>built</body></html>', 'utf-8');
      }
      writeFileSync(join(options.cwd, 'dist', 'sitemap-index.xml'), '<sitemapindex/>', 'utf-8');
    }
    return { stdout: command === 'npm' && args[0] === '--version' ? '10.9.2\n' : '', stderr: '', durationMs: 1 };
  }
}

void test('P-B and P-C form one finalized local-proof transaction', async () => {
  const ctx = fixtureContext();
  try {
    await new SiteAssemblerStage().run(ctx);
    const preInstallDigest = ctx.assemblyManifest?.sourceDigest;

    await new SiteBuildStage(new LocalProofRunner()).run(ctx);

    assert.ok(preInstallDigest);
    assert.notEqual(ctx.assemblyManifest?.sourceDigest, preInstallDigest, 'lockfile creation must refresh the source digest');
    assert.equal(ctx.buildProof?.sourceDigest, ctx.assemblyManifest?.sourceDigest);
    assert.ok(ctx.assemblyManifest?.files.some(file => file.path === 'package-lock.json'));
    assert.deepEqual(ctx.buildProof?.builtRoutes, ['/', '/services', '/contact']);
  } finally {
    cleanupContext(ctx);
  }
});
