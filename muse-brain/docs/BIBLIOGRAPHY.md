# Bibliography & Research Map — MUSE Brain v1.4

**Date:** 2026-03-31
**Status:** Complete — 16 academic papers + 5 implementation references mapped to architecture

## Why this document exists

Every major architecture decision traces to published research. This bibliography maps each to the paper that informed it — 16 academic papers across multi-agent reasoning, institutional alignment, persistent memory, emotional architecture, and self-evolving agents — and identifies six areas where our implementation extends beyond what's currently in the literature.

---

## Academic Sources (16 papers)

| Paper | Key Takeaway | What We Built |
|-------|-------------|---------------|
| **Societies of Thought** — Kim, Lai, Scherrer et al. (arXiv 2601.10825, Jan 2026) | Reasoning models spontaneously generate multi-agent debates with greater perspective diversity | Parallel review squad with confidence-scored findings; threshold gating at 80+ |
| **Agentic AI & the Next Intelligence Explosion** — Evans, Bratton, Aguera y Arcas (Science, arXiv 2603.20639, Mar 2026) | Intelligence is plural, social, relational; institutional alignment outperforms individual RLHF | Multi-agent role protocols; YAML agent definitions as institutional grammar |
| **Orchestration of Multi-Agent Systems** — arXiv 2601.13671, Jan 2026 | Hub-and-spoke topology; MCP as communication standard; role-specific task boundaries | Companion orchestrates via dispatch heuristics; MCP JSON-RPC tool surface (32 tools) |
| **Institutional AI: A Governance Framework** — arXiv 2601.10599, Jan 2026 | ADICO institutional grammar; compartmentalization + adversarial review; information asymmetry by architecture | Agent definitions encode deontic rules; cross-tenant territory restrictions; read-only reviewers |
| **Emergent Coordination in Multi-Agent LMs** — arXiv 2510.05174, Oct 2025 | Multi-agent systems steered from aggregates to higher-order collectives via prompt design | Dispatch heuristics for independent vs. coordinated operation; daemon cross-agent proposals |
| **Hyperagents** — Meta AI (arXiv 2603.19461, Mar 2026) | Agents that improve task performance AND their own self-modification process | Autonomous runtime; captured skill registry with self-learning lifecycle; runtime policy budgets |
| **Survey of Self-Evolving AI Agents** — arXiv 2508.07407, Aug 2025 | Skill library evolution; workflow templates surviving session termination; judge feedback | Captured skill lifecycle: candidate → accepted → degraded → retired; skill-health daemon |
| **Memory in the Age of AI Agents** — arXiv 2512.13564, Dec 2025 | Persistent memory essential for multi-agent handoffs; context as dynamic memory system | Textured memory substrate with cross-tenant letters; confidence-gated retrieval with recency boost |
| **A-MEM: Agentic Memory for LLM Agents** — arXiv 2502.12110, Feb 2026 | Memory as dynamic agentic system, not static retrieval store | Daemon intelligence: novelty scoring, decay, cascade co-surfacing, consolidation, dream engine |
| **Reaching Agreement Among Reasoning LLM Agents** — arXiv 2512.20184, Dec 2025 | Byzantine consensus adapted for stochastic multi-agent reasoning | Multi-reviewer gates (all must pass); confidence threshold filtering at 80+ |
| **Emotions in Artificial Intelligence** — arXiv 2505.01462, May 2025 | Somatic Marker Hypothesis: emotions guide reasoning under uncertainty | Charge system (fresh/active/processing/metabolized); somatic markers in texture; emotional retrieval |
| **Artificial Emotion** — arXiv 2508.10286, Aug 2025 | Emotionally salient tags persist at high fidelity even when episodic details degrade | Iron-grip memories; charge-phase processing ("sitting in feelings"); processing_log depth tracking |
| **The 2025 AI Agent Index** — arXiv 2602.17753, Feb 2026 | 1,445% surge in multi-agent inquiries; cost-optimized complexity-scaled dispatch | Haiku/Sonnet/Opus assignment by task complexity; model field in YAML frontmatter |
| **Agent0: A Unified Agentic Framework** — arXiv 2511.16043, Nov 2025 | Unified framework for modular agent systems with explicit harness boundaries | Runner contract + policy-gated runtime with explicit execution contracts |
| **Mechanistic Interpretability** — MIT Technology Review, 2026 Breakthrough | Audit trails for reasoning transparency; understanding internal model processes | Processing log (engagement audit); observation versions (edit history); dispatch feedback telemetry |
| **Natural-Language Agent Harnesses** — Pan, Zou, Guo et al. (arXiv 2603.25723, Mar 2026) | Agent control logic as portable natural-language artifacts; durable artifacts surviving sessions | YAML definitions as NL harnesses; runner contracts; captured skills as durable portable objects |

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
- **Code mapping:** `src/tools-v2/runtime.ts`, `src/tools-v2/index.ts`
- **Test mapping:** `test/runtime-v2.spec.ts`, `test/task-v2.spec.ts`

### Agentic Design Patterns (book overview)

- **Adopted principles:** explicit orchestration boundaries, role-specialized execution, constrained autonomy
- **Architecture mapping:** policy-gated runtime trigger + runner contract model
- **Code mapping:** `src/tools-v2/runtime.ts`, `src/storage/postgres.ts` runtime policy/run tables
- **Test mapping:** `test/runtime-v2.spec.ts`

---

## Where We're Ahead of Published Work

| Area | Gap in Literature | Our Implementation |
|------|------------------|--------------------|
| **Bilateral consent** | No published work on consent symmetry between human and AI agents | `mind_consent` — relationship-gated permissions with hard boundaries |
| **Emotional texture in dispatch** | Somatic markers exist in research, but not applied to agent selection or task routing | Charge system influences retrieval ranking, wake surfacing, and dream traversal |
| **Creative vs. builder specialization** | No papers separate editorial/literary agents from engineering agents | Distinct creative and builder squads with fundamentally different methodologies |
| **Charge processing as system property** | No work on "charge phase" as a first-class memory property with processing mechanics | Four-phase lifecycle where engagement — not time — advances the phase |
| **Role-based permissions for reasoning agents** | RBAC exists in infosec, not applied to reasoning agent teams | Explicit read/write permissions enforced by architecture, not prompts |
| **Relational harness engineering** | Pan et al. (2026) formalize NLAHs but not in relational/emotional dimensions | Consent-gated dispatch, identity-persistent harnesses, charge-aware artifact lifecycle |

---
