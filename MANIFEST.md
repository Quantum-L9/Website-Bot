# Website-Bot v2.0 — Pack Manifest

## Pack: website-bot-phase2

Version: 2.0.0 (L9 Recursive Optimization — Cycle 1)

## File Tree (28 files)

```
website-bot-phase2/
├── package.json                                    # npm manifest + scripts
├── tsconfig.json                                   # TypeScript NodeNext config
├── .github/workflows/
│   ├── build-and-validate.yml                      # PR type-check + dry-run
│   ├── deploy-to-vercel.yml                        # Manual/on-demand deploy + artifact upload (see build-site.yml for real per-client deploys)
│   └── emit-handoff.yml                            # SEO-Bot registration (post-deploy)
├── contracts/
│   └── website_factory_integration.yaml            # Handoff contract template v2.0
├── scripts/
│   └── run-pipeline.ts                             # CLI entry — all stages registered
├── src/
│   ├── core/
│   │   └── logger.ts                              # Pino logger factory
│   ├── services/
│   │   └── llm.ts                                 # OpenRouter adapter (generateContent, designReasoning, generateSchema)
│   ├── pipeline/
│   │   ├── BuildContext.ts                        # Context carrier interface
│   │   ├── BuildDB.ts                             # Drizzle + SQLite schema + factory
│   │   ├── BuildError.ts                          # Typed error taxonomy (16 codes)
│   │   └── PipelineRunner.ts                      # Stage orchestrator + LLM usage flush
│   └── stages/
│       ├── DomainSpecLoaderStage.ts               # Stage 1: spec load + validation
│       ├── UnknownResolverStage.ts                # Stage 2: WOM flag resolution
│       ├── DesignIntelligenceStage.ts             # Stage 3: LLM brand token generation
│       ├── ContentGenerationStage.ts              # Stage 4: page copy + quality gates
│       ├── SchemaGeneratorStage.ts                # Stage 5: JSON-LD (5 schema types)
│       ├── PostHogSnippetStage.ts                 # Stage 6: analytics injection
│       ├── VercelDeployStage.ts                   # Stage 7: programmatic deploy + poll
│       ├── SEOBaselineStage.ts                    # Stage 8: Day-0 rank capture
│       ├── VisualQAStage.ts                       # Stage 9: visual QA subprocess
│       └── HandoffEmitterStage.ts                 # Stage 10: contract emit + SEO-Bot reg
├── MANIFEST.md                                     # This file
├── RUNBOOK.md                                      # Operator guide
├── VALIDATION.md                                   # Validation evidence
└── CHANGE_SUMMARY.md                               # Delta from Phase 1 → Phase 2 v2.0
```

## Violation Fixes Applied (L9 Recursive Optimization)

| ID | Severity | Fixed |
|----|----------|-------|
| V-01 | HIGH | package.json added |
| V-02 | CRITICAL | src/services/llm.ts added |
| V-03 | HIGH | emit-handoff.yml: DEPLOYMENT_URL injected from artifact |
| V-04 | MEDIUM | PipelineRunner: LLM usage flushed to llm_usage table |
| V-05 | LOW | File count corrected to 28 |
| V-06 | HIGH | designReasoning() declared in WebsiteFactoryLLM interface |
| V-07 | MEDIUM | ServiceArea schema added to SchemaGeneratorStage |
| V-08 | MEDIUM | Word count gate + banned-claim gate added to ContentGenerationStage |
| V-09 | LOW | tsconfig.json included; RUNBOOK.md documents it |
