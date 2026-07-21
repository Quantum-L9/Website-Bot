// L9_META: layer=stage, role=site_materializer, stage_index=6, status=active, version=2.0.0
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createModuleLogger } from '../core/logger.js';
import { BuildError } from '../pipeline/BuildError.js';
import { writeStageCheckpoint } from '../pipeline/StageCheckpoint.js';
import type { BuildContext, DeployTarget, SiteConfig } from '../pipeline/BuildContext.js';
import type { Stage } from '../pipeline/PipelineRunner.js';
import { recordToReference } from '../pipeline/evidence/EvidenceReference.js';
import {
  buildAssemblyManifest,
  normalizeComponentName,
  normalizeRouteSlug,
  normalizeSiteUrl,
  pagePathForRoute,
  safeChild,
  safePathSegment,
  validateRouteContracts,
  writeAssemblyManifest,
} from '../validation/validate-generated-site.js';

const logger = createModuleLogger('stage:site-assembler');
const json = (value: unknown) => JSON.stringify(value, null, 2);
const ASTRO_VERSION = '5.16.9';
const ASTRO_CHECK_VERSION = '0.9.4';
const ASTRO_SITEMAP_VERSION = '3.7.3';
const TYPESCRIPT_VERSION = '5.8.3';

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolveGeneratorVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version ? parsed.version : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

function normalizeHttpsUrl(value: unknown, field: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new BuildError('VALIDATION_FAILED', `${field} must be a valid URL`); }
  if (parsed.protocol !== 'https:') throw new BuildError('VALIDATION_FAILED', `${field} must use HTTPS`);
  return parsed.toString();
}

export class SiteAssemblerStage implements Stage {
  name = 'site-assembler';
  version = '3.0.0';
  evidence = { inputs: (_ctx: BuildContext) => [], outputs: (_ctx: BuildContext) => ['assembly' as const], resumable: true, externalMutation: false };

  async run(ctx: BuildContext): Promise<void> {
    this.validateInputs(ctx);
    const routeSlugs = validateRouteContracts(ctx.domainSpec.routes);
    const outputDir = this.resolveOutputDir(ctx);
    const siteConfig = this.buildSiteConfig(ctx, routeSlugs);
    ctx.siteConfig = siteConfig;
    ctx.deployTarget = this.resolveDeployTarget(ctx);

    if (ctx.dryRun) {
      logger.info({ outputDir, routes: routeSlugs.length }, '[dry-run] Would atomically materialize Astro project');
      return;
    }

    const temporaryParent = resolve(dirname(outputDir), '.tmp');
    mkdirSync(temporaryParent, { recursive: true });
    const temporaryRoot = mkdtempSync(join(temporaryParent, `${safePathSegment(ctx.buildId, 'buildId')}-`));
    const backupRoot = `${outputDir}.backup-${safePathSegment(ctx.buildId, 'buildId')}`;
    rmSync(backupRoot, { recursive: true, force: true });

    try {
      this.writeProject(temporaryRoot, ctx, siteConfig);
      const manifest = buildAssemblyManifest(
        temporaryRoot,
        ctx.buildId,
        ctx.clientId,
        resolveGeneratorVersion(),
        ctx.domainSpec.routes,
      );
      writeAssemblyManifest(temporaryRoot, manifest);

      mkdirSync(dirname(outputDir), { recursive: true });
      if (existsSync(outputDir)) renameSync(outputDir, backupRoot);
      try {
        renameSync(temporaryRoot, outputDir);
      } catch (error) {
        if (existsSync(backupRoot) && !existsSync(outputDir)) renameSync(backupRoot, outputDir);
        throw error;
      }
      rmSync(backupRoot, { recursive: true, force: true });
      manifest.generatedAt = new Date().toISOString();
      manifest.outputDir = outputDir;
      ctx.assemblyManifest = manifest;
      const assemblyRecord = await ctx.evidenceStore.writeAssembly(manifest);
      await writeStageCheckpoint(ctx, {
        stage: this.name,
        inputEvidence: [],
        outputEvidence: [recordToReference(assemblyRecord)],
        inputDigest: manifest.sourceDigest,
        outputDigest: assemblyRecord.sha256,
        status: 'passed',
        attempt: 1,
        startedAt: manifest.generatedAt,
        completedAt: new Date().toISOString(),
      });
      logger.info({ outputDir, routes: routeSlugs.length, sourceDigest: manifest.sourceDigest }, 'Astro site materialized');
    } catch (error) {
      rmSync(temporaryRoot, { recursive: true, force: true });
      if (error instanceof BuildError) throw error;
      throw new BuildError('SITE_ASSEMBLY_FAILED', `Unable to materialize Astro site: ${String(error)}`);
    }
  }

