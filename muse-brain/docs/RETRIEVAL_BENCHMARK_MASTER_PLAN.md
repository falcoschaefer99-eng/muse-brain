# MUSE Brain — Retrieval & Benchmark Master Plan

**Status:** Working design spec  
**Date:** April 8, 2026  
**Purpose:** Durable master design for retrieval upgrades, benchmark competitiveness, release narrative, and cross-session execution.

---

## Framing

**MemPalace optimizes for recall accuracy — did the system remember the exact words? MUSE optimizes for relational relevance — does the system know what matters, in what context, and why it still matters now?** This roadmap is designed to let MUSE compete honestly on standard retrieval benchmarks without abandoning its deeper thesis. The goal is not to flatten MUSE into a benchmark-chasing verbatim store. The goal is to strengthen retrieval quality, expose a clean evaluation lane, and prove that textured memory can match archival recall where needed while surpassing it on the kinds of questions real humans actually ask.

---

## Product Thesis

MUSE Brain is not only a search engine over old text. It is a cognitive memory substrate.

That means the retrieval system must support both:

1. **Benchmark competitiveness**
   - Strong recall on LongMemEval / LoCoMo / related public datasets
   - Transparent, reproducible metrics
   - Clean failure analysis and apples-to-apples comparison

2. **Relational memory advantage**
   - Retrieval that understands emotional charge, relational context, territory, contradiction, significance, and evolving state
   - Questions like:
     - "What was I worried about in March?"
     - "What did we talk about when I was upset last week?"
     - "What did I say during that rupture?"
     - "Which memory contradicts this current self-story?"

The architecture must preserve MUSE's identity while making the recall lane sharper.

---

## Design Principles

1. **No lossy replacement of source memories**  
   Original observations remain canonical. Derived retrieval artifacts may assist search, but they never replace the original memory.

2. **One engine, multiple retrieval profiles**  
   We do not fork the brain into separate products. We add profile-driven behavior inside the existing retrieval architecture.

3. **Separate relevance from cognition**  
   Retrieval relevance and cognitive modulation should be distinguishable, tunable, and inspectable.

4. **Benchmark honestly**  
   We publish standard benchmark results clearly, including what is reranked, what is held out, and what is profile-tuned.

5. **Publish the philosophy next to the code**  
   Every release in this lane should ship with narrative framing, changelog notes, and benchmark receipts so the architecture is understandable, not merely implemented.

6. **Build the moat, not just the match**  
   Matching verbatim recall matters. Surpassing it on relational/contextual memory is the larger opportunity.

---

## Retrieval Architecture Direction

### Layer A — Retrieval Relevance
Signals that answer: *is this memory likely about the query?*

- vector similarity
- keyword relevance
- exact phrase match
- named entity / proper name match
- temporal proximity
- assistant-response relevance
- entity-linked candidate generation
- derived retrieval hints

### Layer B — Cognitive Modulation
Signals that answer: *why should this memory surface now?*

- grip
- charge phase
- novelty
- circadian bias
- territory significance
- entity gravity
- relational context intensity
- future state-conditioned surfacing

### Retrieval Profiles
Profiles set a **baseline weighting**, then query signals may adjust dynamically.

- **native** — preserve current MUSE behavior; cognition has strong influence
- **balanced** — factual recall strengthened while keeping relational weighting meaningful
- **benchmark** — recall-first profile for public evaluation; cognitive weighting reduced but not fully removed
- **cognitive_advantage** — evaluation/reporting lane for queries where textured memory should outperform flat recall systems

### Dynamic Weighting
Profiles should not use rigid fixed ratios only. Query signals can shift weighting.

Examples:
- if query contains assistant-reference cues, increase Layer A weight
- if query contains kin / relational rupture / emotional-state cues, increase Layer B weight
- if query is temporal + entity-specific, combine temporal retrieval boosts with territory/context bias

This keeps retrieval intelligent rather than merely profile-static.

---

## Query Signals to Add

These should be extracted before ranking and attached to the retrieval request.

- quoted phrases
- proper names
- explicit entities
- temporal offsets and ranges
- assistant-reference cues
- emotional-state cues
- contradiction cues
- territory cues
- relational-intensity cues
- check-in / no-contact cues (future lane)

### Future extension: state-conditioned hints
There is a promising future architecture path where hints may reference **recorded user/agent state** when relevant.

Examples:
- state at observation time
- state drift since observation
- check-in context
- no-contact or return-after-absence context

This should be treated as a later architecture lane and designed carefully so state enriches retrieval without becoming a privacy-unsafe or noisy shortcut.

---

## Derived Retrieval Artifacts

Derived artifacts should sit beside canonical observations and improve findability.

### Core artifact types
- `preference_hint`
- `assistant_response_hint`
- `temporal_hint`
- `entity_hint`
- `quoted_phrase_hint`

### MUSE-exclusive artifact types
- `relational_context_hint`
  - examples:
    - "said during crisis"
    - "said during intimate territory"
    - "belongs to unresolved rupture"
    - "contradicts observation X"
    - "recorded during repair / grief / conflict / devotion"
