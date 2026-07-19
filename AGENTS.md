# AGENTS.md

## Mission

Maintain this generated Astro website without drifting from the source domain specification, verified stack, or validation evidence. This file is binding guidance for AI coding agents and developer assistants working in this repository.

## Source-of-Truth Order

1. Current explicit operator instruction.
2. Domain specification and generated contracts.
3. Existing repository files.
4. Machine validation evidence.
5. Root docs in this pack.
6. General best practices.

When sources conflict, stop and report the conflict. Do not silently choose the more convenient answer.

## Locked Decisions

- Framework: Astro.
- Package manager: npm.
- Deployment target: Vercel.
- LLM Router: @quantum-l9/llm-router (installed from GitHub Packages; consumed via src/services/llm.ts).
- LLM Providers: OpenRouter (general) + Perplexity (search-grounded).
- CRM direction: configurable CRM provider (`CRM_PROVIDER`, e.g. acculynx, hubspot, salesforce, none), phase 2 runtime verification.
- Production deployment: preview-first only.
- Readiness claims: evidence-backed only.
- Visual QA: Required before production deployment (verify:visual-qa).

## Allowed Changes

- Fix build, runtime, route, or verification errors.
- Improve scripts when they preserve existing command semantics.
- Update docs to match inspected repo facts.
- Add environment variable names without values.
- Improve command consistency across docs, Makefile, justfile, and package scripts.
- Add validation evidence generated from real commands.

## Forbidden Changes

- Do not invent phone, email, address, license number, disclaimer text, credentials, analytics IDs, support contacts, or legal claims.
- Do not hardcode secrets.
- Do not migrate away from Astro.
- Do not change deployment target away from Vercel.
- Do not commit `.env.local` or runtime secrets.
- Do not mark credential-bound checks as passed without runtime evidence.
- Do not create duplicate docs with overlapping ownership.
- Do not add fake badges, fake links, fake certifications, fake benchmarks, or fake production claims.

## Required Work Loop

1. Inspect files before editing.
2. Identify the smallest change that closes the actual gap.
3. Modify only relevant files.
4. Run the narrowest validation command that proves the fix.
5. Run `npm run verify:all` when preparing handoff.
6. Record Unknowns rather than inventing values.
7. Package only approved outputs.

## Validation Rule

Every readiness claim must map to command output, file evidence, URL evidence, receipt evidence, or an explicit blocked-check record. If evidence is missing, status is not approved.

## Packaging Rule

When producing handoff artifacts, include a manifest, validation summary, changed files, and only approved files. Exclude `node_modules`, `.env.local`, `.git`, caches, reports containing secrets, and archives unless explicitly requested.

## Launch Unknown Resolution Rule

Agents must not invent external values. Convert missing operator-owned values into env vars and enforce fail-closed validation. Canonical launch contract: `.env.example` and `config/launch-env.required.yaml`. Executable gate: `npm run verify:launch-env`.
