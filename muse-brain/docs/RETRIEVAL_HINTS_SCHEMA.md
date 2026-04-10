# Retrieval Hint Schema & Storage Strategy (Sprint 3A)

**Status:** active design + implementation scaffold  
**Date:** April 9, 2026

---

## Why this exists

Retrieval hints are **assistive sidecar artifacts** that improve candidate generation.  
They are never a lossy replacement for canonical observations.

This is the implementation-level contract for Sprint 3A.

---

## Artifact schema (v1)

TypeScript contract lives at:

- `src/retrieval/hints.ts`

Core shape:

- `id`
- `observation_id`
- `hint_type`
- `hint_text`
- `confidence` (0–1)
- `weight` (0–1)
- `source` (`derived | manual | imported`)
- `created_at`
- `updated_at`
- `metadata` (optional)

Supported `hint_type` values:

- `preference_hint`
- `assistant_response_hint`
- `temporal_hint`
- `entity_hint`
- `quoted_phrase_hint`
- `relational_context_hint`
- `contradiction_hint`
- `territory_salience_hint`
- `state_snapshot_hint` *(reserved lane — future state-conditioned work)*

---

## Storage strategy (v1)

### Postgres

- dedicated sidecar table: `retrieval_hints`
- foreign-keyed by `observation_id` (tenant-scoped)
- index strategy:
  - `(tenant_id, hint_type)`
  - `(tenant_id, observation_id)`
  - `GIN(hint_text_tsv)` for keyword recall
  - `(tenant_id, confidence DESC)`

### SQLite

- sidecar collection under KV key: `retrieval_hints`
- in-memory indexes built by:
  - observation id
  - hint type
  - hint token

---

## Safety rules

1. Canonical observations remain source of truth.
2. Hint generation must be deterministic and auditable.
3. Hint payloads are bounded + sanitized.
4. Retrieval can use hints for candidate expansion, never for canonical overwrite.

---

## Sprint 3A implemented now

- Hint schema + normalization helpers
- Hint sanitization + bounded artifact creation
- Initial deterministic derivation functions:
  - quoted phrase hints
  - temporal hints
  - entity hints
- Test coverage for schema + derivation + strategy contract

Implementation tests:

- `test/retrieval-hints.spec.ts`

## Sprint 3B extension notes (April 10, 2026)

- Additional deterministic generators are active:
  - `preference_hint`
  - `assistant_response_hint`
  - `relational_context_hint`
- `state_snapshot_hint` remains explicitly **reserved**:
  - no automatic generation in current retrieval path
  - future lane requires explicit opt-in and auditable policy hooks