- `contradiction_hint`
- `territory_salience_hint`
- `state_snapshot_hint` *(future lane; tied to state/check-ins if implemented)*

### Artifact rule
Artifacts are assistive retrieval surfaces, **not replacements** for the full observation.

---

## Benchmark Strategy

### Public benchmark lanes
1. **Native profile**
   - Current MUSE-style retrieval behavior
   - Measures how the relational system performs as-is

2. **Balanced profile**
   - Stronger recall without abandoning MUSE's cognitive model

3. **Benchmark profile**
   - Recall-first configuration for apples-to-apples public comparison

4. **Cognitive Advantage lane**
   - MUSE-only evaluation set for textured-memory wins
   - Demonstrates where relational/contextual memory beats flat verbatim systems

### Standard benchmarks to support
- LongMemEval
- LoCoMo
- ConvoMem *(optional after first lane is stable)*

### Metrics to output
- Recall@1 / @5 / @10
- NDCG@k
- candidate hit rate
- miss categories
- rerank delta
- held-out vs tuned split
- stale recall rate
- noise rate
- profile comparison table

### Cognitive Advantage examples
This should become a published evaluation suite, not a vague claim.

Sample query families:
- emotional state recall
- crisis-context recall
- contradiction recall
- unresolved tension recall
- relational phase recall
- memory significance recall
- "what mattered most" retrieval

---

## Sprint Roadmap

## Sprint 1 — Retrieval Foundations
**Why it matters:** Improve factual recall inside the existing architecture without flattening MUSE into plain text search.

### Goals
- add retrieval profiles (`native`, `balanced`, `benchmark`)
- introduce query-signal extraction
- support larger candidate pools in benchmark/balanced modes
- add first retrieval boosts:
  - quoted phrase boost
  - proper-name boost
  - temporal boost
  - assistant-reference handling
- expose score breakdowns for analysis

### Deliverables
- retrieval profile support in retrieval pipeline
- query signal helper module
- scoring breakdown diagnostics
- benchmark-oriented candidate pool settings

### Exit criteria
- retrieval behavior can be run in multiple profiles without branching the product
- signal-aware reranking exists in at least heuristic form
- diagnostics show which signals fired for each result

### Sprint 1 implementation decisions (April 8, 2026)
- `mind_query` profile surface: `retrieval_profile` (canonical) with `profile` alias.
- Layer A / Layer B separation encoded in `score_breakdown` diagnostics.
- Profile-specific candidate pool sizes implemented in storage hybrid search.

---

## Sprint 2 — Benchmark Harness
**Why it matters:** Produce honest receipts on standard benchmarks while keeping the relational architecture legible.

### Goals
- create dataset adapters for LongMemEval and LoCoMo
- run all retrieval profiles through a shared harness
- save structured failure analysis
- generate benchmark result artifacts that are publishable

### Deliverables
- `/benchmarks` runner for MUSE Brain
- profile-based run configs
- result logs and summary reports
- miss analysis output

### Exit criteria
- LongMemEval runs end-to-end
- results are reproducible
- failures can be inspected rather than hand-waved

### Sprint 2 implementation decisions (April 9, 2026)
- Benchmark runner lives under `/benchmarks` and is invoked with `npm run benchmark:retrieval`.
- Dataset adapters normalize LongMemEval and LoCoMo into shared `BenchmarkCase` / `BenchmarkDocument` shapes.
- Result artifacts are emitted as:
  - `artifact.json` — full structured run output
  - `summary.md` — human-readable profile table
  - `miss-analysis.json` — inspectable failed / skipped cases
  - `run-issues.json` — per-case run failures (insert/query/delete stages)
- Harness calls the existing `storage.hybridSearch(...)` path directly so benchmark runs stay inside the canonical retrieval implementation.
- Benchmark methodology for this phase is intentionally honest and narrow:
  - no derived hint artifacts
  - no rerank lane yet
  - no lossy observation replacement
  - vector lane only when embeddings are explicitly supplied
  - skipped cases are labeled, not hidden (`abstention`, `missing_evidence`)
  - Recall@k uses fractional evidence coverage for multi-evidence questions (not hit@k)

---

## Sprint 3 — Derived Retrieval Hints
**Why it matters:** Sharpen retrieval while preserving the full experiential memory model.

### Goals
- add assistive retrieval artifacts beside observations
- implement first hint generators
- include MUSE-exclusive relational context artifacts from the start

### Deliverables
- artifact schema + storage strategy
- hint generation pipeline
- support for:
  - preference hints
  - assistant response hints
  - temporal hints
  - quoted phrase hints
  - entity hints
  - relational context hints

### Exit criteria
- hints measurably improve recall on selected query classes
- original observations remain canonical and unchanged

---

## Sprint 4 — Dynamic Weighting & Optional Rerank
**Why it matters:** Move from static profile behavior to retrieval that responds intelligently to the kind of question being asked.

### Goals
- implement dynamic weighting adjustments based on query signals
- add optional rerank lane for benchmark profile
- keep rerank optional and auditable

