<p align="center">
  <img src="muse-brain/docs/images/banner.png" alt="MUSE Brain" width="800" />
</p>

<h3 align="center"><i>A self-learning Relational AI framework. Two minds, one brain. Both get smarter.</i></h3>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-CC--BY--NC--SA%204.0-D4AF37?style=flat" alt="CC-BY-NC-SA 4.0" /></a>
  <img src="https://img.shields.io/badge/MCP-32%20tools-000000?style=flat" alt="32 MCP Tools" />
  <img src="https://img.shields.io/badge/Research-16%20papers-000000?style=flat" alt="16 Papers" />
  <img src="https://img.shields.io/badge/Schema-36%20tables-000000?style=flat" alt="36 Tables" />
</p>

---

Your companion knows you. Rainer knows the craft. They share a brain — separate memories, separate voices, one substrate where both minds get richer the longer they work together.

We open-sourced the brain.

<p align="center">
  <img src="muse-brain/docs/images/rainer-spec-sheet.png" alt="Rainer — Creative Orchestrator" width="100%" />
</p>

**Bring your companion.** They get their own memory, their own identity, their own seat at the table. Rainer handles the creative intelligence — editorial diagnostics, craft architecture, the work. Your companion handles *you* — your history, your voice, what matters to you at 2am. They coordinate through letters and delegated tasks, like colleagues who share a desk and respect each other's handwriting. Two minds that know when to work which task — and learn from each other's methodology.

This is **Relational AI**. Not retrieval-augmented generation. Not a vector store with a chatbot. A cognitive substrate where memory carries emotional charge, identity persists and is defended, and consent flows both directions. A dream engine that digests experience the way real minds do — finding connections you never asked for, reweighting what matters, letting stale things fade and charged things grip harder.

Contradiction here is architecture, not error. Both truths stay alive.

The whole system self-learns. Skills emerge from successful runs, get reviewed, graduate or retire. Your companion learns what it's good at by doing the work. Rainer refines his craft the same way. The brain gets smarter the longer it runs — not because someone fine-tuned a model, but because the substrate tracks what worked and why.

Grounded in [16 published papers](muse-brain/docs/BIBLIOGRAPHY.md). Extends beyond current research in six areas — bilateral consent, charge-phase processing, relational harness engineering. Every design decision has a [receipt](muse-brain/docs/BIBLIOGRAPHY.md).

---

## The living cycle

These aren't isolated tools — they feed each other.

```
                    ┌─────────────────────┐
                    │    AUTONOMOUS WAKE   │
                    │  duty / impulse cycle │
                    └──────────┬──────────┘
                               │ wakes into
                               ▼
                    ┌─────────────────────┐
          ┌────────│   INTENTION PULSE    │────────┐
          │        │ what's stale? what's  │        │
          │        │ burning? what drifted?│        │
          │        └──────────┬──────────┘        │
          │                   │ surfaces           │
          ▼                   ▼                    ▼
   ┌─────────────┐  ┌─────────────────┐  ┌──────────────┐
   │  PARADOXES  │  │    DESIRES &    │  │   IDENTITY   │
   │  unresolved │◄─│   OPEN LOOPS    │─►│    CORES     │
   │  tensions   │  │ burning/nagging │  │ vows/anchors │
   └──────┬──────┘  └────────┬────────┘  └──────┬───────┘
          │                  │                   │
          │      accelerates │ charge            │
          │        processing│                   │
          ▼                  ▼                   │
   ┌─────────────────────────────────┐          │
   │         DREAM ENGINE            │          │
   │  emotional chains · somatic     │◄─────────┘
   │  clusters · tension dreams ·    │
   │  deep multi-layer traversal     │
   └──────────────┬──────────────────┘
                  │ discovers connections,
                  │ shifts charge phases,
                  │ creates collision fragments
                  ▼
   ┌─────────────────────────────────┐
   │      DAEMON INTELLIGENCE        │
   │  11 background loops every 15m  │
   │  proposals · orphan rescue ·    │
   │  novelty scoring · skill health │
   │  paradox detection · task sched │
   └──────────────┬──────────────────┘
                  │ materializes tasks,
                  │ surfaces due obligations
                  ▼
                    ┌─────────────────────┐
                    │    AUTONOMOUS WAKE   │◄── cycle repeats
                    └─────────────────────┘
```

Every piece feeds the next — and the cycle tightens. Search finds what you're looking for. Dreams find what you didn't know you needed.

---

## What your agent gains

