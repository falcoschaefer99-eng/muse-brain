-- ============================================================
-- Brain v5 — Migration 016: Retrieval hint trigram index
-- ============================================================

-- Accelerates hint_text ILIKE search lane used by hybridSearch.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
	IF to_regclass('public.retrieval_hints') IS NOT NULL THEN
		CREATE INDEX IF NOT EXISTS idx_retrieval_hints_hint_text_trgm
			ON retrieval_hints USING GIN (hint_text gin_trgm_ops);
	END IF;
END $$;

