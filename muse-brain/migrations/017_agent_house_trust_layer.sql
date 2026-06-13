-- ============================================================
-- Brain v5 — Migration 017: Agent House Trust Layer (v1.8)
-- ============================================================

-- Server-side lease ledger. Clients may present lease envelopes, but the
-- canonical trust substrate needs durable records for heartbeat/reaper work,
-- process-exit expiry, and forensic review.
CREATE TABLE IF NOT EXISTS agent_leases (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    lease_id           TEXT NOT NULL,
    agent_id           TEXT NOT NULL,
    platform           TEXT NOT NULL,
    session_id         TEXT,
    run_id             TEXT,
    parent_lease_id    TEXT,
    delegation_chain   TEXT[] NOT NULL DEFAULT '{}',
    capabilities       TEXT[] NOT NULL DEFAULT '{}',
    scope              JSONB NOT NULL DEFAULT '{}',
    status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'revoked', 'expired')),
    issued_at          TIMESTAMPTZ NOT NULL,
    expires_at         TIMESTAMPTZ NOT NULL,
    last_heartbeat_at  TIMESTAMPTZ,
    process_id         TEXT,
    metadata           JSONB NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, lease_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_leases_tenant_status_expires
    ON agent_leases(tenant_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_leases_tenant_agent_created
    ON agent_leases(tenant_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_leases_tenant_process
    ON agent_leases(tenant_id, process_id)
    WHERE process_id IS NOT NULL;

-- Append-only audit lane. Diffs are stored in `diff`; snapshots should not be
-- stored here unless an explicit recovery/migration event requires it.
CREATE TABLE IF NOT EXISTS agent_audit_events (
    id                 TEXT PRIMARY KEY,
    tenant_id          TEXT NOT NULL,
    event_type         TEXT NOT NULL,
    actor_agent_id     TEXT,
    lease_id           TEXT,
    platform           TEXT,
    session_id         TEXT,
    run_id             TEXT,
    delegation_chain   TEXT[] NOT NULL DEFAULT '{}',
    operation          TEXT,
    tool_name          TEXT,
    resource           JSONB NOT NULL DEFAULT '{}',
    result             TEXT NOT NULL
                       CHECK (result IN ('allowed', 'denied', 'succeeded', 'failed', 'shadow')),
    reason             TEXT,
    payload_hash       TEXT,
    diff               JSONB NOT NULL DEFAULT '{}',
    metadata           JSONB NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_events_tenant_created
    ON agent_audit_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_audit_events_tenant_lease_created
    ON agent_audit_events(tenant_id, lease_id, created_at DESC)
    WHERE lease_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_audit_events_tenant_actor_created
    ON agent_audit_events(tenant_id, actor_agent_id, created_at DESC)
    WHERE actor_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_audit_events_tenant_result_created
    ON agent_audit_events(tenant_id, result, created_at DESC);
