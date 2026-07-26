// ============ TOOL CONTEXT ============
// Passed to every tool handler. Carries storage + optional Workers AI binding
// + waitUntil for fire-and-forget background work (embedding generation).

import type { IBrainStorage } from "../storage/interface";
import type { BrainLease, LeaseAuthorization, LeaseEnforcementMode, LeaseResolution } from "../security/leases";

export interface ToolContext {
	storage: IBrainStorage;
	ai?: Ai;                               // Workers AI binding — optional during migration period
	waitUntil?: (promise: Promise<unknown>) => void;  // ctx.waitUntil from ExecutionContext
	crossTenantGrants?: ReadonlySet<string>;
	lease?: BrainLease;
	leaseMode?: LeaseEnforcementMode;
	leaseResolution?: LeaseResolution;
	leaseAuthorization?: LeaseAuthorization;
}
