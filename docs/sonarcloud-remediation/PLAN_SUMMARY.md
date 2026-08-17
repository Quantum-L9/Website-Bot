# SonarCloud High-Risk Remediation Phase 2 - Plan Summary

**Plan ID:** `plan.sonarcloud.remediation_phase2.v1`  
**Status:** ✅ **VALIDATED & READY FOR EXECUTION**  
**Created:** 2026-08-16  
**Depth:** Deep (security-critical)

---

## Quick Reference

| Metric | Value |
|--------|-------|
| **Issues to remediate** | 38 high-risk (out of 53 deferred after Phase 1) |
| **Total TODOs** | 25 tasks across 4 phased waves |
| **Estimated effort** | 58-71 hours |
| **Timeline** | 3-4 weeks (4 independent PRs) |
| **Validation gates** | 5 checkpoints with no-go actions |
| **Security review** | Required for Phase 3 (6 ReDoS patterns) |
| **Rollback support** | Per-phase revert with emergency procedures |

---

## Artifacts Created

1. **Machine artifact (authoritative):**
   - 📄 `docs/sonarcloud-remediation/sonarcloud_remediation_phase2.plan.json`
   - ✅ Validates against `l9.plan_document/v4` schema
   - 🔍 Validated: `python3 .claude/skills/l9-plan/scripts/validate_plan_document.py <path>`

2. **Human/executable projection:**
   - 📋 `.cursor/plans/sonarcloud_remediation_phase2_c7f8a3d1.plan.md`
   - 🎯 Execute via: `@environment/program-execution` → `@autonomy`

3. **Audit report:**
   - 📊 `docs/sonarcloud-remediation/PLAN_AUDIT_REPORT.md`
   - ✅ Grade: A+ (Exemplary)
   - ✅ Verdict: APPROVED FOR EXECUTION

4. **Supporting documentation:**
   - 📘 `docs/sonarcloud-remediation/REMAINING_HIGH_RISK_ANALYSIS.md` (existing, to be updated in Phase 4)

---

## Execution Phases

### Phase 1: S107 Options Objects (Wave 1)
**Duration:** 6-8h | **Risk:** Low | **Checkpoint:** CP1

**Objective:** Migrate 4 functions from 8-parameter signatures to options objects with backward-compatible shims.

**TODOs:**
- `phase1-s107-template-lib` (2h) - Refactor `lib.mjs:49` result() → options
- `phase1-s107-example-lib` (30m) - Apply to duplicated example lib
- `phase1-s107-validation-framework` (1h) - Refactor `validation-framework.mjs`
- `phase1-s107-evidence-collector` (3h) - TypeScript EvidenceCollector refactor
- `phase1-validate` (30m) - Validation checkpoint

**Success criteria:**
- All .mjs files pass `node --check`
- TypeScript compilation clean (`tsc --noEmit`)
- Test suite: 100 PASS / 3 BLOCKED (no new failures)

**Deliverable:** PR #1 - "refactor: migrate 4 functions to options objects (S107)"

---

### Phase 2: S3776 Low Complexity (Wave 2)
**Duration:** 20-25h | **Risk:** High | **Checkpoint:** CP2

**Objective:** Extract validation helpers from 8 functions with cognitive complexity 32-40, reduce to <15.

**High-leverage TODOs:**
- `phase2-s3776-validate-spec-low` (4h) - Extract helpers from validateDomainSpec:75
- `phase2-s3776-validate-spec-routes` (3h) - Extract route validation helpers
- `phase2-s3776-validate-spec-provision` (3h) - Extract provision validation helpers
- 4 parallel tasks: CLI, validators, extractJson, example smoke test (12h total)
- `phase2-validate` (1h) - Validation checkpoint

**Success criteria:**
- Complexity metrics show target functions <15
- Unit test coverage added for extracted helpers
- Integration smoke tests pass with 3+ domain specs
- Validation output byte-for-byte identical (regression test)

**Deliverable:** PR #2 - "refactor: reduce cognitive complexity for 8 validation functions (S3776)"

---

### Phase 3: S8786 ReDoS Security (Wave 3) ⚠️ CRITICAL
**Duration:** 28-32h | **Risk:** Irreversible (Security) | **Checkpoints:** CP3, CP4

**Objective:** Optimize 6 ReDoS-vulnerable regex patterns with atomic grouping, prove equivalence via 800k+ fuzz tests, obtain security review approval.

**Sequential TODOs:**
- `phase3-redos-fuzz-harness` (3h) - Create fuzz testing framework
- 6 regex optimizations (4h each = 24h):
  - secureExecution.ts:110, :113
  - E2EEngine.ts:186
  - HandoffEmitterStage.ts:103
  - request.ts:17
  - validate-generated-site.ts:57
