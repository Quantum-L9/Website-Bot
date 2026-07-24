<!-- L9_META: layer=documentation, role=tracked_file, status=active, version=1.0.0 -->
# Pending Workflow Updates

The automation credential used to open this PR does not have the `workflows` permission, so GitHub rejects pushes that create or modify files under `.github/workflows/`. The four workflow files for the complete site factory are staged here instead.

A maintainer with workflow permission should move them into place when merging (or in an immediate follow-up commit):

```bash
git mv .github/workflows-pending/build-and-validate.yml .github/workflows/build-and-validate.yml
git mv .github/workflows-pending/provision-and-build-client.yml .github/workflows/provision-and-build-client.yml
git mv .github/workflows-pending/site-factory-disposable-e2e.yml .github/workflows/site-factory-disposable-e2e.yml
git mv .github/workflows-pending/site-factory-local-proof.yml .github/workflows/site-factory-local-proof.yml
rmdir .github/workflows-pending 2>/dev/null || git rm .github/workflows-pending/README.md
```

| File | Kind | Purpose |
|------|------|---------|
| `build-and-validate.yml` | modified (replaces existing) | Adds the site-factory verification gates to the existing build-and-validate pipeline |
| `provision-and-build-client.yml` | new | Dispatch workflow: provision a client repo + Vercel project and run the factory (P-F) |
| `site-factory-disposable-e2e.yml` | new | Dispatch workflow: end-to-end proof against explicitly disposable GitHub/Vercel targets |
| `site-factory-local-proof.yml` | new | CI workflow: local-proof pipeline mode with no external providers |
