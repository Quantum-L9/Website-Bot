# Route Drift Analysis — §3 Case Authority

**Date:** 2026-08-18 · **Source:** https://www.safehavenrr.com
**Evidence:** `evidence/route-drift-frozen-vs-source.json`, `evidence/route-probe-corrected-case.json`

## Finding

The frozen route inventory supplied in `case.json` **never matched the Safe Haven source
site** — not on 2026-08-18, and not at the 2026-08-16 baseline-capture time the case itself
cites as its authority. This is not drift after capture; it is an inventory that was wrong
when written.

## Evidence

Both sets contain exactly 29 routes. Only 18 intersect.

| Measure | Value |
|---|---|
| Frozen routes (supplied `case.json`) | 29 |
| Real source routes (2026-08-16 capture) | 29 |
| Intersection | **18** |
| In frozen, absent from source | **11** |
| In source, absent from frozen | **11** |
| Redirects reconciling the difference | **0** |

Live probe of the supplied frozen routes: **18 × HTTP 200, 11 × HTTP 404, 0 redirects.**

### The 11 mismatched routes

| Supplied (404 on live) | Real source (HTTP 200) |
|---|---|
| `/roof-repair/` | `/services/roof-repair/` |
| `/roof-installation/` | `/services/roof-installation/` |
| `/roof-inspection/` | `/services/roof-inspection/` |
| `/storm-damage/` | `/services/storm-damage/` |
| `/asphalt-shingles/` | `/services/asphalt-shingles/` |
| `/metal-roofing/` | `/services/metal-roofing/` |
| `/flat-roofing/` | `/services/flat-roofing/` |
| `/gutters/` | `/services/gutters/` |
| `/siding-fascia-soffit/` | `/services/siding-fascia-soffit/` |
| `/interior-renovations/` | `/services/interior-renovations/` |
| `/outdoor-living/` | `/services/outdoor-living/` |

### Corroboration

The frozen baseline captured on 2026-08-16
(`docs/reports_and_test_results/08-15-2026/baseline/pages/`) contains
`_services_roof-repair_.html`, `_services_storm-damage_.html`, and the other nine under
`/services/`. The captured baseline agrees with the live site and disagrees with `case.json`.

## Impact on the visual oracle

`/storm-damage/` is one of the five **visual sentinel** routes (§17) and does not exist on the
source. Its baseline capture was therefore impossible, making the 10-pair visual oracle
required by §17/§20 unsatisfiable as supplied — independent of any product quality.

## Resolution

Per §3 the frozen case was **not** silently mutated. The finding was reported; the operator
authorized correction on 2026-08-18.

Applied: the 11 service routes re-pointed to `/services/<slug>/`, and the visual sentinel
`/storm-damage/` → `/services/storm-damage/`. Route order and sentinel criticality preserved.
The correction is recorded inside the case file under `baseline.route_inventory_correction`
with reason, evidence, and explicit mapping — auditable rather than silent.

### Post-correction verification

| Check | Result |
|---|---|
| Route count | 29, all unique |
| Set equality vs real source inventory | **exact match** |
| Live probe, all 29 routes | **29 × HTTP 200, 0 redirects** |
| Non-route fields changed vs supplied case | **none** |
| Sentinel criticality preserved | yes |
| `oracle.json` critical pairs still resolvable | yes |

**`SAFE_HAVEN_BASELINE_ROUTE_DRIFT` — cleared.**

No semantic requirement was weakened: route count, donor requirements, lineage requirements,
repair limits, visual thresholds, and critical routes are untouched.