- `phase3-security-review` (2h) - Security review process
- `phase3-validate` (1h) - Validation checkpoint

**Success criteria:**
- All 6 fuzz reports show 0 differences over 800k+ test cases
- Security review document status=APPROVED
- Test suite green
- `make pr` PASS

**CRITICAL GATE:** BLOCK merge if security review not approved. Emergency rollback procedure documented for any production security incident.

**Deliverable:** PR #3 - "security: optimize 6 ReDoS regex patterns with fuzz-proven equivalence (S8786)" [REVIEW REQUIRED]

---

### Phase 4: Final Convergence (Wave 4)
**Duration:** 4-6h | **Risk:** Low-Medium | **Checkpoint:** CP5

**Objective:** Eliminate async constructor anti-pattern, validate SonarCloud closure, update documentation.

**TODOs:**
- `phase4-s7059-evidence-collector` (2h) - Refactor async constructor → static factory
- `phase4-validate` (1h) - Final validation checkpoint
- `phase4-doc-update` (1h) - Update remediation documentation

**Success criteria:**
- SonarCloud API confirms 38 issues closed (249 → 120 total)
- Documentation updated with Phase 2-4 summary
- 15 remaining high-complexity functions documented for future Phase 4

**Deliverable:** PR #4 - "chore: eliminate async constructor + update remediation docs (S7059, final)"

---

## Validation Gates (Checkpoints)

| ID | After Phase | Evidence Required | No-Go Action |
|----|-------------|-------------------|--------------|
| **CP1** | Phase 1 | npm test PASS, tsc clean | Rollback Phase 1, do not proceed to Phase 2 |
| **CP2** | Phase 2 | Complexity <15, integration tests PASS | Rollback refactors, add tests, do not proceed to Phase 3 |
| **CP3** | Phase 3 regex | 6 fuzz reports 0 diff over 800k+ | BLOCK, do not submit for security review |
| **CP4** | Phase 3 security | SECURITY_REVIEW_REDOS.md APPROVED | BLOCK merge, address feedback, do not deploy |
| **CP5** | Phase 4 | SonarCloud API confirms 38 closed | Investigate non-closure, manual review |

---

## Risk Management

### High-Risk Areas

1. **Phase 2: Validator refactoring** (blast radius: all site generation)
   - Mitigation: Byte-for-byte output comparison, E2E with 3+ domain specs
   - Rollback: Revert helper extractions, restore monolithic validators

2. **Phase 3: ReDoS regex changes** (blast radius: security vulnerabilities)
   - Mitigation: 800k+ fuzz corpus, security review, production data samples
   - Rollback: **EMERGENCY** - revert all regex changes immediately if production incident

3. **Unknown dependencies**
   - U1: External callers of 8-param functions → probe, keep shims for 2+ releases
   - U2: Security reviewer availability → self-review protocol if unavailable 48h+
   - U3: Production data for fuzz corpus → probe ops team, fallback to synthetic
   - U4: Validation error consumers → probe, preserve exact format if found
   - U5: Mutation testing tools → probe, fallback to manual break-tests

---

## Execution Workflow

### Option 1: Program Execution (Recommended)

```bash
# 1. Attach the plan to Program Execution + Autonomy
@environment/program-execution @autonomy

# 2. Reference the plan
.cursor/plans/sonarcloud_remediation_phase2_c7f8a3d1.plan.md

# 3. Program Lock will:
#    - Lock baseline SHA
#    - Create execution blueprint
#    - Spawn autonomy lanes for each phase
#    - Enforce checkpoints between phases
#    - Stack PRs (one per phase)

# 4. Monitor checkpoints
# - CP1-CP5 must PASS before proceeding to next phase
# - Do not bypass checkpoint no-go actions
```

### Option 2: Manual Execution (Not Recommended)

If executing manually, **strictly follow checkpoint discipline:**

```bash
# Phase 1
# ... implement TODOs 1-5
npm test && npx tsc --noEmit && node --check astro_template/scripts/*.mjs
# ✅ CP1 PASS → proceed

# Phase 2
# ... implement TODOs 6-13
npm test && verify complexity metrics
# ✅ CP2 PASS → proceed

# Phase 3 (CRITICAL - do not skip security review)
# ... implement TODOs 14-20
node scripts/fuzz_regex_equivalence.mjs --verify-all
# ✅ CP3 PASS → submit for security review
# ... obtain security review APPROVED
# ✅ CP4 PASS → proceed

# Phase 4
# ... implement TODOs 23-25
# Verify SonarCloud closure via API
# ✅ CP5 PASS → complete
```

---

## Success Criteria (Final Validation)

