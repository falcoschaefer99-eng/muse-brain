# v7.0.0 Release Candidate Audit Packet

Date: 2026-04-27  
Branch: `release/v7.0.0`  
Base milestone commit: `18c5ed9` (`test(memory): harden phase 2b parity coverage`)  
Package version: `7.0.0`

## Release boundary

This candidate is cut from the pure v7.0 milestone, before the v7.1 family-wrapper work on `main`.

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
- Unit tests: PASS — 20 files, 237 tests
- Contract tests: PASS — 2 files, 69 tests
- Package dry-run: PASS — 145 entries
- Package build: PASS

## Package artifact

Artifact: `muse-brain-7.0.0.tgz`

- npm id: `muse-brain@7.0.0`
- package size: ~5.8 MB
- unpacked size: ~7.3 MB
- files: 145
- final checksums are recorded after the last package build, outside this self-included audit document

## Public/private scrub

Private endpoint references were scrubbed from release docs:

- `docs/AGENT_LEARNING_BRIDGE_v6.md`
- `docs/RETRIEVAL_RATE_UPLIFT_TASKBOARD_20260422.md`

Public shell smoke test auth now uses generic `BRAIN_API_KEY` instead of a private tenant-specific variable.

Test fixtures that contained a real user name were anonymized to `Mira`.

Package contents were extracted and scanned for high-signal secrets/local paths: private deployment hostnames, old tenant-specific auth env vars, local absolute paths, common cloud/API token prefixes, and private-key blocks.

Result: PASS — no matches.

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
