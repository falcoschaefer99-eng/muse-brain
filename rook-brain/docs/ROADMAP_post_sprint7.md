# Post-Sprint-7 Roadmap

**State at lock:** Sprint 7 is implemented locally, audited, and verified.  
**Goal:** close the task-delegation slice cleanly, then start the next shared-core architecture work without mixing concerns.

## Current state

- Sprint 7 task delegation is complete locally.
- `CHANGELOG.md` has been updated to reflect the closeout.
- `SPRINT7_HANDOVER.md` now includes Codex-side follow-through status.
- Phase 1 MVP (Project Dossiers + Wake Delta) is now implemented locally and unit-tested.
- Dispatch feedback exists, but calibration fields/queries do not.
- Agent entities and daemon intelligence exist, but layered learning does not.

## Phase 0 — Sprint 7 closeout

**Goal:** stabilize the baseline before the next architecture slice.

### Deliverables
- changelog reflects the shipped Sprint 7 behavior and validation
- handover reflects implemented audit fixes
- architecture decisions for dispatch learning are locked

## Phase 1 — Shared-core slice A: Project Dossiers + Wake Delta (MVP)

**Goal:** highest immediate utility with low architectural risk.

### Design direction
- Use `entity_type='project'` as the canonical project anchor.
- Add an additive companion table for dossier metadata instead of overloading plain entity text fields.
- Compute wake delta at wake time rather than storing stale snapshots in the first pass.

### Deliverables
1. additive migration for `project_dossiers`
2. storage interface + postgres methods
3. minimal dossier tool surface (`create/get/update/list`)
4. wake delta output:
   - tasks changed since last wake
   - loops changed since last wake
   - recent project activity
5. tests for dossier CRUD and wake delta computation

## Phase 2A — Shared-core slice B: Dispatch Calibration Foundation

**Goal:** replace raw confidence with measured calibration.

### Deliverables
1. additive migration on `dispatch_feedback`:
   - `predicted_confidence`
   - `outcome_score`
   - `revision_cost`
   - `needed_rescue`
   - `rescue_agent_id`
   - `time_to_usable`
   - `domain`
   - `environment`
2. types + storage wiring
3. queries at calibration grain:
   - `(agent_entity_id, domain, environment, task_type)`
4. derived metrics:
   - calibration score
   - overconfidence index
   - underconfidence index
   - trust score

### Phase 2A status — 2026-03-27
- additive migration created: `008_dispatch_calibration_and_agent_manifests.sql`
- `dispatch_feedback` expanded with domain/environment/session, predicted confidence, outcome score, revision cost, rescue, and time-to-usable fields
- agent capability manifest schema added for canonical agent entities
- `mind_agent` tool added for manifest CRUD
- `mind_health(section=dispatch)` now surfaces calibration stats by task type
- unit coverage added for agent manifest wiring + dispatch diagnostics

### Pre-deploy hardening status — 2026-03-27
- additive migration created: `009_predeploy_perf_and_integrity.sql`
- hot-path indexes added for task wake deltas and manifest recency ordering
- manifest router pointers tightened with `ON DELETE SET NULL` foreign-key integrity
- v2 tool normalization consolidated in `src/tools-v2/utils.ts`
- task/project/agent validation hardened before storage writes
- highest-value audit gaps closed in the unit suite (get paths, duplicate guards, wake edge cases, dangling hydration filters)

## Phase 2B — Shared-core slice C: Captured Skill Registry

**Goal:** preserve successful execution paths as reusable, reviewable artifacts.

### Deliverables
1. additive schema for versioned skill artifacts
2. provenance links from successful dispatch runs
3. skill states:
   - `candidate`
   - `accepted`
   - `degraded`
   - `retired`
4. internal skill layers:
   - fixed
   - captured
   - derived
5. review pathway for promoting captured skills into shared use

## Phase 3 — Skill evolution and degradation monitoring

**Goal:** let the system maintain procedural memory quality over time.

### Deliverables
- Kit-owned monitoring for degraded/stale skills
- proposal types for re-capture, supersession, and promotion
- reviewed cross-tenant propagation at the skill-artifact layer
- environment/domain-sensitive skill health tracking

## Phase 4 — Agent learning groundwork

**Goal:** enable safe, reviewed learning.

### Deliverables
- canonical agent mapping policy
- shared/environment/tenant/project layer model in docs + code hooks
- advisory routing outputs informed by calibration + accepted skills
- proposal/review pathway for accepted learning propagation

## Explicitly waiting

- automatic routing directly from trust scores
- raw cross-tenant learning propagation
- hard pairing/drift rules
- liminal territory and taste map (personality-layer work after the shared core stabilizes)
- full workflow engine

## First implementation slice

### Slice 0.5 — done now
- Sprint 7 closeout + planning lock

### Slice 1 — next build slice
- Project Dossiers + Wake Delta MVP

### Slice 1 status — 2026-03-27
- additive migration created: `007_project_dossiers_and_wake_delta.sql`
- storage contract + postgres implementation added for project dossiers and wake cursoring
- `mind_project` tool added (`create/get/update/list`)
- `mind_wake` now emits delta blocks and appends lightweight automatic wake snapshots
- unit coverage added for dossier CRUD wiring + wake delta behavior

## New design lock — 2026-03-27

- skill capture is now explicitly separated from dispatch telemetry
- successful runs should produce candidate reusable skills, not just better stats
- reviewed propagation remains mandatory before shared cross-tenant adoption
- design influenced by OpenSpace (auto-learn / auto-improve / quality monitoring) and gitagent (versioned skills, memory/workflow separation, human review)
