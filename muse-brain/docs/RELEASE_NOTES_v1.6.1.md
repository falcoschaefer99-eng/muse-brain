# MUSE Brain v1.6.1 — Release Notes

**Release date:** April 23, 2026  
**Release theme:** Letter-path hardening + scoped retrieval correctness

---

## Highlights

1. **Scoped letter retrieval now native in storage**
   - Added `getLetterById(id, recipientContext)` backend support in Postgres and SQLite.
   - Direct letter lookup now resolves by tenant + context, not broad collection fallback.

2. **Universal resolver path hardened**
   - `mind_pull` and `mind_letter action=get` share one scoped lookup helper for letter reads.
   - `mind_memory action=get` can pass optional `context` through the same resolver.

3. **Hot-path latency improvement**
   - `mind_pull` observation access updates are now fire-and-forget (`waitUntil`-aware). The blocking round-trip is gone from the read path.

4. **Bridge script security tightening**
   - `scripts/agent-memory-sync.mjs` now validates source roots and endpoint scheme. The API key source is narrowed to a single canonical env var (`MUSE_BRAIN_API_KEY`) — legacy fallback chain removed.

---

## Receipts

### Test gates
- `npm run test:contracts` → **54/54 passing**
- `npm test` → **218/218 passing**

> **Note:** v1.6.0 introduced this lane as `test:reliability`. v1.6.1 renames the primary command to `test:contracts` (the work is contract testing, not runtime reliability); `test:reliability` is retained as an alias for backward compatibility.

### Coverage additions in this patch
- `process:true` non-advance branch behavior (`new_phase` omitted) + explicit `processing_count` assertions.
- Unprefixed fallback chain behavior (`letter -> task -> entity`) in unified pull resolver.
- `ent_` project return-shape assertion with dossier bundle.
- `mind_letter action=get` optimized storage lane (`getLetterById`) assertion.

---

## Suggested tag line

**v1.6.1 closes the letter-retrieval scale trap and fixes ID read scope — no changes to the public API.**
