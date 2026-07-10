-- Fix: similarity is not meaningful for all proposal types (orphan archive,
-- paradox detection, skill health, etc.). The TypeScript type already marks it
-- optional (similarity?: number). Relax the NOT NULL constraint to match.
ALTER TABLE daemon_proposals ALTER COLUMN similarity DROP NOT NULL;