  private resolveOutputDir(ctx: BuildContext): string {
    safePathSegment(ctx.clientId, 'clientId');
    const configured = ctx.outputDir.trim() || join('build', 'sites', ctx.clientId);
    const resolved = resolve(configured);
    ctx.outputDir = resolved;
    return resolved;
  }

  private validateInputs(ctx: BuildContext): void {
    if (!ctx.domainSpec.business_name?.trim()) throw new BuildError('MISSING_INPUT', 'domainSpec.business_name is required');
    if (!ctx.domainSpec.client_id?.trim()) throw new BuildError('MISSING_INPUT', 'domainSpec.client_id is required');
    if (ctx.domainSpec.client_id !== ctx.clientId) {
      throw new BuildError('VALIDATION_FAILED', `BuildContext clientId (${ctx.clientId}) does not match DomainSpec (${ctx.domainSpec.client_id})`);
    }
    if (!ctx.domainSpec.geography?.primary_state || !Array.isArray(ctx.domainSpec.geography.states)) {
      throw new BuildError('MISSING_INPUT', 'domainSpec.geography is required');
    }
    if (!ctx.dryRun && !ctx.designTokens) throw new BuildError('MISSING_INPUT', 'Validated design tokens are required before site assembly');
    validateRouteContracts(ctx.domainSpec.routes);
    if (!ctx.dryRun) {
      for (const route of ctx.domainSpec.routes) {
        for (const component of route.components) {
          const normalized = normalizeComponentName(component);
          if (normalized === 'contact_form' && this.leadFormAction(ctx)) continue;
          if (this.lookupContent(ctx, route.slug, component) === undefined) {
            throw new BuildError('SITE_ASSEMBLY_FAILED', `Missing generated content for ${normalizeRouteSlug(route.slug)}:${component}`);
          }
        }
      }
    }
  }

  private buildSiteConfig(ctx: BuildContext, routeSlugs: string[]): SiteConfig {
    const seo = ctx.domainSpec.seo_contract ?? {};
    const rawSiteUrl = seo.site_url ?? process.env.SITE_URL;
    if (typeof rawSiteUrl !== 'string' || !rawSiteUrl.trim()) {
      throw new BuildError('MISSING_INPUT', 'seo_contract.site_url or SITE_URL is required for site assembly');
    }
    const siteUrl = normalizeSiteUrl(rawSiteUrl);
    const perRoute: Record<string, object[]> = Object.fromEntries(routeSlugs.map(slug => [slug, []]));
    const siteWide: object[] = [];
    for (const [key, schema] of ctx.generatedSchemas) {
      if (key === 'FAQPage') {
        const faqRoute = ctx.domainSpec.routes.find(route => normalizeComponentName(route.components.join('_')).includes('faq'))
          ?? ctx.domainSpec.routes.find(route => normalizeRouteSlug(route.slug) === '/faq');
        if (faqRoute) perRoute[normalizeRouteSlug(faqRoute.slug)].push(schema);
        else siteWide.push(schema);
      } else {
        siteWide.push(schema);
      }
    }

    return {
      businessName: ctx.domainSpec.business_name,
      siteUrl,
      vertical: ctx.domainSpec.vertical,
      clientId: ctx.clientId,
      namespace: slugify(ctx.clientId) || 'client',
      geography: {
        primaryState: ctx.domainSpec.geography.primary_state,
        states: [...ctx.domainSpec.geography.states],
      },
      nav: ctx.domainSpec.routes
        .filter(route => !route.noindex)
        .map(route => ({ href: normalizeRouteSlug(route.slug), label: route.title })),
      schemas: { siteWide, perRoute },
      designTokens: ctx.designTokens ?? {},
      leadFormAction: this.leadFormAction(ctx),
    };
  }

  private leadFormAction(ctx: BuildContext): string | undefined {
    return normalizeHttpsUrl(ctx.domainSpec.seo_contract?.lead_form_action, 'seo_contract.lead_form_action');
  }

