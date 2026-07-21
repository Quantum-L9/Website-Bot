# Release Evidence — Operations

The release-evidence subsystem persists a hash-correlated, resumable proof chain under
`build/evidence/<clientId>/<buildId>/` (assembly → build → publication → deployment →
release receipt → handoff). Evidence files are the authority; `BuildContext` fields and
the SQLite `BuildDB` are caches/indexes only.

This integration is **v2-locked**: the cross-repo handoff wire stays `schema_version 2.0`.
The rich handoff record is retained internally as an audit artifact; the emitter projects
its `site` + `proof` provenance into the enriched (optional) v2 registration block.

## Verification (local, no providers)

```bash
npm run verify:all
```

Runs, in order: `typecheck`, `normalize-spec:check`, `evidence:schemas`,
`evidence:test`, `site:test:local`, `provision:test`, `pipeline:dry`.

## Operator CLI

```bash
npm run evidence:show          -- --client-id=<c> --build-id=<b> --mode=end-to-end
npm run evidence:validate      -- --client-id=<c> --build-id=<b> --mode=end-to-end
npm run evidence:repair-index  -- --client-id=<c> --build-id=<b> --mode=end-to-end
npm run evidence:verify-external -- --client-id=<c> --build-id=<b> --mode=end-to-end
npm run evidence:resume        -- --client-id=<c> --build-id=<b> --mode=end-to-end --from=auto --spec=<spec>
```

- `show` prints the index + per-artifact status. `validate` re-hashes every artifact and
  re-checks the cross-artifact chain. `repair-index` re-derives index metadata from the
  artifact files (it never invents missing evidence). `resume` reuses only checkpoints
  whose evidence bytes still validate; provider-bound checkpoints are re-verified.

## Modes

| Mode | Store | Provider mutation | Handoff |
|---|---|---|---|
| `plan` (`--dry-run`) | in-memory | none | none (logs only) |
| `local-proof` | file | none | none (partial receipt names remote gaps) |
| `publish-proof` | file | GitHub publish | none |
| `end-to-end` (default full run) | file | GitHub + Vercel | v2 (enriched when the chain is complete) |

## Scope note

The evidence-producing stages (assembler/build/publish/receipt) and the provisioning
subsystem are landed as additive, unit-proven code. Wiring them into the default pipeline
registration, and a live disposable-target proof (GitHub/Vercel/SEO-Bot round trip), are
deliberate follow-up steps outside this stack.
