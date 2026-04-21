# Retrieval Rate Uplift — Task Board (April 22, 2026)

## Release sequencing decision
- **v6 release is not blocked by this board.**
- This board is for **post-v6 uplift (v6.x)** execution.

## Version naming recommendation
- Public release label: **MUSE Brain v6**
- Semver tag/package: **v1.5.0** (current package baseline is 1.4.0)

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

---

## Release v6 Immediate Checklist (separate from uplift)

| Step | Item | Status |
|---|---|---|
| R1 | Merge audited s6b4 tightening to main | done |
| R2 | Final green gate (typecheck + unit tests) | done |
| R3 | Release notes + benchmark receipt bundle | pending |
| R4 | Version/tag decision (v6 label + semver) | pending |
| R5 | Public release/deploy announcement | pending |
