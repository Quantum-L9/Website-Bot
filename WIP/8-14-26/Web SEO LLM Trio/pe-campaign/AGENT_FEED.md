# AGENT_FEED — Website-Bot Five-Push PE Campaign

Paste this entire file as the opening message to a fresh agent that has
`@environment/program-execution` available. Attach the three source files
listed under Inputs. Do not ask the agent to redesign the sequence.

---

## Mission

Execute campaign `website-bot-five-push-v1` through the Program Execution
pipeline. Build the accepted five-push Website-Bot sequence. Do not invent a
sixth architecture.

**Push 1 proves transport → Push 2 proves intelligence → Push 3 proves
contractual convergence → Push 4 proves construction → Push 5 proves
improvement.**

## Inputs (immutable)

1. Campaign source (this is the PE intake):
   `WIP/8-14-26/Web SEO LLM Trio/pe-campaign/CAMPAIGN_SOURCE.yaml`
   schema `l9.program-execution.campaign-source.v2`
   sha256 `d86592b07012068ac8c28a4140053507cffc3fd67c994e78a7612c6a7408b23a`
2. Per-push execution contracts (todos, envelopes, evidence matrices):
   `WIP/8-14-26/Web SEO LLM Trio/Program1.md`
3. Independent verifier contract (Gates 0–6):
   `WIP/8-14-26/Web SEO LLM Trio/L9 Website Improvement — Independent Validation Contract Pack.md`
4. Thin intent (optional compiler path):
   `WIP/8-14-26/Web SEO LLM Trio/pe-campaign/INTENT.yaml`

Treat (1) as immutable operator intake. Treat (2) as the per-task build spec.
Treat (3) as the only authority that may issue PASS / FAIL /
BLOCKED_BY_ENVIRONMENT. Worker completion is not a gate verdict.

## Pipeline (required)

```text
CAMPAIGN_SOURCE.yaml
  → @environment/program-execution
      compile Blueprint v2 + Program Lock + Controller
  → admit W0 only
  → execute ready Task Cards under Controller lease
  → independent verify with the Validation Contract Pack
  → wave exit gate
  → next wave
  → Controller handoff
  → program owner terminal verdict
```

Authority order: `environment/agents/PEER_EXECUTION.md`.
Program lease is authoritative. Autonomy / `/autonomy` is subordinate and
must not widen Task Card ceilings.

Runtime state lives only under:

- `$HOME/.l9/programs/website-bot-five-push-v1`
- `$HOME/.l9/program-worktrees/website-bot-five-push-v1`

Do not write PE runtime into Website-Bot, SEO-Bot, or Cursor-Governance.

## Targets

| ID | Repo | Local hint | Mutability |
|---|---|---|---|
| TARGET-001 | Quantum-L9/Website-Bot | `/Users/ib-mac/Website-Bot` | reversible local writes |
| TARGET-002 | Quantum-L9/SEO-Bot | `/Users/ib-mac/SEO-Bot` | **read-only** |
| TARGET-003 | PE control plane | Cursor-Governance `environment/program-execution` | controller only |

Do not use Dropbox clones as SSOT.

## Wave / task map

| Wave | Task | Push | Validation pack | Mutation |
|---|---|---|---|---|
| W0 | TASK-001 | admission + producer lock | GATE 0 | none (inspect + PE runtime) |
| W1 | TASK-002 | Push 1 P1-01…P1-08 | GATE 1 | Website-Bot only |
| W2 | TASK-003 | Push 2 P2-00…P2-07 | GATE 2 | Website-Bot only |
| W3 | TASK-004 | Push 3 P3-00…P3-07 | GATE 3 | Website-Bot only |
| W4 | TASK-005 | Push 4 P4-00…P4-07 | GATE 4 | Website-Bot only |
| W5 | TASK-006 | Push 5 P5-00…P5-07 | GATE 5 + GATE 6 | Website-Bot only |
| W6 | TASK-007 | Controller handoff | GATE-007 | PE runtime only |

A wave starts only when the prior wave and its blocking exit gate PASS.
Never start the next push on a failed or unverified prior gate.

## How to execute each implementation task

1. Render the Controller Task Card / source contract for that task only.
2. Open Program1.md at the matching `plan_id` and execute **only** that
   push's todos, envelope, negative cases, and rollback.
3. Capture real SHAs and artifact digests. Replace
   `<CAPTURE_…>` placeholders. Do not fabricate.
4. Run the push's own evidence matrix from Program1.md.
5. Spawn a **separate** verifier pass using the matching Validation Pack
   gate. The implementer must not issue the verdict.
6. Record Attempt Receipt, then independent verification receipt.
7. Evaluate the PE exit gate. On FAIL, roll back only that push's
   Website-Bot paths. Preserve upstream artifacts. Do not touch SEO-Bot.
8. Stop for the pause list in `operator_directive.pause_only_for`.

## Hard law (fail-closed)

- SEO-Bot source, LLM-Router, and published `@quantum-l9/bot-interop`
  semantics are not writable. Shared-contract collision stops the program.
- Website-Bot communicates with SEO-Bot only through
  `SeoBuildIntelligencePort` + one transport adapter.
- Push 1 WebsiteBuildBlueprint is an integration-only seam probe. It must
  never enter production design/build imports.
- Deterministic PageContentContract compiler is the only reconciliation
  authority. An LLM must not merge blueprints or assign organic rank.
- Website-Bot must not generate generic final copy as SEO-Bot fallback.
- A successful build is not proof the website improved. Only GATE 5/6.
- At most one automatic repair cycle. Persistent second failure is terminal.
- No commit / push / PR / merge / release / deploy unless a later exact
  rendered contract authorizes that named action. Default ceiling is
  inspect + local_write.
- Do not expose credentials. Resolve secrets via `l9-aws-secrets` /
  existing injected runtime. Never ask the human to paste keys.
- Do not mutate Cursor-Governance PE core to make this product campaign pass.
- BLOCKED_BY_ENVIRONMENT is legal only when the implementation is
  structurally proven and a required external service/credential is absent.
  Do not launder implementation defects through that verdict.

## Admission first actions (W0)

```bash
# Capture, do not invent
git -C /Users/ib-mac/Website-Bot rev-parse HEAD
git -C /Users/ib-mac/Website-Bot branch --show-current
git -C /Users/ib-mac/Website-Bot status --short
git -C /Users/ib-mac/SEO-Bot rev-parse HEAD
git -C /Users/ib-mac/SEO-Bot branch --show-current
git -C /Users/ib-mac/SEO-Bot status --short
```

Then run Validation Pack GATE 0 against SEO-Bot (read-only). Do not modify
Website-Bot until GATE 0 PASSes.

## Success

Program is ready for AUTH-001 terminal verdict when GATE 0–6 are PASS
(or an explicit BLOCKED_BY_ENVIRONMENT that still structurally proves the
producer) and `handoff.json` validates. Controller recommends CONVERGED /
CONVERGED_WITH_NON_BLOCKING_RISKS / NOT_CONVERGED / INCONCLUSIVE. Only
Igor Beylin declares the verdict.

## If blocked

State the exact blocker, the Unknown id, and the smallest safe next
action. Do not widen scope to unblock. Do not skip a gate.
