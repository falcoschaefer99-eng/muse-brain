-- ============================================================
-- Brain v5 Sprint 4 — Daemon Intelligence
-- ============================================================

-- 1. Rename proposed_links -> daemon_proposals
ALTER TABLE proposed_links RENAME TO daemon_proposals;

-- 2. Drop old unique constraint, add new one scoped by type
DROP INDEX IF EXISTS idx_proposed_pair;

-- 3. Add new columns
ALTER TABLE daemon_proposals
    ADD COLUMN IF NOT EXISTS proposal_type TEXT NOT NULL DEFAULT 'link',
    ADD COLUMN IF NOT EXISTS confidence REAL NOT NULL DEFAULT 0.5,
    ADD COLUMN IF NOT EXISTS rationale TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS feedback_note TEXT;

-- 4. New dedup index (scoped by proposal_type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_dedup
    ON daemon_proposals(tenant_id, proposal_type, source_id, target_id);

CREATE INDEX IF NOT EXISTS idx_proposals_tenant_type
    ON daemon_proposals(tenant_id, proposal_type, status);

-- 5. Orphan observations table
CREATE TABLE IF NOT EXISTS orphan_observations (
    observation_id      TEXT        NOT NULL,
    tenant_id           TEXT        NOT NULL,
    first_marked        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rescue_attempts     INTEGER     NOT NULL DEFAULT 0,
    last_rescue_attempt TIMESTAMPTZ,
    status              TEXT        NOT NULL DEFAULT 'orphaned'
                                    CHECK (status IN ('orphaned', 'rescued', 'archived')),
    PRIMARY KEY (tenant_id, observation_id)
);

CREATE INDEX IF NOT EXISTS idx_orphans_tenant_status
    ON orphan_observations(tenant_id, status);

-- 6. Daemon config (per-tenant adaptive thresholds + tunable weights)
CREATE TABLE IF NOT EXISTS daemon_config (
    tenant_id               TEXT        PRIMARY KEY,
    link_proposal_threshold REAL        NOT NULL DEFAULT 0.75,
    last_threshold_update   TIMESTAMPTZ,
    data                    JSONB       NOT NULL DEFAULT '{}'
);

-- Seed with tenant-specific weights
INSERT INTO daemon_config (tenant_id, data) VALUES
    ('rook',   '{"charge_weight": 0.4, "similarity_weight": 0.6}'),
    ('rainer', '{"charge_weight": 0.15, "entity_weight": 0.35, "similarity_weight": 0.5}')
ON CONFLICT (tenant_id) DO NOTHING;
