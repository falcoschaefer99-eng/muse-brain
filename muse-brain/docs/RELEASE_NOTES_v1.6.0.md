# MUSE Brain v1.6.0 — Release Notes

**Release date:** April 23, 2026  
**Release theme:** Retrieval reliability + bridge-based cloud learning baseline

---

## Highlights

1. **Universal typed-ID retrieval**
   - `mind_pull` now resolves typed IDs directly: `obs_`, `letter_`, `task_`, `ent_`.
   - `mind_memory action=get` routes through the same resolver path.

2. **Letter retrieval surface expanded**
   - `mind_letter` now supports explicit `list`, `get`, and `search` actions (with pagination semantics), while preserving backward-compatible `read`.

3. **Reliability lane added**
   - New command: `npm run test:reliability`
   - Covers unified retrieval contract + letter edge cases.

4. **Agent learning bridge (v6 addendum)**
   - `scripts/agent-memory-sync.mjs` ingests local agent memory markdown into cloud brain observations through authenticated MCP calls.
   - Idempotent hash-ledger sync contract prevents duplicate spam.

---

## Receipts

### Test gates
- `npm run test:reliability` → **50/50 passing**
- `npm run test:unit` → **214/214 passing**
- Targeted universal resolver smoke (`mind_pull` typed paths + `process:true` path) → **passing**

### Agent-memory bridge
- Initial production sync (2026-04-22): **106 sent / 0 failed**
- Incremental sync (2026-04-23): **10 sent / 0 failed**
- Cumulative synced: **116**
- Idempotency rerun after delta: **0 new**
- Coverage snapshot: **31** agent directories discovered, **29** markdown-bearing (6 empty scaffolds)

---

## Public claim boundary (v6)

- **Released specialist baseline:** Michael.
- Other synced specialist learnings are internal-preview unless separately released with their own public docs.
- In-run subagent MCP writes are still pending; v6 ships the bridge path now:
  - local memory file → sync bridge → cloud brain observation.

---

## Known follow-ups (post-v6)

1. Normalize all specialist entities to canonical `entity_type=agent` (current auto-created concept entities still exist for some names).
2. Optional return-shape harmonization between `mind_pull(letter_*)` and `mind_letter action=get`.
3. Add direct agent-scoped API ingest for real-time subagent writes without parent proxy scripting.
