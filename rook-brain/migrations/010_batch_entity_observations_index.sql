-- ============================================================
-- Brain v5 — Migration 010: batch entity observation hot-path index
-- ============================================================

-- Accelerates batchGetEntityObservations(entityIds, limitPerEntity)
-- query shape:
--   WHERE tenant_id = ? AND entity_id = ANY(?) ORDER BY entity_id, created_at DESC
CREATE INDEX IF NOT EXISTS idx_obs_tenant_entity_created
    ON observations(tenant_id, entity_id, created_at DESC)
    WHERE entity_id IS NOT NULL;
