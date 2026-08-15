<!-- L9_META: layer=architecture, role=factory_topology_adr, status=accepted, version=1.0.0 -->
# ADR-0007: Per-Client Factory Topology

## Status
Accepted.

## Date
2026-08-14

## Context
Website-Bot must design, build, and deploy Astro sites for many clients from a
`DomainSpec`. A shared factory repo cannot be the site source of truth: SEO-Bot
maintenance (`websiteBotRepo`, `urlToFilePath`, deploy hooks) edits an
per-client tree that Vercel builds. Uploading `dist/` would publish HTML
SEO-Bot cannot maintain. Writing orphan files into this repo's CWD would
overwrite one shared project.

## Decision
1. **One GitHub repo per client site.** That repo is the site's source of truth.
   Website-Bot writes it initially; SEO-Bot edits it thereafter; Vercel builds
   it on every push.
2. **Deploy the materialized Astro source**, not `dist/`. Local `astro build`
   is a fail-fast gate (`SiteBuildStage` / `BUILD_FAILED`), not the deploy
   artifact. Publication pushes `ctx.outputDir` (excluding `dist/` and
   `node_modules/`) to the client repo, then deploys that client's Vercel
   project.
3. **Data-driven pages.** `route.components[]` plus `generatedContent` keyed
   `${slug}:${component}` drive a section registry. Unknown components fall
   back to `ProseSection`, which renders generated text as text, not markup.
4. **Dir-per-route paths.** Assembler emits `src/pages/<route>/index.astro`
   (home = `src/pages/index.astro`) so SEO-Bot `urlToFilePath` stays unchanged.
5. **Client-neutral `astro_template/`.** Identity lives in generated
   `siteConfig`. No hardcoded client strings in the template.
6. **Per-build output.** `ctx.outputDir = build/sites/<clientId>` (gitignored
   under `build/`). Design tokens stay on `BuildContext`; `PostHogSnippetStage`
   writes `outputDir/src/layouts/BaseLayout.astro` after assembly.
7. **Provisioning is last.** Build/deploy assume a pre-provisioned repo,
   project, and secrets (`ctx.deployTarget`). Automated repo/project creation
   is P-F and is not required for the spine.

Handoff to SEO-Bot includes `site_deployment` from `ctx.deployTarget` so
maintenance is not forced into dry-run.

## Consequences
- A second client cannot share this factory repo or one `VERCEL_PROJECT_ID`.
- `site_deployment` and the live client repo must land together; a hook to a
  missing repo is dead, and a live repo without `site_deployment` is
  maintainable-blind.
- Generated section text is never interpreted as HTML.
- Per-client provisioning remains deferred (see `TODO.md`).

## Related Artifacts
- `astro_template/`
- `src/stages/SiteAssemblerStage.ts`, `SiteBuildStage.ts`,
  `ClientSourcePublishStage.ts`, `VercelDeployStage.ts`, `HandoffEmitterStage.ts`
- `src/pipeline/BuildContext.ts` (`outputDir`, `designTokens`, `siteConfig`,
  `deployTarget`)
- Archived source: `docs/archive/factory-upgrade-build-plan.md`
