// ============ DAEMON TASK: TASK SCHEDULING ============
// Checks for scheduled tasks whose scheduled_wake has passed
// and advances them to 'open' status so they surface in wake.

import type { IBrainStorage } from "../../storage/interface";
import type { DaemonTaskResult } from "../types";

const SCHEDULER_BATCH_LIMIT = 200;

export async function runTaskSchedulingTask(storage: IBrainStorage): Promise<DaemonTaskResult> {
	const changes = await storage.openDueScheduledTasks(new Date().toISOString(), SCHEDULER_BATCH_LIMIT);
	return { task: "task-scheduling", changes, proposals_created: 0 };
}
