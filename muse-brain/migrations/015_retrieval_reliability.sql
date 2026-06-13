-- ============================================================
-- Brain v5 — Migration 015: Retrieval Reliability (Sprint 4.5)
-- ============================================================

-- 1) Canonical project index for deterministic project routing.
CREATE TABLE IF NOT EXISTS project_index (
	id                  TEXT PRIMARY KEY,
	tenant_id           TEXT NOT NULL,
	project_entity_id   TEXT NOT NULL,
	slug                TEXT NOT NULL,
	aliases             TEXT[] DEFAULT '{}',
	normalized_aliases  TEXT[] DEFAULT '{}',
	keywords            TEXT[] DEFAULT '{}',
	visibility          TEXT NOT NULL DEFAULT 'private'
		CHECK (visibility IN ('private', 'shared')),
	status              TEXT NOT NULL DEFAULT 'active'
		CHECK (status IN ('active', 'paused', 'archived')),
	metadata            JSONB NOT NULL DEFAULT '{}',
	created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_index_slug
	ON project_index(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_project_index_aliases
	ON project_index USING GIN(normalized_aliases);
CREATE INDEX IF NOT EXISTS idx_project_index_entity
	ON project_index(project_entity_id);
CREATE INDEX IF NOT EXISTS idx_project_index_shared
	ON project_index(visibility) WHERE visibility = 'shared';
CREATE INDEX IF NOT EXISTS idx_project_index_status
	ON project_index(tenant_id, status);

-- 2) Link observations to indexed projects.
ALTER TABLE observations
	ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES project_index(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_obs_project_id
	ON observations(tenant_id, project_id);

-- 3) Expand observation FTS coverage (include summary + tags).
CREATE OR REPLACE FUNCTION observations_search_vector_trigger() RETURNS trigger SECURITY INVOKER AS $$
BEGIN
	NEW.search_vector := to_tsvector('english',
		COALESCE(NEW.content, '') || ' ' ||
		COALESCE(NEW.context, '') || ' ' ||
		COALESCE(NEW.mood, '') || ' ' ||
		COALESCE(NEW.summary, '') || ' ' ||
		COALESCE(array_to_string(NEW.tags, ' '), '')
	);
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_obs_search_vector ON observations;
CREATE TRIGGER trg_obs_search_vector
	BEFORE INSERT OR UPDATE OF content, context, mood, summary, tags
	ON observations
	FOR EACH ROW
	EXECUTE FUNCTION observations_search_vector_trigger();

UPDATE observations SET search_vector = to_tsvector('english',
	COALESCE(content, '') || ' ' ||
	COALESCE(context, '') || ' ' ||
	COALESCE(mood, '') || ' ' ||
	COALESCE(summary, '') || ' ' ||
	COALESCE(array_to_string(tags, ' '), '')
)
WHERE search_vector IS DISTINCT FROM to_tsvector('english',
	COALESCE(content, '') || ' ' ||
	COALESCE(context, '') || ' ' ||
	COALESCE(mood, '') || ' ' ||
	COALESCE(summary, '') || ' ' ||
	COALESCE(array_to_string(tags, ' '), '')
);

-- 4) Letter search index for paginated search action.
ALTER TABLE letters
	ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_letters_tenant_ts
	ON letters(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_letters_fts
	ON letters USING GIN(search_vector);

CREATE OR REPLACE FUNCTION letters_search_vector_trigger() RETURNS trigger SECURITY INVOKER AS $$
BEGIN
	NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_letters_search_vector ON letters;
CREATE TRIGGER trg_letters_search_vector
	BEFORE INSERT OR UPDATE OF content
	ON letters
	FOR EACH ROW
	EXECUTE FUNCTION letters_search_vector_trigger();

UPDATE letters
SET search_vector = to_tsvector('english', COALESCE(content, ''))
WHERE search_vector IS DISTINCT FROM to_tsvector('english', COALESCE(content, ''));
