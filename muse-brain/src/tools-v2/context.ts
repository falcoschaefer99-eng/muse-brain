// ============ TOOL CONTEXT ============
// Passed to every tool handler. Carries storage + optional Workers AI binding
// + waitUntil for fire-and-forget background work (embedding generation).

import type { IBrainStorage } from "../storage/interface";

export interface ToolContext {
	storage: IBrainStorage;
	ai?: Ai;                               // Workers AI binding — optional during migration period
	waitUntil?: (promise: Promise<unknown>) => void;  // ctx.waitUntil from ExecutionContext
}
