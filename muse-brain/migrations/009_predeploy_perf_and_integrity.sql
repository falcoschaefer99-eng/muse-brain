-- ============================================================
-- Brain v5 — Migration 009: Pre-deploy performance + integrity
-- ============================================================

-- 1. Hot-path wake/task indexes
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_updated
    ON tasks(tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_updated
    ON tasks(assigned_tenant, updated_at DESC)
    WHERE assigned_tenant IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_manifest_tenant_updated
    ON agent_capability_manifests(tenant_id, updated_at DESC);

-- 2. Router pointer integrity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'agent_capability_manifests_router_agent_entity_id_fkey'
    ) THEN
        ALTER TABLE agent_capability_manifests
            ADD CONSTRAINT agent_capability_manifests_router_agent_entity_id_fkey
            FOREIGN KEY (router_agent_entity_id)
            REFERENCES entities(id)
            ON DELETE SET NULL;
    END IF;
END $$;
