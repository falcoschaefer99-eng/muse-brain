# v7.0.0 Release Candidate Audit Packet

Date: 2026-04-29  
Branch: `release/v7.0.0`  
Base milestone commit: `18c5ed9` (`test(memory): harden phase 2b parity coverage`)  
Package version: `7.0.0`

## Release boundary

This candidate is cut from the v7.0 milestone, before the v7.1 family-wrapper work on `main`.

Included:

- `mind_observe` optional relational payload
- relational write hardening from the Phase 1 audit
- `mind_memory` timeline + territory read consolidation
- `mind_memory action=get` processing passthrough parity
- Phase 2b Kairo test hardening
- release docs, package version bump, launcher version bump, and public scrub cleanup

Not included:

- `mind_self`
- `mind_unconscious`
- `mind_system`
- `mind_wake_log` fold-in
- Agent House / direct agent observe API
- Skill.md sync/drift system

Those continue as v7.1+ work.

## Verification commands

```bash
npx tsc --noEmit -p tsconfig.json
npm test
npm run test:contracts
npm_config_cache=/tmp/muse-brain-npm-cache npm pack --dry-run --json
npm_config_cache=/tmp/muse-brain-npm-cache npm pack
```

## Verification results

- TypeScript: PASS
- Unit tests: PASS — 20 files, 242 tests
- Contract tests: PASS — 2 files, 73 tests
- Package dry-run: PASS — 145 entries
- Package build: PASS

## Squad audit delta fixes

The full RC review squad found six final polish items, all resolved:

1. Removed remaining real user-name test fixtures from packaged tests.
2. Updated MCP `initialize.serverInfo.version` from `1.6.0` to `7.0.0`.
3. Added an aggregate-dispatcher unknown-tool throw test.
4. Added relational `intensity` boundary coverage for `0`, `1`, and non-numeric input.
5. Added `relate_only` missing-feeling negative coverage.
6. Routed legacy `mind_relate action=level` through the shared relationship-level audit-log helper.

Updated count: **315 passing tests** across unit + contract lanes.

## Known issue deferred to v7.0.1

`queryObservations({ entity_id })` is declared in the storage interface, but the current Postgres storage implementation does not enforce `entity_id` inside `queryObservations` itself. Current v7.0 read paths remain correct because `mind_query`/`mind_memory` apply a defensive JS-side entity filter after retrieval, but the storage contract should be tightened for third-party tool authors.

Deferred fix target: v7.0.1.

## Package artifact

Artifact: `muse-brain-7.0.0.tgz`

- npm id: `muse-brain@7.0.0`
- package size: ~5.8 MB
- unpacked size: ~7.3 MB
- files: 145
- final checksums are recorded after the last package build

## Public/private scrub

Private endpoint references were scrubbed from release docs:

- `docs/AGENT_LEARNING_BRIDGE_v6.md`
- `docs/RETRIEVAL_RATE_UPLIFT_TASKBOARD_20260422.md`

Public shell smoke test auth now uses generic `BRAIN_API_KEY` instead of a private tenant-specific variable.

Test fixtures that contained a real user name were anonymized to `Mira`.

Package contents were extracted and scanned for high-signal secrets/local paths: private deployment hostnames, old tenant-specific auth env vars, local absolute paths, common cloud/API token prefixes, and private-key blocks.

Result: PASS — no matches.

The source/package scan also checks for the real user-name fixture with a word-boundary pattern; the only broad-match false positive was Cloudflare's public `falcon-7b` model identifier.

Placeholder/example credentials remain intentionally present in example files:

- `.env.example`
- `.dev.vars.example`
- `docs/MIGRATIONS.md`

## Team review ask

Rook/team should review:

1. Does the release boundary match the stated v7.0 promise?
2. Is `mind_observe relation` intuitive enough as the daily feeling-capture path?
3. Is `mind_memory` clearly positioned as the preferred read lane without breaking legacy callers?
4. Any remaining public/private scrub concerns in docs, templates, or package contents?
5. Any reason not to tag `v7.0.0` after review?

## Tagging recommendation

Do not tag until review signoff.

After signoff:

```bash
git tag -a v7.0.0 -m "Release v7.0.0"
```