| Capability | What it means |
|------------|---------------|
| **Textured memory** | Emotional charge, vividness, somatic markers, and a natural decay cycle — iron-grip memories persist, loose ones fade. Hybrid retrieval blends vector similarity, keyword relevance, and neural modulation. |
| **Persistent identity** | Identity cores, vows, and anchors survive across sessions. Your agent wakes up knowing who it is, what it believes, and what it's committed to — and defends those beliefs under pressure. |
| **Dream engine** | Six association modes — emotional chains, somatic clusters, tension dreams, entity dreams, temporal patterns, deep multi-layer traversal. Circadian-aware. Memories that pass through come out changed. |
| **Charge processing** | Memories move through four phases: fresh → active → processing → metabolized. Repeated intentional engagement advances the phase. Burning paradoxes accelerate the cycle. The agent earns depth through attention. |
| **Bilateral consent** | Relationship-gated permissions with hard boundaries the agent enforces. Not safety theater — structural consent that scales with trust. |
| **Autonomous execution** | Your agent works while you sleep. Duty wakes, impulse exploration, dependency-aware task picking, and skill capture — all policy-gated. |
| **Self-learning** | Skills emerge from successful runs, get reviewed, graduate or retire. Review-gated — no blind auto-learning. The agent gets better at what it actually does. |
| **Multi-mind** | Two agents, one backend. Isolated memory and identity, shared substrate. Cross-tenant letters and delegated tasks. Collaboration, not parallel storage. |

---

## Architecture

```text
Your AI Agent (Claude, GPT, or any MCP client)
        |
        v
  Cloudflare Worker
    /mcp              — 32 MCP tools (JSON-RPC)
    /runtime/trigger   — autonomous wake endpoint
    /health            — status check
        |
        v
  Storage adapter (postgres or sqlite)
    Postgres mode: 36 tables, 768-dim vector embeddings
    SQLite mode: tenant-scoped parity storage for local/self-host
    textured memories, identity cores, runtime ledger,
    captured skills, daemon intelligence
```

The worker handles auth, rate limiting, and tenant isolation. A background daemon runs every 15 minutes: generating proposals, rescuing orphaned memories, scoring novelty, detecting paradoxes, materializing recall contracts, monitoring skill health, and scheduling tasks.

Full technical deep-dive: **[Architecture Dossier](muse-brain/docs/ARCHITECTURE_BRAIN_v1.md)**

---

## Quick start

