// ============ TOOL CONTEXT ============
// Passed to every tool handler. Carries storage + optional Workers AI binding
// + waitUntil for fire-and-forget background work (embedding generation).

import type { IBrainStorage } from "../storage/interface";

export interface ToolContext {
	storage: IBrainStorage;
	ai?: Ai;                               // Workers AI binding — optional during migration period
	waitUntil?: (promise: Promise<unknown>) => void;  // ctx.waitUntil from ExecutionContext
	/**
	 * Tenants (beyond the caller's own key-derived tenant) this request is authorized to
	 * cross-read: project-registry scope:"all" lookups and non-default mind_runtime
	 * agent_tenant values. Populated server-side from CROSS_TENANT_READ_GRANTS
	 * (src/tenant-config.ts), keyed by the caller's own tenant — NEVER from caller input.
	 * Absent/empty => no cross-tenant grants (fail closed; own tenant only). See
	 * ops/MICHAEL_TENANT_KEY_AUDIT_2026-07-06.md fix #3.
	 */
	crossTenantGrants?: ReadonlySet<string>;
}
