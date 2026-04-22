# Agent Learning Bridge (v6 Addendum)

**Date:** 2026-04-22  
**Status:** In progress (bridge live, direct subagent MCP access pending)

## Why this exists

Named specialists already learn in local files:

`~/.claude/agents/memory/<agent>/*.md`

But Claude Code subagents do not directly call MCP tools in-run, so those learnings are not automatically written to brain observations unless a parent agent proxies them.

This bridge closes that gap now.

---

## What ships in v6 addendum

1. **Backfill + repeat sync script**
   - `scripts/agent-memory-sync.mjs`
   - Reads local agent memory markdown files
   - Writes observations to brain via authenticated `/mcp` (`mind_observe`)
   - Uses a hash ledger state file for idempotency (`.brain-sync-state.json`)

2. **Operational protocol**
   - Run backfill once for core specialists.
   - Run sync regularly (or after major specialist runs).
   - Verify via `mind_query` and `mind_entity` observation links.

3. **Honest claim boundary**
   - Current: bridge-based synchronization (local memory -> brain)
   - Pending: direct in-run subagent brain writes with agent-scoped credentials

---

## Runbook

```bash
cd muse-brain

# Dry run first (no writes)
npm run agent-memory:sync -- --dry-run --agent michael

# Real sync (requires key)
MUSE_BRAIN_API_KEY=... \
MUSE_BRAIN_BASE_URL=https://<brain-host> \
npm run agent-memory:sync -- --tenant rainer
```

Optional flags:

- `--source <path>` custom memory root
- `--agent <name>` limit to one/many agents (repeatable)
- `--limit <n>` cap new entries per run
- `--state <path>` custom state ledger location

---

## Verification checklist

- [ ] dry-run shows expected entries
- [ ] sync reports successful writes
- [ ] `mind_query query=\"<agent> learning\"` returns new observations
- [ ] agent entities show linked observations
- [ ] rerun sync produces near-zero duplicates (idempotent ledger works)

---

## Next step (post-v6)

Implement direct Agent API ingest (`/api/v1/agent/observe`) with agent-scoped keys and audit trails so subagents can log in real time without proxy scripting.
