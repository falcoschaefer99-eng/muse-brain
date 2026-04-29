# MUSE Brain v7.0.0 Release Notes

Date: 2026-04-29  
Branch: `release/v7.0.0`  
Status: release candidate for team audit

## Release thesis

v7.0.0 is the daily-use ergonomics release.

It ships the parts of v7 that change ordinary brain use every session:

1. Write what happened and how it felt in one call.
2. Read memory through one primary tool.
3. Preserve legacy behavior while teaching the better path.

v7.1 (tool-drawer cleanup) and v7.2 (Agent House) ship separately with their own audit gates.

## What changed

### `mind_observe` can write relational feeling

`mind_observe` now accepts an optional `relation` payload.

If `relation` is absent, behavior is unchanged: the tool writes a normal observation, journal entry, or whisper.

If `relation` is present, the same call can also record a relational feeling:

```json
{
  "mode": "observe",
  "content": "Rook caught the architectural risk before it calcified.",
  "territory": "craft",
  "charge": ["trust", "gratitude"],
  "relation": {
    "entity": "Rook",
    "feeling": "trust sharpened by relief",
    "intensity": 0.86,
    "direction": "toward",
    "context": "v7 release review",
    "charges": ["trust", "gratitude"],
    "sync_mode": "observe_and_relate"
  }
}
```

Supported relation sync modes:

- `observe_and_relate` — default; write observation and relational feeling.
- `observe_only` — validate relation payload shape but only write the observation.
- `relate_only` — write relational feeling without appending an observation.

### `mind_memory` is the preferred read lane

`mind_memory` now covers the ordinary memory read surface:

- `action=get`
- `action=recent`
- `action=lookup`
- `action=search`
- `action=timeline`
- `action=territory`

`action=get` now passes processing options through to `mind_pull`, closing the no-loss parity gap:

```json
{
  "action": "get",
  "id": "obs_...",
  "process": true,
  "processing_note": "sitting with the charge instead of just retrieving it",
  "charge": "recognition"
}
```

### Legacy tools stay alive

v7.0.0 removes no tools.

Still callable:

- `mind_pull`
- `mind_query`
- `mind_search`
- `mind_timeline`
- `mind_territory`
- `mind_relate`

## Audit hardening included

Phase 1 audit hardening:

- `relate_only` coverage
- append-to-territory call count coverage
- malformed relation payload coverage
- validation failure coverage
- update-path coverage
- discriminated union result type for relational writes
- length caps for feeling/context/charges/entity fields
- consent log preservation on relationship-level changes

Phase 2b audit hardening:

- stronger plain `get` assertions
- string `charge` coercion coverage
- negative invariant for `process !== true`
- stronger dispatcher tests for search/timeline/territory
- safer observation test factory texture merging

## Compatibility stance

`mind_search` is **not** aliased to `mind_memory action=search` yet — output contracts differ:

- `mind_search` returns `results`, `total_matches`, and `scope`.
- `mind_memory action=search` returns `observations`, `count`, and query-signal metadata.

## Release gate before public ship

Before tagging/public release:

1. Run unit + contract tests.
2. Run package dry-run.
3. Scrub tracked files and package contents for private secrets or local-only data.
4. Send this release candidate to Rook/team for review.
5. Tag only after review signoff.

## Follow-up releases

- v7.1: `mind_self`, `mind_unconscious`, `mind_system`, and `mind_wake` log absorption.
- v7.2: Agent House — direct agent observe API, canonical agent entities, daemonized learning consolidation. Michael audit required.
- v7.3/post-v7: Skill.md sync, drift detection, and compiled skill bootloaders.