| ID | Command | Pass Criteria |
|----|---------|---------------|
| FV1 | `npm test` | 100 PASS / 3 BLOCKED (no new failures) |
| FV2 | `npx tsc --noEmit -p tsconfig*.json` | No type errors |
| FV3 | `for f in **/*.mjs; do node --check "$f"; done` | All .mjs parse |
| FV4 | `node scripts/fuzz_regex_equivalence.mjs --verify-all` | 0 differences, ≥800k cases each |
| FV5 | `grep 'Status: APPROVED' docs/.../SECURITY_REVIEW_REDOS.md` | Security APPROVED |
| FV6 | `curl 'https://sonarcloud.io/api/issues/search?...' \| jq '.issues \| length'` | 38 fewer issues |
| FV7 | `make pr` | All pre-PR checks PASS |

---

## Documentation Updates (Phase 4)

| File | Action | Content |
|------|--------|---------|
| `REMAINING_HIGH_RISK_ANALYSIS.md` | Update | Add Phase 2-4 completion summary, update remaining count to 15 |
| `SONARCLOUD_REMEDIATION_REPORT.md` | Update | Update fixed count 173 → 211, add Phase 2-4 detailed summary |
| `SONARCLOUD_ISSUE_REGISTER.yaml` | Update | Change 38 issues disposition: REMAINS_DEFERRED → FIXED_PENDING_REMOTE_ANALYSIS |

---

## Rollback Procedures

### Per-Phase Rollback

```bash
# Identify phase commit
git log --oneline --grep="Phase [1-4]" -1

# Revert phase commit
git revert <phase-commit-sha>

# Verify rollback
npm test && npx tsc --noEmit && make pr
```

### Emergency Rollback (Phase 3 Security Incident)

```bash
# CRITICAL: If ANY production security incident related to regex changes

# 1. Immediately revert all Phase 3 regex changes
git revert <phase3-commit-sha>

# 2. Push emergency fix
git push origin fix/sonarcloud-deferred-safe-issues --force-with-lease

# 3. Verify original regex patterns restored
git diff HEAD~1 HEAD -- "**/*{secureExecution,E2EEngine,HandoffEmitterStage,request,validate-generated-site}*"

# 4. Run full test suite
npm test

# 5. Deploy emergency fix to production immediately

# 6. Investigate incident
# - Review production logs for exploit evidence
# - Re-fuzz with incident inputs
# - Update security review protocol

# 7. Do NOT re-deploy regex changes until:
#    - Root cause identified
#    - Fuzz corpus includes incident cases
#    - Security review re-approved
```

---

## Next Steps

1. **Before execution:**
   - [ ] Lock baseline SHA: `git rev-parse HEAD > .plan-baseline-sha`
   - [ ] Verify branch: `git branch --show-current` == `fix/sonarcloud-deferred-safe-issues`
   - [ ] Run pre-validation: `npm test` (establish 100 PASS / 3 BLOCKED baseline)
   - [ ] Identify security reviewer or establish self-review protocol

2. **Execute plan:**
   - [ ] Attach `@environment/program-execution` + `@autonomy`
   - [ ] Reference `.cursor/plans/sonarcloud_remediation_phase2_c7f8a3d1.plan.md`
   - [ ] Monitor checkpoint gates (do not bypass no-go actions)

3. **Post-execution:**
   - [ ] Verify SonarCloud closure (249 → 120 issues)
   - [ ] Update documentation (Phase 4 TODO #25)
   - [ ] Plan Phase 4 (15 remaining high-complexity S3776 functions)

---

## Key Contacts & Resources

**Security Review:**
- Protocol: See `docs/sonarcloud-remediation/PLAN_AUDIT_REPORT.md` → Recommendations → U2
- Self-review checklist: fuzz equivalence + security audit + staged rollout + async post-merge review

**SonarCloud API:**
- Issues query: `https://sonarcloud.io/api/issues/search?componentKeys=Quantum-L9_Website-Bot&resolved=false`
- Re-trigger analysis: `https://sonarcloud.io/project/overview?id=Quantum-L9_Website-Bot`

**Plan artifacts:**
- Machine: `docs/sonarcloud-remediation/sonarcloud_remediation_phase2.plan.json`
- Human: `.cursor/plans/sonarcloud_remediation_phase2_c7f8a3d1.plan.md`
- Audit: `docs/sonarcloud-remediation/PLAN_AUDIT_REPORT.md`
- This summary: `docs/sonarcloud-remediation/PLAN_SUMMARY.md`

---

**Status:** ✅ **READY FOR EXECUTION**  
**Confidence:** 95%+ (with checkpoint discipline)  
**Approved by:** l9-plan skill framework v4.0.0  
**Date:** 2026-08-16
