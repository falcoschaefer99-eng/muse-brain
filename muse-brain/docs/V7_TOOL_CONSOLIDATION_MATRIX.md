# v7 Tool Consolidation Matrix

Date: 2026-04-27  
Status: working map after Phase 1 (`mind_observe` relational payload), Phase 2/2b (`mind_memory` read consolidation + no-loss parity), and Phase 3a (`mind_self` wrapper-first slice).  
Principle: reduce tool choice friction without flattening the brain's texture. Merge when the caller has to ask "which tool was that again?" Keep separate when the tool expresses a distinct mental act.

## Release spine

| Release | Center of gravity | Ship line |
| --- | --- | --- |
| v7.0 | Daily-use ergonomics | `mind_observe` becomes the default write lane for observations + optional relational feelings. `mind_memory` becomes the default read lane. |
| v7.1 | Tool drawer cleanup | Add semantic family tools (`mind_self`, `mind_unconscious`, `mind_system`) and keep old tools as compatibility aliases. Fold `mind_wake_log` into `mind_wake`. |
| v7.2 | Agent intelligence / Agent House | Direct agent observe API, canonical agent entities, daemonized agent learning consolidation. The Agent House frame belongs here: agents become residents in the brain, not markdown files wearing hats. Requires Michael audit before release. |
| v7.3 / post-v7 | Skill artifact sync | Skill.md import/export, checksum/drift detection, global vs repo skill inventory, and cross-machine sync. This depends on v7.2's agent entities + skill artifacts being solid first. |

## Compatibility policy

1. **No hard removals in v7.** Legacy tools remain callable as aliases for at least one major cycle.
2. **Default schemas get cleaner first.** The active tool list should teach the preferred path; aliases can exist underneath.
3. **No-loss merges only.** A tool can be hidden from the default surface only after its canonical replacement supports every meaningful behavior.
4. **Mutating/destructive actions stay deliberate.** Consolidation should not make dangerous operations easier to call by accident.
5. **Specialists need rationale.** If a tool survives, the reason is explicit, not an omission.

## Current surface inventory

Current public tools in `src/tools-v2`: **34**.