  private resolveDeployTarget(ctx: BuildContext): DeployTarget | undefined {
    const deploy = ctx.domainSpec.deploy;
    const githubRepo = deploy?.github_repo ?? process.env.CLIENT_GITHUB_REPO;
    if (!githubRepo) return undefined;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) {
      throw new BuildError('VALIDATION_FAILED', `Invalid GitHub repository name: ${githubRepo}`);
    }
    const sourceBranch = deploy?.source_branch ?? process.env.CLIENT_SOURCE_BRANCH ?? 'main';
    if (!/^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,255}$/.test(sourceBranch)) {
      throw new BuildError('VALIDATION_FAILED', `Invalid source branch: ${sourceBranch}`);
    }
    return {
      githubRepo,
      githubRepoId: deploy?.github_repo_id ?? process.env.CLIENT_GITHUB_REPO_ID,
      sourceBranch,
      publishCredentialRef:
        deploy?.publish_credential_ref
        ?? process.env.CLIENT_GITHUB_PUBLISH_CREDENTIAL_REF
        ?? 'env://GITHUB_SITE_TOKEN',
      vercelProjectId: deploy?.vercel_project_id ?? process.env.CLIENT_VERCEL_PROJECT_ID,
      vercelDeployHook: normalizeHttpsUrl(
        deploy?.vercel_deploy_hook ?? process.env.CLIENT_VERCEL_DEPLOY_HOOK,
        'deploy.vercel_deploy_hook',
      ),
      seoBotGithubCredentialRef:
        deploy?.seo_bot_github_credential_ref
        ?? process.env.SEO_BOT_SITE_GITHUB_CREDENTIAL_REF
        ?? 'env://SEO_BOT_SITE_GITHUB_TOKEN',
      seoBotVercelDeployHookRef:
        deploy?.seo_bot_vercel_deploy_hook_ref
        ?? process.env.SEO_BOT_SITE_VERCEL_HOOK_REF,
    };
  }

  private lookupContent(ctx: BuildContext, routeSlug: string, component: string): string | undefined {
    const normalizedSlug = normalizeRouteSlug(routeSlug);
    const normalizedComponent = normalizeComponentName(component);
    const candidates = [
      `${routeSlug}:${component}`,
      `${routeSlug}:${normalizedComponent}`,
      `${normalizedSlug}:${component}`,
      `${normalizedSlug}:${normalizedComponent}`,
    ];
    for (const key of candidates) {
      const value = ctx.generatedContent.get(key);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  private writeProject(root: string, ctx: BuildContext, config: SiteConfig): void {
    const write = (path: string, content: string): void => {
      const target = safeChild(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf-8');
    };

    write('package.json', `${json({
      name: `${config.namespace}-site`,
      private: true,
      version: '1.0.0',
      type: 'module',
      engines: { node: '>=20.3.0' },
      scripts: { check: 'astro check', build: 'astro build' },
      dependencies: {
        '@astrojs/check': ASTRO_CHECK_VERSION,
        '@astrojs/sitemap': ASTRO_SITEMAP_VERSION,
        astro: ASTRO_VERSION,
        typescript: TYPESCRIPT_VERSION,
      },
    })}\n`);
    write('astro.config.mjs', `import { defineConfig } from 'astro/config';\nimport sitemap from '@astrojs/sitemap';\n\nexport default defineConfig({\n  site: ${json(config.siteUrl)},\n  output: 'static',\n  integrations: [sitemap()],\n});\n`);
    write('tsconfig.json', `${json({ extends: 'astro/tsconfigs/strict' })}\n`);
    write('vercel.json', `${json({ framework: 'astro', buildCommand: 'npm run build', outputDirectory: 'dist' })}\n`);
    write('src/lib/siteConfig.ts', `export const siteConfig = ${json(config)} as const;\n`);

    const tokens = config.designTokens;
    const cleanFont = (value: string | undefined, fallback: string) => `'${(value ?? fallback).replace(/["'\\;]/g, '')}', sans-serif`;
    write('src/styles/tokens.css', `:root {\n  --color-primary: ${tokens.primary ?? '#17324d'};\n  --color-secondary: ${tokens.secondary ?? '#eef4f8'};\n  --color-accent: ${tokens.accent ?? '#1677ff'};\n  --color-background: ${tokens.background ?? '#ffffff'};\n  --color-text: ${tokens.text ?? '#17212b'};\n  --font-heading: ${cleanFont(tokens.font_heading, 'Inter')};\n  --font-body: ${cleanFont(tokens.font_body, 'Inter')};\n}\n`);
    write('src/styles/global.css', `@import './tokens.css';\n* { box-sizing: border-box; }\nhtml { color-scheme: light; }\nbody { margin: 0; font-family: var(--font-body); color: var(--color-text); background: var(--color-background); line-height: 1.6; }\na { color: var(--color-primary); }\nheader, footer, main { width: min(1100px, calc(100% - 2rem)); margin-inline: auto; }\nnav { display: flex; flex-wrap: wrap; gap: 1rem; padding: 1rem 0; }\nsection { padding: 3rem 0; }\nh1, h2, h3 { font-family: var(--font-heading); line-height: 1.2; }\n.btn { display: inline-block; padding: .8rem 1.1rem; background: var(--color-primary); color: white; border: 0; border-radius: .4rem; cursor: pointer; }\nform { display: grid; gap: 1rem; max-width: 32rem; }\nlabel { display: grid; gap: .35rem; }\ninput, textarea { padding: .75rem; font: inherit; }\n`);
    write('src/layouts/BaseLayout.astro', `---\nimport { siteConfig } from '../lib/siteConfig';\nimport '../styles/global.css';\ninterface Props { title: string; description: string; noindex?: boolean; routeSchemas?: readonly object[]; }\nconst { title, description, noindex = false, routeSchemas = [] } = Astro.props;\nconst schemas = [...siteConfig.schemas.siteWide, ...routeSchemas];\nconst jsonLd = schemas.map(schema => JSON.stringify(schema).replace(/</g, '\\\\u003c'));\n---\n<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>{title}</title>\n    <meta name="description" content={description} />\n    {noindex && <meta name="robots" content="noindex,nofollow" />}\n    {jsonLd.map(value => <script is:inline type="application/ld+json" set:html={value} />)}\n  </head>\n  <body>\n    <header><nav aria-label="Primary">{siteConfig.nav.map(item => <a href={item.href}>{item.label}</a>)}</nav></header>\n    <main><slot /></main>\n    <footer><p>© {new Date().getFullYear()} {siteConfig.businessName}</p></footer>\n  </body>\n</html>\n`);
    write('src/components/Section.astro', `---\ninterface Props { name: string; content: string; }\nconst { name, content } = Astro.props;\nconst heading = name.replaceAll('_', ' ').replace(/\\b\\w/g, character => character.toUpperCase());\nconst paragraphs = content.split(/\\n{2,}/).map(value => value.trim()).filter(Boolean);\n---\n<section data-section={name}>\n  <h2>{heading}</h2>\n  {paragraphs.map(paragraph => <p>{paragraph}</p>)}\n</section>\n`);
    if (config.leadFormAction) {
      write('src/components/LeadForm.astro', `---\nimport { siteConfig } from '../lib/siteConfig';\nif (!siteConfig.leadFormAction) throw new Error('Lead form action is not configured');\n---\n<form method="post" action={siteConfig.leadFormAction} data-lead-form>\n  <label>Name <input name="name" autocomplete="name" required /></label>\n  <label>Email <input type="email" name="email" autocomplete="email" required /></label>\n  <label>Message <textarea name="message" rows="5" required></textarea></label>\n  <button class="btn" type="submit" data-cta>Submit</button>\n</form>\n`);
    }
    write('public/robots.txt', `User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}/sitemap-index.xml\n`);

    for (const route of ctx.domainSpec.routes) {
      const slug = normalizeRouteSlug(route.slug);
      const pagePath = pagePathForRoute(slug);
      const pageDirectoryDepth = slug === '/' ? 1 : slug.split('/').filter(Boolean).length + 1;
      const prefix = '../'.repeat(pageDirectoryDepth);
      const normalizedComponents = route.components.map(normalizeComponentName);
      const hasConfiguredLeadForm = normalizedComponents.includes('contact_form') && Boolean(config.leadFormAction);
      const imports = [
        `import BaseLayout from '${prefix}layouts/BaseLayout.astro';`,
        `import Section from '${prefix}components/Section.astro';`,
        hasConfiguredLeadForm ? `import LeadForm from '${prefix}components/LeadForm.astro';` : '',
      ].filter(Boolean).join('\n');
      const sectionData = route.components.map(component => {
        const normalizedComponent = normalizeComponentName(component);
        if (normalizedComponent === 'contact_form' && hasConfiguredLeadForm) {
          return { kind: 'lead-form' as const, name: normalizedComponent };
        }
        const content = this.lookupContent(ctx, route.slug, component);
        if (content === undefined) throw new BuildError('SITE_ASSEMBLY_FAILED', `Missing generated content for ${slug}:${component}`);
        return { kind: 'content' as const, name: normalizedComponent, content };
      });
      const routeSchemas = config.schemas.perRoute[slug] ?? [];
      const renderedSections = hasConfiguredLeadForm
        ? `{sections.map(section => section.kind === 'lead-form'\n    ? <LeadForm />\n    : <Section name={section.name} content={section.content} />)}`
        : `{sections.map(section => <Section name={section.name} content={section.content} />)}`;
      write(pagePath, `---\n${imports}\nconst sections = ${json(sectionData)} as const;\nconst routeSchemas: readonly object[] = ${json(routeSchemas)};\n---\n<BaseLayout title={${json(route.title)}} description={${json(`${route.title} | ${ctx.domainSpec.business_name}`)}} noindex={${Boolean(route.noindex)}} routeSchemas={routeSchemas}>\n  ${renderedSections}\n</BaseLayout>\n`);
    }
  }
}
