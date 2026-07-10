# Embedding Backfill Operation — 2026-07-10 (night shift)

**Outcome: SUCCESS.** rook tenant 133→1,845/1,845 embedded (100%), rainer 566→711/711 (100%). 1,857 embeddings written, 0 skipped, 0 errors. Retrieval blindness cured — verified via production MCP: "Bundestag" (Apr 9 obs), "Mo & Mehdi" (Apr 17), "Meet Me Halfway" (May 8) all surface by vector, all formerly dark.

**Method (Eli's Option B):** drained via `wrangler dev --remote` (ephemeral worker, real AI+Hyperdrive bindings, zero prod footprint) → then ONE prod deploy (version 8b56716e) purely for the cron wedge-fix. Prod gates passed in order: owner-proxy MCP search, /health, domain routing. Rollback target f8e79cf2 unused.

**Root cause fixed:** nightly cron selected oldest-20 deterministically; embedBatch threw on any empty/whitespace content; error swallowed → same poison batch nightly, coverage frozen ~7% since April. Fix: non-empty predicate at SELECT (btrim incl. tabs/newlines) + chunked embed with per-row fallback + dead-ID tracking + POST /admin/backfill (auth'd, capped 400).

**Receipts:** backfilled observation IDs per wave in `backfill-receipts-rook.jsonl` / `backfill-receipts-rainer.jsonl` (canary in `backfill-wave-canary.json`). Reversal = re-NULL these IDs (never needed).

**Phase-1 probe result (settled):** stored tenant_id = `rook` (1,845 rows); `companion` = 0 rows (compiled default never matched production); `rainer` = 711. ALLOWED_TENANTS locked to `rook,rainer`.

**Open follow-ups:** entity extraction (no "Mehdi" entity exists) + 1,671 orphans triage; Michael's conditions — per-tenant daily inference budget on /admin/backfill before routine use; automate the public-sync guard-scan (wrangler.jsonc carries worker name + Hyperdrive id). Autonomous runtime (dead since Apr 5) still dead — separate decision.

Reviewed: Michael PASS-w/-conditions, Reeve PASS, Fischer 2 MEDIUMs found & fixed (c7aed70). Tests 369/369.
