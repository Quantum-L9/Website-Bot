#!/usr/bin/env bash
# §26 REAL GOLDEN RUN ORCHESTRATOR — Safe Haven REDESIGN_IMPROVE.
#
# Runs exactly ONE frozen end-to-end pipeline, then builds the normalized
# receipt, runs the verifier, and persists golden-oracle-result.json.
#
# DEPLOYMENT SCOPE: PREVIEW ONLY. This script hard-fails on any request for a
# production deploy. VERCEL_TARGET is forced to "preview" (the stage's own
# default) and WEBSITE_BOT_ALLOW_PRODUCTION must remain unset/false. The client
# production site (safehavenrr.com) is Cloudflare-hosted and is NEVER touched
# by this run. The Vercel deploy exists only to give the pipeline's visual-qa
# stage a rendered URL; the blind pairwise oracle is run locally afterwards.
#
# The product is FROZEN for the duration: this script never mutates source.
#
# Usage:
#   L9_GOLDEN_RUN_ID=<id> bash scripts/golden-safehaven/run-golden-e2e.sh
set -euo pipefail

WT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$WT"

# ---- Production deploy guard (fail closed, no way around it here) ----
if [ "${VERCEL_TARGET:-}" = "production" ] || [ "${WEBSITE_BOT_ALLOW_PRODUCTION:-}" = "true" ]; then
  echo "REFUSED: this golden-run orchestrator never deploys to production." >&2
  exit 2
fi
export VERCEL_TARGET="preview"

# Operator-provisioned secrets (gitignored). Exported for every child script;
# values never logged. run-pipeline.ts also loads it itself.
set -a
[ -f .env.local ] && source .env.local
set +a

RUN_ID="${L9_GOLDEN_RUN_ID:?set L9_GOLDEN_RUN_ID}"
CLIENT_ID="${L9_GOLDEN_CLIENT_ID:-safehavenrr}"
SPEC="${L9_GOLDEN_SPEC:-fixtures/safehavenrr-golden-spec.yaml}"
RUN_ROOT="build/golden/${RUN_ID}"
mkdir -p "${RUN_ROOT}"

echo "== golden run ${RUN_ID} =="
echo "website-bot sha: $(git rev-parse HEAD)"
echo "vercel target: ${VERCEL_TARGET} (production hard-blocked)"

# ---- 1. Pre-test gates (§25, §21/§22 must already be COMPLETE) ----
node scripts/audit-safehaven-oracle-coverage.mjs
node scripts/audit-safehaven-oracle-soundness.mjs
node scripts/golden-safehaven/calibrate-oracle.mjs >/dev/null && echo "calibration: COMPLETE"

# ---- 2. Product pipeline (frozen; no source mutation) ----
# end-to-end mode: all stages incl. visual-qa; redesign surface required.
npx tsx scripts/run-pipeline.ts \
  --mode=end-to-end \
  --spec="${SPEC}" \
  --build-id="${RUN_ID}" \
  --redesign \
  2>&1 | tee "${RUN_ROOT}/pipeline.log"

# ---- 3. Resolve the run's evidence locations ----
BUILD_ID="$(ls -1dt "build/evidence/${CLIENT_ID}/"*/ | head -1 | xargs basename 2>/dev/null || echo "${RUN_ID}")"
EVIDENCE_DIR="build/evidence/${CLIENT_ID}/${BUILD_ID}"
ASSETS_DIR="build/assets/${CLIENT_ID}/${BUILD_ID}"
SITE_DIR="build/sites/${CLIENT_ID}/dist"
echo "evidence: ${EVIDENCE_DIR}"
echo "assets:   ${ASSETS_DIR}"
echo "site:     ${SITE_DIR}"

# ---- 4. SEO-Bot evidence collection (preflight + audit) ----
node scripts/golden-safehaven/collect-seo-bot-evidence.mjs \
  --build-id "${BUILD_ID}" \
  --out "${RUN_ROOT}/seo-bot-evidence" \
  || echo "WARN: seo-bot evidence collector failed (adapter must record missing producers)"

# ---- 5. Site integrity + normalized receipt ----
node scripts/golden-safehaven/check-site-integrity.mjs \
  --case tests/golden/safehaven/case.json \
  --site-dir "${SITE_DIR}" \
  --out "${RUN_ROOT}/site-integrity.json"

node scripts/golden-safehaven/build-receipt.mjs \
  --client-id "${CLIENT_ID}" \
  --build-id "${BUILD_ID}" \
  --evidence-dir "${EVIDENCE_DIR}" \
  --assets-dir "${ASSETS_DIR}" \
  --site-dir "${SITE_DIR}" \
  --db .l9/data/website-bot.db \
  --case tests/golden/safehaven/case.json \
  --run-id "${RUN_ID}" \
  --site-integrity "${RUN_ROOT}/site-integrity.json" \
  --seo-bot-evidence "${RUN_ROOT}/seo-bot-evidence" \
  --out "${RUN_ROOT}/receipt.json"

# ---- 6. Blind visual oracle (§17-§20) ----
node scripts/golden-safehaven/capture-visual.mjs \
  --case tests/golden/safehaven/case.json \
  --baseline-url https://www.safehavenrr.com \
  --candidate-url http://localhost:4173 \
  --run-id "${RUN_ID}" \
  --out "${RUN_ROOT}/visual" \
  || { echo "capture failed"; exit 1; }

node scripts/golden-safehaven/run-visual-trials.mjs \
  --visual "${RUN_ROOT}/visual" \
  --judge tests/golden/safehaven/visual-judge.md \
  --case tests/golden/safehaven/case.json \
  --max-pairs 10

node scripts/golden-safehaven/aggregate-visual.mjs \
  --visual "${RUN_ROOT}/visual" \
  --oracle tests/golden/safehaven/oracle.json

# ---- 7. Verifier (the only judge) ----
node scripts/verify-safehaven-golden.mjs \
  tests/golden/safehaven/case.json \
  "${RUN_ROOT}/receipt.json" \
  > "${RUN_ROOT}/golden-oracle-result.json" || true

python3 -c "import json; d=json.load(open('${RUN_ROOT}/golden-oracle-result.json')); print('VERDICT:', d.get('verdict'))"
echo "== run ${RUN_ID} complete; artifacts under ${RUN_ROOT} =="
