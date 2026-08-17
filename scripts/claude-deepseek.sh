#!/usr/bin/env bash
set -euo pipefail

# Launch Claude Code against DeepSeek from THIS clone.
# Do not use ~/.cursor-governance/scripts/claude-deepseek.sh here — that cds into governance.
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ROOT}/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${DEEPSEEK_API_KEY:-}" || "${DEEPSEEK_API_KEY}" == "sk-REPLACE_ME" ]]; then
  echo "ERROR: set DEEPSEEK_API_KEY in .env.local" >&2
  exit 1
fi

export ANTHROPIC_AUTH_TOKEN="${DEEPSEEK_API_KEY}"
unset ANTHROPIC_API_KEY || true

export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://api.deepseek.com/anthropic}"
export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-deepseek-v4-pro[1m]}"
export ANTHROPIC_DEFAULT_OPUS_MODEL="${ANTHROPIC_DEFAULT_OPUS_MODEL:-deepseek-v4-pro[1m]}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="${ANTHROPIC_DEFAULT_SONNET_MODEL:-deepseek-v4-pro[1m]}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${ANTHROPIC_DEFAULT_HAIKU_MODEL:-deepseek-v4-flash}"
export CLAUDE_CODE_SUBAGENT_MODEL="${CLAUDE_CODE_SUBAGENT_MODEL:-deepseek-v4-flash}"
export CLAUDE_CODE_EFFORT_LEVEL="${CLAUDE_CODE_EFFORT_LEVEL:-max}"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW="${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-786432}"

echo "Claude Code -> ${ANTHROPIC_BASE_URL} (${ANTHROPIC_MODEL})"
cd "$ROOT"

# The Cursor plugin launches this wrapper with a minimal PATH that lacks
# Homebrew/nvm dirs, so resolve the claude binary explicitly.
CLAUDE_BIN="${CLAUDE_BIN:-}"
if [[ -z "$CLAUDE_BIN" ]]; then
  for candidate in \
    "$(command -v claude 2>/dev/null || true)" \
    /opt/homebrew/bin/claude \
    "$HOME"/.nvm/versions/node/*/bin/claude \
    "$HOME/.local/bin/claude" \
    /usr/local/bin/claude; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      CLAUDE_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$CLAUDE_BIN" || ! -x "$CLAUDE_BIN" ]]; then
  echo "ERROR: claude binary not found or not executable (CLAUDE_BIN='${CLAUDE_BIN:-}'). Install Claude Code or fix CLAUDE_BIN." >&2
  exit 127
fi

echo "claude binary: ${CLAUDE_BIN}"
exec "$CLAUDE_BIN" "$@"
