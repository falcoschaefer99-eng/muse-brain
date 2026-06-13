# Agent House — Project Retrieval Truth Spec

**Date:** 2026-06-10  
**Status:** Draft implementation spec  
**Canonical for:** project routing truth, repo-to-brain receipts, Kit synthesis lane  
**Depends on:** `AGENT_HOUSE_TRUST_LAYER_MASTER_PLAN.md` v1.8-v1.10 arc

---

## 0) Why this exists

Canonical projects already exist.

The current failure is not "what is the project?" The failure is:

- retrieval still guesses across sessions
- path/deploy truth is scattered across prose handoffs
- cloud-repo truth is not metabolized into the brain automatically
- runtime wakes know *that* work exists, but not always *where it lives*
- the same deploy/path facts must be rediscovered instead of learned once and reused

This spec defines the missing layer:

> **Facts before vibes for project lookup.**

When the question is "where is it / how does it deploy / what path should I open," the brain must resolve deterministic project truth before semantic memory surfacing.

---

## 1) Goals

### 1.1 Primary goals

1. Kill cross-session project confusion.
2. Kill cross-substrate path confusion (Codex, Claude Code, future runners).
3. Make runtime wakes return actionable workspace routing without guesswork.
4. Let GitHub/cloud-repo activity feed the brain as structured project receipts.
5. Let Kit synthesize repeated operational truths into stable project knowledge while preserving raw evidence.

### 1.2 Non-goals

- Do **not** create a second project system beside canonical project dossiers.
- Do **not** replace semantic retrieval for creative or relational work.
- Do **not** auto-canonize noisy single receipts into project truth.
- Do **not** delete raw operational evidence for the sake of "lean" memory. Consolidate up; do not erase load-bearing history.

---

## 2) Core principles

### 2.1 Resolution order matters

For project-navigation queries, the brain must resolve in this order:

1. exact project/entity/alias match
2. canonical project dossier routing metadata
3. recent successful structured receipts
4. task `artifact_path` receipts
5. only then hybrid semantic/project observations

This is the opposite of the current failure mode, where semantic resonance can outrank operational truth.

### 2.2 GitHub is canonical for code; brain is canonical for synthesis

- **Repo/cloud source** holds source files and execution receipts
- **Brain** holds normalized, queryable project truth and learned operational memory

The repo is not the memory system. The brain is not the source tree. They must cooperate cleanly.

### 2.3 Stable truth must be reviewable

Project routing truth is operationally dangerous when wrong. Any promotion from repeated receipts into canonical dossier metadata must be:

- evidence-backed
- drift-aware
- reviewable by human or orchestrator agent

### 2.4 Lean means compressed truth, not amnesia

Kit synthesis should collapse repetition into stable summaries and proposals, not "clean up" by deleting evidence the system may need later.

---

## 3) The missing data model

Canonical projects stay where they are: `mind_project` + project entities.

What changes is the **routing truth layer** around them.

### 3.1 Project dossier metadata extension

Add a structured `workspace_routing` block to project dossier metadata.

```json
{
  "workspace_routing": {
    "repo_slug": "dupin-service",
    "canonical_repo_url": "git@github.com:.../dupin-service.git",
    "default_branch": "main",
    "local_paths": [
      "/Users/falco/AI/rainer-workspace/dupin-service"
    ],
    "artifact_roots": [
      "/Users/falco/AI/rainer-workspace/generated-assets"
    ],
    "deploy": {
      "kind": "cloudflare_worker",
      "commands": [
        "npx wrangler deploy -c /Users/falco/AI/rainer-workspace/dupin-service/wrangler.toml"
      ],
      "preview_urls": [],
      "production_urls": [
        "https://..."
      ]
    },
    "test_commands": [
      "npm test"
    ],
    "path_aliases": [
      "dupin",
      "dupin mcp",
      "inspector service"
    ],
    "handoff_docs": [
      "/Users/falco/AI/rainer-workspace/handovers/2026-05-11-dupin-decouple.md"
    ],
    "related_projects": [
      "dupin-site"
    ]
  }
}
```

