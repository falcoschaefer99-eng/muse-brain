// ============ DAEMON TASK: ORPHAN DETECTION & RESCUE ============
// Phase 1 (detect): observations with no links, no entity_id, access_count <= 1,
//   age > 14 days, not already in orphan_observations
// Phase 2 (rescue): for each orphan with attempts < 3, find nearest non-orphan
//   via vector search, create rescue proposal.
//   After 3 failures, propose archival (metadata: { action: 'archive' }).

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

const ORPHAN_AGE_DAYS = 14;
const MAX_RESCUE_ATTEMPTS = 3;

export async function runOrphanTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	let changes = 0;
	let proposals_created = 0;

	// ---- Phase 1: Detect new orphans ----

	// Get existing orphan IDs to avoid double-marking
	const existingOrphans = await storage.listOrphans(undefined, 5000);
	if (existingOrphans.length >= 5000) {
		console.warn("Orphan list cap reached (5000). Some orphans may be missed this cycle.");
	}

	// findOrphanCandidates does the full filter in SQL — no links loaded into JS memory
	const cutoffDate = new Date(Date.now() - ORPHAN_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const candidates = await storage.findOrphanCandidates(cutoffDate, 200);

	for (const obs of candidates) {
		// Skip metabolized observations (already processed)
		if (obs.texture?.charge_phase === "metabolized") continue;

		await storage.markOrphan(obs.id);
		changes++;
	}

	// ---- Phase 2: Rescue orphans ----

	// Work on active orphans only
	const activeOrphans = await storage.listOrphans("orphaned", 50);

	for (const orphan of activeOrphans) {
		if (orphan.rescue_attempts >= MAX_RESCUE_ATTEMPTS) {
			// Propose archival — metabolize this observation
			const alreadyExists = await storage.proposalExists("orphan_rescue", orphan.observation_id, orphan.observation_id);
			if (!alreadyExists) {
				await storage.createProposal({
					tenant_id: storage.getTenant(),
					proposal_type: "orphan_rescue",
					source_id: orphan.observation_id,
					target_id: orphan.observation_id,
					confidence: 0.9,
					rationale: `Orphan failed ${MAX_RESCUE_ATTEMPTS} rescue attempts. Proposing archival.`,
					metadata: { action: "archive" },
					status: "pending"
				});
				proposals_created++;
			}
			continue;
		}

		// Find nearest non-orphan via vector similarity
		const similar = await storage.findSimilarUnlinked(orphan.observation_id, 3);

		if (similar.length > 0) {
			const best = similar[0];
			const alreadyExists = await storage.proposalExists("orphan_rescue", orphan.observation_id, best.observation.id);
			if (!alreadyExists) {
				await storage.createProposal({
					tenant_id: storage.getTenant(),
					proposal_type: "orphan_rescue",
					source_id: orphan.observation_id,
					target_id: best.observation.id,
					similarity: best.similarity,
					confidence: best.similarity,
					rationale: `Orphan rescue: nearest unlinked observation (similarity ${Math.round(best.similarity * 100)}%)`,
					metadata: {},
					status: "pending"
				});
				proposals_created++;
			}
		}

		await storage.incrementRescueAttempt(orphan.observation_id);
		changes++;
	}

	return { task: "orphans", changes, proposals_created };
}
