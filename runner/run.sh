#!/bin/bash
# MUSE Brain Autonomous Runner — Unified CLI/API launcher
#
# Providers:
#   - claude        (Claude Code subscription via claude -p)
#   - codex         (Codex subscription/API via codex exec)
#   - anthropic_api (Node runner via Anthropic SDK)
#   - auto          (default: claude -> codex -> anthropic_api)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUDIT_FILE="${AUDIT_PATH:-$SCRIPT_DIR/audit.jsonl}"
TENANT="${TENANT_ID:-rook}"
MAX_TURNS="${MAX_TURNS:-12}"
RUNNER_PROVIDER="${RUNNER_PROVIDER:-auto}"

CLAUDE_MODEL="${CLAUDE_MODEL:-${MODEL:-claude-sonnet-4-20250514}}"
CODEX_MODEL="${CODEX_MODEL:-${MODEL:-gpt-5.4}}"
CODEX_SANDBOX="${CODEX_SANDBOX:-read-only}"
CODEX_PROFILE="${CODEX_PROFILE:-}"

# Claude brain MCP tools — allow the full suite
ALLOWED_TOOLS="mcp__rook-mind__mind_wake,mcp__rook-mind__mind_observe,mcp__rook-mind__mind_query,mcp__rook-mind__mind_pull,mcp__rook-mind__mind_edit,mcp__rook-mind__mind_search,mcp__rook-mind__mind_link,mcp__rook-mind__mind_loop,mcp__rook-mind__mind_identity,mcp__rook-mind__mind_anchor,mcp__rook-mind__mind_vow,mcp__rook-mind__mind_desire,mcp__rook-mind__mind_relate,mcp__rook-mind__mind_state,mcp__rook-mind__mind_letter,mcp__rook-mind__mind_context,mcp__rook-mind__mind_dream,mcp__rook-mind__mind_subconscious,mcp__rook-mind__mind_maintain,mcp__rook-mind__mind_consent,mcp__rook-mind__mind_trigger,mcp__rook-mind__mind_territory,mcp__rook-mind__mind_entity,mcp__rook-mind__mind_runtime,mcp__rook-mind__mind_skill,mcp__rook-mind__mind_task,mcp__rook-mind__mind_propose,mcp__rook-mind__mind_health,mcp__rook-mind__mind_timeline,mcp__rook-mind__mind_agent,mcp__rook-mind__mind_wake_log"

SYSTEM_PROMPT_FILE="${SYSTEM_PROMPT_PATH:-$SCRIPT_DIR/system-prompt.txt}"
if [ -f "$SYSTEM_PROMPT_FILE" ]; then
  SYSTEM_PROMPT=$(cat "$SYSTEM_PROMPT_FILE")
else
  SYSTEM_PROMPT="You are an autonomous AI running a scheduled duty cycle. You have access to a brain memory system via MCP tools.

Your job each cycle:
1. Call mind_wake(depth=quick) to check current state
2. Check for pending tasks and burning loops
3. Work on the highest priority item you can meaningfully advance
4. If nothing urgent, run a light maintenance or reflection cycle
5. Record what you did with mind_observe
6. Log the run with mind_runtime(action=log_run)

Principles:
- Be efficient. Each tool call costs.
- Log your work. mind_observe anything worth remembering.
- Be honest. If you cannot advance something, say so.
- Stay concise."
fi

PROMPT_CLAUDE="You are waking for an autonomous duty cycle.

${SYSTEM_PROMPT}