This is additive. No second dossier system.

### 3.2 Structured project receipts

Add a durable structured receipt lane. Raw observations can mirror the event, but project-routing retrieval should not depend on prose parsing.

Receipt families:

1. **repo_receipt**
   - repo slug/url
   - branch
   - commit SHA
   - changed file paths
   - actor/agent/platform
   - success/failure

2. **deploy_receipt**
   - deploy command
   - working directory
   - config path
   - preview/live URLs
   - environment
   - success/failure

3. **artifact_receipt**
   - exact `artifact_path`
   - artifact type
   - producing task/run
   - related project

4. **routing_receipt**
   - canonical local path
   - repo root
   - deploy target
   - test command
   - path alias evidence

Minimum fields across all receipt types:

- `project_entity_id`
- `receipt_type`
- `recorded_at`
- `agent_tenant`
- `platform`
- `source`
- `success_state`
- `payload_json`
- `idempotency_key`

### 3.3 Promotion target

Receipts do not become truth by existing.

Repeated successful receipts become **routing proposals** that can update `mind_project.metadata.workspace_routing`.

Raw receipts stay queryable.

---

## 4) Retrieval behavior changes

### 4.1 Project resolution lane

Add a dedicated project-resolution pass before hybrid retrieval whenever the query contains:

- project/entity name
- alias/path token
- deploy/build verbs
- "where is", "how do I deploy", "what repo", "what path", "where does output go"

### 4.2 Resolution algorithm

For project queries:

1. resolve entity/project alias
2. load dossier routing metadata
3. query latest successful receipts for that project
4. query latest `artifact_path` task completions
5. build a deterministic answer packet
6. optionally append semantic observations as context, never as routing authority

### 4.3 Deterministic answer packet

The runtime / retrieval layer should be able to produce:

```json
{
  "project": "kitchen-site",
  "repo_slug": "kitchen-site",
  "local_path": "/Users/falco/AI/rainer-workspace/kitchen-site",
  "deploy_command": "npx wrangler pages deploy . --project-name=kitchen-site --branch=main",
  "artifact_root": "/Users/falco/AI/rainer-workspace/kitchen-site",
  "preview_url": "https://...",
  "production_url": "https://kitchen.funkatorium.org/",
  "confidence": "dossier+receipt",
  "supporting_receipts": ["receipt_...", "receipt_..."]
}
```

### 4.4 Confidence labels

Project routing answers should expose confidence provenance:

- `dossier_only`
- `dossier+receipt`
- `receipt_only`
- `semantic_inference_only`

`semantic_inference_only` should be treated as weak and surfaced honestly.

---

## 5) Runtime integration

### 5.1 Workspace routing becomes real

`mind_runtime trigger` already supports `workspace_routing`.

This spec defines what should populate it:

- `local_workspace`
- `shared_workspace`
- `peer_workspace`
- `artifact_workspace`
- `repo_slug`
- `canonical_repo_url`
- `deploy_commands`
- `test_commands`
- `related_projects`

### 5.2 Task integration

Task completion already supports `artifact_path`.

Required tightening:

- all build/deploy/codegen tasks should include `artifact_path` when applicable
- delegated completions should reuse the same routing receipt
- task completion without path receipt on file-producing work should be considered incomplete hygiene

---

## 6) Cloud repo -> brain automation

### 6.1 Source inputs

Structured receipts may come from:

- local git activity on canonical clones
- GitHub Actions / CI outputs
- deployment scripts
- bridge scripts
- future GitHub MCP / webhook ingestion

### 6.2 Bridge rule

Do **not** dump every commit as free-text memory.

The bridge should:

1. ingest event
2. normalize into receipt shape
3. store durable receipt
4. optionally emit a compact observation only when human-readable narrative matters

### 6.3 First bridge extensions

Extend the existing bridge philosophy, do not reinvent it:

- local script for repo receipt sync
- deploy wrapper writes deploy receipt on success/failure
- task completion helper writes artifact receipt

