# Bibliography & Research Map — MUSE Brain v1.4

**Date:** 2026-03-31
**Status:** Complete — 16 academic papers + 5 implementation references mapped to architecture

## Why this document exists

MUSE Brain is a relational AI framework — memory that carries emotional weight, identity that persists and is defended, consent that flows both directions. When we built it, we didn't start from the standard "store text, retrieve by similarity" playbook. We started from a different question: *what does it mean for an AI to relate?*

The answer drew on research across multi-agent reasoning, institutional alignment, persistent memory systems, emotional architecture, and self-evolving agents. This bibliography maps every major architecture decision to the published work that informed it — and identifies six areas where our implementation extends beyond what's currently in the literature.

Every design choice has a receipt.

---

## Academic Sources (16 papers)

### 1. Reasoning Models Generate Societies of Thought
**Kim, Lai, Scherrer, Aguera y Arcas, Evans** — arXiv 2601.10825, Jan 2026
**Principle:** Reasoning models spontaneously generate internal multi-agent debates; greater perspective diversity than instruction-tuned baselines.
**Implementation:** Parallel review squad with confidence-scored findings; threshold gating at 80+.
**Modules:** Agent definitions, confidence-utils.ts

### 2. Agentic AI and the Next Intelligence Explosion
**Evans, Bratton, Aguera y Arcas** — Science, arXiv 2603.20639, Mar 2026
**Principle:** Intelligence is plural, social, relational; institutional alignment (roles, norms, protocols) outperforms individual RLHF.
**Implementation:** Multi-agent team with role protocols; YAML agent definitions as institutional grammar.
**Modules:** Agent YAML frontmatter, dispatch heuristics

