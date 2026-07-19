# Examples — reference client instances

This directory holds **per-client instances** for the website factory. Client
identity is data, not code: everything under `examples/<client>/` is specific to
one client, while the factory itself (`src/`, `scripts/`, `config/`, workflows,
docs) is client-agnostic and driven entirely by a client's DomainSpec.

## `supplemental-insurance-pros/` — the bundled reference client

| File | Role |
|---|---|
| `domain_spec.source.yaml` | Rich, nested **authoring** spec (the human-edited input). |
| `domain_spec.normalized.yaml` | Flat **DomainSpec** the pipeline consumes — **generated**, never hand-edited. Kept in sync by `npm run normalize-spec:check` (CI drift guard). |
| `website_object_model.yaml` | Resolved website object model for this client. |
| `DRAFT_LEGAL_DISCLAIMER.md` | Draft (unapproved) legal disclaimer for this client's regulated vertical. |
| `astro_site/` | The client's Astro site (currently hand-authored; see the note below). |

This client is also the **default** the workflows and `run-pipeline.ts` build
when no explicit spec is passed, so the factory always has a working reference.

## Onboarding a new client

1. Author `examples/<client>/domain_spec.source.yaml` (business/market/compliance detail).
2. `npm run normalize-spec -- --in=examples/<client>/domain_spec.source.yaml --out=examples/<client>/domain_spec.normalized.yaml`
3. Build: `CLIENT_ID=<client> npm run pipeline -- --spec=examples/<client>/domain_spec.normalized.yaml`
   (or dispatch `build-site` with `client_id` + `spec_path`).

No factory code changes are required to add a client — only a new instance folder.

## Known follow-up (feature work, not client de-hardcoding)

`astro_site/` is a hand-authored client site; the pipeline does **not** yet
materialize an Astro project from generated content. Turning it into a generic
`astro_template/` that the pipeline populates and writes to a per-`client_id`
output directory is tracked in the repo `TODO.md`.
