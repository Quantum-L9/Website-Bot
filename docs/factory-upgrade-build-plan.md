# L9 Website Factory — Upgrade Build Plan (design → build → deploy)

## Context

`Quantum-L9/Website-Bot` is meant to **design, build, and deploy** Astro
lead-generation websites for many clients from a `DomainSpec`; `Quantum-L9/SEO-Bot`
then maintains each deployed site to grow its SEO + Domain Authority. A prior
refactor (merged: PRs #33/#34/#35) made the factory **client-agnostic** — the one
client now lives under `examples/supplemental-insurance-pros/` and
`src/`/`scripts/`/`config/`/workflows are spec-driven.

**But the factory does not actually build sites yet.** Audit of the current code
(`main`) found the generate→build→deploy spine is a hollow shell:

- `ContentGenerationStage` writes `ctx.generatedContent: Map<string,string>`
  (keyed `` `${slug}:${component}` ``) that **no stage reads**; `SchemaGeneratorStage`'s
  objects are dropped (only keys survive). Content dies in memory.
- There is **no Astro project at the build root** (no `src/pages`, no `astro.config`,
  no `astro` dependency). Stages write orphan files to CWD-relative paths
  (`DesignIntelligenceStage`→`src/styles/tokens.css`; `PostHogSnippetStage`→
  `src/layouts/Layout.astro`, which **doesn't exist** → no-ops or throws).
- `VercelDeployStage` deploys via `gitSource:{github, repoId: GITHUB_REPO_ID}` into a
  single `VERCEL_PROJECT_ID` — Vercel rebuilds *this repo* (no site) into one shared
  project. It **uploads nothing**; a second client would overwrite the same site.
- `HandoffEmitterStage`→SEO-Bot `POST /api/clients/register` **omits `site_deployment`**,
  and SEO-Bot's `siteConfigFromClient` forces **dry-run forever** for handoff-registered
  clients → SEO-Bot can never maintain them.
- The only real site (`examples/…/astro_site/`) is 9 hand-authored `.astro` pages with
  hardcoded identity and no data-driven rendering; `spec.routes[].components[]`
  (hero, process, compliance_note, cta…) are documentation, not build instructions.
- **No per-client repo/Vercel-project provisioning exists** in either repo.

**Intended outcome:** a working factory where a `DomainSpec` → generated design
tokens + per-route/section content + JSON-LD → a **materialized Astro site** (from a
client-neutral `astro_template/` filled with a generated `siteConfig` + content) →
`astro build` gate → **deployed to that client's own Vercel project/repo** → registered
to SEO-Bot **with a populated `site_deployment`** so SEO-Bot maintains it at repo-root
`src/pages/<route>/index.astro`.

---

## Architecture decisions (recommended — flag any to change before build)

| Decision | Recommendation | Rationale |
|---|---|---|
| **Repo topology** | **One GitHub repo per client site** (the client repo is the site's source of truth) | SEO-Bot's entire maintenance transport (`site-deployment.ts`, per-client `websiteBotRepo`/`vercelDeployHook`, `urlToFilePath`) assumes an editable per-client repo Vercel builds. A factory-owned output dir gives SEO-Bot nothing to edit. |
| **Deploy mechanism** | **Push the materialized Astro *source* to the client repo, then deploy that client's Vercel project** (deploy hook / `v13` git-source). Local `astro build` stays a fail-fast gate, not the deploy artifact. | The deploy artifact and SEO-Bot's maintenance artifact must be the **same** editable file tree; a prebuilt `dist/` upload would deploy HTML SEO-Bot can't edit. |
| **Content rendering** | **Data-driven section components looping `route.components[]`** | `generatedContent` is already keyed `slug:component`; a component→section registry is the only thing that turns `components[]` from docs into build instructions and generalizes across clients. |
| **Page-path shape** | **Assembler emits dir-per-route `src/pages/<route>/index.astro`** (home = `src/pages/index.astro`) | Converges to SEO-Bot's `urlToFilePath` (the maintenance contract wired into many action handlers) — a one-place generator fix vs. touching SEO-Bot. |
| **Provisioning** | **Assume pre-provisioned (repo+project+secrets passed in) for build/deploy; automate provisioning last (P-F)** | Keeps the design→build→deploy spine shippable and testable before the orthogonal repo/project-creation machinery. |

**Resulting artifact identity:** per client, the single source of truth is its GitHub
repo containing a materialized Astro project (`astro_template/` + generated
`src/lib/siteConfig.ts` + generated `src/pages/<route>/index.astro`). Website-Bot writes
it initially; SEO-Bot edits it thereafter; Vercel builds it on every push.

---

## BuildContext additions (`src/pipeline/BuildContext.ts`)

```ts
outputDir: string                    // per-build materialized site root: build/sites/<clientId>/  (P-B)
designTokens?: Record<string,string> // set by DesignIntelligence instead of the orphan CSS write   (P-B)
siteConfig?: SiteConfig              // assembled identity/nav/schemas/leadForm/tokens               (P-B)
distDir?: string                     // outputDir/dist after astro build                              (P-C)
deployTarget?: { githubRepo: string; vercelProjectId?: string; vercelDeployHook?: string; sourceBranch: string } // (P-D)
```

`outputDir = build/sites/${clientId}` (git-ignored via `build/`, already in `.gitignore`).
`makeBuildId` unchanged.

---

## Phased plan (each phase independently shippable + dry-run safe)

### P-A — Extract client-neutral `astro_template/` (+ siteConfig, section components, data-driven pages)
**Goal:** a parameterized Astro project that builds from a `siteConfig` object with zero hardcoded client identity. Pure additive scaffold — no `src/` pipeline changes.

Add new top-level `astro_template/`:
- `package.json` (`astro` + `@astrojs/sitemap`), `astro.config.mjs` (`site` per-client), `tsconfig.json`.
- `src/lib/siteConfig.ts` — exported `SiteConfig` interface + placeholder default (assembler overwrites per build): `businessName, siteUrl, vertical, clientId, namespace (replaces the hardcoded 'sip_' prefix), geography{primaryState,states[]}, contact{phone,email,address}, nav[], seo{titlePattern,descriptionPattern,defaultDescription}, leadForm{provider,states,fields[]}, compliance{disclaimers[]}, schemas{siteWide[],perRoute{}}, designTokens`.
- `src/layouts/BaseLayout.astro` — the example `BaseLayout.astro` structure, but every literal (name, `areaServed`, nav, JSON-LD, footer contact, `sip_` namespace) reads from `siteConfig`; injects `siteConfig.schemas.siteWide` as JSON-LD; keeps `PUBLIC_*` env fallbacks; retains a `</head>` anchor for PostHog.
- `src/components/sections/*.astro` — section library, each `{content, route, siteConfig}`, using existing CSS classes (`hero, container, card, grid two, btn, eyebrow, field, notice, nav`): `Hero`, `TrustBar`, `Process`, `AudiencePaths`, `ServiceArea`, `CtaBanner` (`cta`/`final_cta`), `ComplianceNote` (`compliance_note`/`disclaimer`), `Faq` (renders `siteConfig.schemas.perRoute[slug]` FAQPage), `Confirmation`, `ProseSection` (generic fallback — renders generated text as **text**, not markup).
- `src/components/SectionRegistry.ts` — component-name → section-component map, `default: ProseSection`.
- `src/components/LeadForm.astro` — data-driven: iterate `siteConfig.leadForm.fields` (from the 14-field `website_object_model.yaml lead_capture_contract`); provider/states/namespace from `siteConfig`.
- `src/styles/global.css` (from example), `public/robots.txt` (templated `Sitemap:` line).

Reference fixture: `examples/supplemental-insurance-pros/astro_site/` validates the template.
**Verify:** hand-fill `siteConfig.ts` with SIP values → `npm i && astro build` in a copy → 9 dir-per-route pages + `sitemap-index.xml`, no hardcoded-identity leakage.

### P-B — `SiteAssemblerStage` (materialize) + wire design tokens + fix PostHog target
**Goal:** `domainSpec + generatedContent + generatedSchemas + designTokens` → a filled Astro project in `ctx.outputDir`.

- **BuildContext:** add `outputDir`, `designTokens`, `siteConfig`; set `ctx.outputDir` in `run-pipeline.ts` bootstrap.
- **`DesignIntelligenceStage`:** set `ctx.designTokens` instead of writing the orphan `src/styles/tokens.css`; **also** populate `ctx.designTokens` from `domainSpec.design.palette/fonts` on the `status==='resolved'` early-return so resolved specs aren't token-less.
- **`PostHogSnippetStage`:** change `LAYOUT_PATH` → `${ctx.outputDir}/src/layouts/BaseLayout.astro` and **move it after the assembler** so the file exists.
- **New `SiteAssemblerStage`** (`name: site-assembler`), slot **index 6** (between SchemaGenerator(5) and PostHog). Render algorithm:
  1. Build `siteConfig` from `domainSpec` (name/vertical/geography), `seo_contract` (site_url/keywords/patterns), resolved `wom_flags`/`PUBLIC_*` env (contact), `ctx.designTokens`, `lead_capture_contract` (form fields), `ctx.generatedSchemas` split into `siteWide` (Organization/LocalBusiness/ServiceArea) vs `perRoute` (FAQPage→`/faq`). `namespace = slugify(clientId)`; `nav = routes.filter(!noindex).map({href:slug,label:title})`.
  2. Copy `astro_template/` → `ctx.outputDir`; write `src/lib/siteConfig.ts`, `src/styles/tokens.css` (from `designTokens`), `public/robots.txt`; set `astro.config.mjs` `site` = `siteConfig.siteUrl`.
  3. Per `route`: `pagePath = slug==='/' ? 'src/pages/index.astro' : \`src/pages${slug}/index.astro\`` (dir-per-route). For each `component` of `route.components`: `text = generatedContent.get(\`${slug}:${component}\`) ?? ''`; `Section = SectionRegistry[component] ?? ProseSection`. Emit a page importing `BaseLayout`+`siteConfig`+deduped sections/`LeadForm`, wrapping `<BaseLayout title description path noindex>` around the ordered `<Section content route siteConfig />` list; `contact_form` → `<LeadForm>`.
  4. Empty required-component text → non-blocking `CONTENT_VALIDATION_FAILED`-class warning (partial builds still render).

**Verify:** `--dry-run` logs planned files; a real run yields `build/sites/<clientId>/src/pages/{index,about,faq,contact,...}/index.astro` + `siteConfig.ts` with no `sip_`/hardcoded strings.

### P-C — `SiteBuildStage` (local `astro build` gate) + `BUILD_FAILED`
**Goal:** compile the materialized project; fail fast before deploy.
- Add `'BUILD_FAILED'` to `BuildErrorCode` (`src/pipeline/BuildError.ts`).
- **New `SiteBuildStage`** (`name: site-build`), slot after PostHog, before VercelDeploy: dry-run skips; else `npm ci` + `astro build` in `ctx.outputDir` (child process), throw `BuildError('BUILD_FAILED')` on non-zero; set `ctx.distDir`. Reuse the example `scripts/verify-build.mjs` heuristics (page-count/sitemap) as a post-build assertion.

**Verify:** `dist/` has one `index.html` per route + `sitemap-index.xml`; a deliberately broken section → `BUILD_FAILED`.

### P-D — Deploy to the client's own Vercel/repo (per-client resolution)
**Goal:** publish to *that client's* project, not the shared one.
- Deploy-target resolution: extend `DomainSpec` with an optional `deploy` block (`github_repo`, `vercel_project_id`, `vercel_deploy_hook`, `source_branch`) or resolve from env keyed by `clientId`; set `ctx.deployTarget`.
- **Rework `VercelDeployStage`:** push `ctx.outputDir` source (exclude `dist/`,`node_modules/`) to `deployTarget.githubRepo@source_branch` via the GitHub Git/Contents API (**mirror SEO-Bot's `GitHubContentClient` PUT pattern** so both write identically); trigger deploy via `deployTarget.vercelDeployHook` or `v13/deployments` with the client repo id + `deployTarget.vercelProjectId`; keep the READY/ERROR poll loop + `ctx.deploymentUrl`. Retire the `GITHUB_REPO_ID = this repo` coupling.
- **Workflows** (`build-site.yml`, `deploy-to-vercel.yml`): replace the single `vars.VERCEL_PROJECT_ID`/`github.event.repository.id` with per-client resolution; retire `deploy-to-vercel.yml`'s `push→main`=deploy model for multi-client.

**Verify:** a throwaway client repo + test Vercel project deploys and serves the generated pages at a live URL.

### P-E — Persist `site_deployment` on registration + reconcile page paths
**Goal:** SEO-Bot can maintain the handoff-registered client live.
- **SEO-Bot** `src/contracts/website_factory_v2.ts` — add optional `site_deployment: z.object({githubToken,vercelDeployHook,websiteBotRepo,sourceBranch}).partial().optional()`. `src/api/clients/register.ts buildClientConfig()` — persist `site_deployment` (matches `siteConfigFromClient`'s read shape).
- **Website-Bot** `HandoffEmitterStage` — add `site_deployment` to the registration payload from `ctx.deployTarget` + a repo-scoped `SEO_BOT_SITE_TOKEN`; keep non-blocking.
- Page-path shape already reconciled by P-B (dir-per-route matches `urlToFilePath`).

**Verify:** run handoff against a local SEO-Bot → `clients.config.site_deployment` populated and `siteConfigFromClient(config).dryRun === false`; drive one `meta_title_update` → PUTs to `src/pages/<route>/index.astro` in the client repo.

### P-F — Per-client provisioning + onboarding automation
**Goal:** onboard a new client from a spec with no manual repo/project setup.
- New `scripts/provision-client.ts` (or flag-gated `ProvisioningStage`): idempotently create the client GitHub repo (seed from `astro_template/`), create/link a Vercel project + deploy hook, set required env/secrets, write the resolved `deploy` block back to the spec.
- Wire onboarding: spec authored → `provision-client` → `build-site.yml` dispatch → build→deploy→register; `build-site.yml` optionally provisions when `deployTarget` is absent.

**Verify:** end-to-end from a brand-new spec: repo+project created, site deployed, client registered with live maintenance enabled.

---

## Final stage order

```
1 domain-spec-loader   2 unknown-resolver   3 design-intelligence (→ ctx.designTokens)
4 content-generation   5 schema-generator   6 site-assembler  (NEW)
7 posthog-snippet (→ outputDir/BaseLayout)  8 site-build (NEW → BUILD_FAILED)
9 vercel-deploy (reworked: client repo + project)   10 seo-baseline
11 visual-qa           12 handoff-emitter (+ site_deployment)
```

## Critical files
- `Website-Bot/src/pipeline/BuildContext.ts` — add `outputDir`, `designTokens`, `siteConfig`, `distDir`, `deployTarget`.
- `Website-Bot/scripts/run-pipeline.ts` — register `SiteAssembler` + `SiteBuild`, reorder, set `outputDir`.
- `Website-Bot/src/stages/DesignIntelligenceStage.ts`, `PostHogSnippetStage.ts` — write to ctx/outputDir, fix layout target.
- `Website-Bot/src/stages/VercelDeployStage.ts` — per-client repo push + project deploy.
- `Website-Bot/src/stages/HandoffEmitterStage.ts` — emit `site_deployment`.
- `SEO-Bot/src/api/clients/register.ts` + `SEO-Bot/src/contracts/website_factory_v2.ts` — persist `site_deployment`.
- New: `Website-Bot/astro_template/` (P-A); `Website-Bot/src/stages/SiteAssemblerStage.ts`, `SiteBuildStage.ts`.

## Reused utilities
- `ctx.generatedContent`/`generatedSchemas` maps as-is (no key change).
- `BuildError` + `recoverable` semantics; `createModuleLogger`; `yaml`/`fs`.
- SEO-Bot `GitHubContentClient` (PUT pattern) as the reference for the reworked deploy push.
- Example site's CSS, sitemap integration, and `scripts/verify-*.mjs` verifiers as the acceptance harness.

## Risks / sequencing / deferred
- **Sequencing:** P-A→P-B→P-C are internal, mergeable without touching prod (default spec still dry-runs). **P-D + P-E must land together** (a live client repo without persisted `site_deployment` is maintainable-blind; persisted `site_deployment` pointing at a nonexistent repo is a dead hook). P-F last.
- **Risks:** (a) `astro build` needs a per-build network install → cache/vendor. (b) LLM `generatedContent` is plain text → sections must render it as text (XSS/markup-injection), mirroring `DesignIntelligenceStage`'s existing hardening. (c) prefer the explicit deploy-hook/`v13` deploy+poll over push-then-git-build timing. (d) `namespace = slugify(client_id)` (already unique). (e) the `site_deployment.githubToken` handed to SEO-Bot must be repo-scoped to that client only.
- **Deferred:** per-route schema application (spec `schema_application: per_route` stays informational — honor opportunistically); local `astro preview` VisualQA; AccuLynx phase-2 CRM wiring; Infisical secret consolidation (tracked in `TODO.md`); per-client provisioning stays P-F.

## End-to-end verification
1. **Dry run:** `npx tsx scripts/run-pipeline.ts --spec=examples/supplemental-insurance-pros/domain_spec.normalized.yaml --dry-run` — every stage logs its planned action, no writes/network, exit 0.
2. **Real single-client build** to a throwaway repo + test Vercel project with `deployTarget` set: `build/sites/<clientId>/dist` has one HTML per route + sitemap; the client repo received the source; the Vercel URL serves generated home/contact/faq with correct JSON-LD and no `sip_`/hardcoded identity; SEO-Bot has the client with populated `config.site_deployment`; one SEO-Bot maintenance action edits `src/pages/<route>/index.astro` in the client repo and redeploys.
