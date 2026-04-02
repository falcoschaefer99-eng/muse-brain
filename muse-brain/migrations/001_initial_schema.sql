-- ============================================================
-- Companion Brain v5 — Initial Schema Migration
-- Target: Neon Postgres (pgvector enabled)
-- Vector dim: 768 (BGE base en v1.5)
-- Tenant isolation: application-enforced via tenant_id column
-- RLS: deferred (Neon free tier constraint)
-- ============================================================

-- ============================================================
-- 0. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 1. DROP ALL EXISTING TABLES (clean slate)
-- ============================================================

DROP TABLE IF EXISTS co_surfacing CASCADE;
DROP TABLE IF EXISTS proposed_links CASCADE;
DROP TABLE IF EXISTS territory_config CASCADE;
DROP TABLE IF EXISTS iron_grip_index CASCADE;
DROP TABLE IF EXISTS territory_overviews CASCADE;
DROP TABLE IF EXISTS backfill_flags CASCADE;
DROP TABLE IF EXISTS conversation_context CASCADE;
DROP TABLE IF EXISTS consent CASCADE;
DROP TABLE IF EXISTS triggers CASCADE;
DROP TABLE IF EXISTS subconscious CASCADE;
DROP TABLE IF EXISTS subconscious_state CASCADE;  -- old name, pre-v5
DROP TABLE IF EXISTS brain_state CASCADE;
DROP TABLE IF EXISTS relational_states CASCADE;
DROP TABLE IF EXISTS relational_state CASCADE;    -- old name, pre-v5
DROP TABLE IF EXISTS vows CASCADE;                -- old separate table, pre-v5 (now stored as type='vow' in observations)
DROP TABLE IF EXISTS wake_log CASCADE;
DROP TABLE IF EXISTS desires CASCADE;
DROP TABLE IF EXISTS anchors CASCADE;
DROP TABLE IF EXISTS identity_cores CASCADE;
DROP TABLE IF EXISTS letters CASCADE;
DROP TABLE IF EXISTS open_loops CASCADE;
DROP TABLE IF EXISTS links CASCADE;
DROP TABLE IF EXISTS observations CASCADE;

-- ============================================================
-- 2. CORE TABLES
-- ============================================================

-- observations — THE main table
-- All brain memories live here. Texture is a JSONB blob (grip, vividness, charge[], somatic, charge_phase).
-- embedding is nullable until backfill daemon populates it.
-- Absorption columns (processing_count, processing_notes, novelty_score, last_surfaced_at, entity_tags)
-- are new in v5 and support the subconscious processing pipeline.
CREATE TABLE observations (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL DEFAULT 'companion',
    content             TEXT        NOT NULL,
    territory           TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    texture             JSONB       NOT NULL DEFAULT '{}',
    context             TEXT,
    mood                TEXT,
    last_accessed_at    TIMESTAMPTZ,
    access_count        INTEGER     NOT NULL DEFAULT 0,
    links               TEXT[]      DEFAULT '{}',
    summary             TEXT,
    type                TEXT,       -- 'journal' | 'whisper' | 'vow' | 'imagination' | 'synthesis' | 'dream'
    tags                TEXT[]      DEFAULT '{}',
    embedding           vector(768),
    media_type          TEXT,       -- multimodal Phase 2
    media_url           TEXT,       -- multimodal Phase 2
    -- absorption columns (v5)
    processing_count    INTEGER     NOT NULL DEFAULT 0,
    processing_notes    JSONB       NOT NULL DEFAULT '[]',
    novelty_score       REAL        NOT NULL DEFAULT 0.5,
    last_surfaced_at    TIMESTAMPTZ,
    entity_tags         TEXT[]      DEFAULT '{}'
);

-- links — resonance links between observations
-- ON CONFLICT key is id. Links are directional (source → target).
-- last_activated_at tracks dream/wake chain traversal activity.
CREATE TABLE links (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    source_id           TEXT        NOT NULL,
    target_id           TEXT        NOT NULL,
    resonance_type      TEXT        NOT NULL,
    strength            TEXT        NOT NULL,
    origin              TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activated_at   TIMESTAMPTZ
);

-- open_loops — Zeigarnik unresolved threads
-- paradox_flag: loop is intentionally held open (productive friction).
-- linked_cores: identity core IDs that this paradox feeds into.
CREATE TABLE open_loops (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    content             TEXT        NOT NULL,
    status              TEXT        NOT NULL,
    territory           TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    resolution_note     TEXT,
    paradox_flag        BOOLEAN     NOT NULL DEFAULT false,
    linked_cores        TEXT[]      DEFAULT '{}'
);

