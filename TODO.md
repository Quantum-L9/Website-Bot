# TODO — Deferred / externally-gated work

Tracked items that are intentionally **not** done yet because they depend on an
external precondition (not on more code). Each lists the exact trigger that
unblocks it.

---

## P4b — Wrap the pipeline in `infisical run` (CLI secrets baseline)

**Status:** deferred — not built, because it can't be verified until the
Infisical setup exists and would only red the pipeline before then.

**Plan:** replace the per-secret `env:` blocks in `deploy-to-vercel.yml`,
`emit-handoff.yml`, and `build-site.yml` with:
- an Infisical CLI install step (confirm the current package name),
- machine-identity auth
  (`infisical login --method=universal-auth --client-id=… --client-secret=… --plain --silent`),
- wrapping the run as
  `infisical run --projectId "$INFISICAL_PROJECT_ID" --env prod -- npx tsx scripts/run-pipeline.ts …`
  (dry-run job uses `--env test`),
- reducing each `env:` block to the 3 bootstrap vars
  (`INFISICAL_CLIENT_ID` / `_SECRET` / `_PROJECT_ID`) plus non-secret
  `CLIENT_ID` / `NODE_ENV` and `NODE_AUTH_TOKEN` (still needed for the
  `@quantum-l9` npm scope during `npm ci`).

> **Confirm the exact CLI flags against the pinned Infisical CLI version** — the
> invocation above is the documented shape, but flags/behavior must be validated
> against the real (pinned) CLI before this ships.

**Unblock trigger (all required):**
1. the Infisical project exists (`terraform apply` from the `infra` repo),
2. its secret **values** are populated in Infisical,
3. the 3 `INFISICAL_*` bootstrap vars are set as this repo's Actions secrets.

Build it as a **draft** and flip it ready once the above are true.

---

## Build the core factory capability — design → build → deploy client sites

> 📋 **Living decision:** [`docs/architecture/ADR-0007-per-client-factory-topology.md`](docs/architecture/ADR-0007-per-client-factory-topology.md)
> (source plan archived at [`docs/archive/factory-upgrade-build-plan.md`](docs/archive/factory-upgrade-build-plan.md)).
> Evidence chain: [`ADR-0016`](docs/architecture/ADR-0016-release-evidence-spine.md).

**This is the repo's purpose, not optional feature work.** `Quantum-L9/Website-Bot`
is meant to **design, build, and deploy** Astro websites for many clients from a
DomainSpec (then `Quantum-L9/SEO-Bot` grows each deployed site's SEO + Domain
Authority). The client-agnostic factory spine (template, assembler, local
`astro build` gate, per-client publish/deploy, evidence chain) is in tree.
Remaining operator-gated work:

1. **Per-client provisioning (P-F).** Automate GitHub repo + Vercel project +
   secrets for a new client. Build/deploy still assume a pre-provisioned
   `deployTarget` (ADR-0007).
2. **Reference-client launch values.** The bundled SIP spec still blocks
   production deploy on unresolved compliance placeholders (see below).

> Note: `ARCHITECTURE.md` previously described this repo as "a generated site, not
> the factory" — that was stale; corrected to reflect the factory purpose.

## Related — production deploy is currently gated (by design, not a bug)

`deploy-to-vercel.yml` runs the pipeline against the bundled reference client's
flat spec (`examples/supplemental-insurance-pros/domain_spec.normalized.yaml`).
It correctly **blocks at `UnknownResolverStage`** on the 4 `error`-severity
compliance flags:

- `authority.license_number`
- `compliance.public_adjuster_disclaimer`
- `compliance.no_guarantee_disclaimer`
- `compliance.not_legal_advice_disclaimer`

**To green the production deploy:** supply the real public-adjuster license
number and the 3 approved legal disclaimer texts in
`examples/supplemental-insurance-pros/domain_spec.source.yaml`, then regenerate
the flat spec (`npm run normalize-spec`). The normalizer drops those error flags
only once the underlying `{{…PLACEHOLDER}}` tokens are resolved, so the deploy
proceeds past the launch gate.

---

## Related (other repo)

- **SEO-Bot** deferred items (multi-tenant enable-flip; P4a Infisical loader):
  see `TODO.md` in `Quantum-L9/SEO-Bot`.

Both P4a and P4b are downstream of the **handoff pushes** (`infra` +
`infisical-config` repos).
