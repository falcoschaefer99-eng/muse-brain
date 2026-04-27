# Retrieval Rate Uplift — Task Board (April 22, 2026)

## Release sequencing decision
- **v6 release is not blocked by this board.**
- This board is for **post-v6 uplift (v6.x)** execution.

---

## Active Tasks

| ID | Task | Owner | ETA | Receipt | Status |
|---|---|---|---|---|---|
| U1 | Mine LoCoMo + LongMemEval miss-analysis and group top failure families | Rainer | 1 day | `benchmarks/results/*/miss-analysis.json` summary note | open |
| U2 | Candidate-hit uplift patch (precision-safe widening for flagged query shapes) | June | 2 days | new benchmark delta receipt | open |
| U3 | Add regression tests for each new miss-family rule | Kairo/June | 1 day | test file diffs + passing suite | open |
| U4 | Phase 2 model-rerank lane (contradiction+temporal gated path) | June | 2 days | lane artifact with rerank traces | open |
| U5 | Model-hook failure/timeout fallback tests | Kairo | 0.5 day | unit coverage for deterministic fallback | open |
| U6 | Write-path retrieval hygiene pass (summary/tag/entity/project-link quality checks) | Rainer | 1 day | checklist + spot-check probes | open |
| U7 | Full receipts rerun (base + rerank + family notes) | Rainer | 1 day | consolidated benchmark packet | open |
| U8 | Uplift interpretation doc (wins/losses/unchanged + honest limits) | Rainer | 0.5 day | `docs/` report update | open |
| U9 | Normalize all specialist entities to canonical `entity_type=agent` (migrate auto-created concept entities) | Rainer | 1 day | migration diff + `mind_entity` verification for full squad | open |

---

## Release v6 Immediate Checklist (separate from uplift)

| Step | Item | Status |
|---|---|---|
| R1 | Merge audited s6b4 tightening to main | done |
| R2 | Typecheck + unit tests passing | done |
| R3 | Release notes + benchmark receipts + editorial pass | done |
| R4 | Version/tag decision (v6 label + semver) | done |
| R5 | Public release/deploy announcement | pending |
| R6 | Agent Learning Bridge: backfill specialist local memory into brain + enable repeat sync script | done |
| R7 | Public claim boundary in release notes: Michael is the released specialist baseline; other squad agents are internal preview | done |
| R8 | Post-deploy smoke probes: `mind_pull(letter_)`, `mind_pull(task_)`, `mind_memory get(letter_)` | done |

### R6 receipt (completed)
- Backfill run executed against a private deployment endpoint.
- Sync totals: `sent=116`, `failed=0` (initial 106 + incremental 10 on 2026-04-23).
- Idempotency verification rerun: `0 new learning entries`.
- Coverage includes builder + creative agent memory folders (`31` dirs; `29` markdown-bearing files).