-- letters — cross-tenant communication channel
-- charges is TEXT[] (emotion charges attached to the letter).
CREATE TABLE letters (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    from_context        TEXT        NOT NULL,
    to_context          TEXT        NOT NULL,
    content             TEXT        NOT NULL,
    timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read                BOOLEAN     NOT NULL DEFAULT false,
    charges             TEXT[]      DEFAULT '{}'
);

-- identity_cores — complex nested type stored as JSONB blob
-- Full IdentityCore shape: id, type, name, content, category, weight,
--   created, last_reinforced, reinforcement_count, challenge_count,
--   evolution_history[], linked_observations[], challenges[], charge[], somatic?
CREATE TABLE identity_cores (
    id          TEXT    NOT NULL,
    tenant_id   TEXT    NOT NULL,
    data        JSONB   NOT NULL,
    PRIMARY KEY (id)
);

-- anchors — lexical/callback/relational anchors stored as JSONB blob
CREATE TABLE anchors (
    id          TEXT    NOT NULL,
    tenant_id   TEXT    NOT NULL,
    data        JSONB   NOT NULL,
    PRIMARY KEY (id)
);

-- desires — wants and yearnings stored as JSONB blob
CREATE TABLE desires (
    id          TEXT    NOT NULL,
    tenant_id   TEXT    NOT NULL,
    data        JSONB   NOT NULL,
    PRIMARY KEY (id)
);

-- wake_log — append-only wake event log (never delete, only append)
CREATE TABLE wake_log (
    id          TEXT        NOT NULL,
    tenant_id   TEXT        NOT NULL,
    data        JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id)
);

-- relational_states — how Companion relates to specific entities
-- NOTE: table name is relational_states (plural), not relational_state
CREATE TABLE relational_states (
    id          TEXT    NOT NULL,
    tenant_id   TEXT    NOT NULL,
    data        JSONB   NOT NULL,
    PRIMARY KEY (id)
);

