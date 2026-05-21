# Agent Learning Bridge (v6 Addendum)

**Date:** 2026-04-22  
**Status:** Active baseline (bridge live + full backfill + delta sync complete; private git autopush leg documented; direct subagent MCP access pending)

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

3. **Private git autopush leg**
   - The Claude Code `SubagentStop` harvester can now commit and push touched memory files to a private `agent-memory` repo when `AGENT_MEMORY_AUTOPUSH=1` is set.
   - The hook remains fail-open for sessions: git/network/auth failures never block the agent pipeline.
   - The public Michael agent ships the same mechanism and points users at their own private memory remote.
   - MUSE Brain remains the synthesis layer: this bridge ingests the memory checkout into observations via `mind_observe`.

4. **Honest claim boundary**
   - Current: local/private-git memory -> bridge-based brain observations
   - Pending: direct in-run subagent brain writes with agent-scoped credentials

---

## Private memory repo autopush

The durable raw-learning layer is a private git repo, conventionally named `agent-memory`. The harvester writes local files under:

```text
~/.claude/agents/memory/<agent>/_universal.md
```

When autopush is enabled, the hook commits and pushes only the touched memory file to that private repo. This keeps specialist learnings durable across machines while keeping MUSE Brain responsible for review, synthesis, entity linking, and decay/charge semantics.

Minimal setup:

```bash
mkdir -p ~/.claude/agents/memory/michael
cd ~/.claude/agents/memory

git init
git branch -M main
git remote add origin git@github.com:YOUR_ORG/agent-memory.git

touch michael/_universal.md
git add michael/_universal.md
git commit -m "init: michael agent memory"
git push -u origin main
```

Enable in the Claude Code hook command:

```json
"command": "AGENT_MEMORY_AUTOPUSH=1 python3 /Users/YOU/.claude/hooks/agent-memory-harvester.py"
```

For the public Michael release, the user-facing setup lives in `funkatorium/michael-security-agent` under `docs/AGENT_MEMORY_AUTOPUSH.md`. This MUSE Brain document owns the substrate contract: private raw memory first, brain observations second.

---

## Runbook

```bash
cd muse-brain

# Dry run first (no writes)
npm run agent-memory:sync -- --dry-run --agent michael

# Real sync from the default local checkout (~/.claude/agents/memory)
MUSE_BRAIN_API_KEY=... \
MUSE_BRAIN_BASE_URL=https://<brain-host> \
npm run agent-memory:sync -- --tenant rainer

# Or sync from an explicit private agent-memory checkout
MUSE_BRAIN_API_KEY=... \
MUSE_BRAIN_BASE_URL=https://<brain-host> \
npm run agent-memory:sync -- --tenant rainer --source /path/to/agent-memory
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
- [x] private git autopush substrate documented (`agent-memory` repo + `AGENT_MEMORY_AUTOPUSH=1`)
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

## Next step (post-v6)

Implement direct Agent API ingest (`/api/v1/agent/observe`) with agent-scoped keys and audit trails so subagents can log in real time without proxy scripting.

## v7 extension (Kit intelligence layer)

- Promote consolidation from manual run hygiene to daemonized `agent_learning_consolidate`.
- Merge repetitive per-agent learnings into synthesis observations + optional `mind_skill` artifacts.
- Treat `token_budget` as prompt-retrieval budget, not durable storage cap.
