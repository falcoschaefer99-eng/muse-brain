# ADR — Dispatch Calibration and Agent Learning Layers

**Date:** 2026-03-27  
**Status:** Accepted for implementation planning

## Context

The brain already tracks agent dispatch feedback, but confidence is still raw and weakly judged. At the same time, named agents need a stable learning model that improves across tenants without silently flattening environment- or user-specific nuance.

## Decisions

### 1. Canonical named agents are the persistent learning anchor

- Named agents such as Michael, Kit, Reeve, Quinn, Dante, etc. remain stable `entity_type='agent'` entities.
- Runtime platform nicknames are not canonical. They map back to the named agent entity.
- Accepted learning attaches to the canonical agent dossier, not to ephemeral runtime aliases.

### 2. Agent learning is layered, not undifferentiated

Learning is split into four layers:

1. **Shared skill core** — strengths, failure modes, pair affinities, routing priors. Cross-tenant.
2. **Environment layer** — Codex vs CC vs shell vs API behavior. Per-platform.
3. **Tenant layer** — user-specific preferences and relational calibration. Per-tenant.
4. **Project/session layer** — dossier-scoped temporary state. Ephemeral.

### 3. Cross-tenant learning propagates only after review

- Raw run data does not automatically rewrite the shared agent profile.
- A pattern must be observed, reviewed, and accepted before it updates the shared skill core.
- Tenant-layer behavior never crosses tenants without explicit review.

### 4. Domain faceting lives in dispatch feedback, not the entities table

- Agents can operate across multiple domains.
- Domain is modeled on dispatch/calibration records, not as a fixed entity column.
- The primary calibration grain is:

`(agent_entity_id, domain, environment, task_type)`

This lets Michael improve in security audit without forcing the same calibration assumptions onto unrelated domains or environments.

### 5. Kit is domain-faceted, not schema-special

- **Brain hygiene** (`kit-hygiene.ts`) remains infrastructure/daemon behavior.
- **Kit as an agent** remains the system/filesystem janitor mind.
- Kit's dual role is an instance of the general domain-faceting pattern, not a one-off schema exception.

## Immediate implications

- Dispatch feedback needs richer fields for calibration and rescue cost.
- Routing should become advisory before it becomes automatic.
- Shared-core learning should be queryable independently from tenant- or environment-specific overlays.

## Out of scope for the first pass

- Fully automatic routing from trust scores
- Silent cross-tenant propagation
- Hard pair-affinity routing rules
- Identity rewrites driven directly by noisy run data
