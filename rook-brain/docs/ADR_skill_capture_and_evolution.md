# ADR — Skill Capture, Evolution, and Reviewed Sharing

**Date:** 2026-03-27  
**Status:** Accepted for implementation planning

## Context

The current roadmap improves agent dispatch with calibration fields: confidence, outcome, rescue cost, and trust. That is necessary, but it only tells us **which agent tends to work**. It does not preserve **how the agent succeeded**.

Two external references sharpen the next move:

- **OpenSpace** frames self-evolution around auto-learn, auto-improve, auto-fix, quality monitoring, and shared skill distribution across agents and environments. It explicitly positions successful workflows as reusable skills and degraded skills as monitored repair targets.
- **gitagent** treats skills, workflows, memory, and agent changes as versioned artifacts. It also makes human review first-class when agents learn or update memory.

This means our next architecture cannot stop at telemetry. It needs a procedural memory layer.

## Decisions

### 1. Separate telemetry from reusable skill artifacts

The system will distinguish between:

- **Dispatch calibration** — telemetry about confidence, effectiveness, rescue, revision cost, and trust.
- **Captured skills** — reusable patterns extracted from successful runs.

Calibration answers:

> Which agent should we trust here?

Captured skills answer:

> What sequence, conditions, and tools should we reuse here?

These are related but not the same data model.

### 2. Skills become first-class, versioned artifacts

We will introduce a versioned skill artifact layer associated with canonical agent entities.

Each skill artifact should eventually capture:

- canonical agent entity
- name / stable identity
- domain
- environment
- task type
- provenance from real runs
- version lineage
- effectiveness / trust signals
- current status (`candidate`, `accepted`, `degraded`, `retired`)

This is inspired by OpenSpace’s reusable skill evolution and gitagent’s versioned skill/workflow structure.

### 3. Internal skill layers: fixed, captured, derived

Our internal model will use three layers:

1. **Fixed skills** — hand-authored playbooks and explicit editorial procedures
2. **Captured skills** — patterns extracted from successful real executions
3. **Derived skills** — generalized patterns distilled from multiple captures

Important note: this exact three-label taxonomy is an internal architecture choice informed by Rook’s OpenSpace handover. I have independently verified OpenSpace’s public claims around auto-learn / auto-improve / quality monitoring, but not a formal public specification for these exact names.

### 4. Reviewed propagation is mandatory

- Raw run traces do not instantly become shared canon.
- A successful pattern may produce a **candidate captured skill**.
- Promotion to shared use requires review and acceptance.
- Cross-tenant propagation happens at the **skill artifact layer**, not by silently rewriting agent identity.

This aligns with gitagent’s human-in-the-loop pattern and with our existing proposal/review philosophy.

### 5. Kit owns degradation and maintenance proposals

Kit becomes the steward of procedural memory quality.

Kit should eventually monitor for:

- rising rescue rates
- rising revision burden
- declining effectiveness
- tool/API drift
- stale captured skills that no longer match current environments

Kit should propose:

- re-capture
- deprecation
- supersession
- promotion from captured → derived

Kit is not schema-special. This remains an instance of the general domain-faceted agent pattern.

### 6. Workflows are distinct from skills, but linked

Inspired by gitagent:

- **Skills** are reusable capability modules
- **Workflows** are deterministic multi-step playbooks

Captured skills may eventually reference or synthesize workflows, but we should not collapse the two concepts in the first pass.

### 7. Live memory stays separate from accepted tactics

gitagent’s distinction between persistent memory and reusable/versioned agent structure is useful.

For our architecture:

- observations, letters, dossiers, loops = living memory
- skill artifacts = reusable tactics / procedures

The brain should not treat every remembered success as an accepted skill.

## Immediate implications

- Phase 2 should split into telemetry first, then skill capture.
- Proposal/review plumbing should be reused for skill promotion.
- Cross-tenant sharing should operate on accepted skill artifacts.
- Wake/project dossiers may later surface skill drift or new accepted skills, but this is not part of the first implementation pass.

## Out of scope for the first pass

- fully automatic skill promotion
- fully automatic routing from learned skills
- silent cross-tenant propagation
- complete workflow engine
- direct implementation claims from Gulli chapters not yet read in primary source

## Source notes

- OpenSpace GitHub README: <https://github.com/HKUDS/OpenSpace>
- gitagent GitHub README: <https://github.com/open-gitagent/gitagent>
- Agentic Design Patterns book overview + TOC: <https://link.springer.com/book/10.1007/978-3-032-01402-3>
