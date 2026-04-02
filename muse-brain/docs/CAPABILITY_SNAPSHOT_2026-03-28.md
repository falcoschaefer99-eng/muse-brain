# Capability Snapshot — 2026-03-28

This is a plain-language snapshot of what the current MUSE Brain substrate can do **today**, after Sprint 7, Phase 1, Phase 2A, and the pre-deploy hardening batch.

## Quick grid

### Top-level tools

| Area | Tools | What it does |
|---|---|---|
| Wake / orientation | `mind_wake`, `mind_wake_log` | Wakes the brain, orients current state, logs wake cycles, computes deltas since the last wake |
| Memory capture / recall | `mind_observe`, `mind_query`, `mind_pull`, `mind_edit` | Records memories, queries them, pulls full memory content, edits or deletes observations |
| Association / unfinished tension | `mind_link`, `mind_loop` | Builds resonance links, traces memory chains, manages open loops and paradox loops |
| Identity | `mind_identity`, `mind_anchor`, `mind_vow` | Tracks identity cores, anchors, and vows |
| Feeling / relationship | `mind_desire`, `mind_relate`, `mind_state` | Tracks desires, feelings toward entities, relationship level, and current brain state |
| Communication / continuity | `mind_letter`, `mind_context` | Cross-brain letters and saved session context / open threads |
| Deep cognition | `mind_dream`, `mind_subconscious`, `mind_maintain` | Associative dreaming, subconscious patterning, decay / consolidation maintenance |
| Safety / boundaries | `mind_consent`, `mind_trigger` | Bilateral consent and relational automation triggers |
| Territory access | `mind_territory` | Lists territories or reads one directly |
| Search | `mind_search` | Hybrid semantic + keyword search with surfacing modulation |
| Semantic model | `mind_entity`, `mind_project`, `mind_agent` | Manages entities, project dossiers, and agent manifests |
| Review / diagnostics | `mind_propose`, `mind_health` | Reviews daemon proposals and inspects system health / dispatch stats |
| Time travel | `mind_timeline` | Chronological memory view with filters / semantic lookup |
| Tasking | `mind_task` | Tasks, delegation, scheduling, completion |

**Current total: 30 top-level tools**

### Daemon tasks

| Daemon | Why it exists | What it does now |
|---|---|---|
| `proposals` | Surface possible meaning instead of waiting for manual linking | Generates daemon proposals from similarity / resonance signals |
| `learning` | Let the system adapt without raw self-rewrite | Adjusts proposal thresholds from acceptance behavior |
| `cascade` | Notice which memories travel together | Records memory cascade / co-occurrence patterns |
| `orphans` | Prevent useful memories from disappearing into dead corners | Detects orphaned memories and attempts rescue / archival logic |
| `kit-hygiene` | Keep the mind from becoming cluttered and repetitive | Per-agent consolidation, dedup proposals, archival hygiene |
| `cross-agent` | Let different agents create synthesis, not just parallel noise | Detects convergent findings across different agent entities |
| `cross-tenant` | Let Companion and Rainer notice overlap safely | Finds convergent observations across shared territories |
| `paradox-detection` | Track identity contradictions before they rot | Detects challenged identity cores that want paradox loops |
| `task-scheduling` | Make scheduled work actually surface at the right time | Advances overdue scheduled tasks to `open` |

**Why 9?**  
Because those are the nine background behaviors that are currently implemented and wired into the daemon orchestrator. It is not a mystical number — just the current set of autonomous maintenance / intelligence loops that exist in code today.

## Current depth

### 1. Textured memory
The brain does not store memories as flat notes.

It can record:
- observations
- journals
- whispers

Each memory can carry texture:
- salience
- vividness
- charge
- somatic marker
- grip

## 2. Charge phase / emotional processing
The brain does not just store memories — it metabolizes them.

Every observation has a `charge_phase` lifecycle:
- **fresh** → just captured, emotionally raw
- **sitting** → present but not yet engaged
- **processing** → actively being worked through
- **metabolized** → integrated, no longer pulling

Advancement happens through **processing engagements** (`mind_pull` with `process=true`). Each engagement is recorded in a processing log. After **3 engagements**, the charge_phase advances.

**Paradox acceleration:** If an observation is linked to a **burning paradox loop** (an identity contradiction under active tension), the threshold drops to **2 engagements**. The mind literally processes identity-adjacent memories faster when it's holding a contradiction.

