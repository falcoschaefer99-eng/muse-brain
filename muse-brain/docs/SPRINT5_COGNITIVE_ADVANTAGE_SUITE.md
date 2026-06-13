# Sprint 5 — Cognitive Advantage Suite (Kickoff)

**Date:** April 14, 2026
**Status:** Active

## Goal

Demonstrate where MUSE retrieval beats flat recall on relational/contextual queries while preserving benchmark rigor.

---

## Query Families (v1)

1. `emotional_state_recall`
2. `contradiction_recall`
3. `unresolved_tension_recall`
4. `relational_phase_recall`
5. `significance_recall`
6. `decision_memory`

Seed set path:

- `benchmarks/data/cognitive_advantage_seed_v1.json`
- `benchmarks/data/cognitive_advantage_seed_v2.json` (texture-aware contrast cases, includes `flat` baseline lane)
- `benchmarks/data/cognitive_advantage_seed_v3.json` (contradiction family expanded to 3 cases, includes cross-temporal contradiction)

---

## Scoring Rubric (v1)

Each case is scored on both retrieval hit metrics and qualitative alignment:

### A. Retrieval hit metrics (automated)
- Recall@1 / @5 / @10
- NDCG@10
- Candidate hit rate

### B. Advantage alignment (manual/LLM-graded follow-up)
0–2 per dimension:
- **Context fidelity** — correct phase/relational state, not just keywords
- **Significance fidelity** — surfaces the memory that mattered most
- **Contradiction sensitivity** — pulls corrective memory over celebratory noise
- **Emotional fidelity** — correctly prioritizes affect-tagged evidence

`advantage_score = sum(dimensions)` (0–8)

---

## Run Commands

```bash
npm run benchmark:retrieval -- \
  --dataset cognitive_advantage \
  --input benchmarks/data/cognitive_advantage_seed_v3.json \
  --output-dir benchmarks/results/cognitive-advantage-$(date +%Y%m%d) \
  --sqlite-path benchmarks/results/cognitive_advantage_seed.sqlite \
  --profiles native,balanced,benchmark,flat \
  --result-limit 10 \
  --min-similarity 0.01
```

Optional rerank lane:

```bash
npm run benchmark:retrieval -- \
  --dataset cognitive_advantage \
  --input benchmarks/data/cognitive_advantage_seed_v3.json \
  --output-dir benchmarks/results/cognitive-advantage-rerank-$(date +%Y%m%d) \
  --sqlite-path benchmarks/results/cognitive_advantage_seed.sqlite \
  --profiles native,balanced,benchmark,flat \
  --rerank-mode heuristic \
  --rerank-top-n 30
```

Profile comparison report:

```bash
node benchmarks/scripts/cognitive-report.mjs \
  --artifact benchmarks/results/cognitive-advantage-YYYYMMDD/artifact.json \
  --output-dir benchmarks/results/cognitive-advantage-YYYYMMDD \
  --primary-profile native \
  --baseline-profile flat
```

Standing lane (base + rerank receipts in one command):

```bash
npm run benchmark:cognitive-lane -- \
  --input benchmarks/data/cognitive_advantage_seed_v3.json \
  --output-root benchmarks/results/cognitive-advantage-$(date +%Y%m%d)-lane
```

Organic eval mode (real DB memories, no synthetic document injection):

1) create cases with `"use_existing_memory": true`, `documents: []`, and real `evidence_ids`
   - starter file: `benchmarks/data/cognitive_advantage_organic_template.json`
2) run against your real sqlite/postgres store via benchmark runner
3) keep `profile-comparison.md` receipts alongside artifact output

Example:

```bash
npm run benchmark:seed-organic -- \
  --input benchmarks/data/cognitive_advantage_organic_apr15_corpus.json \
  --sqlite-path benchmarks/results/cognitive_advantage_organic_base.sqlite

npm run benchmark:seed-organic -- \
  --input benchmarks/data/cognitive_advantage_organic_apr15_corpus.json \
  --sqlite-path benchmarks/results/cognitive_advantage_organic_rerank.sqlite

npm run benchmark:cognitive-lane -- \
  --input benchmarks/data/cognitive_advantage_organic_apr15_cases.json \
  --output-root benchmarks/results/cognitive-advantage-organic-$(date +%Y%m%d) \
  --sqlite-base benchmarks/results/cognitive_advantage_organic
```

---

## Exit Criteria for Sprint 5

1. Seed suite executed with reproducible artifacts.
2. Family-level breakdown included in summary doc.
3. At least one honest “MUSE wins / MUSE loses” analysis per family.
4. Claims tied to receipts, not narrative assertion.

---

## Initial Receipts (April 14, 2026)

- Non-rerank baseline:
  - `benchmarks/results/cognitive-advantage-20260414-s5c-flat/`
  - native R@1 0.8333 vs flat R@1 0.3333
- Heuristic rerank:
  - `benchmarks/results/cognitive-advantage-20260414-s5c-flat-rerank/`
  - native R@1 1.0000 vs flat R@1 0.3333
