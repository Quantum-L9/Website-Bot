# Safe Haven Recreation — Improvement Report

**Baseline:** safehavenrr.com captured 2026-08-16 (29 pages, see SAFEHAVEN_BASELINE.md)
**Recreation:** Website-Bot pipeline (local-proof) output `build/sites/safehavenrr/dist`
**Rule:** every improvement claim is tied to a before/after measurement or a verified defect fix; nothing is claimed from visual judgment.

## 1. Defect-driven fixes (each fixes a verified E2E failure)

| Fix | Defect | Before | After | Evidence |
|---|---|---|---|---|
| Gallery array typing | F-04: text-only builds failed `astro check` (TS2339 ×4 on `never[]`) | pipeline failed at site-build | pipeline completes; 248/248 repo tests | pipeline-run2.log exit 0; astro-template-contract.test.ts |
| Footer route sitemap | F-10: 19/29 built pages orphaned (unreachable) | 10 reachable pages | **29/29 reachable** (0 orphans) | recrawl of pass-3 build: crawl size 29 = dist HTML count |
| Skip link | baseline target and recreation both lacked keyboard skip navigation | absent on target AND recreation | present on every page (`Skip to content` → `#main-content`) | dist HTML grep; astro-template-contract.test.ts |
| Biome symlink sweep | F-01: lint swept `~/.cursor-governance` via `.cursor-commands` symlink | 1667 files checked, 957 errors | 290 files checked, 463 errors (pure in-repo debt remains, operator-owned) | biome-lint-baseline.txt vs post-fix run |

## 2. Measured target-vs-recreation deltas

| Metric | Target (baseline) | Recreation pass 3 | Delta |
|---|---|---|---|
| Pages | 29 | 29 | parity |
| Pages reachable from the site | 29 | 29 (was 10 pre-fix) | parity after fix |
| Single h1 per page | 29/29 | 29/29 | parity |
| Meta description present | 29/29 | 29/29 | parity |
| Canonical present | 29/29 | 29/29 (self-referencing) | parity |
| lang="en" | all | all | parity |
| HTML weight (avg/page) | ~26 KB | ~18 KB | −31% |
| Total HTML site weight | ~754 KB (HTML only) | 533 KB | −29% |
| External CSS/JS requests | 1 stylesheet + 4–5 scripts per page | 0 external (inlined) | fewer requests |
| JSON-LD on home | RoofingContractor | Organization + LocalBusiness + Service + BreadcrumbList | richer structured data |
| Form rendered + wired | 4-step wizard (32 inputs) on / and /contact | simple lead form (name/email/message) on all form routes, posting to labeled test endpoint | structure simplified (see §5) |
| Skip-to-content link | absent | present | +1 a11y |
| Internal links on home | ~30 | 39 (nav + footer sitemap) | +30% |
| Alt-text coverage | 77/78 (98.7%) | n/a (0 images in pass 3) | — |
| Images | 78 | 0 (text-only pass) | see §3 |

## 3. Imagery pass (pass 4 — generated assets only)

The target's photos are third-party assets **not authorized for redistribution**
(robots.txt `use=reference`, `ai-train=no`). The improvement pass therefore enables
**pipeline-generated original imagery** via `assets.generation` (gemini-2.5-flash-image,
budget $2.00, no source-site downloads):

- `hero-home` (16:9, 2K) — homepage hero
- `og-image` (16:9, 2K) — Open Graph social preview
- `logo` (1:1, 1K) — header logo mark

Measured outcomes (pass 4, build safehavenrr-1786876188151):

- images on site: 0 → **3 generated images** (hero-home.png, logo.png, og-image.png; 3,014 KB total; Gemini 2.5-flash-image via the pipeline's image generation stage, logged in pipeline-run4.log)
- `og:image` + `twitter:card` meta: absent → **present** on every page
- logo: absent → **rendered in header** with alt text (2/2 imgs on home have alt)
- reachability held: 29/29 pages reachable (footer sitemap unaffected)

## 4. Engineering-quality improvements (repository-level, regression-tested)

- 2 new Website-Bot regression tests (248 passing), 3 new SEO-Bot regression
  tests (236 passing). All suites green post-fix.
- Commits (local-only, no push per execution authority):
  - Website-Bot `c88d1c5` on branch `e2e/safehaven-validation`
  - SEO-Bot clone `9eccc06` on branch `e2e/safehaven-validation`

## 5. Documented limitations (NOT presented as production content)

- **Lead form endpoint** is `https://httpbin.org/post` — a labeled TEST-ONLY inert
  endpoint. The target posts to its own `/api/quote`; the production endpoint is an
  operator-owned value (UNKNOWN) and must be replaced before any real launch.
  Form structure is simplified (name/email/message) vs the target's 4-step wizard —
  recreating the full wizard requires custom template components (out of scope).
- **Service-area towns**: the target has 1 town landing page (/service-areas/charlotte)
  in its sitemap; the recreation matches that inventory exactly (29 pages = sitemap).
- **Content-accuracy note**: LLM-generated copy includes marketing phrasing not
  grounded in the spec (e.g. "decades of combined experience" vs the source's "6 years
  of local experience"). The DomainSpec has no business-facts field for such claims;
  grounding copy in verified facts is the designed role of the SEO-Bot intelligence
  artifacts (SEOContentBlueprint business_facts), which the Website-Bot pipeline does
  not consume yet (F-12 in E2E_FAILURES.yaml). Recorded, not fixed — the seam is the
  intended next integration workstream.
- **Title/keyword richness**: route titles come from the crawl; nav labels reuse them,
  so very long keyworded titles would degrade nav usability. Title-vs-label decoupling
  is a template improvement candidate (recorded, not implemented).