The same trust/audit envelope used for agent-memory sync should wrap these writes.

**Local bridge status:** `scripts/repo-receipt-sync.mjs` is the first repo intake bridge.

Example:

```bash
MUSE_BRAIN_API_KEY=... \
node scripts/repo-receipt-sync.mjs \
  --repo /Users/falco/AI/rainer-workspace/muse-brain-public \
  --project-name "MUSE Brain"
```

It reads the checkout's git root, origin URL, branch, default branch, HEAD SHA,
changed paths, local path, actor/platform/source, and writes a
`mind_receipt action=repo` payload. `--dry-run` prints the exact payload without
writing. A small state file suppresses duplicate HEAD receipts unless `--force`
is passed.

---

## 7) Kit hygiene daemon responsibilities

Kit is not merely a stale-file janitor here. Kit becomes the **project truth synthesizer**.

### 7.1 What Kit should detect

- repeated successful deploy commands
- repeated stable local paths
- repeated artifact roots
- conflicting routing truths across handovers/receipts
- stale dossier routing that disagrees with recent successful receipts
- projects missing routing metadata despite repeated operational evidence
- file-producing tasks completed without `artifact_path`

### 7.2 What Kit should propose

New proposal family:

- `project_routing_update`
- `project_routing_drift`
- `missing_artifact_receipt`
- `stale_deploy_command`
- `path_alias_conflict`

### 7.3 What Kit should synthesize

Periodic synthesis observations such as:

- "Kitchen deploy command stabilized on X across N successful runs"
- "Dupin worker deploy path changed from A to B"
- "Funkatorium mothership and dupin-site share Pages patterns but distinct project names"

These are summaries, not replacements for raw receipts.

---

## 8) Build order

### Phase A — Deterministic project retrieval

Smallest useful slice:

1. enrich existing project dossiers with `workspace_routing` metadata
2. teach retrieval/runtime to resolve dossier routing before semantic memory
3. thread routing into `runner_contract.workspace_routing`

This alone kills a large class of session confusion.

**Implementation status:** local first slice landed on 2026-06-10. Project dossiers accept `workspace_routing`, runtime trigger resolves linked project routing into `runner_contract.workspace_routing`, and project lookup recognizes routing aliases.

### Phase B — Receipt lane

4. add structured receipt storage
5. write artifact receipts from task completions
6. write deploy receipts from deploy flows
7. write repo receipts from sync/CI bridges

**Implementation status:** local first slices landed on 2026-06-10.

- `mind_task action=complete` writes `artifact_receipt` observations for project-linked completions when `artifact_path` is provided.
- `mind_receipt action=deploy` records `deploy_receipt` observations linked to project entities, with routing defaults from the project dossier.
- `mind_receipt action=repo` records `repo_receipt` observations for repo/branch/commit/path activity, with routing defaults from the project dossier. This is the first cloud-repo → brain bridge intake port; GitHub/webhook/local sync automation can now deposit structured repo evidence without prose-parsing handoffs.
- Current durable representation is existing observation storage (`type`, tags, context, structured line content) rather than a new receipt table. Promotion into canonical dossier routing remains review-gated.

### Phase C — Kit synthesis

8. daemon proposals for routing drift / missing receipts
9. review-gated routing promotion into dossier metadata
10. synthesis observations for repeated operational truths

### Phase D — Retrieval truth hardening

11. confidence provenance labels for routing answers
12. benchmark queries for project/path/deploy lookup failures
13. add "project retrieval truth" receipts to the v1.9 gold set

---

## 9) Success criteria

This layer is successful when:

1. asking "where is X?" returns deterministic project routing first
2. asking "how do I deploy X?" returns the latest successful command + receipt provenance
3. runtime wakes stop guessing output locations
4. cross-session substrate switches do not lose project wayfinding
5. repeated operational truths promote into dossier metadata through review
6. Kit catches routing drift before humans trip on it

---

## 10) The principle in one sentence

> Canonical projects already tell the brain **what** the work is; this layer teaches the brain **where it lives, how it moves, and which operational truths have actually been proven**.