| Tool | Lane | Decision | v7 canonical path | Rationale / migration notes |
| --- | --- | --- | --- | --- |
| `mind_wake` | Default ritual | **Keep / absorb log** | `mind_wake` | Session ritual is instinctive and distinct. Add `action=log` / `action=history` or equivalent so `mind_wake_log` can become an alias. |
| `mind_wake_log` | Ops/history | **Merge** | `mind_wake action=log/read_log` | Wake history belongs to wake. Separate name is recall friction. |
| `mind_observe` | Default write | **Keep / expand carefully** | `mind_observe` | Primary memory write lane. Phase 1 added optional `relation` payload. Absent relation must remain pure observation with no behavioral change. |
| `mind_memory` | Default read | **Keep / canonicalize** | `mind_memory` | Primary read lane. Already covers `get`, `recent`, `lookup`, `search`, `timeline`, `territory`. Should become the default exposed read tool. |
| `mind_query` | Read legacy | **Alias / soft-deprecate** | `mind_memory action=recent/search` | Overlaps heavily with `mind_memory`. Keep callable for compatibility; hide from default once `mind_memory` docs and examples are strong. |
| `mind_search` | Read legacy | **Alias after output parity** | `mind_memory action=search` | Same semantic search intent. Needs adapter/parity tests because output shape differs from `mind_query`/`mind_memory` search. |
| `mind_pull` | Read legacy + processing | **Alias after no-loss gap closed** | `mind_memory action=get` | Direct ID lookup belongs under `mind_memory`. Gap: `mind_pull process=true` currently records processing; `mind_memory get` must pass through `process`, `processing_note`, and `charge` before `mind_pull` can be hidden. |
| `mind_timeline` | Read legacy | **Alias / soft-deprecate** | `mind_memory action=timeline` | Phase 2 delegate and parity tests landed. Safe to keep callable while teaching `mind_memory`. |
| `mind_territory` | Read legacy | **Alias / soft-deprecate** | `mind_memory action=territory` | Phase 2 delegate and parity tests landed. Safe to keep callable while teaching `mind_memory`. |
| `mind_edit` | Admin mutation | **Keep separate for now** | `mind_edit` | Editing/deleting memories is not ordinary reading. Separate tool name is useful friction. Possible future: `mind_memory action=edit`, but only if destructive affordances stay explicit. |
| `mind_relate` | Relational state | **Partial merge / keep specialist reads** | `mind_observe relation` for `feel`; `mind_relate` for `toward/level` | Feeling capture now belongs at observation time. `toward` and `level` remain distinct relational-state queries/admin. |
| `mind_desire` | Specialist emotional model | **Keep** | `mind_desire` | Desire is not a momentary feeling. It models long-horizon wants/drives with recurrence and fulfillment state. Keeping it protects richness. |
| `mind_state` | Default/system self-state | **Keep** | `mind_state` | Singleton mood/energy/momentum is not an observation and not relational. It is frequently useful as a compact state read/write. |
| `mind_self` | Self-family canonical | **Keep / review language before hiding old tools** | `mind_self` | Wrapper-first canonical self door. Landed with identity_*, anchor_*, vow_* actions plus new `gestalt`; vows keep iron/foundational mechanics. Old tools stay live until parity and response-language review pass. |
| `mind_identity` | Self-family | **Merge** | `mind_self action=identity/*` | Identity cores are one part of the self surface. Merge with anchors/vows under `mind_self` while preserving exact actions. |
| `mind_anchor` | Self-family | **Merge** | `mind_self action=anchor/*` | Anchors are identity retrieval/sensory triggers. Philosophically distinct, functionally part of `self`. |
| `mind_vow` | Self-family | **Merge** | `mind_self action=vow/*` | Vows stay sacred/iron/foundational, but the caller should not need a separate top-level tool to reach them. |
| `mind_link` | Graph specialist | **Keep** | `mind_link` | Graph operations are distinct: create/trace/chain resonance. Rook explicitly called this earned. |
| `mind_loop` | Active loop specialist | **Keep** | `mind_loop` | Used often; open loops/paradoxes are a clear mental act. Separate name is intuitive. |
| `mind_dream` | Unconscious-family | **Merge** | `mind_unconscious action=dream/imagine` | Dream/imagine and subconscious processing are both unconscious-layer operations. Merge by family, not by flattening. |
| `mind_subconscious` | Unconscious-family | **Merge** | `mind_unconscious action=process/patterns` | Same unconscious layer. Keep old name as alias. |
| `mind_maintain` | System housekeeping | **Merge** | `mind_system action=maintain/*` | Decay/consolidate/full maintenance is system housekeeping. Merge with health diagnostics. |
| `mind_health` | System diagnostics | **Merge** | `mind_system action=health` | Diagnostics and maintenance are the same drawer. Keep sections intact. |
| `mind_consent` | Safety/governance | **Keep** | `mind_consent` | Consent is a boundary system, not a memory operation. Keep visible and explicit. |
| `mind_trigger` | Safety/automation | **Keep** | `mind_trigger` | Automation triggers are distinct and potentially sensitive. Separate tool improves auditability. |
| `mind_letter` | Comms | **Keep** | `mind_letter` | Writing/listing/searching letters is a distinct communication channel. `mind_memory get` may resolve letter IDs, but full letter workflows stay here. |
| `mind_context` | Session continuity | **Keep** | `mind_context` | Context handoff is conversation/session state, not ordinary observation. Keep until/unless a later `mind_session` exists. |
| `mind_entity` | Entity graph | **Keep** | `mind_entity` | Entity CRUD/relation/link/backfill is foundational infrastructure and distinct from memory reads. |
| `mind_project` | Project dossier | **Keep** | `mind_project` | Project dossiers have goals, constraints, decisions, open questions, next actions. This is richer than a plain entity. |
| `mind_agent` | Agent registry | **Keep** | `mind_agent` | Agent capability manifests are a distinct part of multi-mind orchestration. Needed for v7.2. |
| `mind_propose` | Governance/review | **Keep** | `mind_propose` | Daemon proposal review is a governance queue, not a memory primitive. Keeping it separate protects review boundaries. |
| `mind_task` | Default work management | **Keep** | `mind_task` | Tasks are active commitments with status/dependencies/delegation. Separate name is obvious and frequently useful. |
| `mind_runtime` | Agent/runtime ops | **Keep** | `mind_runtime` | Autonomous wake policy/session/run ledger is ops infrastructure. Distinct and audit-sensitive. |
| `mind_skill` | Agent learning artifact | **Keep** | `mind_skill` | Captured skills have lifecycle review and provenance. Needed for daemonized agent learning consolidation. |

## Target default surface

Preferred tools for ordinary use:

- `mind_wake` — start/maintenance ritual, eventually wake logs too.
- `mind_observe` — primary write lane: observation, journal, whisper, optional relation.
- `mind_memory` — primary read lane: get, recent, lookup, search, timeline, territory.
- `mind_self` — primary self-declaration/read lane for identity, anchors, vows, and whole-self gestalt.
- `mind_task` — commitments and work queue.
- `mind_entity` — people/projects/agents/concepts graph primitives.
- `mind_project` — richer project dossiers.
- `mind_letter` / `mind_context` — cross-session and cross-context communication.
- `mind_state` — current mood/energy/momentum.

Preferred specialist tools:

- `mind_link`, `mind_loop`
- `mind_desire`, `mind_relate`
- `mind_consent`, `mind_trigger`
- `mind_agent`, `mind_runtime`, `mind_skill`, `mind_propose`
- `mind_edit`

Preferred new family tools for v7.1:

