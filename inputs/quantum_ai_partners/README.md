# Quantum AI Partners: run input

The current run input for client `quantumaipartners_com`: CRM Transformation + AI RevOps, violet palette, five routes, image generation disabled.

| File | Origin | sha256 |
|---|---|---|
| `domain_spec.normalized.yaml` | Supplied by the operator as normalized IR, committed byte-for-byte | `b5422267eb49131be4fcf02225b8d7ff987fc0b143366adf9117ae88f2130cd4` |
| `assets/quantum-ai-partners-logo-LOCKED.jpg` | Operator's locked logo master. Must not change. | `0da4b5b16334950e2fc9bd955ca695b43644c15068761f76bb4e9baa51f89b02` |

## Why there is no `domain_spec.source.yaml`

The domain-spec loader (`src/stages/DomainSpecLoaderStage.ts`) reads normalized IR and validates it with `validateDomainSpec`. `scripts/normalize-spec.ts` is a one-way compiler from source to IR. `--check` only proves that the two pinned `examples/` pairs are still in sync. A run needs the IR, not the source.

`tests/unit/qap-input-spec.test.ts` pins this input:

- the loader accepts it
- it has five routes and generation is disabled
- the logo it names is byte-identical to the locked master

## Run

```bash
npm run pipeline:local-proof -- --spec=inputs/quantum_ai_partners/domain_spec.normalized.yaml --redesign
```

Run it from the repository root; `providedImages[].path` is resolved against the working directory.

The previous QAP spec (cyan, six routes) stays in `examples/quantum-ai-partners/` as the normalizer's regression fixture. Its rebuild report is under `reports/test-runs/qap-rebuild-local-proof-20261113/`.