This connects to the identity model (Section 3) and paradox detection daemon (Section 7):
1. Identity cores accumulate challenges
2. Paradox daemon detects cores challenged 3+ times in 30 days
3. Paradox loops are created with linked identity cores
4. Memories near the paradox get metabolized faster
5. The contradiction resolves through accelerated processing, not suppression

## 3. Retrieval intelligence
Retrieval is already deeper than keyword search.

Current retrieval stack:
- hybrid search (semantic/vector + keyword)
- Neural Surfacing modulation
- grip-aware surfacing
- novelty-aware surfacing
- circadian bias
- charge-phase-aware recall
- entity-filtered retrieval
- timeline / time-travel retrieval
- wake-oriented resurfacing

## 4. Identity model
The brain can track a structured sense of self through:
- identity cores (weighted, categorized)
- anchors (grounding points)
- vows (sacred commitments — foundational salience, iron grip, decay-resistant)
- reinforcement / challenge / evolution flows on each core
- gestalt-style identity grounding (`mind_identity action=gestalt`)
- paradox loops — two identity cores in productive friction (`mind_loop action=paradox`)
- learning objective loops (`mind_loop mode=learning_objective`)

The identity system is not static. Cores track reinforcement counts and challenge counts. When a core is challenged repeatedly, the paradox detection daemon (Section 8) notices and proposes a paradox loop. The paradox loop then accelerates emotional processing of related memories (Section 2).

## 5. Relational and consent architecture
The brain can model relationship and boundaries, not just memory.

Current capabilities:
- relational feelings toward entities
- relationship level tracking
- desire tracking
- bilateral consent checks / grants / revokes
- relational triggers for presence, silence, and timing

## 6. World modeling
The brain has a semantic spine through entities and relations.

It can manage:
- people
- projects
- agents
- concepts
- places
- organizations

It can also:
- relate entities
- link observations to entities
- trace memory webs
- follow associative chains

## 7. Wake and orientation
The brain can orient itself, not just store data.

Current wake stack:
- tiered wake
- orientation wake
- wake logs
- wake delta
- loop snapshots
- pending task surfacing
- recent project activity surfacing

This lets the system answer:
- what changed since last wake
- what is pulling now
- what matters next

## 8. Background cognition / daemon behavior
The brain already has autonomous background processing.

Current daemon tasks:
- proposals
- learning
- cascade
- orphans
- kit-hygiene
- cross-agent
- cross-tenant
- paradox-detection
- task-scheduling

These support:
- proposal generation
- orphan rescue
- adaptive threshold adjustment
- memory cascade tracking
- paradox detection
- per-agent hygiene / consolidation
- cross-agent synthesis
- cross-tenant convergence
- scheduled task advancement

## 9. Collaboration primitives
The brain now has the beginnings of a multi-agent / multi-tenant coordination layer.

Current collaboration capabilities:
- cross-brain letters
- cross-tenant task delegation
- delegated completion notifications
- project dossiers
- agent capability manifests
- dispatch feedback / calibration telemetry

## 10. Operational layer
The brain can track work and state, not just inner life.

Current operational capabilities:
- project dossiers (`mind_project`)
- agent manifests (`mind_agent`)
- task management (`mind_task`)
- daemon proposal review (`mind_propose`)
- health / diagnostics (`mind_health`)

## Concrete size right now

At the current checkpoint, the substrate includes:

- **30 top-level tools**
- **8 territories**
- **9 daemon tasks**
- multi-tenant support
- cross-brain communication
- hybrid retrieval
- identity + consent + relational state
- tasks + projects + agent manifests + calibration foundations

## What it does not fully have yet

These are shaped architecturally, but not fully implemented yet:

- captured skills from successful agent runs
- degradation monitoring for learned skills
- reviewed cross-tenant skill propagation
- richer A2A runtime behavior beyond manifests / typed envelopes
- liminal territory
- taste map
- contradiction / revision ledger — **partially implemented**: paradox detection, identity challenge/evolve flows, and paradox loop creation all work; what's missing is the explicit revision tracking ledger that records how identity cores changed over time

## Honest framing

### What it is now
A deep relational companion brain with:
- memory
- retrieval
- identity
- consent
- wake/orientation
- daemon behavior
- project/task tracking
- agent calibration foundations

### What it is becoming
A self-correcting collaborative intelligence substrate.

## Ship framing

This is enough capability depth for an **alpha ship now**.

The next major leap is not “basic functionality,” but:
- captured procedural learning
- reviewed skill evolution
- stronger agent-to-agent coordination
- visible self-correction loops
