# ROOT_FILE_VALIDATION.md

## Result

Status: PASS_WITH_EXTERNAL_UNKNOWNS

## Inventory

- Repo root inspected: yes
- Root pack inspected: yes
- Files in final pack: 19
- Node/Astro project evidence: package.json, package-lock.json, astro.config.mjs, src/, public/
- Python tooling evidence: none

## Command Surface Check

- package.json scripts inspected: yes
- npm script references in root docs checked: yes
- missing npm script references: none
- Makefile and justfile semantics: non-conflicting
- pyproject.toml: skipped, not supported by repo evidence

## Dedupe Check

- duplicate root docs created: no
- deployment ownership: DEPLOYMENT.md
- operator procedure ownership: RUNBOOK.md
- validation policy ownership: VALIDATION.md
- AI-agent instruction ownership: AGENTS.md
- requirements/prerequisites remain in REQUIREMENTS.md when present in source repo, not duplicated into this root pack except summary references.

## Unsupported Claim Check

- fake badges: none
- fake contacts: none
- fake license: none
- fake production deployment claim: none
- fake form/CRM/analytics success claim: none
- secrets included: none

## Remaining Unknowns

- license choice
- support contact
- security contact
- final production domain verification
- real form endpoint
- AccuLynx credentials
- analytics provider/id
- Vercel project/org/token
- approved legal disclaimer
- public adjuster license number

## Validation Gates

| Gate | Status | Evidence |
|---|---|---|
| repo_root_inspected | PASS | package.json and Astro root files inspected |
| input_pack_inventory | PASS | final manifest generated from file bytes |
| no_duplicate_files | PASS | one canonical root file per responsibility |
| command_surface_aligned | PASS | npm script refs checked against package.json |
| env_contract_aligned | PASS | .env.example contains operator values without secrets |
| unsupported_claims_removed | PASS | Unknowns preserved |
| pyproject_skipped_correctly | PASS | no Python tooling evidence |
| zip_ready | PASS | final bundle generated separately |
