# Website-Bot repository-owned Make implementation (Repository Execution V2).
#
# The root Makefile is the generated l9-ci-core `make-v1` facade (never edit
# it; regenerate with `python3 -m tools.l9_repo --workspace <repo> reconcile`
# from an l9-ci-core checkout). It includes this file and routes
#   setup -> repo-setup   validate -> repo-validate
#   check -> repo-check   test     -> repo-test
# Do not define help, setup, validate, check or test here: the facade owns
# them. SHELL and .DEFAULT_GOAL are the facade's too. Everything else below is
# this repository's own command surface (`make commands` lists it).

# Organization CI (`Analyze (central Core)`) runs the four phases on the hosted
# runner without setting up Node, and Website-Bot requires Node >= 22.19.0
# (package.json engines). Prefer the runner's hosted-toolcache Node 22 when it
# exists; elsewhere the Node already on PATH is used and repo-setup checks it.
NODE22_BIN := $(lastword $(sort $(wildcard /opt/hostedtoolcache/node/22.*/x64/bin)))
ifneq ($(NODE22_BIN),)
export PATH := $(NODE22_BIN):$(PATH)
endif

# The repository test runner disables agent memory for the local scopes; the
# phases below use it so `make test` matches the repository's own gates.
SITE_TESTS := node scripts/run-site-factory-tests.mjs

# Exit 0 only when Playwright's Chromium starts headless on this machine: the
# check that decides whether its OS libraries must be installed.
CHROMIUM_LAUNCHES := node -e 'require("playwright").chromium.launch().then((browser) => browser.close()).catch(() => process.exit(1))' >/dev/null 2>&1

# ── make-v1 ABI leaves (Repository Execution V2) ────────────────────────────
# Each reuses a gate the repository's own CI already runs green
# (.github/workflows/ci.yml Gate 5 and pr-check below); none adds a second
# implementation.
.PHONY: repo-setup repo-validate repo-check repo-test

repo-setup: ## Install Node dependencies and the Playwright Chromium the tests render with
	@node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) { console.error(`repo-setup: Node >= 22.19.0 required, found ${process.versions.node}`); process.exit(1); }'
	npm ci --no-audit --no-fund --ignore-scripts
	npm rebuild better-sqlite3
	npm --prefix packages/bot-interop ci --no-audit --no-fund --ignore-scripts
	npx --no-install playwright install chromium
	@# Chromium's OS libraries are installed only when the browser cannot
	@# launch without them. `install --with-deps` always ran apt, and on the
	@# hosted runner (which already carries those libraries) that one mirror
	@# download took 7-8 minutes of Analyze (central Core).
	@if $(CHROMIUM_LAUNCHES); then \
		echo "repo-setup: Chromium launches; OS libraries already present"; \
	elif [ -n "$${CI:-}" ]; then \
		echo "repo-setup: Chromium cannot launch; installing its OS libraries"; \
		npx --no-install playwright install-deps chromium; \
		$(CHROMIUM_LAUNCHES) || { echo "repo-setup: Chromium still cannot launch after install-deps" >&2; exit 1; }; \
	else \
		echo "repo-setup: Chromium cannot launch; run: sudo npx playwright install-deps chromium" >&2; \
		exit 1; \
	fi

repo-validate: ## Non-mutating contract validation (spec, evidence schemas, boundaries, LLM wiring)
	npm run normalize-spec:check
	npm run evidence:schemas
	npm run evidence:contract-parity
	npm run alignment:boundaries
	npm run llm:wiring

repo-check: ## Static checks: TypeScript (main and provisioning projects)
	npm run typecheck
	npm run typecheck:provisioning

repo-test: ## Unit and local integration suites (site-factory local scope)
	$(SITE_TESTS) --scope=local

# ── Repository command surface ──────────────────────────────────────────────
.PHONY: commands install \
        pipeline-plan pipeline-local-proof pipeline-publish-proof pipeline-end-to-end \
        generate-spec normalize-spec provision-plan provision-client \
        verify verify-all verify-preflight verify-source verify-build verify-smoke \
        verify-form verify-analytics verify-crm verify-seo verify-rollback \
        verify-launch-env verify-visual-qa \
        site-test site-test-local evidence-validate evidence-show clean workspace-clean

commands:
	@printf '%s\n' 'L9 Website Factory Bot — command surface'
	@printf '%s\n' ''
	@printf '%s\n' '── Repository execution (make-v1 facade) ──'
	@printf '%-30s %s\n' 'make setup' 'Install dependencies and Playwright Chromium'
	@printf '%-30s %s\n' 'make validate' 'Non-mutating contract validation'
	@printf '%-30s %s\n' 'make check' 'TypeScript static checks'
	@printf '%-30s %s\n' 'make test' 'Unit and local integration suites'
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
	@printf '%s\n' '── Housekeeping ──'
	@printf '%-30s %s\n' 'make clean' 'Remove local build/generated-site/evidence artifacts'
	@printf '%-30s %s\n' 'make workspace-clean' 'Ship leftover work to scoped PRs (delegates to Cursor-Governance make clean)'

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

# Ship leftover work to the owning repo as a scoped PR, then prime main.
# Artifact wipe stays `make clean`. Orchestrator lives in Cursor-Governance.
workspace-clean:
	$(MAKE) -C "$(HOME)/.cursor-governance" clean WS="$(CURDIR)"

# ── Publish (L9 sanctioned surface) ──────────────────────────────────────
# make pr is the ONLY push/PR route (48-make-pr-remediation). Checkers run
# before any remote mutation; OPEN_PR=0 runs the gate only.
GOV_ROOT ?= $(HOME)/.cursor-governance
OPEN_PR ?= 1
PR_REMEDIATE ?= 1
PR_BASE ?= origin/main

.PHONY: pr pr-check

pr-check:
	@echo "--- pr-check: Website-Bot repository gates ---"
	npm run typecheck
	npm run normalize-spec:check
	npm run evidence:schemas
	npm run evidence:contract-parity
	node scripts/run-site-factory-tests.mjs --scope=local
	node scripts/validate-recursive-schemas.mjs
	node scripts/run-recursive-tests.mjs
	npm run llm:wiring
	npm run alignment:boundaries
	# Lint scoped to the branch-owned surface. packages/validation-executor is
	# excluded from the local gate because its working tree carries other
	# sessions' uncommitted edits; CI lints its committed state on the branch.
	npx biome check src scripts tests astro_template config contracts schemas examples validation packages/bot-interop
	@echo "--- pr-check PASS ---"

pr: pr-check
	@if [ "$(OPEN_PR)" = "1" ]; then \
		PR_BASE="$(PR_BASE)" PR_REMEDIATE="$(PR_REMEDIATE)" \
			bash "$(GOV_ROOT)/ops/scripts/open_pr_after_gate.sh" "$(PWD)"; \
	else \
		echo "OPEN_PR=0 — skipped GitHub PR open (gate already PASS)"; \
	fi
