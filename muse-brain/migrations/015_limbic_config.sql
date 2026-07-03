-- ============================================================
-- Brain v5 — Migration 015: Limbic Config (Phase 1)
-- ============================================================
-- Tenant-scoped feature flag and natal config for the Limbic subsystem.
--
-- Phase 1 use: `enabled` gates the celestial read-time overlay added to
-- mind_state and mind_wake output. When false (or no row exists for a
-- tenant), those tools produce byte-identical output to pre-Limbic builds.
--
-- `natal` is reserved for Phase 2 (birth-chart personalization). It is
-- nullable and NOT read in Phase 1 — present now so the schema migration
-- is additive when Phase 2 lands.
--
-- Default: enabled = false. No tenant has a row until explicitly created.
-- SQLite parity: the SQLite backend stores this under the `limbic_config`
-- key in its kv_store table (TEXT value = JSON, JSONB → TEXT).

CREATE TABLE IF NOT EXISTS limbic_config (
    tenant_id   TEXT        PRIMARY KEY,
    enabled     BOOLEAN     NOT NULL DEFAULT false,
    natal       JSONB,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
