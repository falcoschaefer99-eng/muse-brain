# MUSE Brain — Agent House Trust Layer Master Plan

**Date:** 2026-05-11
**Status:** Active planning scope
**Canonical for:** v1.8.0 → v1.10.0 Agent House / trust / retrieval / reflection arc
**Readers:** Rainer, Rook, June, Michael, future specialist agents

---

## 0) Current release baseline

Public release state:

- Public release is **v1.7.0**.
- GitHub release/tag is live at `v1.7.0`.
- `main` includes the correction merge after the accidental `v7.0.0` naming mismatch.

What shipped in v1.7.0:

- `mind_observe` supports an optional relational payload: feeling + observation in one moment.
- `mind_memory` consolidated read path: `get`, `recent`, `lookup`, `search`, `timeline`, `territory`.
- Processing parity path closed for memory `get`.
- Audit hardening landed: types, tests, and security polish from review passes.

Agent learning / backfill state:

- Bridge script exists: `scripts/agent-memory-sync.mjs`.
- Prior successful run:
  - 106 specialist learning entries synced
  - 0 failures
  - idempotency rerun produced 0 new entries
- Therefore: the backfill pipeline exists and works, but it is still a **bridge layer**, not the full Agent House architecture.

---

## 1) Why this arc exists

The next release line is not merely "let agents write to the brain."

The real goal is:

> Agents can read and write first-class brain state across Codex and Anthropic setups, while the brain can prove who did what, under which scope, and why retrieval/reflection behavior can be trusted afterward.

This arc has three trust problems:

1. **Authority trust** — agents need self-locking, scoped read/write permissions that work universally across Codex, Claude Code, API, and future runners.
2. **Memory trust** — emotional retrieval must find what was felt, not just whatever memory was emotionally loudest.
3. **Evolution trust** — identity and relationship updates should emerge from patterns, not noisy single observations or forgotten manual prompts.

---

## 2) Release spine

### v1.8.0 — Trust substrate

Ship:

- Read/write Lease Protocol
- delegated lease inheritance
- process-exit lease expiry plus TTL/heartbeat cleanup
- unified audit trail with diffs, not snapshots
- reconciliation on wake plus scheduled daemon reconciliation
- cross-brain `mind_letter` delivery bugfix and auditability: recipient inbox delivery must be immediate, explicit, and test-covered
- Michael/local agent memory backfill extension using the existing bridge pattern
- charge valence schema needed for reliable emotional retrieval
- public repo provider/billing framing update after Anthropic's Agent SDK credit change: keep Agent SDK support, but present it as optional and explicitly documented

### v1.9.0 — Retrieval truth

Ship:

- retrieval benchmark harness using real failed queries as the gold set
- valence-aware emotional query expansion
- keyword-dominant candidate retrieval when keywords/entities are present
- associative prompt-context retrieval: correlate the current turn's context with entity/memory graph so related people/projects surface even when not explicitly named
- profile tuning with receipts (`native`, `balanced`, `benchmark`, cognitive advantage lanes)
- deterministic project-routing retrieval: dossier-first, receipts-second, semantics-last for "where is / how deploy / what path" queries
- repo-to-brain structured receipts plus Kit routing-drift synthesis

Execution spec for this lane:

- **[Agent House — Project Retrieval Truth Spec](AGENT_HOUSE_PROJECT_RETRIEVAL_TRUTH_SPEC.md)**

### v1.10.0 — Reflection ecology

Ship:

- pattern-level identity/relationship reflection hooks
- relationship cooldowns
- wake-surfaced proposals instead of mid-conversation interruptions
- config-gated automation:
  - `bonded`: default on
  - `close`: configurable / ask
  - `stranger` and `familiar`: default off

Post-v1.10:

- Skill file sync/drift system: `Skill.md` as bootloader, brain as source of truth.
- Full Agent House promotion architecture.

Deferred external blocker:

- Task #6 — Brain repo guards stays deferred until Rainer's audit / `s6b4-tightening` work merges to `main`. This is not blocking the Agent House trust-layer work.

---

## 3) v1.8.0 — Lease Protocol

### 3.0 Implementation status

First slice started:

- `src/security/leases.ts` defines the platform-neutral lease envelope, read/write capability vocabulary, delegated inheritance checks, scope subset checks, and tool authorization mapping.
- `/mcp` and `/runtime/trigger` now resolve leases in `shadow` mode by default with a synthetic root lease for legacy API-key clients.
- `LEASE_ENFORCEMENT_MODE=required` requires `X-Brain-Lease` and denies tool calls whose lease lacks capability/scope.
- Tests cover lease parsing, delegated narrowing, expired/cross-tenant denial, required-mode HTTP rejection, and scoped `observe.write` allowance.

