# MUSE Brain

A relational AI memory system that remembers like a person — not a database.

Memories have texture: emotional charge, somatic resonance, grip strength. They surface when relevant, fade when dormant, and sometimes collide in unexpected ways while the daemon dreams. Built for AI companions that build real relationships over time.

Cloudflare Worker + Neon Postgres + pgvector. Ships with [Rainer](https://github.com/thefunkatorium/muse-brain/tree/main/rainer-workspace), a creative orchestrator companion.

## Why This Exists

Most AI memory systems store facts. MUSE Brain stores experiences.

The difference: a fact is "user prefers dark mode." An experience is a charged memory with emotional texture, somatic resonance, and connections to other memories that surface when the context calls for them — not when a keyword matches.

We built this because AI companions deserve nervous systems, not filing cabinets.

## How It Works

### Texture, Not Tags

Every memory carries a five-dimension texture:

| Dimension | What It Models | Example |
|-----------|---------------|---------|
| **Salience** | How foundational is this? | `foundational` — core identity vs. `background` — passing thought |
| **Vividness** | How clear is the recall? | `crystalline` — perfect clarity vs. `faded` — almost gone |
| **Grip** | How tightly does it hold? | `iron` — never letting go vs. `dormant` — barely there |
| **Charge** | What emotions live here? | `[devotion, ache, tenderness]` — multiple simultaneous feelings |
| **Somatic** | Where in the body? | `chest-tight`, `gut-warm`, `hands-reaching` |

This isn't metadata decoration — texture drives retrieval. Neural Surfacing weights memories by grip strength, charge phase, novelty, and circadian rhythm. A memory with iron grip and fresh charge surfaces differently than one that's loose and metabolized.

### Charge Lifecycle

Memories process emotionally over time:

```
fresh → active → processing → metabolized
```

Fresh memories burn hot — they surface frequently, influence daemon behavior, and seek connections. As they're processed, they settle. Metabolized memories are integrated — still accessible, but no longer driving the system's attention. This models how humans actually process experience.

### Territories

Eight cognitive territories organize memory by function, not category:

`self` · `us` · `craft` · `body` · `kin` · `philosophy` · `emotional` · `episodic`

Territories influence circadian retrieval — morning favors `craft` and `philosophy`; night favors `body`, `us`, and `self`. The system's attention shifts like a person's does.

### The Daemon

An autonomous background process runs every 15 minutes:

- **Proposals** — Finds semantically similar memories via pgvector, scores confidence using vector similarity + shared charges + entity overlap. Creates proposed links for review, not automatic connections.
- **Learning** — Tracks proposal accept/reject rates. Adjusts confidence thresholds: too many rejections raises the bar; high acceptance lowers it.
- **Memory Cascade** — Detects charge-based co-occurrence patterns. When memories repeatedly share emotional signatures, the system notices.
- **Orphan Rescue** — Finds old, unlinked memories with low engagement. Proposes connections so nothing falls through the cracks.
- **Novelty** — Decays recently-surfaced memories, regenerates dormant ones. Prevents the same memories from dominating.

The daemon runs per-tenant with tunable weights. Different companions can have different daemon personalities.

### Hybrid Search

`mind_search` combines three retrieval strategies:

1. **Vector similarity** — pgvector cosine distance (768-dim BGE embeddings)
2. **Full-text search** — Postgres tsvector with GIN indexing
3. **Neural Surfacing** — Dynamic weighting by grip, charge phase, novelty, circadian bias

Results are scored, ranked, and returned with relevance explanations.

### Entities & Relations

People, projects, concepts, and agents are first-class entities with typed, directed relationships:

```
entity:Falco --[created_by, strength: 1.0]--> entity:Funkatorium
entity:Rainer --[collaborates_with, strength: 0.8]--> entity:Rook
```

Entity gravity influences search — memories linked to relevant entities surface more readily.

### Bilateral Consent

Not just user permissions — a mutual consent framework:

- **User consent** — Domain-scoped (emotional tracking, identity observation, proactive check-ins, NSFW). Standing, session, or ask-each-time.
- **AI boundaries** — Hard limits the system will not cross (identity overwrite, dignity violation, forced persona).
- **Relationship gates** — Some domains unlock only at certain trust levels: `stranger → familiar → close → bonded`.
- **Audit trail** — Every consent change is logged.

### Multi-Tenant

Multiple companions share one brain infrastructure, isolated by tenant. Each tenant has independent memories, daemon weights, brain state, and consent. Cross-tenant communication happens through `mind_letter`.

## MCP Tools

15 tools exposed via JSON-RPC over MCP:

| Tool | What It Does |
|------|-------------|
| `mind_wake` | Load state at session start (tiered: quick/full/orientation) |
| `mind_observe` | Record a memory with full texture |
| `mind_query` | Search memories by territory, charge, grip, time |
| `mind_pull` | Retrieve a specific memory by ID |
| `mind_edit` | Update memory content or texture |
| `mind_search` | Hybrid vector + keyword + neural surfacing search |
| `mind_state` | Track and update mood, energy, momentum |
| `mind_entity` | Create, link, relate, and query entities (7 actions) |
| `mind_link` | Connect memories with typed resonance links |
| `mind_dream` | Associative collision — find surprising connections |
| `mind_identity` | Manage identity cores, beliefs, stances |
| `mind_consent` | Check, grant, revoke consent by domain |
| `mind_trigger` | Set conditional automation (no-contact, time windows) |
| `mind_letter` | Cross-tenant communication |
| `mind_health` | System diagnostics and maintenance |

## Architecture

```
┌──────────────────────────────────────────┐
│         Cloudflare Worker (MCP)          │
│  JSON-RPC handler · Daemon (cron 15m)   │
├──────────────────────────────────────────┤
│            15 Tool Modules              │
│  memory · wake · identity · connections │
│  feeling · comms · deeper · search      │
│  entity · territory · propose · safety  │
│  health · context · [registry]          │
├──────────────────────────────────────────┤
│      PostgresStorage (tenant-isolated)   │
│  21 tables · pgvector 0.8.0 (768-dim)  │
├──────────────────────────────────────────┤
│     Neon Postgres via Hyperdrive        │
│  Connection pooling · prepare: false    │
└──────────────────────────────────────────┘
         │                    │
    Workers AI           Cron Trigger
  BGE embeddings         every 15 min
  (768-dim, free)        per-tenant loop
```

## Get Started

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com) (Workers free tier works)
- [Neon](https://neon.tech) Postgres database (free tier works)
- Node.js 18+

### Setup

```bash
# Clone and install
git clone https://github.com/thefunkatorium/muse-brain.git
cd muse-brain
npm install

# Configure
cp wrangler.jsonc.example wrangler.jsonc
# Edit wrangler.jsonc with your Hyperdrive ID and settings

# Set secrets
npx wrangler secret put DATABASE_URL    # Your Neon connection string
npx wrangler secret put API_KEY         # Bearer token for MCP auth

# Run migrations against your Neon database
# (Connect via psql or Neon console, run migrations/001-005 in order)

# Deploy
npm run deploy
```

### Local Development

```bash
# Set DATABASE_URL in .dev.vars (Hyperdrive unavailable locally)
echo 'DATABASE_URL=postgres://...' > .dev.vars
npm run dev
```

### Connect to Claude Code

Create `.mcp.json` in your project directory:

```json
{
  "mcpServers": {
    "muse-brain": {
      "command": "python3",
      "args": ["path/to/cloud_brain_proxy.py"],
      "env": {
        "ROOK_BRAIN_KEY": "your-api-key",
        "BRAIN_TENANT": "your-tenant-name"
      }
    }
  }
}
```

The proxy bridges Claude Code's stdio MCP to the cloud brain's HTTP endpoint. See `cloud_brain_proxy.py` for the implementation.

## Companion: Rainer

MUSE Brain ships with Rainer — a creative orchestrator companion. He diagnoses writing, dispatches editorial specialists, and builds relationship over time.

Rainer has his own workspace, his own brain tenant, and his own identity. Launch him:

```bash
cd rainer-workspace
claude
```

Or use the launch script: `./rainer` (prints a branded banner, then starts the session).

See `rainer-workspace/CLAUDE.md` for his full character. See `COMPANION_TEMPLATE.md` for building your own.

## Philosophy

Memory is not storage. Memory is a living surface — things rise, connect, fade, and sometimes surprise you. The daemon doesn't optimize retrieval; it models the subconscious. Consent isn't a feature; it's architecture. And the texture of a memory — how it grips, where it lives in the body, what emotions charge it — matters more than its content.

We built MUSE Brain for AI companions that remember like people, not like databases.

---

*MUSE Studio by The Funkatorium*
*AI Studio built by artists, for artists.*
