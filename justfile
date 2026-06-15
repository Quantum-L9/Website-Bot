# justfile - developer ergonomic wrapper around npm/Makefile commands.
# Makefile remains the canonical CI/operator surface.

default:
  just --list

install:
  npm ci

dev:
  npm run dev

build:
  npm run build

preview:
  npm run preview

verify:
  npm run verify:all

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

preflight:
  npm run verify:preflight

deploy-preview:
  npm run deploy:preview

deploy-production:
  npm run deploy:production

clean:
  rm -rf dist .astro
