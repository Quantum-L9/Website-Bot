L9 Website Improvement — Independent Validation Contract Pack

Purpose

Use these contracts after each implementation slice.

The verifier is not the implementer.

Its job is to determine whether the claimed capability actually exists, is correctly wired, obeys the accepted architecture, and works under controlled execution.

Do not repair implementation unless explicitly asked.

Do not accept:

* code presence as proof of execution;
* passing unit tests as proof of integration;
* mocked artifacts as proof of cross-repo behavior;
* successful HTTP status as proof of valid lineage;
* successful build as proof of website improvement;
* documentation as proof of runtime behavior.

Every gate ends exactly one way:

PASS
FAIL
BLOCKED_BY_ENVIRONMENT

BLOCKED_BY_ENVIRONMENT is permitted only when the implementation can be structurally verified but a required external credential/service is unavailable.

Do not convert an implementation defect into BLOCKED_BY_ENVIRONMENT.

⸻

GATE 0 — SEO-Bot Producer Verification

When to Run

Immediately after the current SEO-Bot build-time intelligence implementation lands.

Do not proceed to Website-Bot integration until this gate passes.

Mission

Prove that SEO-Bot genuinely produces:

CompetitiveLandscape
SEOContentBlueprint
StructuredContentPackage

with correct ownership, routing, lineage, validation, and failure behavior.

Repositories

Primary:

Quantum-L9/SEO-Bot

Inspect dependency contracts from:

@quantum-l9/bot-interop
@quantum-l9/llm-router

Do not modify Website-Bot.

⸻

A. Repository Truth

Capture:

git status --short
git branch --show-current
git rev-parse HEAD
git diff --stat

Inspect:

