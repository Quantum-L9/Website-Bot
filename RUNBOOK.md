<!-- L9_META: layer=documentation, role=tracked_file, status=active, version=1.0.0 -->
# Website-Bot Site Factory Runbook

## Validate

```bash
npm ci --no-audit --no-fund
npm run verify:all
```

## Pipeline modes

```bash
npm run pipeline:plan -- --spec=<spec>
npm run pipeline:local-proof -- --spec=<spec> --build-id=<build>
npm run pipeline:publish-proof -- --spec=<spec> --build-id=<build>
npm run pipeline:end-to-end -- --spec=<spec> --build-id=<build> --auto-register-seo-bot
```

## Evidence operations

```bash
npm run evidence:show -- --client-id=<client> --build-id=<build> --mode=<mode>
npm run evidence:validate -- --client-id=<client> --build-id=<build> --mode=<mode>
npm run evidence:repair-index -- --client-id=<client> --build-id=<build> --mode=<mode>
npm run evidence:resume -- --client-id=<client> --build-id=<build> --mode=<mode> --from=auto --spec=<spec>
```

## Canonical root

`build/evidence/<clientId>/<buildId>/`

Do not delete or edit evidence to force a retry. Fix the cause and resume the same build transaction.