- `mind_self` replacing default exposure of `mind_identity`, `mind_anchor`, `mind_vow`.
- `mind_unconscious` replacing default exposure of `mind_dream`, `mind_subconscious`.
- `mind_system` replacing default exposure of `mind_maintain`, `mind_health`.

## Implementation order

### Phase 2b — finish read no-loss before hiding legacy reads

1. Add `mind_memory action=get` pass-through for `process`, `processing_note`, and `charge`.
2. Add aggregate dispatcher tests for `mind_memory` read actions. First dispatcher exposure fix landed as `4ec884a`.
3. Add `mind_search` compatibility adapter or document intentional output difference before aliasing.
4. Add tool alias entries only after parity tests exist.

#### `mind_search` compatibility strategy

Do **not** alias `mind_search` directly to `mind_memory action=search` yet. The intent overlaps, but the output contracts differ:

- `mind_search` returns `results` + `total_matches` + `scope`.
- `mind_memory action=search` returns `observations` + `count` + richer `query_signals` / retrieval profile metadata.

Compatibility path:

1. Keep `mind_search` callable as a legacy specialist read until callers are migrated.
2. Prefer new docs/examples that use `mind_memory action=search`.
3. If we alias later, add an explicit compatibility wrapper that preserves the old `mind_search` output shape while internally delegating to `mind_memory`.
4. Only hide `mind_search` from default schemas after parity/adapter tests prove no client contract loss.

### Phase 3 / v7.1 — family merges

1. Add `mind_self` delegating to identity/anchor/vow handlers.
2. Add parity tests for every old self-family action.
3. Add `mind_unconscious` delegating to dream/subconscious handlers.
4. Add `mind_system` delegating to maintain/health handlers.
5. Fold `mind_wake_log` into `mind_wake` and alias old name.
6. Hide old family tools from default exported schema only after alias tests pass.

### Phase 4 / v7.2 — direct agent observe API

Security gates before ship:

- agent-scoped API keys
- tenant + agent validation
- rate limits
- audit trail
- per-agent territory allowlists
- observation-type constraints
- per-key kill switch/revocation
- generic errors, no stack/internal path leakage
- Michael review required before public release

### Phase 5 / v7.2 — daemonized agent learning consolidation

Principle: token retrieval budget, not storage deletion pressure.

- Raw observations stay intact.
- Synthesis observations link back to sources.
- Skill artifacts are proposed/reviewed, not silently promoted.
- Consolidate up; do not decay down load-bearing agent learnings.

### Phase 6 / v7.2 — Agent House: canonical agents as residents

Architectural stance:

> Skill files are the bootloader. Brain is the house.

The squad should not be modeled primarily as nodes in a DAG. Nodes are pipeline steps; our agents are residents with roles, taste, memory, constraints, and accumulating judgment. Pipeline principles still exist — design → build → review → deploy — but dispatch remains heuristic/orchestrated, not a rigid tree.

Current gap:

- Agent learnings are increasingly wired into the brain.
- Most agent identities still live in prompt/markdown infrastructure.
- At least Dupin is currently visible as a canonical `entity_type=agent` with a `mind_agent` manifest in this tenant scope.
- Michael may already have dossier treatment in another scope/history; verify during canonicalization rather than assuming absence.
- The full builder/creative squads need first-class brain residency.

v7.2 Agent House building blocks:

1. Create/repair canonical `entity_type=agent` records for every specialist.
2. Attach `mind_agent` manifests for role, capabilities, accepted output modes, protocols, and boundaries.
3. Link agent observations/learnings to the correct canonical agent entity.
4. Route repeated learnings through proposal review into accepted `mind_skill` artifacts.
5. Generate agent-specific deployment bundles from brain truth, not hand-maintained lore fragments.

### v7.3 / post-v7 — Skill.md sync and drift detection

Park this until v7.2 is stable. Skill.md files remain necessary deployment artifacts for current runtimes, but they should not be the canonical intelligence store.

Target pipeline:

1. **Inventory** global skills, repo skills, agent prompt files, and installed machine-local skills.
2. **Register** `skill_key`, version, scope (`global` / `repo` / `agent`), checksum, source brain IDs, and install path.
3. **Promote** raw learning → observation → proposal → accepted `mind_skill`.
4. **Export** accepted brain skills into Skill.md / prompt artifacts as compiled bootloaders.
5. **Detect drift** when a local Skill.md differs from the accepted brain version.
6. **Sync** across machines without making markdown folders the source of truth.

## Immediate next code tasks from this matrix

1. `mind_memory get` processing parity with `mind_pull`.
2. `mind_search` → `mind_memory search` compatibility strategy.
3. `mind_self` wrapper tool with alias tests.
4. `mind_unconscious` wrapper tool with alias tests.
5. `mind_system` wrapper tool with alias tests.
6. `mind_wake` absorbs `mind_wake_log`.
7. Park Agent House under v7.2 after family merges; park Skill.md sync/drift under v7.3/post-v7.
