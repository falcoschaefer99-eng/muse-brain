# Agent Learning Bridge (v6 Addendum)

**Date:** 2026-04-22  
**Status:** Active baseline (bridge live + full backfill + delta sync complete; direct subagent MCP access pending)

## Why this exists

Named specialists learn in local files (`~/.claude/agents/memory/<agent>/*.md`), but Claude Code subagents can't call MCP in-run — so those learnings don't reach the brain unless a parent proxies them. This bridge closes the gap.

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
   - Normalize agent identity mapping so synced rows attach to canonical `entity_type=agent` entities.

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

- [x] dry-run shows expected entries
- [x] sync reports successful writes
- [x] `mind_query query=\"<agent> learning\"` returns new observations
- [x] agent entities show linked observations (`mind_entity get(name=\"june\", include_observations=true)` verified)
- [x] rerun sync produces near-zero duplicates (idempotent ledger works)
- [ ] canonical `entity_type=agent` normalization complete for all specialists

### First production receipt (April 22, 2026; private endpoint redacted)

- Endpoint: private deployment
- Tenant: `rainer`
- Result: `106 sent / 0 failed`
- Idempotency rerun: `0 new`
- Source scan: 29 local agent memory files

### Delta production receipt (April 23, 2026; private endpoint redacted)

- Endpoint: private deployment
- Tenant: `rainer`
- Result: `10 sent / 0 failed` (Dupin + June additions)
- Cumulative synced total: `116`
- Idempotency rerun: `0 new`
- Source coverage: 31 agent directories, 29 markdown-bearing files (6 empty scaffolds awaiting first writes)

---

## Next step (post-v1.7.0 / v1.8.0 trust layer)

Do **not** redesign this bridge. Extend it as part of the v1.8.0 Agent House trust layer.

Public release scope file: **[MUSE Brain 1.8 — Agent House Foundations](RELEASE_SPEC_v1.8_AGENT_HOUSE_FOUNDATIONS.md)**.

Required bridge extension:

- local files such as `.claude/agents/memory/michael/` continue to sync through `scripts/agent-memory-sync.mjs`
- bridge writes are wrapped in a lease envelope
- audit metadata includes:
  - `source: "local_file"`
  - `platform: "claude_code"`
  - `bridge_run_id`
  - canonical `agent_id`
  - source path
  - deterministic idempotency key

Direct in-run agent writes remain a target, but they must use the same read/write Lease Protocol as bridge writes. Agent-side writeability is never trusted by itself; the brain server enforces scope.

## v7 extension (Kit intelligence layer)

- Promote consolidation from manual run hygiene to daemonized `agent_learning_consolidate`.
- Merge repetitive per-agent learnings into synthesis observations + optional `mind_skill` artifacts.
- Treat `token_budget` as prompt-retrieval budget, not durable storage cap.
