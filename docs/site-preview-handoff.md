# Local site preview and evidence handoff

One command builds a DomainSpec into a real Astro site on this machine, renders
every route in Chromium, keeps that run's output for inspection, and writes a
receipt that binds the exact input to the measured output. It reuses the native
validator (`scripts/validate-site-factory.ts --build`): `SiteAssemblerStage`,
`SiteBuildStage` (real `npm install`, `astro check`, `astro build`) and
`RenderedSiteValidationStage` (desktop 1440×900 and mobile 390×844). The wrapper
(`scripts/site-preview.mjs`) generates and renders nothing itself.

## What a preview is, and is not

A preview builds **deterministic test-supplied copy** (the validator's fixture
text) into the factory's template. It shows that this input assembles, compiles,
builds and renders cleanly on this machine.

It is **not** evidence of SEO-Bot or LLM content, a deployment, SEO approval, or
client-site or production readiness. Nothing is published: deploy/publish
options are refused, and deploy, provider and token environment variables are
withheld from the build (their names, never values, are listed in the receipt).

## Run it (no credentials)

Needs Node, network access for the generated site's `npm install`, and the
Playwright Chromium binary (`npx playwright install chromium` once). Using the
fictional WB-FACTORY-07 fixture:

```bash
node scripts/site-preview.mjs --spec=fixtures/wb-factory-07-editorial.yaml
```

It prints the receipt path, the built site, the screenshot folder and
`STATUS: PASS` (exit 0), `STATUS: FAIL` (exit 1; a FAIL receipt is still written)
or `STATUS: BLOCKED` (exit 2; invalid invocation, nothing ran). The spec must be
a `.yaml`/`.yml` file inside this repository.

## Inspect it

| What | Where |
|---|---|
| Receipt | `build/site-preview/<run-id>/receipt.json` |
| Validator log and raw result | `build/site-preview/<run-id>/validator.log`, `validation-result.json` |
| Generated Astro source | `build/validation/<client_id>/` |
| Built site | `build/validation/<client_id>/dist/` (open `index.html`, or serve the folder with any static server) |
| Browser report | `build/validation-evidence/<client_id>/<build_id>/rendered-site-validation.json` |
| Screenshots | `build/assets/<client_id>/<build_id>/renders/` |

All of it lives under the gitignored `build/` tree. A later preview of the same
`client_id` replaces `build/validation/<client_id>/`; evidence and screenshots
are kept per build id.

## The receipt

`website-bot.local-preview-receipt/v1` records:

- the input spec path and SHA-256, and the generator repository HEAD plus
  whether tracked files had uncommitted changes (`UNKNOWN` when git is
  unavailable; never guessed);
- the build id, client id and declared route set;
- the `install`, `astro-check`, `astro-build` and `route-assertion` verdicts,
  plus the source and dist digests from the build proof;
- the browser engine and version, viewports, the report path and SHA-256, and
  every route × viewport screenshot path with its SHA-256;
- `remote_deploy: NOT_INVOKED` and the withheld environment variable names.

`status` is `PASS` only when the validator succeeded and every one of these
re-verified against disk. Otherwise it is `FAIL`, with `problems` listing why.

## Re-verify a receipt later

```bash
node scripts/site-preview.mjs --verify=build/site-preview/<run-id>/receipt.json
```

This re-hashes the spec, the generated source, the built site, the report and
every screenshot. It fails if any is missing or changed, if a recorded digest
disagrees with the build proof, or if the receipt was not `PASS`. A receipt from
before a rebuild of the same client with different input therefore fails: it is
stale.

## Clean up

Delete `build/site-preview/`, `build/validation/<client_id>/`,
`build/validation-evidence/<client_id>/` and `build/assets/<client_id>/`.
Without the wrapper, `scripts/validate-site-factory.ts` removes only its own
run's site, evidence and screenshots when `KEEP_SITE_FACTORY_VALIDATION_OUTPUT`
is unset, and keeps all three when it is `true`. It never touches other clients'
or other runs' output.

## Acceptance scope

`tests/integration/local/wb-factory-08-preview.test.ts` (part of
`npm run site:test:local`) checks:

- a PASS receipt for a fictional spec;
- FAIL for a malformed spec, a missing Chromium, a tampered or missing built
  site, report or screenshot, a changed spec, a conflicting digest and a stale
  receipt;
- BLOCKED for a missing or out-of-repository spec and for deploy/publish
  options;
- that cleanup without KEEP leaves unrelated clients' output in place.
