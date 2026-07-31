# justfile - developer ergonomic wrapper around npm/Makefile commands.
# Makefile remains the canonical CI/operator surface.

default:
  just --list

install:
  npm ci

# ── Pipeline ── pass flags after the recipe, e.g. `just pipeline-local-proof --spec=<path> --build-id=<id>`
pipeline-plan *ARGS:
  npm run pipeline:plan -- {{ARGS}}

pipeline-local-proof *ARGS:
  npm run pipeline:local-proof -- {{ARGS}}

pipeline-publish-proof *ARGS:
  npm run pipeline:publish-proof -- {{ARGS}}

pipeline-end-to-end *ARGS:
  npm run pipeline:end-to-end -- {{ARGS}}

# ── Spec & provisioning ──
normalize-spec *ARGS:
  npm run normalize-spec -- {{ARGS}}

provision-plan *ARGS:
  npm run provision:plan -- {{ARGS}}

provision-client *ARGS:
  npm run provision:client -- {{ARGS}}

# ── Verification ──
verify:
  npm run verify:all

verify-launch-env:
  npm run verify:launch-env

verify-visual-qa:
  npm run verify:visual-qa

preflight:
  npm run verify:preflight

verify-build:
  npm run verify:build

verify-smoke:
  npm run verify:smoke

verify-form:
  npm run verify:form

verify-analytics:
  npm run verify:analytics

verify-crm:
  npm run verify:crm

verify-seo:
  npm run verify:seo

verify-rollback:
  npm run verify:rollback

# ── Tests & evidence ──
site-test:
  npm run site:test

evidence-validate *ARGS:
  npm run evidence:validate -- {{ARGS}}

evidence-show *ARGS:
  npm run evidence:show -- {{ARGS}}

clean:
  rm -rf dist .astro build/sites build/evidence