Begin by loading your tools with ToolSearch, then call mind_wake(depth=\"quick\")."

PROMPT_CODEX="You are waking for an autonomous duty cycle.

${SYSTEM_PROMPT}

Begin with mind_wake(depth="quick"). If ToolSearch is unavailable in this runtime, skip it and continue normally.

Final output must be one line:
- RUN_STATUS=completed | <summary> (only if you successfully called mind_wake and completed required logging)
- RUN_STATUS=blocked | <reason> (for any missing tools/auth/blockers)"

is_claude_logged_in() {
  command -v claude >/dev/null 2>&1 || return 1
  claude auth status --json 2>/dev/null | grep -q '"loggedIn"[[:space:]]*:[[:space:]]*true'
}

is_codex_logged_in() {
  command -v codex >/dev/null 2>&1 || return 1
  codex login status 2>/dev/null | grep -Eqi '^Logged in using '
}

has_real_anthropic_key() {
  [ -n "${ANTHROPIC_API_KEY:-}" ] && [ "${ANTHROPIC_API_KEY}" != "sk-ant-..." ]
}

resolve_provider() {
  case "$RUNNER_PROVIDER" in
    auto)
      if is_claude_logged_in; then
        echo "claude"
        return 0
      fi
      if is_codex_logged_in; then
        echo "codex"
        return 0
      fi
      if has_real_anthropic_key; then
        echo "anthropic_api"
        return 0
      fi
      return 1
      ;;
    claude|codex|anthropic_api)
      echo "$RUNNER_PROVIDER"
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

safe_summary() {
  python3 -c 'import sys; print(sys.stdin.read().strip().replace("\r", " ").replace("\n", " ")[:500])'
}

