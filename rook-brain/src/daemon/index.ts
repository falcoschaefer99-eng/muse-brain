// ============ DAEMON ORCHESTRATOR (Sprint 4) ============
// Runs all daemon intelligence tasks in order.
// Execution order: proposals → learning → cosurfacing → orphans.
// Proposals first — it's the primary feature and uses the fewest subrequests.
// Each task is isolated — failures don't cascade.

import type { IBrainStorage } from "../storage/interface";
import type { IEmbeddingProvider } from "../embedding/interface";
import type { DaemonTaskResult } from "./types";

import { runCoSurfacingTask } from "./tasks/cosurfacing";
import { runOrphanTask } from "./tasks/orphans";
import { runProposalTask } from "./tasks/proposals";
import { runLearningTask } from "./tasks/learning";

export async function runDaemonTasks(
	storage: IBrainStorage,
	embedding?: IEmbeddingProvider
): Promise<DaemonTaskResult[]> {
	const results: DaemonTaskResult[] = [];

	// 1. Proposals — generate link proposals from vector similarity
	try {
		const result = await runProposalTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "proposals",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 2. Learning — adaptive threshold adjustment
	try {
		const result = await runLearningTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "learning",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 3. Co-surfacing — record charge-based co-occurrence pairs
	try {
		const result = await runCoSurfacingTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "cosurfacing",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	// 4. Orphans — detect and attempt rescue
	try {
		const result = await runOrphanTask(storage);
		results.push(result);
	} catch (err) {
		results.push({
			task: "orphans",
			changes: 0,
			proposals_created: 0,
			error: err instanceof Error ? err.message : "unknown error"
		});
	}

	return results;
}
