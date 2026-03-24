-- ============================================================
-- Brain v5 Sprint 1 — FTS, charge_phase, entity_id, embedding providers
-- ============================================================

-- Full-text search vector column
ALTER TABLE observations ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_obs_fts ON observations USING GIN(search_vector);

-- Trigger for auto-populating search_vector on insert/update
CREATE OR REPLACE FUNCTION observations_search_vector_trigger() RETURNS trigger SECURITY INVOKER AS $$
BEGIN
    NEW.search_vector := to_tsvector('english',
        COALESCE(NEW.content, '') || ' ' ||
        COALESCE(NEW.context, '') || ' ' ||
        COALESCE(NEW.mood, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_obs_search_vector
    BEFORE INSERT OR UPDATE OF content, context, mood
    ON observations
    FOR EACH ROW
    EXECUTE FUNCTION observations_search_vector_trigger();

-- Backfill existing observations
UPDATE observations SET search_vector = to_tsvector('english',
    COALESCE(content, '') || ' ' || COALESCE(context, '') || ' ' || COALESCE(mood, '')
);

-- Sprint 1 column additions
ALTER TABLE observations
    ADD COLUMN IF NOT EXISTS entity_id TEXT,
    ADD COLUMN IF NOT EXISTS aesthetic_significance REAL DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS charge_phase TEXT DEFAULT 'fresh'
        CHECK (charge_phase IN ('fresh', 'active', 'processing', 'metabolized'));

CREATE INDEX IF NOT EXISTS idx_obs_entity ON observations(entity_id);
CREATE INDEX IF NOT EXISTS idx_obs_charge_phase ON observations(tenant_id, charge_phase);

-- Embedding providers tracking table
CREATE TABLE IF NOT EXISTS embedding_providers (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    dimensions  INTEGER     NOT NULL,
    modality    TEXT        NOT NULL DEFAULT 'text',
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    config      JSONB       DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Workers AI BGE provider
INSERT INTO embedding_providers (id, name, dimensions, modality, is_active)
VALUES ('workers-ai-bge-base', '@cf/bge-base-en-v1.5', 768, 'text', true)
ON CONFLICT (id) DO NOTHING;
