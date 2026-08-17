# Safe Haven Roofing & Renovations — Baseline Capture

**Target:** https://www.safehavenrr.com
**Captured:** 2026-08-16 (full crawl, Node undici client, 29/29 pages HTTP 200)
**Method:** independent crawler (`e2e-safehaven/scripts/baseline-crawl.mjs`), per-page HTML saved to
`e2e-safehaven/baseline/pages/`, machine-extracted inventory at `e2e-safehaven/baseline/inventory.json`.
Raw `robots.txt`, `sitemap-index.xml`, `sitemap-0.xml` also captured.

> Note: `curl` fails against this host (headers OK, zero body; exits 56/23) while Node
> fetch/undici succeeds. TLS-fingerprint-level blocking — recorded because the Website-Bot
> crawlers use undici and are unaffected.

## Content-Signal policy (reuse boundary)

`robots.txt` carries an explicit Content-Signal policy (Cloudflare managed):

- `search=yes` — search indexing permitted
- `ai-train=no` — **AI training explicitly forbidden**
- `use=reference` — AI systems may consume content for **reference**
- ClaudeBot, GPTBot, Google-Extended, CCBot, Bytespider, Amazonbot, Applebot-Extended, meta-externalagent: Disallow

**Test compliance:** this test only (a) extracts factual identity data (NAP, services, service
areas, routes) for reference use, and (b) generates original copy via the Website-Bot pipeline.
No verbatim marketing copy is reproduced, no content is used for training, no assets are
redistributed. Third-party photos on the target are NOT copied into the recreation (the
recreation uses pipeline-generated or explicitly labeled placeholder assets only).

## Page inventory (29 pages, = sitemap count, 0 missing)

| Group | Pages |
|---|---|
| Home | `/` |
| Services index | `/services/` |
| Service detail (12) | `/services/roof-replacement/`, `/roof-repair/`, `/roof-installation/`, `/roof-inspection/`, `/storm-damage/`, `/asphalt-shingles/`, `/metal-roofing/`, `/flat-roofing/`, `/gutters/`, `/siding-fascia-soffit/`, `/interior-renovations/`, `/outdoor-living/` |
| Service areas | `/service-areas/`, `/service-areas/charlotte/` (15 towns listed on index; only Charlotte has a dedicated page in the sitemap) |
| Insurance | `/insurance-claims/` |
| Guides (6) | repair-or-replace-roof, how-long-roof-replacement-takes, how-to-choose-roofing-contractor, metal-roof-vs-shingles, roof-replacement-cost, storm-damage-roof-repair (all `...-charlotte/`) |
| Company | `/about/`, `/gallery/`, `/faq/`, `/contact/`, `/privacy/` |

## Verified business facts (from on-page JSON-LD + visible content)

| Fact | Value | Source |
|---|---|---|
| Legal name | Safe Haven Roofing & Renovations | RoofingContractor schema |
| Phone | (704) 648-7252 / +17046487252 | schema + tel: links |
| Email | info@safehavenrr.com | schema + mailto: links |
| Locality | Charlotte, NC (no street address published) | schema address |
| Hours | Open 24/7 (Mo-Su 00:00-23:59) | schema + page copy |
| Service area | 15 NC towns: Charlotte, Gastonia, Belmont, Lake Wylie, Mount Holly, Huntersville, Lowell, Weddington, Matthews, Waxhaw, Ballantyne, Indian Trail, Mooresville, Concord, Pineville | schema areaServed + page copy |
| Brand signals | "Fully insured", "free inspections", "6 years local experience", GAF/CertainTeed/Atlas shingles, 5-year workmanship warranty + manufacturer warranties | page copy |
| Social profiles | tiktok.com/@safehaven_roofing, instagram.com/safehaven_roofing/, facebook (SafeHaven Roofing and Renovations) | schema sameAs |

## Functionality baseline

- **Quote/estimate form** on `/` and `/contact/`: 4-step wizard, 32 inputs — service needed,
  storm/insurance status, active leak, property type, roof age, roof material, timeline,
  optional photo upload (JPEG/PNG/HEIC, ≤10MB, ≤5 files), town, contact preference,
  consent checkbox (phone/text/email).
- FAQ accordion on `/faq/` (inspections, insurance, shingle brands, warranty) + FAQ blocks on service pages.
- Photo gallery (`/gallery/`), guides index with 6 articles, privacy policy page.

## Technical SEO baseline

| Metric | Result |
|---|---|
| All pages 200 | ✅ 29/29 |
| Titles present, unique, keyworded | ✅ all pages; e.g. "Roof Replacement in Charlotte, NC \| Safe Haven Roofing" |
| Meta descriptions | ✅ all pages, 87–199 chars |
| Canonical self-references | ✅ 29/29 |
| Single `<h1>` per page | ✅ 29/29 |
| `lang="en"` | ✅ all pages |
| Viewport meta | ✅ |
| Structured data | RoofingContractor sitewide (NAP, areaServed, sameAs, openingHours); FAQPage on /faq/; additional blocks on service/guide pages partially unparsed by crawler (recorded, not asserted) |
| Sitemap | ✅ sitemap-index.xml → sitemap-0.xml, 29 URLs, exact crawl parity |
| robots.txt | ✅ present with Content-Signal policy (see above) |
| Open Graph / Twitter cards | UNKNOWN (not asserted in this capture) |

## Accessibility / performance baseline (measured)

| Metric | Result |
|---|---|
| Images with alt text | 77/78 (98.7%) |
| Skip-to-content link | ❌ absent on home |
| Heading hierarchy | h1×1 all pages; h2/h3 present per page (full arrays in inventory.json) |
| Contrast / keyboard / focus | UNKNOWN (not machine-measured in this capture; target for the recreation's measured pass) |
| HTML weight | avg 26 KB/page (home 50 KB) |
| Scripts / stylesheets per page | 4–5 inline/script tags, 1 stylesheet link |
| Full asset weight / LCP / CLS / TBT | UNKNOWN (not measured on target; will be measured on both target and recreation with the same tooling in Phase 7) |

## Baseline quality gaps observed (candidate improvement targets)

1. No skip-to-content link (keyboard a11y).
2. Only 1 of 15 service-area towns has a dedicated landing page (thin local SEO coverage).
3. No OG/Twitter card verification performed on target (UNKNOWN — recreation will ship them and measure).
4. Sitemap URL was moved from `/sitemap.xml` to `/sitemap-index.xml` (fetches of the former return the app shell) — index correct in robots.txt.
5. Quote form is duplicated verbatim across `/` and `/contact/` (maintainability observation, not a defect).
