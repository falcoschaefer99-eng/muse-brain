// ============ DAEMON TASK: LINK PROPOSAL GENERATION ============
// Generates link proposals from vector similarity between fresh/active observations.
// Uses tenant-tunable weights from daemon_config.data.
// Confidence formula:
//   With entity_weight:  similarity * sim_w + (shared_charges/max) * charge_w + (shared_entity ? 1 : 0) * entity_w
//   Without entity_weight: similarity * sim_w + (shared_charges/max) * charge_w

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

const BATCH_SIZE = 10;

export async function runProposalTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	let proposals_created = 0;

	// Read config: threshold + tenant weights
	const config = await storage.readDaemonConfig();
	const threshold = config.link_proposal_threshold;
	const weights = config.data as Record<string, number>;

	const chargeWeight = weights.charge_weight ?? 0.4;
	const similarityWeight = weights.similarity_weight ?? 0.6;
	const entityWeight = weights.entity_weight as number | undefined;

	// Query recent observations (batch of 50)
	const candidates = await storage.queryObservations({
		limit: BATCH_SIZE,
		order_by: "created",
		order_dir: "desc"
	});

	// Filter to non-metabolized observations — fresh, active, and processing are all
	// valid for link discovery. The narrow fresh/active window (~1 hour / ~1 day)
	// combined with async embedding backfill means most observations get embeddings
	// AFTER being decayed to "processing". findSimilarUnlinked already excludes
	// existing links and pending proposals, so no wasted work.
	const eligible = candidates.filter(({ observation: obs }) => {
		const phase = obs.texture?.charge_phase;
		return phase !== "metabolized";
	});

	console.log(`Proposals: ${candidates.length} candidates, ${eligible.length} eligible (non-metabolized)`);

	for (const { observation: source } of eligible) {
		// Find top 5 similar unlinked observations
		const similar = await storage.findSimilarUnlinked(source.id, 5);

		if (similar.length === 0) continue;
		console.log(`Proposals: source ${source.id.slice(0, 8)} found ${similar.length} similar (best: ${Math.round(similar[0].similarity * 100)}%)`);

		for (const candidate of similar) {
			// Filter by threshold (findSimilarUnlinked already excludes pending proposals via CTE)
			if (candidate.similarity < threshold) continue;

			// Compute shared charges
			const sourceCharges = new Set(source.texture?.charge ?? []);
			const candidateCharges = candidate.observation.texture?.charge ?? [];
			let sharedCharges = 0;
			for (const c of candidateCharges) {
				if (sourceCharges.has(c)) sharedCharges++;
			}
			const maxCharges = Math.max(sourceCharges.size, candidateCharges.length, 1);
			const chargeRatio = sharedCharges / maxCharges;

			// Compute shared entity flag
			const sharedEntity =
				source.entity_id != null &&
				candidate.observation.entity_id != null &&
				source.entity_id === candidate.observation.entity_id;

			// Compute confidence
			let confidence: number;
			if (entityWeight !== undefined) {
				confidence =
					candidate.similarity * similarityWeight +
					chargeRatio * chargeWeight +
					(sharedEntity ? 1 : 0) * entityWeight;
			} else {
				confidence =
					candidate.similarity * similarityWeight +
					chargeRatio * chargeWeight;
			}

			// Clamp to [0, 1]
			confidence = Math.min(1, Math.max(0, confidence));

			// Only create proposal if confidence meets threshold
			if (confidence < threshold) continue;

			await storage.createProposal({
				tenant_id: storage.getTenant(),
				proposal_type: "link",
				source_id: source.id,
				target_id: candidate.observation.id,
				similarity: candidate.similarity,
				resonance_type: "semantic",   // Default resonance for vector-similarity links; reviewer can adjust
				confidence,
				rationale: `Vector similarity ${Math.round(candidate.similarity * 100)}%, shared charges ${sharedCharges}/${maxCharges}`,
				metadata: {
					shared_charges: sharedCharges,
					charge_ratio: chargeRatio,
					shared_entity: sharedEntity
				},
				status: "pending"
			});
			proposals_created++;
		}
	}

	return { task: "proposals", changes: 0, proposals_created };
}
