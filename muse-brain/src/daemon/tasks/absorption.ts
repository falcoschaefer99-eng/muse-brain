// ============ DAEMON TASK: AUTO-ABSORPTION ============
// The daemon is a producer of proposals with no consumer — they pile up unreviewed.
// Auto-absorption digests the obvious ones immediately after they're created:
//   - link proposals, confidence >= 0.92: create bidirectional link
//   - orphan_rescue (rescue), confidence >= 0.90: create bidirectional link + mark orphan rescued
//   - orphan_rescue (archive, any confidence): metabolize observation + mark orphan archived
// Everything else (skill_promotion, cross_agent, cross_tenant, paradox_detected, consolidation,
// dedup, recall_contract, fact_commitment) is left pending — needs companion/human judgment.
//
// Side effects replicate mind_propose's action=review "accepted" logic exactly
// (src/tools-v2/propose.ts) so absorbed proposals have identical downstream effects
// to a human clicking "accept".

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";
import type { DaemonProposal } from "../../types";
import { createBidirectionalLink } from "../helpers";

const LINK_CONFIDENCE_THRESHOLD = 0.92;
const ORPHAN_RESCUE_CONFIDENCE_THRESHOLD = 0.90;
const MAX_ABSORB_PER_RUN = 50;

export async function runAbsorptionTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	let changes = 0;

	const pending = await storage.listProposals(undefined, "pending", 200);

	for (const proposal of pending.slice(0, MAX_ABSORB_PER_RUN)) {
		try {
			if (await absorb(storage, proposal)) {
				changes++;
			}
		} catch (err) {
			console.error(`absorption: proposal ${proposal.id} failed:`, err instanceof Error ? err.message : err);
		}
	}

	return { task: "absorption", changes, proposals_created: 0 };
}

async function absorb(storage: IBrainStorage, proposal: DaemonProposal): Promise<boolean> {
	if (proposal.proposal_type === "link" && proposal.confidence >= LINK_CONFIDENCE_THRESHOLD) {
		await createBidirectionalLink(storage, proposal);
		await storage.reviewProposal(proposal.id, "accepted", "auto-absorbed");
		return true;
	}

	if (proposal.proposal_type === "orphan_rescue") {
		const meta = (proposal.metadata ?? {}) as Record<string, unknown>;

		if (meta.action === "archive") {
			const found = await storage.findObservation(proposal.source_id);
			if (found) {
				const texture = { ...found.observation.texture, charge_phase: "metabolized" as const };
				await storage.updateObservationTexture(proposal.source_id, texture);
			}
			await storage.updateOrphanStatus(proposal.source_id, "archived");
			await storage.reviewProposal(proposal.id, "accepted", "auto-absorbed");
			return true;
		}

		if (proposal.confidence >= ORPHAN_RESCUE_CONFIDENCE_THRESHOLD) {
			await createBidirectionalLink(storage, proposal);
			await storage.updateOrphanStatus(proposal.source_id, "rescued");
			await storage.reviewProposal(proposal.id, "accepted", "auto-absorbed");
			return true;
		}
	}

	return false;
}