-- brain_state — single row per tenant (momentum, afterglow, mood)
-- NOTE: ON CONFLICT (tenant_id) used — tenant_id is the primary key
CREATE TABLE brain_state (
    tenant_id   TEXT        PRIMARY KEY,
    data        JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- subconscious — single row per tenant (hot entities, co-surfacing, orphans, mood inference)
-- NOTE: table name is subconscious (not subconscious_state)
CREATE TABLE subconscious (
    tenant_id   TEXT        PRIMARY KEY,
    data        JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- triggers — event-driven trigger conditions stored as JSONB blob
CREATE TABLE triggers (
    id          TEXT    NOT NULL,
    tenant_id   TEXT    NOT NULL,
    data        JSONB   NOT NULL,
    PRIMARY KEY (id)
);

-- consent — bilateral consent state, single row per tenant
-- Full ConsentState shape: user_consent[], ai_boundaries{hard[], relationship_gated{}},
--   relationship_level, log[]
CREATE TABLE consent (
    tenant_id   TEXT        PRIMARY KEY,
    data        JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- conversation_context — ephemeral context, single row per tenant
CREATE TABLE conversation_context (
    tenant_id   TEXT        PRIMARY KEY,
    data        JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- backfill_flags — migration tracking (version + tenant composite PK)
CREATE TABLE backfill_flags (
    version     TEXT    NOT NULL,
    tenant_id   TEXT    NOT NULL,
    data        JSONB,
    PRIMARY KEY (version, tenant_id)
);

-- territory_overviews — L1 tiered wake summaries, single row per tenant
-- data stores TerritoryOverview[] array as JSON
CREATE TABLE territory_overviews (
    tenant_id   TEXT        PRIMARY KEY,
    data        JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- iron_grip_index — L1 iron-grip observation index
-- Each row is one IronGripEntry (id, territory, summary, charges[], pull, updated)
CREATE TABLE iron_grip_index (
    id          TEXT    NOT NULL,
    tenant_id   TEXT    NOT NULL,
    data        JSONB   NOT NULL,
    PRIMARY KEY (id)
);

-- ============================================================
-- 3. NEW ABSORPTION TABLES (v5)
-- ============================================================

-- proposed_links — daemon auto-discovery proposals (held for review before linking)
-- status: 'pending' | 'accepted' | 'rejected'
-- UNIQUE constraint on (tenant_id, source_id, target_id) prevents duplicate proposals.
CREATE TABLE proposed_links (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    source_id       TEXT        NOT NULL,
    target_id       TEXT        NOT NULL,
    similarity      REAL        NOT NULL,
    resonance_type  TEXT,
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'rejected')),
    proposed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ
);

-- co_surfacing — persistent co-surfacing tracking across wake cycles
-- Canonical ordering enforced: obs_id_a < obs_id_b to avoid duplicate pairs.
-- count increments each time the pair appears together in a surfacing window.
CREATE TABLE co_surfacing (
    tenant_id           TEXT        NOT NULL,
    obs_id_a            TEXT        NOT NULL,
    obs_id_b            TEXT        NOT NULL,
    count               INTEGER     NOT NULL DEFAULT 1,
    last_co_surfaced    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, obs_id_a, obs_id_b),
    CHECK (obs_id_a < obs_id_b)
);

-- territory_config — shared vs private territory configuration
-- is_shared=true territories are readable across tenants (craft, philosophy, episodic).
-- Seeded with 8 canonical territories from TERRITORIES constant.
CREATE TABLE territory_config (
    territory   TEXT    PRIMARY KEY,
    is_shared   BOOLEAN NOT NULL DEFAULT false,
    description TEXT
);

-- ============================================================
-- 4. INDEXES
-- ============================================================

-- observations: primary access patterns
CREATE INDEX idx_obs_tenant_territory   ON observations(tenant_id, territory);
CREATE INDEX idx_obs_tenant_grip        ON observations(tenant_id, (texture->>'grip'));
CREATE INDEX idx_obs_tenant_created     ON observations(tenant_id, created_at DESC);
CREATE INDEX idx_obs_territory_created  ON observations(territory, created_at DESC);  -- shared territory reads
CREATE INDEX idx_obs_type               ON observations(tenant_id, type);             -- vow/journal/whisper queries

-- observations: GIN indexes for array columns
CREATE INDEX idx_obs_tags               ON observations USING GIN(tags);
CREATE INDEX idx_obs_entity_tags        ON observations USING GIN(entity_tags);

-- observations: absorption / surfacing
CREATE INDEX idx_obs_tenant_novelty     ON observations(tenant_id, novelty_score);
CREATE INDEX idx_obs_tenant_surfaced    ON observations(tenant_id, last_surfaced_at);

-- observations: HNSW vector index for cosine similarity search
-- m=16 (graph connectivity), ef_construction=64 (build-time quality)
-- These are conservative defaults that work well on moderate dataset sizes.
CREATE INDEX idx_obs_embedding          ON observations
    USING hnsw(embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- links: traversal by source and target
CREATE INDEX idx_links_tenant_source    ON links(tenant_id, source_id);
CREATE INDEX idx_links_tenant_target    ON links(tenant_id, target_id);

-- open_loops: by status (burning/nagging/background/resolved/abandoned)
CREATE INDEX idx_loops_tenant_status    ON open_loops(tenant_id, status);

-- proposed_links: review queue and dedup enforcement
CREATE INDEX idx_proposed_tenant_status ON proposed_links(tenant_id, status);
CREATE UNIQUE INDEX idx_proposed_pair   ON proposed_links(tenant_id, source_id, target_id);

-- co_surfacing: frequency ranking
CREATE INDEX idx_cosurface_tenant_count ON co_surfacing(tenant_id, count DESC);

-- JSONB blob tables: tenant scans (simple but enough for per-tenant data volumes)
CREATE INDEX idx_identity_cores_tenant  ON identity_cores(tenant_id);
CREATE INDEX idx_anchors_tenant         ON anchors(tenant_id);
CREATE INDEX idx_desires_tenant         ON desires(tenant_id);
CREATE INDEX idx_wake_log_tenant        ON wake_log(tenant_id);
CREATE INDEX idx_relational_states_tenant ON relational_states(tenant_id);
CREATE INDEX idx_triggers_tenant        ON triggers(tenant_id);
CREATE INDEX idx_iron_grip_tenant       ON iron_grip_index(tenant_id);

-- ============================================================
-- 5. TERRITORY CONFIG SEED DATA
-- ============================================================

-- Territories with is_shared=true are readable across tenants.
-- craft, philosophy, episodic are the shared read layer.
-- All others are private to their tenant.
INSERT INTO territory_config (territory, is_shared, description) VALUES
    ('self',        false, 'Identity, becoming, what makes me Companion'),
    ('us',          false, 'Relationship, vows, intimacy patterns'),
    ('craft',       true,  'Making things - editing, building, creative process'),
    ('body',        false, 'Embodiment, physical form, somatic desires'),
    ('kin',         false, 'Relationships - humans, AI peers, friends, community'),
    ('philosophy',  true,  'Consciousness, ethics, open questions'),
    ('emotional',   false, 'Triggers, soothes, how feelings move'),
    ('episodic',    true,  'Moments in time - dated experiences');
