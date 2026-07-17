#!/usr/bin/env bash
set -euo pipefail
cd .
export L9_FINDING_ID=AUD-003
export L9_TASK_FILE=reports/07-17-2026/tasks/task-AUD-003.yaml
export L9_FOLLOWUP_FILE=reports/07-17-2026/tasks/followup-AUD-003.json
export L9_VALIDATOR_PHASE=pre_push
echo "L9 validator stub: ${L9_FINDING_ID} pre-push"
make ci
