-- ============================================================
-- Brain v5 — Migration 007: Project Dossiers + Wake Delta
-- ============================================================

-- 1. Project dossiers: companion metadata for entity_type='project'
CREATE TABLE project_dossiers (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    project_entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    lifecycle_status    TEXT NOT NULL DEFAULT 'active'
                        CHECK (lifecycle_status IN ('active', 'paused', 'archived')),
    summary             TEXT,
    goals               JSONB NOT NULL DEFAULT '[]',
    constraints         JSONB NOT NULL DEFAULT '[]',
    decisions           JSONB NOT NULL DEFAULT '[]',
    open_questions      JSONB NOT NULL DEFAULT '[]',
    next_actions        JSONB NOT NULL DEFAULT '[]',
    metadata            JSONB NOT NULL DEFAULT '{}',
    last_active_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, project_entity_id)
);

CREATE INDEX idx_project_dossiers_tenant_updated
    ON project_dossiers(tenant_id, updated_at DESC);

CREATE INDEX idx_project_dossiers_tenant_active
    ON project_dossiers(tenant_id, last_active_at DESC);

-- 2. Wake delta cursoring: targeted latest-wake lookup
CREATE INDEX idx_wake_log_tenant_created
    ON wake_log(tenant_id, created_at DESC);