package.json
package-lock.json
src/build-intelligence/**
src/services/llm*
src/services/*dataforseo*
src/api/**
tests/**
contracts/**

Determine the actual implementations, not expected filenames.

⸻

B. CompetitiveLandscape Structural Verification

Prove:

CompetitiveLandscape producer exists
DataForSEO is the ranking truth source
organic rank is preserved
domain normalization is deterministic
visibility scoring is deterministic
selected donors resolve to observations
exclusions have explicit reasons
artifact is sealed through bot-interop

Search for every call that can influence donor ranking.

Fail if:

an LLM can assign organic rank
an LLM can override organic rank
Perplexity is ranking authority
selected donors can exist without source observations
random/non-deterministic ordering affects output

⸻

C. Zero-LLM CompetitiveLandscape Test

Instrument/mock the LLM service so every invocation throws:

UNEXPECTED_LLM_CALL

Run CompetitiveLandscape generation against deterministic SERP fixtures.

Expected:

CompetitiveLandscape generation succeeds
LLM call count = 0

Fail otherwise.

⸻

D. Determinism Test

Using identical normalized SERP fixtures:

run #1
run #2

Compare semantic payloads and artifact digests.

Expected:

semantic payload equal
payload digest equal
artifact_id equal

Metadata such as timestamps may differ only if excluded from semantic identity by protocol design.

⸻

E. SEOContentBlueprint Routing Verification

Trace the exact LLM call.

Prove its task descriptor resolves to:

strategic reasoning
requiresReasoning = true
requiresSearch = false

Run the descriptor through the actual installed LLM-Router.

Fail if it resolves through a search-provider route solely because the task concerns competitors/SEO.

Verify the blueprint contains:

search intent
queries
topics
entities
questions
competitive gaps
content requirements
internal links
AEO/GEO requirements
metadata requirements
forbidden claims
acceptance tests

Fail if it owns:

section order
layout
component architecture
visual design
CTA placement
final page prose

⸻

F. StructuredContentPackage Verification

Use a valid sealed PageContentContract fixture.

Prove:

artifact integrity checked before LLM spend
generation operates from PageContentContract
output preserves route IDs
output preserves section IDs
output references exact contract artifact
content validation executes
unsupported claims are surfaced
failed requirements are surfaced

Then tamper with one byte/field in the contract without resealing.

Expected:

request rejected before content generation

Fail if any LLM call occurs before integrity rejection.

⸻

G. Bounded Repair Verification

Create a fixture that intentionally produces one validation failure.

Expected:

initial generation
→ validation FAIL
→ one targeted repair
→ validation

Prove passing routes are not regenerated.

Create a repair fixture that still fails.

Expected terminal result:

CONTENT_REQUIREMENT_UNSATISFIED

Fail if retries can continue indefinitely.

⸻

H. API Verification

Verify exactly the intended build-time endpoints exist.

Expected conceptual surface:

POST competitive-landscape
POST seo-content-blueprint
POST structured-content

Test:

unauthenticated → rejected
invalid schema → rejected
valid request → sealed artifact
provider override → rejected/not part of schema
model override → rejected/not part of schema
raw system prompt → rejected/not part of schema

⸻

I. Existing SEO Regression

Run the canonical repository tests.

Determine commands from package.json.

At minimum verify applicable:

typecheck
unit tests
integration tests
verify:all

Do not invent commands.

Existing scheduled SEO behavior must remain green.

⸻

J. Real Smoke Test

If DataForSEO credentials are available, make one bounded real request.

Use a cheap test query.

Persist/report:

query
location
top organic observations
selected donor calculation
artifact_id
payload_digest

Do not expose credentials.

If credentials are unavailable, classify only this subsection:

BLOCKED_BY_ENVIRONMENT

The overall gate may still PASS structurally only if all non-network behavior is proven and real-network execution is explicitly recorded as pending.

⸻

Required Verdict

Return:

GATE: SEO_BOT_PRODUCER
VERDICT:
PASS | FAIL | BLOCKED_BY_ENVIRONMENT
PROVEN:
...
FAILED:
...
ARTIFACT_LINEAGE:
...
LLM_ROUTING:
...
COMMANDS_RUN:
...
REAL_SMOKE:
...
MUST_FIX_BEFORE_NEXT_GATE:
...

PASS is required before Gate 1.

⸻

GATE 1 — Real Cross-Repo Intelligence Transaction

When to Run

After Website-Bot implements the real SEO-Bot adapter.

Mission

Prove that Website-Bot and SEO-Bot cooperate through the shared contracts without hidden coupling, mock substitution, stale artifacts, or lineage drift.

Repositories

Quantum-L9/Website-Bot
Quantum-L9/SEO-Bot

Shared:

@quantum-l9/bot-interop

⸻

A. Transport Boundary

Find the Website-Bot implementation of:

SeoBuildIntelligencePort

Prove pipeline stages depend on the port, not HTTP/fetch implementation.

Fail if individual stages perform direct SEO-Bot network calls.

Verify transport concerns are centralized:

base URL
authentication
timeout
retry
artifact validation
error translation

⸻

B. Shared Contract Identity

Verify both repos use the same exact compatible bot-interop protocol/version.

Prove neither repo has copied/redeclared local versions of:

CompetitiveLandscape
SEOContentBlueprint
PageContentContract
StructuredContentPackage
ArtifactRef

Fail on duplicate wire-schema authority.

⸻

C. Full Controlled Transaction

Execute:

Website-Bot
→ SEO-Bot CompetitiveLandscape
Website-Bot
→ SEO-Bot SEOContentBlueprint
Website-Bot deterministic compiler
→ PageContentContract
Website-Bot
→ SEO-Bot StructuredContentPackage

Record all four artifact IDs/digests.

Expected lineage:

CompetitiveLandscape@A
SEOContentBlueprint@B
  references A
WebsiteBuildBlueprint@W
  references A
PageContentContract@C
  references B + W
StructuredContentPackage@D
  references exact C

No approximate lineage.

No “latest artifact” lookup.

No implicit filename-based selection.

⸻

D. Negative Lineage Tests

Test each:

Different landscapes

Use:

WebsiteBuildBlueprint → Landscape A
SEOContentBlueprint → Landscape B

Expected:

COMPETITIVE_LANDSCAPE_MISMATCH

Tampered SEO blueprint

Modify payload after sealing.

Expected:

INTEL_ARTIFACT_HASH_MISMATCH

Stale page contract

Generate content for Contract C1, then ask Website-Bot to assemble against C2.

Expected:

CONTENT_CONTRACT_HASH_MISMATCH

Route mismatch

Website and SEO blueprints expose different route sets.

Expected:

ROUTE_SET_MISMATCH

⸻

E. Deterministic Compiler Test

Run PageContentContract compilation twice with byte-equivalent semantic inputs.

Expected:

identical canonical payload
identical semantic digest

No LLM may execute.

Instrument the Website-Bot LLM facade to throw on calls during compilation.

Expected:

compiler succeeds
LLM call count = 0

⸻

F. No Website-Bot Final Copy Generation

Trace the active canonical pipeline.

Prove no final page prose enters through Website-Bot’s old generic generation path.

Instrument legacy/generic generation if it still physically exists.

Expected:

call count = 0

Fail if an SEO-Bot failure causes fallback to Website-Bot generic copy.

Required behavior:

SEO integration unavailable
→ fail closed

⸻

Required Verdict

GATE: CROSS_REPO_TRANSACTION
VERDICT:
PASS | FAIL | BLOCKED_BY_ENVIRONMENT
END_TO_END_ARTIFACT_CHAIN:
...
NEGATIVE_TESTS:
...
DETERMINISTIC_COMPILER:
...
FORBIDDEN_FALLBACK_CHECK:
...
COMMANDS_RUN:
...
MUST_FIX_BEFORE_NEXT_GATE:
...

PASS required before Gate 2.

⸻

GATE 2 — Donor Intelligence and Pattern Harvest

When to Run

After Website-Bot implements:

CompetitorIngestion
DonorPatternExtraction
PatternSynthesis
PatternPortfolio

Mission

Prove that Website-Bot is actually learning transferable design/UX/conversion patterns from the CompetitiveLandscape cohort without copying donor expression.

⸻

A. Cohort Authority

Prove competitor ingestion accepts the exact:

CompetitiveLandscape

produced by SEO-Bot.

Fail if Website-Bot independently searches for another “top ten.”

Fail if donor selection changes without explicit exclusion/operator policy.

⸻

B. Bounded Ingestion

Verify explicit limits exist for:

pages per donor
crawl depth
screenshots
payload size
timeouts
concurrency

Fail if the system can recursively crawl entire sites by default.

⸻

C. Donor Evidence

For each selected donor, inspect the produced evidence.

Require enough material to support claims about:

navigation
IA
above-fold composition
conversion mechanics
trust architecture
proof placement
section sequencing
mobile behavior
visual hierarchy
CTA mechanics

A pattern may be UNKNOWN if evidence is insufficient.

The model must not invent missing observations.

⸻

D. Nugget Contract

Sample every disposition class that appears.

Every adopted nugget must have:

pattern_id
class
invariant
evidence
donor references
disposition
beneficiary destination
risk
acceptance tests

Fail if a recommendation lacks evidence.

Fail if an abstract “nice design” recommendation is accepted without a stable problem/invariant.

⸻

E. Anti-Copy Test

Inspect actual LLM inputs and normalized artifacts.

Fail if downstream pattern synthesis receives/reuses:

large raw competitor prose
competitor image binaries for reuse
competitor HTML intended for copying
competitor component/source markup
instructions to replicate exact styling

Screenshots may be used for analysis.

They must not become downloadable design assets.

⸻

F. Cross-Donor Synthesis

Prove PatternPortfolio distinguishes:

single-donor observation
repeated category convention
high-confidence transferable invariant
anti-pattern
rejected pattern

Frequency must be evidence, not automatic adoption.

Test a fixture where 8/10 donors use an objectively undesirable pattern.

Expected:

system can REJECT despite frequency

⸻

G. LLM Routing

Trace:

DONOR_NUGGET_EXTRACTION
VISUAL_PATTERN_ANALYSIS
PATTERN_SYNTHESIS

Expected:

requiresSearch = false

Pattern synthesis must not route to Perplexity merely because competitors are involved.

⸻

Required Verdict

GATE: DONOR_PATTERN_INTELLIGENCE
VERDICT:
PASS | FAIL | BLOCKED_BY_ENVIRONMENT
COHORT_PROVENANCE:
...
INGESTION_BOUNDS:
...
NUGGET_QUALITY:
...
ANTI_COPY:
...
PATTERN_SYNTHESIS:
...
LLM_ROUTING:
...
MUST_FIX_BEFORE_NEXT_GATE:
...

PASS required before Gate 3.

⸻

GATE 3 — Blueprint Convergence and Content Authority

When to Run

After Website-Bot produces a real WebsiteBuildBlueprint and both blueprints participate in the page-content transaction.

Mission

Prove that the two independent expert authorities converge correctly without either repo taking ownership of the other’s domain.

⸻

A. WebsiteBuildBlueprint Authority

Verify it owns:

route architecture
section order
component classes
content slots
conversion architecture
proof placement
experience strategy
pattern references
acceptance tests

Fail if it owns final prose.

Fail if it invents SERP rank/search truth.

⸻

B. SEOContentBlueprint Authority

Verify it owns:

search intent
queries
topics
entities
questions
content gaps
internal links
AEO/GEO
metadata requirements
SEO acceptance tests

Fail if it owns visual/component architecture.

⸻

C. Independent Inputs

Prove both blueprints reference the same CompetitiveLandscape.

Prove SEO-Bot did not require WebsiteBuildBlueprint to produce SEOContentBlueprint.

This sibling relationship is intentional.

⸻

D. Slot Reconciliation

Test at least:

FAQ requirement → FAQ-capable section
trust requirement → trust-capable section
local relevance → local-relevance slot

Then construct an impossible required SEO requirement.

Expected:

CONTENT_REQUIREMENT_UNPLACED

No LLM fallback is allowed.

⸻

E. Business Fact Boundary

Inspect final PageContentContract.

Every business fact provided to content generation must be verified and traceable.

Test an unsupported claim requirement.

Expected:

not silently converted into business fact

⸻

F. Structured Content Contract

Produce a real StructuredContentPackage.

Verify:

routes exact
sections exact
metadata present
required questions/topics represented
internal links represented
unsupported claims empty
contract hash exact

⸻

Required Verdict

GATE: BLUEPRINT_CONVERGENCE
VERDICT:
PASS | FAIL | BLOCKED_BY_ENVIRONMENT
WEBSITE_AUTHORITY:
...
SEO_AUTHORITY:
...
SIBLING_INDEPENDENCE:
...
SLOT_COMPILATION:
...
BUSINESS_FACT_SAFETY:
...
CONTENT_PACKAGE:
...
MUST_FIX_BEFORE_NEXT_GATE:
...

PASS required before Gate 4.

⸻

GATE 4 — Assembly and Build Proof

When to Run

After Website-Bot wires:

DesignIntelligence
ImageAssetPlanning
SiteAssembler
deterministic schema
SiteBuild

to the authoritative artifacts.

Mission

Prove the system builds the website it planned rather than reverting to generic generation.

⸻

A. Downstream Inputs

Trace every intelligence-consuming stage.

Expected:

DesignIntelligence
← WebsiteBuildBlueprint
content
← StructuredContentPackage
SiteAssembler
← WebsiteBuildBlueprint + StructuredContentPackage
schema
← approved structured content

Fail if downstream stages independently reread raw competitors and reinterpret architecture.

⸻

B. DesignIntelligence Constraint

Inspect prompts/input contracts.

The design step should translate approved strategy into:

tokens
typography
spacing
component treatments
visual relationships
responsive rules

It must not independently change:

routes
section order
content purpose
SEO targets

⸻

C. Deterministic Schema

Instrument LLM service.

Generate schema from approved structured content.

Expected:

LLM calls for schema serialization = 0

⸻

D. Real Build

Use one real target fixture/site.

Run the complete build up to candidate output.

Verify:

all planned routes exist
all required sections exist
content IDs map correctly
no broken internal references
assets resolve
type/build succeeds
responsive screenshots can be captured

⸻

E. Blueprint Conformance

Produce a machine-readable conformance report:

planned routes / actual routes
planned sections / actual sections
planned conversions / actual conversions
planned content slots / actual populated content

Fail on material silent omissions.

⸻

Required Verdict

GATE: ASSEMBLY_BUILD
VERDICT:
PASS | FAIL | BLOCKED_BY_ENVIRONMENT
DOWNSTREAM_AUTHORITY:
...
SCHEMA_DETERMINISM:
...
REAL_BUILD:
...
BLUEPRINT_CONFORMANCE:
...
MISSING_OR_MUTATED_REQUIREMENTS:
...
MUST_FIX_BEFORE_NEXT_GATE:
...

PASS required before Gate 5.

⸻

GATE 5 — Improvement Proof and Release Readiness

When to Run

After QualityDelta and bounded repair exist.

Mission

Answer the original product question:

Did Website-Bot actually make the website better?

A successful build is irrelevant if the redesign regressed materially.

⸻

A. Baseline Identity

Prove the baseline being compared is the exact source site evidence captured for this build.

Record:

baseline artifact/hash
candidate build/hash

No stale baseline.

⸻

B. Deterministic Checks

Evaluate at minimum:

broken links
missing routes
heading structure
required CTA presence
content completeness
SEO contract conformance
business-fact accuracy
accessibility checks
responsive overflow
asset failures

Record individual results, not only one aggregate score.

⸻

C. Visual Comparison

Capture equivalent viewport screenshots for baseline and candidate.

Evaluate:

visual hierarchy
legibility
spacing/coherence
mobile usability
conversion clarity
obvious rendering defects

Vision reasoning is allowed here.

It must identify evidence for each judgment.

⸻

D. No Fake Precision

Do not turn subjective visual judgments into arbitrary numbers such as:

baseline 71.8
candidate 86.4

unless an actual calibrated scoring mechanism exists.

Prefer:

IMPROVED
NON_REGRESSED
REGRESSED
INCONCLUSIVE

with evidence.

⸻

E. Repair Test

Intentionally introduce or use one known repairable defect.

Verify:

QualityDelta FAIL
→ RepairPlan identifies only failed dimensions
→ one repair
→ re-evaluate

Prove unrelated passing areas are not wholesale regenerated.

Then test a persistent failure.

Expected:

release stops

⸻

F. Release Gate

Release readiness requires:

build success
AND
business truth valid
AND
content contract valid
AND
no unresolved required SEO failures
AND
no material deterministic regression
AND
no material visual regression

Any waiver must be explicit and persisted.

No silent waiver.

⸻

Required Verdict

GATE: IMPROVEMENT_PROOF
VERDICT:
PASS | FAIL | BLOCKED_BY_ENVIRONMENT
BASELINE:
...
CANDIDATE:
...
DETERMINISTIC_DELTA:
...
VISUAL_DELTA:
...
REGRESSIONS:
...
REPAIR_RESULT:
...
WAIVERS:
...
RELEASE_READY:
YES | NO
MUST_FIX:
...

Only RELEASE_READY: YES counts as the end-to-end success condition.

⸻

GATE 6 — Full-System Golden Run

When to Run

After Gates 0–5 independently pass.

Mission

Prove the complete system works from one command/entrypoint without fixture substitution between stages.

Use one real representative website.

⸻

Execute

Run:

source site
   ↓
baseline/business truth
   ↓
real CompetitiveLandscape
   ↓
real donor cohort
   ↓
real donor analysis
   ↓
real PatternPortfolio
   ↓
real WebsiteBuildBlueprint
   ↓
real SEOContentBlueprint
   ↓
real deterministic PageContentContract
   ↓
real StructuredContentPackage
   ↓
real design/assembly
   ↓
real build
   ↓
real QualityDelta
   ↓
optional bounded repair
   ↓
release-ready candidate

Mocks are forbidden except external-network fixtures explicitly needed for repeatability in a separate control run.

⸻

Artifact Chain Audit

Produce the complete chain:

BaselineSiteProfile@...
CompetitiveLandscape@...
PatternPortfolio@...
WebsiteBuildBlueprint@...
SEOContentBlueprint@...
PageContentContract@...
StructuredContentPackage@...
CandidateBuild@...
QualityDeltaReport@...

For each record:

producer
artifact ID
digest
input refs
consumer

Every link must resolve.

⸻

LLM Call Audit

Output every LLM operation performed during the run:

operation
repository
task type
requiresSearch
requiresReasoning
resolved provider/model
input artifact refs

The verifier must then classify each:

EXPECTED
UNEXPECTED
FORBIDDEN

Hard FAIL on any FORBIDDEN.

Examples:

CompetitiveLandscape LLM call
→ FORBIDDEN
PageContentContract merge LLM call
→ FORBIDDEN
Website-Bot final page-copy generation
→ FORBIDDEN
Pattern synthesis strategic reasoning
→ EXPECTED
SEO structured content generation
→ EXPECTED
Visual delta reasoning
→ EXPECTED

⸻

Final Verdict

Return:

GATE: FULL_SYSTEM_GOLDEN_RUN
VERDICT:
PASS | FAIL | BLOCKED_BY_ENVIRONMENT
PRODUCT_OBJECTIVE:
Did the system produce a materially improved redesign?
YES | NO | INCONCLUSIVE
ARTIFACT_CHAIN:
...
LLM_CALL_AUDIT:
...
FAIL_CLOSED_BEHAVIOR:
...
QUALITY_DELTA:
...
RELEASE_READY:
YES | NO
TOP_5_DEFECTS:
...
NEXT_ACTION:

A complete system is not declared finished until this gate passes.

⸻

Operator Sequence

Run the gates in this exact order:

SEO-Bot implementation
        ↓
GATE 0
Website-Bot SEO adapter
        ↓
GATE 1
Website-Bot donor intelligence
        ↓
GATE 2
Website/SEO blueprint convergence
        ↓
GATE 3
assembly/build
        ↓
GATE 4
quality delta + repair
        ↓
GATE 5
complete real run
        ↓
GATE 6

Never start the next major implementation slice with a known failed previous gate.

⸻

Verification Doctrine

The verifier must distinguish:

IMPLEMENTED
TESTED
INTEGRATED
EXECUTED
PROVEN

These are not synonyms.

For example:

file exists
→ IMPLEMENTED maybe
unit test passes
→ TESTED
two repos exchange valid artifacts
→ INTEGRATED
real transaction completes
→ EXECUTED
negative cases + lineage + output quality confirmed
→ PROVEN

The objective of this pack is PROVEN.

⸻

Final Rule

Replace every future sentence of the form:

“If that works, proceed to X.”

with:

“Run Gate N. Proceed to X only on PASS.”

No architectural milestone is accepted on implementation claims alone.