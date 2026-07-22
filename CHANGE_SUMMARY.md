<!-- L9_META: layer=documentation, role=tracked_file, status=active, version=1.0.0 -->
# Website-Bot Change Summary

This overlay consolidates P-A through P-F and adds the Release Evidence Spine required by handoff v3.

## Material changes

- Evidence files, not optional BuildContext fields, now authorize downstream stages.
- `FileEvidenceStore` provides atomic persistence, SHA-256 references, index repair, checkpoints, and failure evidence.
- Site assembly/build/publication/deployment/receipt/handoff stages were rewired to persist and reload evidence.
- `ReleaseReceiptFinalizerStage` converts a partial receipt to succeeded only after full correlation and visual QA.
- Handoff v3 consumes only a validated succeeded end-to-end release bundle.
- BuildDB indexes evidence without replacing file authority.
- Inngest uses a stable build ID and evidence root; retries rehydrate the same transaction.
- Evidence operator commands, schemas, tests, workflows, and contract lock were added.