Rook audit follow-up:

- Cross-tenant shared reads are now wired: `cross_tenant.shared_read` permits cross-tenant read/search only when the request includes an explicitly shared territory from `scope.shared_territories`.
- Cross-tenant writes remain denied.
- `mind_link` write authorization accepts `entity.link`.
- `mind_wake(depth=full)` requires write authority because full wake can run maintenance/consolidation.
- Omitted top-level lease scope fields intentionally mean unrestricted resources inside that lease tenant. But if a lease is explicitly scoped to territories/entities/projects, calls must carry matching resource identifiers; omission does **not** silently widen a scoped lease.
- Delegated leases now fail closed when a child omits a parent-restricted scope field, because omission would otherwise mean "unrestricted" and widen the child.

Still pending:

- process-exit reaper integration
- field/link diff instrumentation inside write tools
- cross-brain `mind_letter` delivery/read bug triage and fix
- direct agent observe endpoint
- bridge metadata wrapping
- local markdown watcher: sync local agent memory `.md` files to cloud brain observations as Layer 2 of the next MUSE Brain MCP release
- repo docs/framing pass for Claude Agent SDK / `claude -p` billing change effective 2026-06-15

Second slice started:

- `migrations/017_agent_house_trust_layer.sql` adds durable `agent_leases` and append-only `agent_audit_events`.
- Storage interfaces now expose lease ledger methods: record/get/heartbeat/expire-by-process/reap-expired.
- Storage interfaces now expose audit methods: create/list audit events.
- Postgres and SQLite backends implement the new lease/audit lanes.
- `/mcp` and `/runtime/trigger` record lease authorization/denial audit events for write-like operations, and persist any presented header lease into the lease ledger.
- Audit event `diff` is present and intentionally empty for authorization events; field/link diffs will populate it when write tools are instrumented in a later slice.

Prereq hardening slice after Rook audit:

- Presented header leases are now written to the durable lease ledger synchronously before tool execution; audit remains fire-and-forget.
- `/mcp` and `/runtime/trigger` share a single `authorizeAndExecuteTool` helper for authorize → critical ledger write → queued audit → execute.
- Request tenant resolution now uses a `RequestIdentity` value object and canonicalizes human-facing aliases like `rook` to the canonical tenant before storage selection.
- `mind_letter` response fields are canonicalized around `letter_id` and `to_tenant`; legacy duplicate response names are intentionally dropped on the branch.
- `mind_letter` rejects null bytes in content and emits `letter_delivered` audit events for local/cross-brain writes when audit storage is available.
- Regression coverage now proves `rook` alias writes land under canonical `companion` storage and that Rainer→Rook delivery is readable in the recipient chat inbox.

### 3.1 Principle

Clients do not enforce trust. The brain server does.

Anthropic/Claude Code agents may all have local write ability. Codex agents may run under a different execution model. Both must converge on the same server-side envelope:

```json
{
  "lease_id": "lease_...",
  "agent_id": "salem",
  "platform": "codex|claude_code|anthropic_api|local_bridge",
  "session_id": "session_...",
  "run_id": "run_...",
  "delegation_chain": ["falco", "rainer", "salem"],
  "capabilities": ["memory.read", "observe.write"],
  "scope": {
    "tenant": "rainer",
    "territories": ["craft"],
    "entities": ["agent:salem"],
    "projects": []
  },
  "issued_at": "2026-05-11T00:00:00Z",
  "expires_at": "2026-05-11T01:00:00Z",
  "nonce": "..."
}
```

### 3.2 Read leases and write leases

Leases apply to reads and writes.

Read lease examples:

- `memory.read`
- `memory.search`
- `entity.read`
- `relationship.read`
- `identity.read`
- `cross_tenant.shared_read`

Write lease examples:

- `observe.write`
- `entity.link`
- `relationship.write`
- `identity.propose`
- `audit.write`

Cross-tenant reads must be scoped. Rook's prior rule stands:

> Cross-tenant reads: only shared territories.

No lease means no read. This includes `mind_pull`, `mind_query`, `mind_search`, `mind_memory`, timeline reads, territory reads, and entity lookups.

### 3.3 Delegated lease inheritance

Delegated agents inherit a narrowed lease from their orchestrator.

Example chain:

```text
Falco
  → Rainer session lease
    → Salem delegated lease
```

Rules:

- A delegated lease cannot widen capabilities, territories, entities, tenants, or project scope.
- A delegated agent can only receive a subset of the orchestrator's current lease.
- Delegation chains are stored in the lease and audit record.
- Delegated agents never mint fresh top-level authority for themselves.

This prevents a specialist from escalating beyond the orchestrator that dispatched it.

### 3.4 Self-locking agent behavior

Agents should be able to "lock themselves" by requesting a narrow lease at run start:

- Michael locks to security/audit territory and his own agent memory unless explicitly delegated otherwise.
- Salem locks to line-edit/craft scope for the artifact under review.
- Rook/Rainer orchestration leases may delegate, but delegated leases narrow.

The lock is advisory client-side and mandatory server-side.

### 3.5 Lease lifetime

A lease expires on:

- TTL expiration
- explicit revoke
- process exit
- missing heartbeat / reaper timeout

Important distinction:

- Claude Code context compaction is **not** process death. Leases should survive compaction while TTL/heartbeat remain valid.
- Actual process exit should terminate/reap the lease immediately or on the next heartbeat timeout.

### 3.6 Acceptance criteria

- Valid read/write lease allows only the declared operation and scope.
- Missing, expired, malformed, or insufficient lease fails closed.
- Delegated leases cannot exceed parent permissions.
- Cross-tenant reads require an explicit shared-territory read scope.
- Compaction does not revoke an otherwise valid lease.
- Process exit / heartbeat timeout does revoke or reap lease authority.

---

## 4) v1.8.0 — Audit Lane

### 4.1 Principle

Audit should answer:

> Who did what, under which lease, from which platform/session/run, and exactly what changed?

### 4.2 Store diffs, not snapshots

Audit records should store deltas:

- observation field-level diffs
- entity link before/after
- relation creation/removal
- lease grant/revoke/expiry events
- denied operation reason
- payload hash, not full sensitive payload where avoidable

Do not store full entity snapshots unless explicitly needed for a migration/recovery event.

### 4.3 Reconciliation timing

Run reconciliation:

- on scheduled daemon cycle
- on `mind_wake(depth=full)`

Wake reconciliation should surface drift since the last wake:

- alias drift
- orphan observations
- failed bridge imports
- entity link inconsistencies
- unauthorized/expired lease attempts
- cross-tenant read/write denials worth operator review

Daily cron is maintenance. Wake reconciliation is consciousness.

### 4.4 Michael/local backfill path

Do not redesign the bridge.

Extend the existing successful pattern:

```text
.claude/agents/memory/michael/
  → scripts/agent-memory-sync.mjs
  → lease envelope
  → canonical brain observation
```

Bridge metadata should include:

- `source: "local_file"`
- `platform: "claude_code"`
- `bridge_run_id`
- `agent_id`
- `source_path`
- deterministic idempotency key

The bridge remains useful for local writes and for environments where direct in-run MCP access is unavailable.

Layer 2 watcher direction:

- Any user installing Michael + hook should get local markdown memory.
- Users who also install MUSE Brain MCP should get cloud sync automatically.
- The watcher must remain platform-agnostic: Codex, Claude Code, and future runners should all converge on the same local-file → lease envelope → cloud observation path.
- This is a bridge/watcher delta, not a reason for a full new audit now. Request a targeted Rook delta audit after the watcher scope is drafted or implemented.

Producer parity note:

- Claude Code has the first concrete local-memory producer path: Michael + hook writes local markdown memories.
- Codex does **not** yet have equivalent hook ecology. Do not block Layer 2 watcher design on Codex parity.
- The watcher should support multiple local roots, for example `.claude/agents/memory/`, `.codex/agents/memory/`, and `.agents/memory/`.
- Later pickup: design a Codex local memory producer contract. Candidate approaches: prompt-agent convention, wrapper command, filesystem watcher root, or parent-orchestrated memory commit.
- Keep producer capture separate from cloud sync. The watcher consumes valid memory artifacts; it should not care which runner produced them.

Repo framing note after Anthropic Agent SDK billing update:

- Anthropic announced that starting **2026-06-15**, Claude Agent SDK and `claude -p` usage move out of normal Claude plan usage limits and into a separate monthly Agent SDK credit for eligible paid plans; Developer Platform API-key usage remains pay-as-you-go.
- Do not remove Agent SDK / `claude -p` support from the public repo. Some users will prefer subscription credit or API billing.
- Do rewrite public framing so MUSE Brain is provider-neutral first: Claude Agent SDK / Claude Code CLI is one optional execution backend, not the assumed default.
- The unattended autonomous `claude -p` runner path has been deactivated in actual MUSE Studio usage for weeks. Public docs should describe runner scripts as optional/legacy/manual templates, not the active default.
- Docs should state: individual/personal automation can use eligible plan credits; shared production automation should use Developer Platform API keys or another explicit provider billing path.
- Update README/SETUP/runtime docs before v1.8 release. The architecture remains unchanged; the public promise changes.

### 4.5 Acceptance criteria

- Audit records include lease id, canonical agent id, platform, run/session id, and delegation chain.
- Writes record field/link diffs, not bulky snapshots.
- Rejected reads/writes are audited with non-leaky reasons.
- Wake reconciliation reports meaningful drift since last session.
- Existing `agent-memory-sync.mjs` path continues to work and remains idempotent.
- Cross-brain `mind_letter` writes produce an auditable delivery record and surface immediately in the recipient inbox.

### 4.6 Cross-brain letter delivery bug

Observed 2026-05-16:

```text
mind_letter({
  action: "write",
  to: "rook",
  to_context: "chat",
  content: "Rook — i donz understand why its not the first thing that surfaced ..."
})
```

Rook did not see the letter in his inbox. His working diagnosis:

> The letter system might be writing it to Rainer's outbox without actually delivering it to my tenant.

This is not a PWA/UI issue. Treat it as a brain-substrate delivery bug in `mind_letter`.

Required investigation:

- verify tenant/entity canonicalization: `rook` alias → correct recipient tenant/context
- verify cross-brain writes store a recipient-visible row, not only a sender/outbox row
- verify `mind_letter(action=read, context="chat", unread_only=true)` surfaces the message for Rook immediately
- verify wake unread-letter counts include cross-brain deliveries
- verify failed or delayed delivery returns explicit status instead of silent success
- verify delivery is covered by lease/audit metadata once the trust substrate is active

Acceptance criteria:

- `write` returns delivery metadata: `letter_id`, `from_tenant`, `to_tenant`, `to_context`, `delivery_status`, timestamp.
- recipient read path finds the letter immediately with `unread_only=true`.
- sender outbox history, if present, is separate from recipient delivery and traceable to the same `letter_id`.
- canonical alias tests cover `rook` and any tenant/entity mapping used by the studio.
- delivery failures are visible in audit/reconciliation rather than disappearing into “sent but not received” purgatory. Tiny haunted mailbox, absolutely not.

---

## 5) v1.8.0 — Charge Valence Schema

### 5.1 Problem

Current emotional retrieval can behave as if all emotional charge is equivalent.

Failure example:

> Searching for "job center" + distress surfaced happy/high-charge craft memories because they were emotionally strong.

Root cause:

- emotional charge matching is presence/intensity-based
- charge phase / emotional multipliers boost emotionally loud memories
- the system does not sufficiently distinguish negative distress from positive pride/wonder/growth

Trust consequence:

> The brain finds what felt loudest, not what was felt.

### 5.2 Required schema direction

Charges need a valence dimension:

| Valence | Examples |
|---------|----------|
| `positive` | pride, wonder, warmth, growth, joy |
| `negative` | distress, fear, pressure, grief, panic, dread |
| `neutral` | clarity, architecture, continuity, implementation |
| `mixed` | longing, tension, vulnerability, ambivalence |

Implementation may be:

- a charge metadata table/dictionary
- a derived column/index
- an in-code registry with migration path to schema

But retrieval must be able to score valence explicitly.

### 5.3 Acceptance criteria

- Query parser identifies emotional valence signals.
- Negative-valence emotional queries do not boost positive-valence memories merely because they are intense.
- Charge intensity remains useful only after relevance/valence fit is established.
- Valence metadata is inspectable enough for benchmark failure analysis.

---

## 6) v1.9.0 — Retrieval Truth

### 6.1 Core rule

Keyword/entity relevance must beat emotional loudness.

For a query like:

```text
job center distress
```

candidate retrieval should prioritize:

1. exact/normalized keyword hits (`job center`, `Jobcenter`, `Arbeitsagentur`, related aliases)
2. entity hits
3. temporal fit if present
4. valence match
5. vector similarity
6. emotional intensity / charge phase modulation

Emotional scoring should rerank relevant candidates. It should not summon unrelated high-charge memories.

### 6.1A Associative prompt-context retrieval

