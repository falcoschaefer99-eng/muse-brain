# Retrieval Rate Uplift Plan (2 Weeks)
**Date:** April 22, 2026  
**Window:** April 22, 2026 → May 5, 2026  
**Purpose:** Increase practical retrieval quality/rates without destabilizing v6.

---

## Baseline (current receipts)

- **Cognitive Advantage (synthetic, s6b4):**
  - native R@1: **0.8333** (base), **1.0000** (rerank)
- **Cognitive Advantage (organic, s6b4):**
  - native R@1: **0.8**
  - known miss: `organic_contradiction_01` (semantic boundary)
- **LongMemEval (s3c/s4 quick receipts):**
  - native R@1: **~0.478**
  - native R@10: **~0.900**
- **LoCoMo (s3c receipt):**
  - native R@1: **~0.232**
  - native R@10: **~0.488**
  - candidate hit: **~0.534**

---

## Uplift Targets (short horizon)

1. **LoCoMo candidate hit:** 0.534 → **>= 0.56**
2. **LoCoMo R@1:** 0.232 → **>= 0.245**
3. **LongMemEval R@1:** 0.478 → **>= 0.49**
4. **Organic contradiction lane:** improve `organic_contradiction_01` via Phase 2 semantic rerank path

---

## Workstream A — Candidate-Hit First (highest leverage)

**Why:** If the target never reaches candidate pool, rerank cannot rescue it.

### Actions
- Expand miss-analysis mining in LoCoMo/LongMemEval for top failure families:
  - entity alias misses
  - temporal phrasing misses
  - contradiction-state misses
- Add precision-safe candidate widening only for flagged query shapes.
- Add regression tests per discovered miss family before weight changes.

### Exit Criteria
- candidate hit improvement visible in at least one major benchmark receipt run.

---

## Workstream B — Phase 2 Semantic Rerank (target the known boundary)

**Why:** `organic_contradiction_01` is a semantic narrative-sequence failure.

### Actions
- Activate `rerank_mode=model` lane for contradiction+temporal query class.
- Keep strict guardrails:
  - top-N cap
  - deterministic fallback to heuristic on model failure
  - trace logging in artifacts
- Add dedicated tests for:
  - model hook success
  - model hook timeout/error fallback
  - no change to unrelated query families

### Exit Criteria
- organic contradiction lane improves with no synthetic regression.

---

## Workstream C — Retrieval Input Quality (write-path recall hygiene)

**Why:** Better memory inputs = better retrieval across all profiles.

### Actions
- tighten summary/tag/entity/project-link quality checks on observe path
- add “project/business critical” prioritization checks in regression tests
- run backfill validation to ensure older critical observations remain discoverable

### Exit Criteria
- improved hit consistency on project/business recall probes.

---

## Workstream D — Benchmark Integrity + Release Receipts

### Actions
- freeze evaluation datasets for this 2-week run window
- run base + rerank receipts per lane
- generate one consolidated delta report with:
  - wins
  - losses
  - unchanged families
  - known limitations

### Exit Criteria
- publishable benchmark packet for v6.x follow-up and post-v6 external alignment lane kickoff.

---

## Week-by-Week Plan

### Week 1 (April 22–April 28, 2026)
- implement candidate-hit improvements + regression tests
- implement Phase 2 model rerank hook path (guarded)
- run mid-week benchmark sanity receipts

### Week 2 (April 29–May 5, 2026)
- tune from measured misses only (no blind loops)
- rerun full receipts (base + rerank)
- finalize uplift report and v6.x release addendum

---

## Non-Negotiables

- No benchmark claim without receipts.
- No metric improvement accepted if it regresses honesty/explainability.
- Keep one explicit “MUSE loses” section in every summary.
- Keep fallback behavior deterministic when model rerank is unavailable.