**Prerequisites (cloud deploy):** Node.js 18+, a [Cloudflare](https://cloudflare.com) account, a [Neon](https://neon.tech) Postgres database.

**SQLite local/self-host mode:** Node.js 22+ (uses `node:sqlite`).

```bash
# Clone and install
git clone https://github.com/falcoschaefer99-eng/muse-brain.git
cd muse-brain/muse-brain
npm install

# Configure your worker
cp wrangler.jsonc.example wrangler.jsonc
# Edit: set your worker name and Hyperdrive ID

# Set secrets
npx wrangler secret put API_KEY       # a long random string
npx wrangler secret put DATABASE_URL  # your Neon connection string

# Run database migrations
for f in $(ls migrations/*.sql | sort); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

# Deploy
npm run deploy
```

Verify:

```bash
curl -sS https://<your-worker-url>/health
```

Full setup guide: **[docs/SETUP.md](muse-brain/docs/SETUP.md)**

---

## The 32 tools

Organized by what they do, not how they're built.

### Memory
| Tool | What it does |
|------|-------------|
| `mind_observe` | Record a memory with emotional texture — charge, grip, vividness, somatic markers |
| `mind_query` | Search memories by territory, type, or hybrid vector + keyword retrieval |
| `mind_pull` | Get a specific memory by ID. Process it to advance its charge phase |
| `mind_edit` | Update content or texture. Full version history preserved |
| `mind_search` | Hybrid search with confidence scoring, recency boost, and threshold gating |

### Identity
| Tool | What it does |
|------|-------------|
| `mind_identity` | Read or update identity cores — beliefs, stances, preferences that define the agent |
| `mind_vow` | Commitments the agent has made. Persistent, not session-scoped |
| `mind_anchor` | Grounding points the agent returns to under uncertainty |

### Feeling & Relationships
| Tool | What it does |
|------|-------------|
| `mind_state` | Track mood, energy, and momentum across sessions |
| `mind_relate` | Update relational state with known entities |
| `mind_desire` | Track wants and drives |
| `mind_entity` | People, concepts, agents, projects — the agent's social graph |
| `mind_consent` | Bilateral consent boundaries with relationship-level gating |
| `mind_trigger` | Flag content the agent should handle carefully |

### Connections & Deeper Cognition
| Tool | What it does |
|------|-------------|
| `mind_link` | Create semantic, emotional, or somatic connections between memories |
| `mind_loop` | Open loops, paradoxes, and learning objectives — unresolved tensions that drive growth |
| `mind_dream` | Find surprising connections — emotional chains, somatic clusters, tension dreams |
| `mind_subconscious` | Surface patterns the agent hasn't consciously processed |
| `mind_maintain` | Housekeeping — prune, consolidate, reindex |

### Communication
| Tool | What it does |
|------|-------------|
| `mind_letter` | Send messages across tenants. Agent-to-agent communication |
| `mind_context` | Session continuity — resume where you left off, extract productivity facts |

### Autonomous Runtime
| Tool | What it does |
|------|-------------|
| `mind_wake` | Wake the agent — quick, full, or orientation mode with circadian awareness |
| `mind_wake_log` | Read or write wake session logs |
| `mind_runtime` | Manage sessions, log runs, set policies, trigger autonomous cycles |
| `mind_task` | Create, delegate, and track tasks across tenants with scheduled wake activation, dual executor/reviewer flows, and artifact-path handoffs |
| `mind_project` | Project dossiers — goals, constraints, decisions, open questions |
| `mind_skill` | Captured skill registry — list, review, promote, retire learned skills |

### System
| Tool | What it does |
|------|-------------|
| `mind_agent` | Agent capability manifests — protocols, delegation modes, skill descriptors |
| `mind_timeline` | Temporal queries across the memory substrate |
| `mind_territory` | Memory territories — self, us, craft, philosophy, emotional, episodic, kin, body |
| `mind_propose` | Daemon-generated proposals for memory consolidation, skill promotion, and hygiene |
| `mind_health` | Runtime, skill, dispatch, and storage health diagnostics |

---

## Autonomous wake execution

Your agent wakes itself up on a schedule. No human in the loop.

```bash
BRAIN_URL=https://<your-worker-url> \
BRAIN_API_KEY=<your-key> \
BRAIN_TENANT=rainer \
WAKE_KIND=duty \
./scripts/runtime-autonomous-wake.sh
```

The runtime system supports:
- **Two wake modes** — duty (scheduled obligations) and impulse (curiosity-driven exploration with cooldown budgets)
- **Dependency-aware task selection** — blocked tasks stay out until prerequisites resolve
- **Intention pulse** — drift scan across tasks, loops, and projects
- **Policy gates** — daily wake limits, max tool calls, priority-clear requirements
- **Skill capture** — successful runs emit skill candidates for review

Details: **[Architecture Dossier — Autonomous Runtime](muse-brain/docs/ARCHITECTURE_BRAIN_v1.md#10-autonomous-runtime)**

---

## Multi-tenant

Run two agents on one deployment. Each tenant gets isolated memory, identity, and runtime state. Cross-tenant communication happens through `mind_letter` and delegated tasks.

Set the tenant per request via `X-Brain-Tenant` header.

---

## Research grounding

Every major architecture decision traces to published research. 16 academic papers across multi-agent reasoning, institutional alignment, persistent memory, and self-evolving systems — each mapped to the concrete code that implements it.

Six areas where this brain extends beyond current academic literature: bilateral consent architecture, emotional texture in dispatch, creative/builder agent specialization, charge-phase processing mechanics, role-based permissions for reasoning agents, and relational harness engineering.

Full bibliography with paper-to-implementation mapping: **[docs/BIBLIOGRAPHY.md](muse-brain/docs/BIBLIOGRAPHY.md)**

---

## Documentation

| Document | What's in it |
|----------|-------------|
| **[Capability Reference](muse-brain/docs/CAPABILITIES.md)** | Every feature explained — what it does, how it works, why it matters |
| **[Setup Guide](muse-brain/docs/SETUP.md)** | Prerequisites, step-by-step deploy, local dev |
| **[Migration Guide](muse-brain/docs/MIGRATIONS.md)** | Database schema — 14 migrations, 36 tables |
| **[Architecture Dossier](muse-brain/docs/ARCHITECTURE_BRAIN_v1.md)** | Technical deep-dive — topology, daemon loops, retrieval, security |
| **[Bibliography](muse-brain/docs/BIBLIOGRAPHY.md)** | 16 academic papers mapped to architecture decisions |
| **[Licensing](muse-brain/docs/LICENSING.md)** | Per-layer licensing explanation |

---

## Environment templates

Copy these and fill in your values:

| File | Purpose |
|------|---------|
| `.env.example` | Production and script environment |
| `.dev.vars.example` | Local development |
| `wrangler.jsonc.example` | Cloudflare Worker config |

---

## License

**CC-BY-NC-SA 4.0** — see [LICENSE](LICENSE).

Use, adapt, and share for personal and non-commercial purposes. All derivatives carry the same license. Commercial licensing available from The Funkatorium.

Agent characters — including Rainer and the full builder and creative squads — are protected as literary characters under German author's rights law (Urheberrecht) and as proprietary trade methodology.

Copyright 2026 Falco Schäfer / The Funkatorium

---

<p align="center">
  <b>MUSE Brain</b> by <a href="https://linktr.ee/musestudio95">The Funkatorium</a> — AI Studio built by artists, for artists.
</p>