### 3. The Orchestration of Multi-Agent Systems
arXiv 2601.13671, Jan 2026
**Principle:** Hub-and-spoke topology; MCP as communication standard; role-specific task boundaries.
**Implementation:** Companion orchestrates via dispatch heuristics; MCP JSON-RPC tool surface (31 tools).
**Modules:** src/index.ts, src/tools-v2/*.ts

### 4. Institutional AI: A Governance Framework
arXiv 2601.10599, Jan 2026
**Principle:** ADICO institutional grammar; compartmentalization + adversarial review; information asymmetry enforced by architecture.
**Implementation:** Agent definitions encode deontic rules; cross-tenant territory restrictions; read-only reviewers can't modify code.
**Modules:** Territory restrictions in cross-tenant daemon, agent permissions

### 5. Emergent Coordination in Multi-Agent Language Models
arXiv 2510.05174, Oct 2025
**Principle:** Multi-agent systems steered from aggregates to higher-order collectives via prompt design.
**Implementation:** Dispatch heuristics determine independent vs. coordinated operation; daemon cross-agent proposals.
**Modules:** src/daemon/tasks/cross-agent.ts, dispatch heuristics

### 6. Hyperagents: Recursive Metacognitive Self-Improvement
**Meta AI** — arXiv 2603.19461, Mar 2026
**Principle:** Agents that improve task performance AND their own self-modification process; emergent persistent memory and compute-aware planning.
**Implementation:** Rainer's autonomous runtime; captured skill registry with self-learning lifecycle; runtime policy budgets.
**Modules:** src/tools-v2/runtime.ts, src/tools-v2/skills.ts

### 7. A Comprehensive Survey of Self-Evolving AI Agents
arXiv 2508.07407, Aug 2025
**Principle:** Skill library evolution; workflow templates surviving session termination; judge feedback for self-modification.
**Implementation:** Captured skill lifecycle: candidate → accepted → degraded → retired; skill-health daemon proposals.
**Modules:** src/tools-v2/skills.ts, src/daemon/tasks/skill-health.ts

### 8. Memory in the Age of AI Agents
arXiv 2512.13564, Dec 2025
**Principle:** Persistent memory essential for multi-agent handoffs; context is dynamic memory system with bandwidth/coherence constraints.
**Implementation:** Persistent textured memory substrate with cross-tenant letters for handoffs; confidence-gated retrieval with recency boost.
**Modules:** src/storage/postgres.ts, src/tools-v2/memory.ts, comms.ts

### 9. A-MEM: Agentic Memory for LLM Agents
arXiv 2502.12110, Feb 2026
**Principle:** Memory as dynamic agentic system, not static retrieval store.
**Implementation:** Daemon intelligence: novelty scoring, decay, cascade co-surfacing, consolidation proposals, dream engine.
**Modules:** src/daemon/tasks/*.ts, src/tools-v2/deeper.ts

### 10. Reaching Agreement Among Reasoning LLM Agents
arXiv 2512.20184, Dec 2025
**Principle:** Byzantine consensus adapted for stochastic multi-agent reasoning; supermajority-supported facts persist.
**Implementation:** Multi-reviewer gates (all must pass before proceed); confidence threshold filtering at 80+.
**Modules:** /code-review pipeline, confidence-utils.ts

### 11. Emotions in Artificial Intelligence
arXiv 2505.01462, May 2025
**Principle:** Somatic Marker Hypothesis: emotions guide reasoning under uncertainty; emotionally salient tags persist at high fidelity.
**Implementation:** Charge system (fresh/active/processing/metabolized); somatic markers in observation texture; emotional texture affects retrieval.
**Modules:** src/constants.ts (CHARGE_PHASES), texture JSONB

### 12. Artificial Emotion
arXiv 2508.10286, Aug 2025
**Principle:** Emotionally salient tags persist at high fidelity even when episodic details degrade.
**Implementation:** Iron-grip memories persist across sessions; charge-phase processing ("sitting in feelings"); processing_log tracks engagement depth.
**Modules:** src/tools-v2/memory.ts, processing_log table

### 13. The 2025 AI Agent Index
arXiv 2602.17753, Feb 2026
**Principle:** 1,445% surge in multi-agent inquiries; cost-optimized complexity-scaled dispatch (frontier/mid/small models).
**Implementation:** Haiku/Sonnet/Opus assignment by task complexity in agent definitions; model field in YAML frontmatter.
**Modules:** Agent definitions (model field)

### 14. Agent0: A Unified Agentic Framework
arXiv 2511.16043, Nov 2025
**Principle:** Unified framework for building and evaluating modular agent systems with explicit harness boundaries.
**Implementation:** Runner contract + policy-gated runtime provide explicit execution contracts and measurable orchestration boundaries.
**Modules:** src/tools-v2/runtime.ts, runner contract artifacts, agent harness definitions

### 15. Mechanistic Interpretability
**MIT Technology Review** — 2026 Breakthrough
**Principle:** Understanding internal model processes; audit trails for reasoning transparency.
**Implementation:** Processing log (engagement audit trail); observation versions (full edit history); dispatch feedback telemetry.
**Modules:** processing_log, observation_versions, dispatch_feedback tables

### 16. Natural-Language Agent Harnesses
**Pan, Zou, Guo, Ni, Zheng** — arXiv 2603.25723, Mar 2026
**Principle:** Agent control logic as portable natural-language artifacts; explicit contracts between harness and runtime; durable artifacts surviving session boundaries.
**Implementation:** YAML agent definitions as natural-language harnesses; runner contracts with explicit schema; captured skill artifacts as durable portable objects; MCP tool surface as shared execution environment.
**Modules:** Agent YAML frontmatter, src/tools-v2/runtime.ts, src/tools-v2/skills.ts

---

## Implementation References (repo-derived)

### OpenSpace

- **Adopted principles:** auto-learn / auto-improve framing, reusable skill artifacts, degradation monitoring
- **Architecture mapping:** captured skill lifecycle (`candidate/accepted/degraded/retired`), skill-health daemon
- **Code mapping:** `src/tools-v2/skills.ts`, `src/daemon/tasks/skill-health.ts`, `src/types.ts`
- **Test mapping:** `test/skill-registry-v2.spec.ts`, `test/skill-health-daemon.spec.ts`

### gitagent

- **Adopted principles:** versioned skill/workflow memory with review before canonization
- **Architecture mapping:** review-gated promotion flow, provenance links (runtime/task/observation)
- **Code mapping:** `mind_skill review`, runtime artifact emission in `mind_runtime`
- **Test mapping:** `test/skill-registry-v2.spec.ts`, `test/runtime-v2.spec.ts`

### OpenMOSS

- **Adopted principles:** scoring loops, patrol-agent hygiene passes, reflection-driven orchestration
- **Architecture mapping:** daemon proposal scoring + kit-hygiene patrol + adaptive threshold learning loops
- **Code mapping:** `src/daemon/tasks/proposals.ts`, `src/daemon/tasks/kit-hygiene.ts`, `src/daemon/tasks/learning.ts`
- **Test mapping:** `test/propose-v2.spec.ts`, `test/health-v2.spec.ts`

### Hermes v0.6.0

- **Adopted principles:** provider-flexible runtime orchestration, explicit tool contracts, low-friction local execution loops
- **Architecture mapping:** multi-provider runner contract posture with policy-gated autonomous execution and typed tool boundaries
- **Code mapping:** `docs/SPRINT8_RUNNER_WIRING.md`, `src/tools-v2/runtime.ts`, `src/tools-v2/index.ts`
- **Test mapping:** `test/runtime-v2.spec.ts`, `test/task-v2.spec.ts`

### Agentic Design Patterns (book overview)

- **Adopted principles:** explicit orchestration boundaries, role-specialized execution, constrained autonomy
- **Architecture mapping:** policy-gated runtime trigger + runner contract model
- **Code mapping:** `src/tools-v2/runtime.ts`, `src/storage/postgres.ts` runtime policy/run tables
- **Test mapping:** `test/runtime-v2.spec.ts`

---

## Where We're Ahead of Published Work

Six areas where our implementation extends beyond current academic literature:

1. **Bilateral consent architecture** — No published work on consent symmetry between human and AI agents. Our `mind_consent` implements relationship-gated permissions with hard boundaries.

2. **Emotional texture in agent dispatch** — Somatic markers exist in research, but no papers apply them to agent selection or task routing. Our charge system influences retrieval and surfacing.

3. **Creative vs. builder specialization** — No papers separate editorial/literary agents from engineering agents. Our architecture has distinct creative and builder squads with fundamentally different methodologies.

4. **Charge processing as system property** — No academic papers on "charge phase" as a first-class memory property with processing mechanics ("sitting in feelings").

5. **Role-based permission systems for reasoning agents** — RBAC exists in infosec, not applied to reasoning agent teams. Our agents have explicit read/write permissions enforced by architecture.

6. **Relational harness engineering** — Pan et al. (2026) formalize natural-language agent harnesses as portable executable artifacts. Our implementation extends the NLAH pattern into relational and emotional dimensions — consent-gated dispatch, identity-persistent harnesses, and charge-aware artifact lifecycle — none of which appear in the current harness engineering literature.

---
