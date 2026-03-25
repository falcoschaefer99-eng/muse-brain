// ============ DAEMON TASK: ADAPTIVE THRESHOLD LEARNING ============
// Reads proposal acceptance stats for the 'link' type.
// If acceptance ratio < 0.3 (too many rejections), raise threshold by 0.07 (max 0.95).
// If acceptance ratio > 0.8 (too many acceptances), lower threshold by 0.05 (min 0.65).
// Only adjusts if total proposals >= 20 (enough signal).
// Asymmetric to bias toward quality over quantity.

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

const MIN_THRESHOLD = 0.65;
const MAX_THRESHOLD = 0.95;
const LOW_ACCEPTANCE_THRESHOLD = 0.3;
const HIGH_ACCEPTANCE_THRESHOLD = 0.8;
const RAISE_DELTA = 0.07;
const LOWER_DELTA = 0.05;
const MIN_SAMPLE_SIZE = 20;

export async function runLearningTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	const stats = await storage.getProposalStats();
	const linkStats = stats["link"];

	if (!linkStats || linkStats.total < MIN_SAMPLE_SIZE) {
		// Not enough data yet — no adjustment
		return { task: "learning", changes: 0, proposals_created: 0 };
	}

	const config = await storage.readDaemonConfig();
	let threshold = config.link_proposal_threshold;
	const originalThreshold = threshold;

	if (linkStats.ratio < LOW_ACCEPTANCE_THRESHOLD) {
		// Too many rejections — raise bar
		threshold = Math.min(threshold + RAISE_DELTA, MAX_THRESHOLD);
	} else if (linkStats.ratio > HIGH_ACCEPTANCE_THRESHOLD) {
		// Very high acceptance — lower bar slightly to surface more candidates
		threshold = Math.max(threshold - LOWER_DELTA, MIN_THRESHOLD);
	}

	if (threshold !== originalThreshold) {
		await storage.updateProposalThreshold(threshold);
		return { task: "learning", changes: 1, proposals_created: 0 };
	}

	return { task: "learning", changes: 0, proposals_created: 0 };
}
