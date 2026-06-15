# Supplemental Insurance Pros Runtime Verification Layer

This codebase is an Astro site targeted for Vercel. The runtime layer adds deployment automation, verification scripts, source checks, form checks, attribution checks, SEO runtime checks, CRM phase-2 verification, monitoring guidance, and rollback instructions.

## Commands

- `npm run verify:preflight`
- `npm run verify:source`
- `npm run verify:build`
- `npm run verify:smoke`
- `npm run verify:form`
- `npm run verify:analytics`
- `npm run verify:crm`
- `npm run verify:seo`
- `npm run verify:rollback`
- `npm run verify:all`
- `npm run deploy:preview`
- `npm run deploy:production`

## Readiness policy

A local pack can be deployment-ready with Unknowns, but not launch-ready, when missing operator values remain. Launch readiness requires real phone, email, address, license number, disclaimer text, form endpoint, and deployment credentials.
