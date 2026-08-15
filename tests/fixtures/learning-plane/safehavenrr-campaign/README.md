# Learning-plane fixture: Safe Haven campaign

Fixture campaign for the learning plane test suite. Mirrors the observed
golden-run corpus shapes (Safe Haven Roofing & Renovations, safehavenrr.com)
and the campaign storage layout from the design contract:

```text
safehavenrr/
└── safehavenrr-20260815-001/
    ├── campaign-manifest.json       (built by the runner/CLI on first run)
    ├── hypotheses/
    │   └── LH-001.json              (pre-authored DESIGN hypothesis)
    └── candidates/
        └── C0/
            └── quality-delta.json   (initial candidate dimension results)
```

Tests copy this directory into a temp campaign root and drive the runner
against it; nothing here is a production campaign.
