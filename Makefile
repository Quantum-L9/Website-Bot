SHELL := /bin/sh
.DEFAULT_GOAL := help

.PHONY: help install dev build preview verify verify-preflight verify-source verify-build verify-smoke verify-form verify-analytics verify-crm verify-seo verify-rollback verify-launch-env verify-visual-qa generate-domain-spec generate-content deploy-preview deploy-production clean

help:
	@printf '%s\n' 'L9 Website Factory Bot — command surface'
	@printf '%s\n' ''
	@printf '%s\n' '── Setup ──'
	@printf '%-28s %s\n' 'make install' 'Install all workspace dependencies (root + packages)'
	@printf '%s\n' ''
	@printf '%s\n' '── Development ──'
	@printf '%-28s %s\n' 'make dev' 'Run Astro dev server'
	@printf '%-28s %s\n' 'make build' 'Build static site into dist/'
	@printf '%-28s %s\n' 'make preview' 'Serve built site locally'
	@printf '%s\n' ''
	@printf '%s\n' '── Verification ──'
	@printf '%-28s %s\n' 'make verify' 'Run full local verification suite'
	@printf '%-28s %s\n' 'make verify-launch-env' 'Validate all launch environment variables (fail-closed)'
	@printf '%-28s %s\n' 'make verify-visual-qa' 'Run visual layout QA via LLM vision (requires OPENROUTER_API_KEY)'
	@printf '%s\n' ''
	@printf '%s\n' '── Generation ──'
	@printf '%-28s %s\n' 'make generate-domain-spec' 'Generate domain spec from operator inputs via LLM'
	@printf '%-28s %s\n' 'make generate-content' 'Generate page content via LLM router'
	@printf '%s\n' ''
	@printf '%s\n' '── Deployment ──'
	@printf '%-28s %s\n' 'make deploy-preview' 'Run Vercel preview deployment wrapper'
	@printf '%-28s %s\n' 'make deploy-production' 'Run Vercel production deployment (requires preview pass + operator auth)'

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

preview:
	npm run preview

verify: verify-preflight verify-source verify-build verify-smoke verify-form verify-analytics verify-crm verify-seo verify-rollback verify-launch-env
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

generate-domain-spec:
	npm run generate:domain-spec

generate-content:
	npm run generate:content

deploy-preview:
	npm run deploy:preview

deploy-production:
	npm run deploy:production

clean:
	rm -rf dist .astro
