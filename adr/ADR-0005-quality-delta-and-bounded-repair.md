<!-- L9_META: layer=architecture, role=quality_delta_adr, status=accepted, version=1.0.0 -->
# ADR-0005: Quality Delta Gate and Bounded Repair

## Status
Accepted.

## Date
2026-08-14

## Context
Successful compilation does not prove that a redesign improved the website.

## Decision
`REDESIGN_IMPROVE` must emit a QualityDeltaReport comparing the candidate against
BaselineSiteProfile.

Evaluation combines deterministic measurements with vision/reasoning only where
subjective comparison is required.

Required dimensions include at minimum:

- business-fact accuracy;
- route/content coverage;
- accessibility;
- responsive integrity;
- conversion clarity;
- visual hierarchy;
- visual coherence;
- SEO contract compliance.

No regression may be silent.

A material regression must result in:

- `REPAIR`
- `WAIVED_WITH_RECORDED_RATIONALE`
- `FAIL`

Automatic repair is bounded to **one** repair cycle by default.

Repair receives only failed dimensions and their evidence. It does **not** receive
authority to redesign unrelated passing areas.

A second failed evaluation stops the release.

## Consequences
The release criterion changes from "site builds" to "site builds, satisfies its
blueprints, and does not materially regress the baseline."

## Validation / Evidence
- Tests cover pass, bounded-repair, explicit-waiver, and terminal-failure paths.
- QualityDeltaReport is persisted with the release evidence.

## Related Artifacts
- BaselineSiteProfile, QualityDeltaReport (Website-Bot owned)
- `contracts/WEBSITE_INTELLIGENCE_LOCK.json` (`quality_delta` authority: Website-Bot)
