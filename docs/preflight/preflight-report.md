# Preflight Report

- run_id: `10ea5271ce14`
- timestamp: 2026-07-16T01:42:36Z
- source_commit: `10ea5271ce14ddf2e0e87f87928cbcd763b09027`
- tool_version: 2.1.0
- overall_status: **blocked**
- blocker_count: **1**

## Genuine blockers

- **BLK-6-inaccessible_private_dependency-npm_install** [high] inaccessible_private_dependency — autofix 'npm_install' was applicable but failed: inaccessible_private_dependency

## Autofixes applied

- (none)

## Technical debt

- stale_or_duplicate_workflows: `.github/workflows/deploy-to-vercel.yml, .github/workflows/emit-handoff.yml`
- unpinned_actions: `.github/workflows/build-and-validate.yml`:18
- unpinned_actions: `.github/workflows/build-and-validate.yml`:21
- unpinned_actions: `.github/workflows/deploy-to-vercel.yml`:20
- unpinned_actions: `.github/workflows/deploy-to-vercel.yml`:23
- unpinned_actions: `.github/workflows/deploy-to-vercel.yml`:54
- unpinned_actions: `.github/workflows/emit-handoff.yml`:19
- unpinned_actions: `.github/workflows/emit-handoff.yml`:22
- unpinned_actions: `.github/workflows/emit-handoff.yml`:33
- unpinned_actions: `.github/workflows/emit-handoff.yml`:60
- unpinned_actions: `.github/workflows/regen-lockfile.yml`:26
- unpinned_actions: `.github/workflows/regen-lockfile.yml`:32
