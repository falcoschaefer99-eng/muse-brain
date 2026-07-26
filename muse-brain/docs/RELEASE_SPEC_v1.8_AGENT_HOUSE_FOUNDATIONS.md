# MUSE Brain 1.8 — Agent House Foundations

**Release:** v1.8.0
**Title:** Agent House Foundations
**Status:** Public release spec
**Date:** 2026-06-13

---

## 1) Release thesis

MUSE Brain 1.8 teaches agents to coordinate around proof instead of vibes.

Before this release, the Brain could remember a project, but agents could still lose time rediscovering operational truth:

- which repo is canonical
- where the checkout lives locally
- which command deploys the project
- where an artifact was written
- whether a path came from a proven receipt or a semantic guess

This release adds the first Agent House foundation: **project truth, receipt-backed wayfinding, scoped agent trust, and Kit hygiene proposals.**

In one sentence:

> Canonical projects tell the Brain what the work is; Agent House Foundations tells the Brain where the work lives, how it moves, and which operational truths have actually been proven.

---

## 2) What ships

### 2.1 Project routing truth

Project dossiers can now carry structured `workspace_routing` metadata:

- repo slug
- canonical repo URL
- default branch
- local workspace paths
- artifact roots
- deploy commands
- test commands
- production/preview URLs
- handoff docs
- related projects
- path aliases

This gives agents deterministic project wayfinding before semantic retrieval gets involved.

### 2.2 Operational receipts

MUSE Brain now supports structured operational receipts through `mind_receipt`:

- `repo_receipt` — repo URL, branch, commit, local path, changed paths, actor/platform/source
- `deploy_receipt` — deploy command, target, branch/commit, URLs, status, artifact path
- `artifact_receipt` — exact artifact path produced by project-linked task completion

Receipts are stored as linked observations so they remain inspectable, queryable, and evidence-backed without creating a second project system.

### 2.3 Repo-to-Brain bridge

`scripts/repo-receipt-sync.mjs` can read a local checkout and write a structured repo receipt to the Brain.

It captures:

- git root
- origin URL
- branch/default branch
- HEAD SHA
- changed paths
- local path
- actor/platform/source
- idempotency state

This is the first cloud/local repo → Brain intake bridge for Agent House.

### 2.4 Kit project routing hygiene

Kit now inspects project-linked receipts and proposes corrections when project truth drifts.

New proposal families:

- `project_routing_update`
- `project_routing_drift`
- `missing_artifact_receipt`
- `stale_deploy_command`
- `path_alias_conflict`

Kit can now notice:

- repeated successful receipts point to a stable local path missing from the dossier
- repeated deploy receipts use a command not in routing metadata
- dossier routing disagrees with recent successful receipts
- a file-producing project task was completed without an artifact path

Kit does **not** auto-promote these into canonical dossier metadata. Proposals remain review-gated.

### 2.5 Agent lease trust layer

The first Agent House trust layer is in place:

- `X-Brain-Lease` request envelope
- lease parsing and validation
- delegated lease narrowing
- required/shadow/off enforcement modes
- server-side authorization for tool calls
- lease ledger storage
- append-only audit events
- tenant alias canonicalization, including `rook` → `companion`

Agents can act, but the Brain can now answer: who acted, under what scope, and whether the action was authorized.

### 2.6 Cross-brain letter hardening

Cross-brain letters now have clearer delivery behavior:

- canonical tenant resolution
- explicit sender/recipient tenant fields
- delivery status
- safer content/context validation
- optional audit events for delivery
- paged/list/search/get support for letter history

### 2.7 Cognitive benchmark/rerank lane

This release includes a first custom benchmark lane for retrieval experiments:

- `cognitive_advantage` dataset adapter
- benchmark CLI support for `--rerank-mode` and `--rerank-top-n`
- heuristic rerank engine and tests
- family-level cognitive report scripts
- organic corpus seed helper
- end-to-end smoke coverage for the cognitive benchmark lane

This is not the full relational creative benchmark. It is the infrastructure needed to test retrieval and rerank claims honestly.

### 2.8 Legacy runner repositioning

The old headless `claude -p` / Agent SDK runner path remains in the repo as an optional legacy/manual template.

It is no longer described as the active default execution path for MUSE Studio.

The active public stance is:

- MUSE Brain core is provider-neutral MCP infrastructure
- runner templates are optional experiments
- app-level autonomous orchestration belongs in the app/runtime layer when ready

### 2.9 Supply-chain guard

A GitHub Actions guard blocks pull requests that add or modify install-time lifecycle scripts in `package.json` files unless explicitly labeled for review.

This reduces supply-chain risk from surprise `postinstall`, `preinstall`, `prepare`, or `install` scripts.

---

## 3) What does not ship yet

MUSE Brain 1.8 does **not** ship:

- automatic promotion of routing proposals into project dossiers
- full app-level autonomous wake orchestration
- direct in-run agent observe API
- full local file watcher for agent memory sync
- charge valence schema for emotional retrieval
- full relational creative AI benchmark
- complete Agent House promotion architecture

Those remain future layers.

---

## 4) Why this matters

Personal AI does not become reliable by remembering more. It becomes reliable by knowing what kind of truth it is holding.

MUSE Brain 1.8 separates:

- semantic memory
- project routing truth
- operational receipts
- reviewable proposals
- scoped agent authority

That separation is the foundation for safer subagent automation.

Agents should not have to guess where work lives. They should not invent deploy commands from old prose. They should not silently rewrite canonical project truth. And they should not act without the Brain knowing what authority they had.

This release makes those expectations concrete.

---

## 5) Verification

Release branch verification before this spec:

- TypeScript: `npx tsc --noEmit`
- Unit suite: `npm test -- --run`
- Passing suite: 24 files / 281 tests
- Cognitive benchmark smoke: `cognitive_advantage` with heuristic rerank
- Git tree: clean after release-framing commit

---

## 6) Release headline

**MUSE Brain 1.8 — Agent House Foundations**

Agents now know where work lives, can prove what happened, and can ask Kit to flag when project truth drifts.
