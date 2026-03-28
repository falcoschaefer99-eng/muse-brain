-- ============================================================
-- Brain v5 — Migration 008: Dispatch Calibration + Agent Manifests
-- ============================================================

-- 1. Expand dispatch feedback into usable calibration telemetry
ALTER TABLE dispatch_feedback
    ADD COLUMN IF NOT EXISTS domain TEXT,
    ADD COLUMN IF NOT EXISTS environment TEXT,
    ADD COLUMN IF NOT EXISTS session_id TEXT,
    ADD COLUMN IF NOT EXISTS predicted_confidence REAL,
    ADD COLUMN IF NOT EXISTS outcome_score REAL,
    ADD COLUMN IF NOT EXISTS revision_cost REAL,
    ADD COLUMN IF NOT EXISTS needed_rescue BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS rescue_agent_id TEXT,
    ADD COLUMN IF NOT EXISTS time_to_usable_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_dispatch_tenant_domain_env
    ON dispatch_feedback(tenant_id, domain, environment, task_type);

CREATE INDEX IF NOT EXISTS idx_dispatch_rescue
    ON dispatch_feedback(tenant_id, needed_rescue, rescue_agent_id);

-- 2. Agent capability manifests (A2A / routing primitives)
CREATE TABLE IF NOT EXISTS agent_capability_manifests (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    agent_entity_id         TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    version                 TEXT NOT NULL DEFAULT '1.0.0',
    delegation_mode         TEXT NOT NULL DEFAULT 'explicit'
                            CHECK (delegation_mode IN ('auto', 'explicit', 'router')),
    router_agent_entity_id  TEXT,
    supports_streaming      BOOLEAN NOT NULL DEFAULT FALSE,
    accepted_output_modes   TEXT[] NOT NULL DEFAULT '{}',
    protocols               TEXT[] NOT NULL DEFAULT '{}',
    skills                  JSONB NOT NULL DEFAULT '[]',
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, agent_entity_id)
);

CREATE INDEX idx_agent_manifest_tenant_mode
    ON agent_capability_manifests(tenant_id, delegation_mode);