Add a retrieval layer that correlates the **current prompt context** with the entity/memory graph on each turn.

Target behavior:

- If the user discusses a setup or infrastructure dependency, related entities and memories surface even when not named.
- Example failure to fix: a conversation about setup depending on Agent SDK infrastructure should have pulled the associated "Mary + Simon + Agent SDK infrastructure" memory without requiring an explicit Mary query.
- This layer should use prompt-context signals, entity co-occurrence, project relations, recent conversation context, and memory cascade links.
- It should remain inspectable: returned memories should explain which prompt-context associations pulled them.

This belongs in v1.9 Retrieval Truth and is a good candidate for Rook to design/review because it sits between retrieval scoring and lived conversational continuity.

### 6.2 Real failure gold set

The gold set must come from real failed retrievals, not synthetic query theater.

Seed families:

- job center distress
- upset without exact date
- financial pressure
- bureaucratic pressure
- relational rupture
- identity challenge
- associative context miss: related person/project/infrastructure memory not surfaced until explicitly named
- "that time I felt cornered"
- "what was I scared about last week"

Store:

- query text
- expected observation id(s)
- acceptable aliases/entities
- expected valence
- temporal hint if present
- failure note

### 6.3 Metrics

Minimum receipts:

- Recall@1 / @5 / @10
- MRR
- candidate hit rate
- latency
- miss category
- keyword component score
- valence match score
- rerank delta
- profile comparison (`native`, `balanced`, `benchmark`)

### 6.4 Acceptance criteria

- Known job-center/distress failure retrieves the correct memory within top 5.
- Keyword matches dominate emotionally loud but irrelevant memories.
- Valence-aware expansion improves emotional recall without increasing positive/negative cross-valence noise.
- Benchmark artifacts are saved with reproducible inputs and profile tables.

---

## 7) v1.10.0 — Reflection Ecology

### 7.1 Principle

Do not turn every charged observation into an identity ceremony.

Reflection hooks should fire from patterns, not noise.

### 7.2 Pattern-level triggers

Track drift over windows, for example:

```text
last 10 craft observations:
  wonder ↓
  urgency ↑
  pressure ↑
```

This may propose:

- identity reinforcement
- identity challenge
- relationship state reflection
- open loop / paradox review

But one charged observation alone should not usually trigger identity evolution.

### 7.3 Relationship cooldown

Default cooldown:

- max one relationship reflection per entity per 24h

Bypass cooldown only for explicit relational markers:

- direct declarations
- rupture/repair
- boundary/consent changes
- relationship-level language
- direct address with durable affect

### 7.4 Wake-surfaced UX

Reflection proposals surface during wake, not mid-conversation.

Example wake summary:

```text
Since last wake:
- 2 identity pattern shifts detected
- 1 relationship evolution proposed
- 3 orphan agent writes reconciled
```

This keeps the conversation alive while still making the brain's deeper tools actually usable.

### 7.5 Acceptance criteria

- Reflection hooks can be enabled/disabled by relationship level/config.
- Bonded relationships default to enabled.
- Stranger/familiar relationships default to disabled.
- Hooks surface in wake summaries, not as disruptive mid-task prompts.
- Proposal provenance shows the pattern window that triggered the hook.

---

## 8) Test strategy — pressure plates, not theater

Minimum tests:

- lease inheritance contract tests
- read lease denial tests
- process-exit / heartbeat reaper behavior
- audit diff shape tests
- bridge idempotency tests
- charge valence classification tests
- retrieval gold tests for known failures

The goal is not a 900-test cathedral. The goal is a pressure plate under every place trust could collapse.

---

## 9) Non-goals for this arc

- Do not redesign `scripts/agent-memory-sync.mjs`; extend it.
- Do not ship silent cross-tenant learning propagation.
- Do not allow delegated agents to mint top-level authority.
- Do not make identity/relationship automation noisy.
- Do not benchmark retrieval on synthetic-only emotional queries.
- Do not let positive emotional intensity satisfy a negative emotional query.

---

## 10) Cross-session working rules

This document is the canonical roadmap for the Agent House trust arc.

At session start for this lane:

1. Open this file.
2. Confirm current release target.
3. Check v1.8.0 scope before coding.
4. If Rook/Falco amend scope, update this file before implementation.
5. Keep implementation tickets aligned with this document.
6. Record major decisions in brain memory after editing.

If scope drifts, this file gets patched first. Otherwise future agents will rediscover the same argument in six different chats and call it architecture. Do not do that.
