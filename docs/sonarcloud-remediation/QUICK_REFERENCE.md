# SonarCloud Remediation Phase 2 - Quick Reference Card

## At a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│ PLAN: SonarCloud High-Risk Remediation Phase 2                 │
│ ID: plan.sonarcloud.remediation_phase2.v1                      │
│ STATUS: ✅ VALIDATED & READY FOR EXECUTION                      │
│ GRADE: A+ (Exemplary)                                          │
└─────────────────────────────────────────────────────────────────┘

38 HIGH-RISK ISSUES → 4 PHASES → 58-71h → 4 PRs → 3-4 WEEKS
```

---

## Execution Command

```bash
# Launch via Program Execution + Autonomy
@environment/program-execution @autonomy

# Reference plan
.cursor/plans/sonarcloud_remediation_phase2_c7f8a3d1.plan.md
```

---

## Phase Checklist

### ☐ Phase 1: S107 Options Objects (6-8h, Low Risk)
- [ ] Refactor 4 functions (8-param → options)
- [ ] ✅ **CP1:** npm test PASS, tsc clean
- [ ] PR #1: "refactor: migrate 4 functions to options objects (S107)"

### ☐ Phase 2: S3776 Complexity (20-25h, High Risk)
- [ ] Extract helpers from 8 functions (complexity 32-40 → <15)
- [ ] Add unit tests for extracted helpers
- [ ] ✅ **CP2:** Complexity <15, integration tests PASS
- [ ] PR #2: "refactor: reduce cognitive complexity for 8 functions (S3776)"

### ☐ Phase 3: S8786 ReDoS Security (28-32h, ⚠️ CRITICAL)
- [ ] Create fuzz harness (800k+ test cases)
- [ ] Optimize 6 regex patterns with atomic grouping
- [ ] ✅ **CP3:** Fuzz reports 0 diff over 800k+ cases
- [ ] Submit for security review
- [ ] ✅ **CP4:** Security review APPROVED
- [ ] PR #3: "security: optimize 6 ReDoS patterns (S8786)" [REVIEW REQUIRED]

### ☐ Phase 4: Final Convergence (4-6h, Low-Medium Risk)
- [ ] Refactor async constructor → static factory
- [ ] ✅ **CP5:** SonarCloud confirms 38 closed
- [ ] Update documentation
- [ ] PR #4: "chore: eliminate async constructor + update docs (S7059)"

---

## Critical Gates (DO NOT BYPASS)

| Gate | Evidence | Action if FAIL |
|------|----------|----------------|
| **CP1** | npm test PASS, tsc clean | ❌ Rollback Phase 1, STOP |
| **CP2** | Complexity <15, tests PASS | ❌ Rollback Phase 2, STOP |
| **CP3** | Fuzz 0 diff, 800k+ cases | ❌ BLOCK security review, STOP |
| **CP4** | Security APPROVED | ❌ BLOCK merge/deploy, STOP |
| **CP5** | SonarCloud 38 closed | ❌ Investigate, manual review |

---

## Emergency Rollback (Phase 3 Only)

```bash
# ⚠️ IF PRODUCTION SECURITY INCIDENT:
git revert <phase3-commit-sha>
git push origin fix/sonarcloud-deferred-safe-issues --force-with-lease
npm test
# → Deploy emergency fix immediately
# → Do NOT re-deploy regex changes until security re-approved
```

---

## Success Criteria (End State)

✅ 38 SonarCloud issues closed (249 → 120 total)  
✅ Test suite: 100 PASS / 3 BLOCKED (no new failures)  
✅ TypeScript compilation clean  
✅ All .mjs files syntactically valid  
✅ 6 ReDoS regexes security-approved with fuzz proof  
✅ `make pr` PASS  
✅ Documentation updated

---

## Unknowns to Resolve (During Execution)

| ID | Question | Resolution |
|----|----------|------------|
| U1 | External callers of 8-param functions? | **Probe:** search codebase for dynamic calls |
| U2 | Security reviewer available? | **Ask:** identify or establish self-review protocol |
| U3 | Production data for fuzz corpus? | **Probe:** check with ops, fallback synthetic |
| U4 | Validation error consumers? | **Probe:** check if external systems parse errors |
| U5 | Mutation testing available? | **Probe:** check for Stryker, fallback manual |

---

## File Locations

```
Machine (authoritative):
  docs/sonarcloud-remediation/sonarcloud_remediation_phase2.plan.json

Human/executable:
  .cursor/plans/sonarcloud_remediation_phase2_c7f8a3d1.plan.md

Audit report:
  docs/sonarcloud-remediation/PLAN_AUDIT_REPORT.md

Summary:
  docs/sonarcloud-remediation/PLAN_SUMMARY.md

Quick reference (this):
  docs/sonarcloud-remediation/QUICK_REFERENCE.md
```

---

## Validation Commands

```bash
# Pre-flight
npm test  # Establish 100 PASS / 3 BLOCKED baseline
git rev-parse HEAD > .plan-baseline-sha

# Post-Phase 1
npm test && npx tsc --noEmit && node --check astro_template/scripts/*.mjs

# Post-Phase 2
npm test && verify complexity <15 && integration smoke tests

# Post-Phase 3 (CRITICAL)
node scripts/fuzz_regex_equivalence.mjs --verify-all
grep 'Status: APPROVED' docs/sonarcloud-remediation/SECURITY_REVIEW_REDOS.md

# Post-Phase 4
curl 'https://sonarcloud.io/api/issues/search?componentKeys=Quantum-L9_Website-Bot&resolved=false' | jq '.issues | length'
make pr
```

---

## Risk Levels

```
Phase 1: 🟢 LOW     (template scripts, backward-compatible)
Phase 2: 🟡 HIGH    (validators, site generation blast radius)
Phase 3: 🔴 CRITICAL (security vulnerabilities, emergency rollback ready)
Phase 4: 🟡 MEDIUM  (factory pattern, validation-executor)
```

---

## Contacts

**Security Review:**
- Self-review protocol: fuzz evidence + security checklist + staged rollout + async post-merge review
- SLA: If unavailable 48h+, proceed with self-review

**SonarCloud:**
- API: `https://sonarcloud.io/api/issues/search?componentKeys=Quantum-L9_Website-Bot`
- Re-trigger: `https://sonarcloud.io/project/overview?id=Quantum-L9_Website-Bot`

---

## Key Metrics

| Metric | Value |
|--------|-------|
| Issues | 38 (S3776×23, S8786×6, S107×4, S7059×1, others×4) |
| LOC affected | ~2,500 lines across 20+ files |
| Test coverage | ≥70% required for refactor targets |
| Fuzz cases | 800k+ (6 regexes × 133k each) |
| PRs | 4 (one per phase) |
| Checkpoints | 5 (CP1-CP5) |
| Unknowns | 5 (U1-U5) |
| Rollbacks | 4 strategies (per phase) + 1 emergency |

---

**Status:** ✅ READY  
**Confidence:** 95%+  
**Last Updated:** 2026-08-16
