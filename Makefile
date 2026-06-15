SHELL := /bin/sh
.DEFAULT_GOAL := help

.PHONY: help install dev build preview verify verify-preflight verify-source verify-build verify-smoke verify-form verify-analytics verify-crm verify-seo verify-rollback deploy-preview deploy-production clean

help:
	@printf '%s\n' 'Supplemental Insurance Pros Astro command surface'
	@printf '%s\n' ''
	@printf '%-24s %s\n' 'make install' 'Install dependencies with npm ci'
	@printf '%-24s %s\n' 'make dev' 'Run Astro dev server'
	@printf '%-24s %s\n' 'make build' 'Build static site into dist/'
	@printf '%-24s %s\n' 'make preview' 'Serve built site locally'
	@printf '%-24s %s\n' 'make verify' 'Run full local verification suite'
	@printf '%-24s %s\n' 'make deploy-preview' 'Run Vercel preview deployment wrapper'
	@printf '%-24s %s\n' 'make deploy-production' 'Run Vercel production deployment wrapper after preview passes'

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

preview:
	npm run preview

verify: verify-preflight verify-source verify-build verify-smoke verify-form verify-analytics verify-crm verify-seo verify-rollback
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

deploy-preview:
	npm run deploy:preview

deploy-production:
	npm run deploy:production

clean:
	rm -rf dist .astro