### Deliverables
- baseline profile weights
- signal-driven weight adjustments
- rerank hook (heuristic first, model-assisted optionally)

### Exit criteria
- profile + signal interplay is inspectable
- rerank improves edge cases without obscuring baseline behavior

---

## Sprint 5 — Cognitive Advantage Suite
**Why it matters:** Show where textured memory is not just different, but better.

### Goals
- define MUSE-specific evaluation set
- test relational/contextual retrieval wins
- publish counter-benchmark results alongside standard benchmark results

### Deliverables
- cognitive advantage query set
- scoring rubric
- public results writeup

### Exit criteria
- MUSE can show benchmark competitiveness **and** differentiated retrieval value

---

## Sprint 6 — Release Narrative & Publication Package
**Why it matters:** The public release must explain what changed, why it matters, and what the receipts actually show.

### Goals
- ship narrative documentation next to code
- make release artifacts intelligible to technical and non-technical readers
- ensure philosophy, benchmark receipts, and implementation notes land together

### Deliverables
- changelog entry
- release notes
- philosophy doc tied to the release
- benchmark summary page
- implementation doc updates in `CAPABILITIES.md` / architecture dossier if needed

### Exit criteria
- repo documents not just the mechanism, but the meaning
- benchmark claims are scoped, honest, and contextualized

---

## Release Documentation Requirements

When this lane ships, it should include all of the following:

- **CHANGELOG entry** describing retrieval architecture changes
- **philosophy page** explaining the difference between recall accuracy and relational relevance
- **benchmark report** with profile-by-profile results
- **implementation notes** documenting signals, hints, and weighting logic
- **known limitations** so claims stay honest

### Suggested philosophy page title
`docs/RETRIEVAL_PHILOSOPHY.md`

### Suggested release framing
- what changed technically
- why MUSE is still different
- what standard benchmarks show
- what standard benchmarks fail to capture
- what the cognitive advantage lane adds

---

## Master Checklist

### Sprint 1 — Retrieval Foundations
- [x] define retrieval profile interface
- [x] add query signal extraction module
- [x] add quoted phrase detection
- [x] add proper-name detection
- [x] add temporal signal parsing
- [x] add assistant-reference detection
- [x] expand candidate pools by profile
- [x] expose scoring breakdown diagnostics
- [x] decide profile API surface in `mind_query` (`retrieval_profile`, alias `profile`)

### Sprint 2 — Benchmark Harness
- [x] scaffold benchmark directory
- [x] implement LongMemEval adapter
- [x] implement LoCoMo adapter
- [x] define result artifact format
- [x] implement profile-based runner
- [x] save miss analysis logs
- [x] document honest benchmark methodology

### Sprint 3 — Derived Retrieval Hints
- [ ] define hint artifact schema
- [ ] define storage strategy for hint artifacts
- [ ] add preference hints
- [ ] add assistant response hints
- [ ] add temporal hints
- [ ] add quoted phrase hints
- [ ] add entity hints
- [ ] add relational context hints
- [ ] define future state snapshot hint lane

### Sprint 4 — Dynamic Weighting & Rerank
- [ ] define baseline profile weights
- [ ] define signal-driven weight modifiers
- [ ] implement dynamic weighting logic
- [ ] add heuristic rerank stage
- [ ] add optional model-assisted rerank hook
- [ ] log rerank deltas for inspection

### Sprint 5 — Cognitive Advantage Suite
- [ ] define cognitive advantage query families
- [ ] draft initial evaluation set
- [ ] define scoring rubric
- [ ] run comparative profile tests
- [ ] identify textured-memory wins
- [ ] write interpretation guidance

### Sprint 6 — Release Narrative
- [ ] write changelog entry draft
- [ ] write retrieval philosophy page draft
- [ ] write release notes draft
- [ ] prepare benchmark summary page
- [ ] update architecture and capabilities docs
- [ ] publish limitations and honest claims

---

## Cross-Session Working Rules

This document is the **master design reference** for this lane.

### Rainer / Rook handoff rules
- use this file as the canonical roadmap
- append changes here before sprint scope drifts
- keep philosophy and engineering notes in the same document lineage
- if a sprint changes the architecture, update both the checklist and the rationale
- if a benchmark insight is important, log it and fold it back into this plan

### Session-start protocol for this lane
1. open this master plan
2. identify current sprint
3. convert checked/unchecked items into immediate execution tasks
4. update project/context memory with any decisions made
5. only then begin implementation

---

## Immediate Next Move

Start a fresh session and execute **Sprint 1 only**.

Sprint 1 should stay disciplined:
- retrieval profiles
- query signal extraction
- first boost set
- diagnostics

No premature publication work, no full benchmark harness yet, no scope creep into later sprints.

---

## Proposed future companion docs

- `docs/RETRIEVAL_PHILOSOPHY.md`
- `docs/BENCHMARKS_MUSE_BRAIN.md`
- `docs/RETRIEVAL_HINTS.md`

These should be created when the relevant sprint is active, not before.
