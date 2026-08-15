SHELL := /bin/sh
.DEFAULT_GOAL := help

.PHONY: help install \
        pipeline-plan pipeline-local-proof pipeline-publish-proof pipeline-end-to-end \
        generate-spec normalize-spec provision-plan provision-client \
        verify verify-all verify-preflight verify-source verify-build verify-smoke \
        verify-form verify-analytics verify-crm verify-seo verify-rollback \
        verify-launch-env verify-visual-qa \
        site-test site-test-local evidence-validate evidence-show clean pr push

help:
	@printf '%s\n' 'L9 Website Factory Bot — command surface'
	@printf '%s\n' ''
	@printf '%s\n' '── Setup ──'
	@printf '%-30s %s\n' 'make install' 'Install dependencies (npm ci)'
	@printf '%s\n' ''
	@printf '%s\n' '── Pipeline (DomainSpec → site) ──'
	@printf '%-30s %s\n' 'make pipeline-plan' 'Dry-run: converge all stages, no files/mutations (no keys)'
	@printf '%-30s %s\n' 'make pipeline-local-proof' 'Materialize + Astro build a site locally (needs provider keys)'
	@printf '%-30s %s\n' 'make pipeline-publish-proof' 'Local proof + publish source to the client GitHub repo'
	@printf '%-30s %s\n' 'make pipeline-end-to-end' 'Full run: build, publish, Vercel deploy, SEO handoff'
	@printf '%s\n' '  (pass a spec: make pipeline-local-proof ARGS="--spec=<path> --build-id=<id>")'
	@printf '%s\n' ''
	@printf '%s\n' '── Spec & provisioning ──'
	@printf '%-30s %s\n' 'make generate-spec' 'Generate a flat DomainSpec from a target URL (crawl + LLM)'
	@printf '%-30s %s\n' 'make normalize-spec' 'Normalize a rich source spec into the flat DomainSpec'
	@printf '%-30s %s\n' 'make provision-plan' 'Plan client repo/Vercel provisioning (no mutation)'
	@printf '%-30s %s\n' 'make provision-client' 'Provision the client GitHub repo and Vercel project'
	@printf '%s\n' ''
	@printf '%s\n' '── Verification ──'
	@printf '%-30s %s\n' 'make verify-all' 'Full offline gate (typecheck, tests, plan, boundaries)'
	@printf '%-30s %s\n' 'make verify' 'verify-all plus every launch validation profile'
	@printf '%-30s %s\n' 'make verify-launch-env' 'Validate launch environment variables (fail-closed)'
	@printf '%-30s %s\n' 'make verify-visual-qa' 'Run visual layout QA via LLM vision (requires OPENROUTER_API_KEY)'
	@printf '%-30s %s\n' 'make site-test' 'Run the full site-factory test suite'
	@printf '%s\n' ''
	@printf '%s\n' '── Evidence ──'
	@printf '%-30s %s\n' 'make evidence-validate' 'Validate a persisted evidence chain (ARGS=--client-id=.. --build-id=.. --mode=..)'
	@printf '%-30s %s\n' 'make evidence-show' 'Show persisted evidence for a build (ARGS as above)'
	@printf '%s\n' ''
	@printf '%s\n' '── Publish ──'
	@printf '%-30s %s\n' 'make pr' 'verify-all, push the current branch, open one PR against main'
	@printf '%-30s %s\n' 'make push' 'verify-all, push the current branch (same-PR remediation)'
	@printf '%s\n' '  (override: PR_TITLE=.. PR_BODY=.. PR_BASE=..)'
	@printf '%s\n' ''
	@printf '%s\n' '── Housekeeping ──'
	@printf '%-30s %s\n' 'make clean' 'Remove local build/generated-site/evidence artifacts'

install:
	npm ci

# ── Pipeline ── ARGS forwards flags, e.g. ARGS="--spec=<path> --build-id=<id>"
pipeline-plan:
	npm run pipeline:plan -- $(ARGS)

pipeline-local-proof:
	npm run pipeline:local-proof -- $(ARGS)

pipeline-publish-proof:
	npm run pipeline:publish-proof -- $(ARGS)

pipeline-end-to-end:
	npm run pipeline:end-to-end -- $(ARGS)

# ── Spec & provisioning ──
generate-spec:
	npm run generate-spec -- $(ARGS)

normalize-spec:
	npm run normalize-spec -- $(ARGS)

provision-plan:
	npm run provision:plan -- $(ARGS)

provision-client:
	npm run provision:client -- $(ARGS)

# ── Verification ──
verify: verify-all verify-preflight verify-source verify-build verify-smoke verify-form verify-analytics verify-crm verify-seo verify-rollback verify-launch-env

verify-all:
	npm run verify:all

verify-preflight:
	npm run verify:preflight

verify-source:
	npm run verify:source

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

verify-launch-env:
	npm run verify:launch-env

verify-visual-qa:
	npm run verify:visual-qa

# ── Tests & evidence ──
site-test:
	npm run site:test

site-test-local:
	npm run site:test:local

evidence-validate:
	npm run evidence:validate -- $(ARGS)

evidence-show:
	npm run evidence:show -- $(ARGS)

clean:
	rm -rf dist .astro build/sites build/evidence

# ── Publish ── checkers run before push; one PR against main
PR_TITLE ?= [campaign] Autonomous multi-candidate improvement and learning loop v1
PR_BODY ?= .l9/pr-body.md
PR_BASE ?= main

pr: verify-all
	git push -u origin HEAD
	@if gh pr view --json url > /dev/null 2>&1; then \
		echo "PR already open:"; gh pr view --json url --jq .url; \
	else \
		gh pr create --base $(PR_BASE) --head $$(git branch --show-current) --title "$(PR_TITLE)" --body-file "$(PR_BODY)"; \
	fi

push: verify-all
	git push origin HEAD
