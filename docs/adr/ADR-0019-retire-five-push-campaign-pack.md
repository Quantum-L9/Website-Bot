<!-- L9_META: layer=architecture, role=campaign_retirement_adr, status=accepted, version=1.0.0 -->
# ADR-0019: Retire the Five-Push Campaign Pack

## Status
Accepted.

## Date
2026-09-02

## Context

`WIP/8-14-26/Web SEO LLM Trio/` held an operator-compiled Program Execution
intake for campaign `website-bot-five-push-v1`, authored 2026-08-14: a
`CAMPAIGN_SOURCE.yaml` (`l9.program-execution.campaign-source.v2`), a
per-push plan (`Program1.md`), an independent verifier ladder of Gates 0–6,
and launch mechanics. It sequenced the redesign transaction as five gated
pushes — transport, donor intelligence, blueprint convergence, assembly,
quality delta.

The pack was internally sound. Its sha256 matched its integrity receipt, and
it validated against the live
`environment/program-execution/core/shared/schemas/campaign-source.schema.json`
with zero errors. It was not retired for defects in its own construction.

It was retired because the architecture underneath it moved. Four findings,
all observable in tree:

1. **Its central invariant was reversed.** The pack asserts `CompetitiveLandscape`
   is the sole donor authority, and instructs the verifier to fail any run that
   uses another. [ADR-0018](ADR-0018-website-build-blueprint-v2-single-authority.md)
   (accepted 2026-09-01) makes `ClientVision` and `DesignReferenceIntelligence`
   first-class first-party authorities. The pack's Gate 2 therefore fails a
   correct V2 implementation.
2. **It plans against a removed contract.** Push 1 mandates a
   `WebsiteBuildBlueprint` seam probe and reserves the real blueprint as a
   Push-2 product. V1 was removed from active code by ADR-0018 and its absence
   is now enforced by `scripts/validate-blueprint-v1-eradication.mjs`.
3. **Its `bot-interop` boundary no longer matches the lock.** The pack treats
   `@quantum-l9/bot-interop` as a published dependency to be digest-pinned.
   `contracts/WEBSITE_INTELLIGENCE_LOCK.json` (lock_version 2, locked
   2026-09-01) declares `VENDORED_WORKSPACE_SOURCE` with convergence by
   byte-level source parity, proven by `scripts/validate-interop-parity.mjs`
   against `contracts/BOT_INTEROP_PARITY.json`. The pack references neither.
4. **Its plan restarts work that is already done, and stops at a blocker it
   may not touch.** The port, HTTP adapter, deterministic `PageContentContract`
   compiler, blueprint compiler, and assembly stages are all in tree.
   Meanwhile [Campaign 7](../campaigns/campaign-7-redesign-runtime-convergence.md)
   §16 records an open cross-repository blocker in the SEO-Bot
   `structured-content` producer. The pack holds SEO-Bot read-only and treats a
   shared-contract collision as non-retryable, so it halts at Push 1 on a defect
   outside its writable scope.

The pack also declares `source_is_immutable: true` and requires a new source
contract when the accepted objective changes, so it could not legitimately be
edited into currency.

## Options Considered

### Option A: Retire the pack and delete it from this repository

- Pros: removes an executable intake whose verifier would block correct work;
  provenance survives in git history; matches the pack's own immutability rule
  that objective changes require a new source contract.
- Cons: the sequencing rationale is no longer readable in the working tree.

### Option B: Patch the pack in place to match V2

- Pros: preserves the five-push structure and the sunk authoring effort.
- Cons: forbidden by the pack's own `source_is_immutable` and
  `require_new_source_contract_when: accepted_objective_changes`; editing a
  digest-bound source invalidates its integrity receipt; and the required edits
  reach the campaign's objective, not its wording.

### Option C: Keep it in tree as a historical record

- Pros: retains the reasoning where a reader will find it.
- Cons: it is not a narrative document. It ships an `AGENT_FEED.md` whose
  instruction is to execute it, and a campaign source an agent can admit. A
  live-looking intake that encodes a superseded invariant is a hazard, not a
  record. Its verifier ladder would fail compliant V2 work.

## Decision

We choose **Option A**. Campaign `website-bot-five-push-v1` is retired. Its
seven files are deleted from this repository, which removes `WIP/` entirely.

No successor campaign is authorized by this decision. Program-level sequencing
for the redesign transaction is now grounded in the V2 authority set (ADR-0018)
and the state recorded in Campaign 7, not in the five-push ladder. The
SEO-Bot `structured-content` blocker is out of Website-Bot's scope and belongs
to a SEO-Bot-owned change.

Two elements of the pack are worth carrying into any future program and are
recorded here so they survive its deletion:

- **The verifier is not the implementer.** A worker's completion claim is not a
  gate verdict. Implementer self-verification is a hard failure, not a retry.
- **Four proof distinctions.** Passing unit tests are not integration proof;
  mocked artifacts are not cross-repo proof; HTTP 200 is not lineage proof; a
  successful build is not improvement proof. The last of these is already an
  architectural invariant here via
  [ADR-0005](ADR-0005-quality-delta-and-bounded-repair.md).

## Consequences

- `WIP/` no longer exists in this repository. Nothing referenced the pack, so no
  in-repo link breaks.
- A byte-identical copy of the pack remains in the Cursor-Governance clone at
  `WIP/8-14-26/Web SEO LLM Trio`. That clone is a separate repository and is
  deliberately out of scope for this decision. Anyone treating that copy as
  executable intake should read this ADR first: it is retired, not pending.
- Full pack contents remain recoverable from this repository's git history.
- Future redesign program planning must start from the ADR-0018 authority map
  and Campaign 7's recorded state. Reintroducing the "sole donor authority"
  framing would contradict ADR-0018.
