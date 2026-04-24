# MUSE Brain v1.6.0 — Release Notes

**Release date:** April 23, 2026  
**Release theme:** Retrieval reliability + bridge-based cloud learning baseline

---

## Highlights

1. **Universal ID resolver**
   - `mind_pull` now resolves typed IDs directly: `obs_`, `letter_`, `task_`, `ent_`.
   - `mind_memory action=get` routes through the same resolver.

2. **Letter retrieval surface expanded**
   - `mind_letter` gains explicit `list`, `get`, and `search` actions, while preserving backward-compatible `read`. Pagination and keyword search included.

3. **Contract test lane added**
   - New command: `npm run test:reliability` (renamed to `test:contracts` in v1.6.1; alias retained).
   - Covers unified retrieval contract + letter edge cases.

4. **Agent learning bridge (v6 addendum)**
   - `scripts/agent-memory-sync.mjs` reads local agent memory markdown and writes observations to the cloud brain via authenticated MCP. Idempotent hash ledger prevents duplicates on re-runs.

---

## Receipts

### Test gates
- `npm run test:reliability` → **50/50 passing**
- `npm run test:unit` → **214/214 passing**
- Targeted universal resolver smoke (`mind_pull` typed paths + `process:true` path) → **passing**

### Agent-memory bridge
Full receipts live in [`docs/AGENT_LEARNING_BRIDGE_v6.md`](./AGENT_LEARNING_BRIDGE_v6.md). Headline: **116 sent / 0 failed** across initial + incremental runs, idempotency rerun **0 new**.

---

## Public claim boundary (v6)

- **Released specialist baseline:** Michael.
- Other synced specialist learnings are internal-preview until separately released with their own public docs.
- In-run subagent MCP writes remain pending; v6 ships the bridge path (local memory file → sync → brain observation).

---

## Known follow-ups (post-v6)

1. **Canonical `entity_type=agent` normalization** — auto-created concept entities still exist for some specialists; tracked as U9 on the uplift board.
2. Optional return-shape harmonization between `mind_pull(letter_*)` and `mind_letter action=get`.
3. Direct agent-scoped API ingest for real-time subagent writes, removing the parent-proxy step.