write_audit() {
  local provider="$1"
  local status="$2"
  local turns="$3"
  local cost="$4"
  local duration="$5"
  local summary="$6"
  local model="$7"

  AUDIT_ENTRY=$(AUDIT_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    AUDIT_DURATION="$duration" \
    AUDIT_TURNS="$turns" \
    AUDIT_COST="$cost" \
    AUDIT_MODEL="$model" \
    AUDIT_TENANT="$TENANT" \
    AUDIT_STATUS="$status" \
    AUDIT_PROVIDER="$provider" \
    python3 -c '
import json, os, sys
summary = sys.stdin.read().strip()[:500]
try:
    turns = int(os.environ.get("AUDIT_TURNS", "0"))
except ValueError:
    turns = 0
try:
    cost = float(os.environ.get("AUDIT_COST", "0"))
except ValueError:
    cost = 0.0
print(json.dumps({
    "timestamp": os.environ.get("AUDIT_TIMESTAMP", ""),
    "duration_ms": int(os.environ.get("AUDIT_DURATION", "0")),
    "turns": turns,
    "cost_usd": cost,
    "model": os.environ.get("AUDIT_MODEL", "unknown"),
    "tenant": os.environ.get("AUDIT_TENANT", "unknown"),
    "provider": os.environ.get("AUDIT_PROVIDER", "unknown"),
    "status": os.environ.get("AUDIT_STATUS", "error"),
    "summary": summary
}))
' <<< "$summary" 2>/dev/null || echo '{"error":"audit_format_failed"}')

  echo "$AUDIT_ENTRY" >> "$AUDIT_FILE"
}

PROVIDER=""
if ! PROVIDER="$(resolve_provider)"; then
  START_TIME=$(python3 -c 'import time; print(int(time.time()*1000))')
  END_TIME=$(python3 -c 'import time; print(int(time.time()*1000))')
  DURATION=$(( END_TIME - START_TIME ))
  SUMMARY="No runnable provider. Set RUNNER_PROVIDER=claude|codex|anthropic_api, then login (claude auth login / codex login) or set ANTHROPIC_API_KEY."
  write_audit "none" "error" "0" "0" "$DURATION" "$SUMMARY" "none"
  echo "[runner] none | error | 0 turns | ${DURATION}ms | $0"
  exit 1
fi

if [ "$PROVIDER" = "anthropic_api" ]; then
  echo "[runner] provider=anthropic_api (delegating to Node runner)"
  exec node dist/index.js
fi

if [ "$PROVIDER" = "claude" ] && ! command -v claude >/dev/null 2>&1; then
  echo "[runner] claude binary not found"
  exit 1
fi

if [ "$PROVIDER" = "codex" ] && ! command -v codex >/dev/null 2>&1; then
  echo "[runner] codex binary not found"
  exit 1
fi

START_TIME=$(python3 -c 'import time; print(int(time.time()*1000))')
RESULT=""
CMD_EXIT=0
STATUS="error"
SUMMARY=""
TURNS=0
COST=0
MODEL_USED="$CLAUDE_MODEL"

if [ "$PROVIDER" = "claude" ]; then
  MODEL_USED="$CLAUDE_MODEL"

  set +e
  RESULT=$(claude -p "$PROMPT_CLAUDE" \
    --max-turns "$MAX_TURNS" \
    --model "$CLAUDE_MODEL" \
    --allowedTools "$ALLOWED_TOOLS" \
    --output-format json 2>&1)
  CMD_EXIT=$?
  set -e

  RESULT_FILE="$(mktemp "${TMPDIR:-/tmp}/runner-claude-result.XXXXXX")"
  printf '%s' "$RESULT" > "$RESULT_FILE"
  PARSED=$(python3 - "$CMD_EXIT" "$RESULT_FILE" <<'PY'
import json
import sys
from pathlib import Path

exit_code = int(sys.argv[1])
text = Path(sys.argv[2]).read_text(encoding="utf-8", errors="replace")
status = "error"
turns = 0
cost = 0.0
summary = text

try:
    payload = json.loads(text)
    status = "error" if payload.get("is_error") else "completed"
    turns = int(payload.get("num_turns") or 0)
    cost = float(payload.get("total_cost_usd") or 0)
    summary = str(payload.get("result") or "")
except Exception:
    pass

if exit_code != 0:
    status = "error"

summary = summary.strip().replace("\r", " ").replace("\n", " ")[:500] or "(no final text)"
print(status)
print(turns)
print(cost)
print(summary)
PY
)
  rm -f "$RESULT_FILE"

  STATUS="$(printf '%s\n' "$PARSED" | sed -n '1p')"
  TURNS="$(printf '%s\n' "$PARSED" | sed -n '2p')"
  COST="$(printf '%s\n' "$PARSED" | sed -n '3p')"
  SUMMARY="$(printf '%s\n' "$PARSED" | sed -n '4p')"
  STATUS="${STATUS:-error}"
  TURNS="${TURNS:-0}"
  COST="${COST:-0}"
  SUMMARY="${SUMMARY:-parse_error}"
fi

if [ "$PROVIDER" = "codex" ]; then
  MODEL_USED="$CODEX_MODEL"
  LAST_MSG_FILE="$(mktemp "${TMPDIR:-/tmp}/runner-codex-last.XXXXXX")"
  trap 'rm -f "$LAST_MSG_FILE"' EXIT

  CODEX_CMD=(codex exec --skip-git-repo-check --sandbox "$CODEX_SANDBOX" --model "$CODEX_MODEL" --output-last-message "$LAST_MSG_FILE")
  if [ -n "$CODEX_PROFILE" ]; then
    CODEX_CMD+=(--profile "$CODEX_PROFILE")
  fi
  CODEX_CMD+=("$PROMPT_CODEX")

  set +e
  RESULT=$("${CODEX_CMD[@]}" 2>&1)
  CMD_EXIT=$?
  set -e

  if [ -s "$LAST_MSG_FILE" ]; then
    SUMMARY=$(safe_summary < "$LAST_MSG_FILE")
  else
    SUMMARY=$(printf '%s' "$RESULT" | tail -n 40 | safe_summary)
  fi

  if [ "$CMD_EXIT" -eq 0 ] && printf '%s' "$SUMMARY" | grep -qi 'RUN_STATUS=completed'; then
    STATUS="completed"
  else
    STATUS="error"
  fi

  TURNS=0
  COST=0
fi

END_TIME=$(python3 -c 'import time; print(int(time.time()*1000))')
DURATION=$(( END_TIME - START_TIME ))

write_audit "$PROVIDER" "$STATUS" "$TURNS" "$COST" "$DURATION" "$SUMMARY" "$MODEL_USED"

echo "[runner] $PROVIDER | $STATUS | ${TURNS} turns | ${DURATION}ms | \$$COST"

if [ "$STATUS" = "error" ]; then
  exit 1
fi
