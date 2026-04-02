// ============ DAEMON TASK TYPES ============
// Used internally by the daemon orchestrator and all task modules.

export interface DaemonTaskResult {
	task: string;
	changes: number;
	proposals_created: number;
	error?: string;
}
