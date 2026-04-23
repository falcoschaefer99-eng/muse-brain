# MUSE Brain v1.6.1 — Release Notes (Draft)

**Target release date:** April 23, 2026  
**Release theme:** Letter-path hardening + scoped retrieval correctness

---

## Highlights

1. **Scoped letter retrieval now native in storage**
   - Added `getLetterById(id, recipientContext)` backend support in Postgres and SQLite.
   - Direct letter lookup now resolves by tenant + context, not broad collection fallback.

2. **Unified resolver path hardened**
   - `mind_pull` and `mind_letter action=get` now use one shared scoped helper for letter reads.
   - `mind_memory action=get` can pass optional `context` through the same resolver lane.

3. **Hot-path latency improvement**
   - `mind_pull` observation access updates are now fire-and-forget (`waitUntil`-aware), removing a blocking round-trip from the read path.

4. **Bridge script security tightening**
   - `scripts/agent-memory-sync.mjs` now validates source roots and endpoint scheme, and uses a single canonical API key source (`MUSE_BRAIN_API_KEY`).

---

## Receipts

### Test gates
- `npm run test:contracts` → **54/54 passing**
- `npm test` → **218/218 passing**

### Coverage additions in this patch
- `process:true` non-advance branch behavior (`new_phase` omitted) + explicit `processing_count` assertions.
- Unprefixed fallback chain behavior (`letter -> task -> entity`) in unified pull resolver.
- `ent_` project return-shape assertion with dossier bundle.
- `mind_letter action=get` optimized storage lane (`getLetterById`) assertion.

---

## Suggested tag line

**v1.6.1 closes the letter-retrieval scale trap and hardens ID read correctness without changing public tool ergonomics.**
