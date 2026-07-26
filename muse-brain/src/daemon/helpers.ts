// ============ DAEMON SHARED HELPERS ============
// Utilities shared across daemon tasks (absorption.ts, ai-review.ts).

import type { IBrainStorage } from "../storage/interface";
import type { DaemonProposal, Link } from "../types";
import { generateId, getTimestamp } from "../helpers";

/**
 * Create a bidirectional link from a proposal's source_id <-> target_id.
 * Mirrors mind_propose's action=review "accepted" logic exactly (src/tools-v2/propose.ts)
 * so absorbed/AI-reviewed proposals have identical downstream effects to a human clicking "accept".
 */
export async function createBidirectionalLink(storage: IBrainStorage, proposal: DaemonProposal): Promise<void> {
	const resonanceType = proposal.resonance_type ?? "semantic";
	const now = getTimestamp();

	const fwdLink: Link = {
		id: generateId("link"),
		source_id: proposal.source_id,
		target_id: proposal.target_id,
		resonance_type: resonanceType,
		strength: "present",
		origin: "daemon",
		created: now,
		last_activated: now
	};
	const revLink: Link = {
		id: generateId("link"),
		source_id: proposal.target_id,
		target_id: proposal.source_id,
		resonance_type: resonanceType,
		strength: "present",
		origin: "daemon",
		created: now,
		last_activated: now
	};

	await Promise.all([
		storage.appendLink(fwdLink),
		storage.appendLink(revLink)
	]);
}
