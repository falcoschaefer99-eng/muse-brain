// ============ AGENT LEASE PROTOCOL ============
// Server-side trust envelope for agent reads/writes.
//
// This is intentionally platform-neutral: Codex, Claude Code, local bridge,
// and future runners all converge on the same lease shape. Clients may "lock"
// themselves voluntarily, but the brain only trusts server-side validation.

export type LeasePlatform = "codex" | "claude_code" | "anthropic_api" | "local_bridge" | "system";
export type LeaseEnforcementMode = "off" | "shadow" | "required";

export const LEASE_HEADER = "X-Brain-Lease";

export const LEASE_CAPABILITIES = {
	systemRoot: "system.root",
	memoryRead: "memory.read",
	memorySearch: "memory.search",
	observeWrite: "observe.write",
	entityRead: "entity.read",
	entityWrite: "entity.write",
	entityLink: "entity.link",
	relationshipRead: "relationship.read",
	relationshipWrite: "relationship.write",
	identityRead: "identity.read",
	identityWrite: "identity.write",
	identityPropose: "identity.propose",
	auditWrite: "audit.write",
	runtimeTrigger: "runtime.trigger",
	runtimeRead: "runtime.read",
	runtimeWrite: "runtime.write",
	taskRead: "task.read",
	taskWrite: "task.write",
	letterRead: "letter.read",
	letterWrite: "letter.write",
	skillRead: "skill.read",
	skillWrite: "skill.write",
	agentRead: "agent.read",
	agentWrite: "agent.write",
	consentRead: "consent.read",
	consentWrite: "consent.write",
	stateRead: "state.read",
	stateWrite: "state.write",
	territoryRead: "territory.read",
	crossTenantSharedRead: "cross_tenant.shared_read"
} as const;

export type LeaseCapability = typeof LEASE_CAPABILITIES[keyof typeof LEASE_CAPABILITIES] | `${string}.*` | "*";

export interface LeaseScope {
	tenant: string;
	/** Omitted fields mean "no resource restriction" for top-level leases. Delegated leases cannot widen omitted parent fields. */
	territories?: string[];
	entities?: string[];
	projects?: string[];
	/** Cross-tenant reads are only allowed for explicitly listed shared territories. */
	shared_territories?: string[];
	allow_all?: boolean;
}

export interface BrainLease {
	lease_id: string;
	agent_id: string;
	platform: LeasePlatform;
	session_id?: string;
	run_id?: string;
	parent_lease_id?: string;
	delegation_chain: string[];
	capabilities: LeaseCapability[];
	scope: LeaseScope;
	issued_at: string;
	expires_at: string;
	nonce?: string;
	process_id?: string;
	metadata?: Record<string, unknown>;
}

export interface LeaseResolution {
	mode: LeaseEnforcementMode;
	lease?: BrainLease;
	source: "header" | "synthetic_root" | "missing";
	error?: string;
}

export interface LeaseRequirement {
	operation: string;
	anyOf: LeaseCapability[];
	resource?: {
		territory?: string;
		entity_id?: string;
		project_id?: string;
	};
}

export interface LeaseAuthorization {
	allowed: boolean;
	requirement: LeaseRequirement;
	reason?: string;
}

const MAX_LEASE_HEADER_BYTES = 8192;
const MAX_STRING_FIELD = 512;
const MAX_CHAIN_LENGTH = 16;
const MAX_SCOPE_ITEMS = 100;

const VALID_PLATFORMS = new Set<LeasePlatform>([
	"codex",
	"claude_code",
	"anthropic_api",
	"local_bridge",
	"system"
]);

const WRITE_ACTIONS = new Set(["create", "update", "delete", "texture", "link", "relate", "backfill", "review", "complete", "create_dual", "set", "grant", "revoke", "feel", "level", "open", "paradox", "resolve", "log", "write", "process", "trigger"]);
const READ_ACTIONS = new Set(["get", "list", "read", "toward", "status", "check", "who_i_am", "gestalt", "search", "recent", "lookup", "timeline", "territory", "stats", "patterns"]);

function nowIso(nowMs = Date.now()): string {
	return new Date(nowMs).toISOString();
}

function cleanString(value: unknown, maxLength = MAX_STRING_FIELD): string | undefined {
	if (typeof value !== "string") return undefined;
	const cleaned = value.trim().replace(/[\x00-\x1f]/g, "");
	if (!cleaned || cleaned.length > maxLength) return undefined;
	return cleaned;
}

function cleanStringArray(value: unknown, maxItems = MAX_SCOPE_ITEMS): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: string[] = [];
	for (const item of value.slice(0, maxItems)) {
		const cleaned = cleanString(item);
		if (cleaned) out.push(cleaned);
	}
	return out;
}

function parseJsonOrBase64Url(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) throw new Error("empty lease header");
	if (trimmed.startsWith("{")) return JSON.parse(trimmed);

	const padded = trimmed.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(trimmed.length / 4) * 4, "=");
	const decoded = atob(padded);
	return JSON.parse(decoded);
}

function validateScope(value: unknown): LeaseScope | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const tenant = cleanString(record.tenant, 64);
	if (!tenant) return undefined;

	const scope: LeaseScope = {
		tenant,
		allow_all: record.allow_all === true
	};
	const territories = cleanStringArray(record.territories);
	const entities = cleanStringArray(record.entities);
	const projects = cleanStringArray(record.projects);
	const sharedTerritories = cleanStringArray(record.shared_territories);
	if (territories?.length) scope.territories = territories;
	if (entities?.length) scope.entities = entities;
	if (projects?.length) scope.projects = projects;
	if (sharedTerritories?.length) scope.shared_territories = sharedTerritories;
	return scope;
}

export function normalizeLeaseMode(value: unknown): LeaseEnforcementMode {
	if (typeof value !== "string") return "shadow";
	const clean = value.trim().toLowerCase();
	if (clean === "off" || clean === "shadow" || clean === "required") return clean;
	return "shadow";
}

export function parseLeaseEnvelope(raw: string): { lease?: BrainLease; error?: string } {
	try {
		const bytes = new TextEncoder().encode(raw).byteLength;
		if (bytes > MAX_LEASE_HEADER_BYTES) return { error: "lease header too large" };
		const parsed = parseJsonOrBase64Url(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "lease must be an object" };
		const record = parsed as Record<string, unknown>;

		const lease_id = cleanString(record.lease_id);
		const agent_id = cleanString(record.agent_id);
		const platformRaw = cleanString(record.platform, 64);
		const platform = platformRaw as LeasePlatform | undefined;
		const delegation_chain = cleanStringArray(record.delegation_chain, MAX_CHAIN_LENGTH);
		const capabilities = cleanStringArray(record.capabilities, 128) as LeaseCapability[] | undefined;
		const scope = validateScope(record.scope);
		const issued_at = cleanString(record.issued_at);
		const expires_at = cleanString(record.expires_at);

		if (!lease_id) return { error: "lease_id is required" };
		if (!agent_id) return { error: "agent_id is required" };
		if (!platform || !VALID_PLATFORMS.has(platform)) return { error: "platform is invalid" };
		if (!delegation_chain?.length) return { error: "delegation_chain is required" };
		if (!capabilities?.length) return { error: "capabilities are required" };
		if (!scope) return { error: "scope is required" };
		if (!issued_at || Number.isNaN(Date.parse(issued_at))) return { error: "issued_at is invalid" };
		if (!expires_at || Number.isNaN(Date.parse(expires_at))) return { error: "expires_at is invalid" };

		const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
			? record.metadata as Record<string, unknown>
			: undefined;

		return {
			lease: {
				lease_id,
				agent_id,
				platform,
				session_id: cleanString(record.session_id),
				run_id: cleanString(record.run_id),
				parent_lease_id: cleanString(record.parent_lease_id),
				delegation_chain,
				capabilities,
				scope,
				issued_at,
				expires_at,
				nonce: cleanString(record.nonce),
				process_id: cleanString(record.process_id),
				metadata
			}
		};
	} catch {
		return { error: "lease header is not valid JSON/base64url JSON" };
	}
}

export function createSyntheticRootLease(tenant: string, nowMs = Date.now()): BrainLease {
	return {
		lease_id: `lease_root_${tenant}_${nowMs}`,
		agent_id: "operator",
		platform: "system",
		delegation_chain: ["operator"],
		capabilities: [LEASE_CAPABILITIES.systemRoot],
		scope: {
			tenant,
			allow_all: true
		},
		issued_at: nowIso(nowMs),
		expires_at: nowIso(nowMs + 60 * 60 * 1000),
		metadata: {
			source: "api_key_backcompat",
			note: "Synthetic root lease for authenticated legacy clients; remove when lease mode becomes required."
		}
	};
}

export function resolveRequestLease(headers: Headers, tenant: string, mode: LeaseEnforcementMode, nowMs = Date.now()): LeaseResolution {
	const rawLease = headers.get(LEASE_HEADER);
	if (!rawLease) {
		if (mode === "required") {
			return { mode, source: "missing", error: "lease is required" };
		}
		return {
			mode,
			source: "synthetic_root",
			lease: createSyntheticRootLease(tenant, nowMs)
		};
	}

	const parsed = parseLeaseEnvelope(rawLease);
	if (parsed.error || !parsed.lease) {
		return { mode, source: "header", error: parsed.error || "invalid lease" };
	}
	return { mode, source: "header", lease: parsed.lease };
}

export function isLeaseExpired(lease: BrainLease, nowMs = Date.now()): boolean {
	return Date.parse(lease.expires_at) <= nowMs;
}

function hasCapability(lease: BrainLease, required: LeaseCapability): boolean {
	if (lease.capabilities.includes("*") || lease.capabilities.includes(LEASE_CAPABILITIES.systemRoot)) return true;
	if (lease.capabilities.includes(required)) return true;
	const [family] = required.split(".");
	return lease.capabilities.includes(`${family}.*` as LeaseCapability);
}

function setContainsAll(parent: string[] | undefined, requested: string[] | undefined): boolean {
	if (!requested?.length) return true;
	if (!parent?.length) return false;
	const parentSet = new Set(parent);
	return requested.every(item => parentSet.has(item));
}

function requestedScopeDoesNotWiden(parent: string[] | undefined, requested: string[] | undefined): boolean {
	if (!parent?.length) return true;
	if (!requested?.length) return false;
	return setContainsAll(parent, requested);
}

export function isScopeSubset(parent: LeaseScope, requested: LeaseScope): boolean {
	if (parent.allow_all) return parent.tenant === requested.tenant;
	if (parent.tenant !== requested.tenant) return false;
	return requestedScopeDoesNotWiden(parent.territories, requested.territories)
		&& requestedScopeDoesNotWiden(parent.entities, requested.entities)
		&& requestedScopeDoesNotWiden(parent.projects, requested.projects)
		&& requestedScopeDoesNotWiden(parent.shared_territories, requested.shared_territories)
		&& (requested.allow_all !== true);
}

function scopeAllowsTenant(lease: BrainLease, tenant: string): boolean {
	return lease.scope.tenant === tenant;
}

function isReadRequirement(requirement: LeaseRequirement): boolean {
	return requirement.operation.endsWith(".read") || requirement.operation.endsWith(".search");
}

function scopeAllowsSharedTenantRead(lease: BrainLease, tenant: string, requirement: LeaseRequirement): boolean {
	if (scopeAllowsTenant(lease, tenant)) return false;
	if (!isReadRequirement(requirement)) return false;
	if (!hasCapability(lease, LEASE_CAPABILITIES.crossTenantSharedRead)) return false;

	const territory = requirement.resource?.territory;
	if (!territory) return false;
	const sharedTerritories = lease.scope.shared_territories ?? [];
	return sharedTerritories.includes("*") || sharedTerritories.includes(territory);
}

function scopeAllowsResource(lease: BrainLease, requirement: LeaseRequirement): boolean {
	if (lease.scope.allow_all) return true;
	const territory = requirement.resource?.territory;
	if (lease.scope.territories?.length) {
		if (!territory) return false;
		if (!lease.scope.territories.includes(territory)) return false;
	}
	const entityId = requirement.resource?.entity_id;
	if (lease.scope.entities?.length) {
		if (!entityId) return false;
		if (!lease.scope.entities.includes(entityId)) return false;
	}
	const projectId = requirement.resource?.project_id;
	if (lease.scope.projects?.length) {
		if (!projectId) return false;
		if (!lease.scope.projects.includes(projectId)) return false;
	}
	return true;
}

export function createDelegatedLease(
	parent: BrainLease,
	requested: Omit<BrainLease, "parent_lease_id" | "delegation_chain" | "issued_at"> & { issued_at?: string },
	nowMs = Date.now()
): BrainLease {
	if (isLeaseExpired(parent, nowMs)) {
		throw new Error("parent lease expired");
	}
	if (!isScopeSubset(parent.scope, requested.scope)) {
		throw new Error("delegated scope exceeds parent scope");
	}
	for (const capability of requested.capabilities) {
		if (!hasCapability(parent, capability)) {
			throw new Error(`delegated capability exceeds parent scope: ${capability}`);
		}
	}
	const requestedExpiresAt = Date.parse(requested.expires_at);
	if (Number.isNaN(requestedExpiresAt)) {
		throw new Error("delegated lease expires_at is invalid");
	}
	if (requestedExpiresAt <= nowMs) {
		throw new Error("delegated lease already expired");
	}
	if (requestedExpiresAt > Date.parse(parent.expires_at)) {
		throw new Error("delegated lease outlives parent lease");
	}

	return {
		...requested,
		parent_lease_id: parent.lease_id,
		issued_at: requested.issued_at ?? nowIso(nowMs),
		delegation_chain: [...parent.delegation_chain, requested.agent_id].slice(-MAX_CHAIN_LENGTH)
	};
}

function actionIsWrite(action: unknown): boolean {
	if (typeof action !== "string") return false;
	return WRITE_ACTIONS.has(action);
}

function actionIsRead(action: unknown): boolean {
	if (typeof action !== "string") return false;
	return READ_ACTIONS.has(action);
}

export function resolveToolLeaseRequirement(toolName: string, args: Record<string, unknown> = {}): LeaseRequirement {
	const territory = typeof args.territory === "string" ? args.territory : undefined;
	const entity_id = typeof args.entity_id === "string" ? args.entity_id : undefined;
	const action = args.action;

	switch (toolName) {
		case "mind_wake":
			return args.depth === "full"
				? { operation: "memory.write", anyOf: [LEASE_CAPABILITIES.observeWrite], resource: { territory, entity_id } }
				: { operation: "memory.read", anyOf: [LEASE_CAPABILITIES.memoryRead], resource: { territory, entity_id } };
		case "mind_observe":
			return { operation: "observe.write", anyOf: [LEASE_CAPABILITIES.observeWrite], resource: { territory, entity_id } };
		case "mind_edit":
			return { operation: "observe.edit", anyOf: [LEASE_CAPABILITIES.observeWrite], resource: { territory, entity_id } };
		case "mind_link":
			return actionIsWrite(action)
				? { operation: "entity.link", anyOf: [LEASE_CAPABILITIES.entityLink, LEASE_CAPABILITIES.observeWrite], resource: { territory, entity_id } }
				: { operation: "memory.read", anyOf: [LEASE_CAPABILITIES.memoryRead], resource: { territory, entity_id } };
		case "mind_query":
		case "mind_search":
			return { operation: "memory.search", anyOf: [LEASE_CAPABILITIES.memorySearch, LEASE_CAPABILITIES.memoryRead], resource: { territory, entity_id } };
		case "mind_pull":
		case "mind_memory":
		case "mind_timeline":
		case "mind_territory":
			return { operation: "memory.read", anyOf: [LEASE_CAPABILITIES.memoryRead], resource: { territory, entity_id } };
		case "mind_entity":
		case "mind_project":
			return actionIsWrite(action)
				? { operation: "entity.write", anyOf: [LEASE_CAPABILITIES.entityWrite, LEASE_CAPABILITIES.entityLink], resource: { entity_id } }
				: { operation: "entity.read", anyOf: [LEASE_CAPABILITIES.entityRead], resource: { entity_id } };
		case "mind_agent":
			return actionIsWrite(action)
				? { operation: "agent.write", anyOf: [LEASE_CAPABILITIES.agentWrite], resource: { entity_id } }
				: { operation: "agent.read", anyOf: [LEASE_CAPABILITIES.agentRead], resource: { entity_id } };
		case "mind_identity":
		case "mind_anchor":
		case "mind_vow":
			return actionIsWrite(action)
				? { operation: "identity.write", anyOf: [LEASE_CAPABILITIES.identityWrite, LEASE_CAPABILITIES.identityPropose], resource: { entity_id } }
				: { operation: "identity.read", anyOf: [LEASE_CAPABILITIES.identityRead], resource: { entity_id } };
		case "mind_relate":
		case "mind_desire":
		case "mind_state":
			return actionIsWrite(action)
				? { operation: "relationship.write", anyOf: [LEASE_CAPABILITIES.relationshipWrite, LEASE_CAPABILITIES.stateWrite], resource: { entity_id } }
				: { operation: "relationship.read", anyOf: [LEASE_CAPABILITIES.relationshipRead, LEASE_CAPABILITIES.stateRead], resource: { entity_id } };
		case "mind_letter":
		case "mind_context":
			return actionIsWrite(action)
				? { operation: "letter.write", anyOf: [LEASE_CAPABILITIES.letterWrite], resource: { entity_id } }
				: { operation: "letter.read", anyOf: [LEASE_CAPABILITIES.letterRead], resource: { entity_id } };
		case "mind_consent":
		case "mind_trigger":
			return actionIsWrite(action)
				? { operation: "consent.write", anyOf: [LEASE_CAPABILITIES.consentWrite], resource: { entity_id } }
				: { operation: "consent.read", anyOf: [LEASE_CAPABILITIES.consentRead], resource: { entity_id } };
		case "mind_task":
			return actionIsWrite(action)
				? { operation: "task.write", anyOf: [LEASE_CAPABILITIES.taskWrite], resource: { entity_id } }
				: { operation: "task.read", anyOf: [LEASE_CAPABILITIES.taskRead], resource: { entity_id } };
		case "mind_runtime":
			return action === "trigger"
				? { operation: "runtime.trigger", anyOf: [LEASE_CAPABILITIES.runtimeTrigger, LEASE_CAPABILITIES.runtimeWrite], resource: { entity_id } }
				: actionIsRead(action)
					? { operation: "runtime.read", anyOf: [LEASE_CAPABILITIES.runtimeRead], resource: { entity_id } }
					: { operation: "runtime.write", anyOf: [LEASE_CAPABILITIES.runtimeWrite], resource: { entity_id } };
		case "mind_skill":
			return actionIsWrite(action)
				? { operation: "skill.write", anyOf: [LEASE_CAPABILITIES.skillWrite], resource: { entity_id } }
				: { operation: "skill.read", anyOf: [LEASE_CAPABILITIES.skillRead], resource: { entity_id } };
		case "mind_wake_log":
		case "mind_dream":
		case "mind_subconscious":
		case "mind_maintain":
		case "mind_loop":
		case "mind_propose":
		case "mind_health":
			return actionIsWrite(action)
				? { operation: "memory.write", anyOf: [LEASE_CAPABILITIES.observeWrite], resource: { territory, entity_id } }
				: { operation: "memory.read", anyOf: [LEASE_CAPABILITIES.memoryRead], resource: { territory, entity_id } };
		default:
			return { operation: "tool.call", anyOf: [LEASE_CAPABILITIES.systemRoot], resource: { territory, entity_id } };
	}
}

export function authorizeLeaseForTool(
	lease: BrainLease | undefined,
	toolName: string,
	args: Record<string, unknown>,
	tenant: string,
	nowMs = Date.now()
): LeaseAuthorization {
	const requirement = resolveToolLeaseRequirement(toolName, args);

	if (!lease) {
		return { allowed: false, requirement, reason: "lease missing" };
	}
	if (isLeaseExpired(lease, nowMs)) {
		return { allowed: false, requirement, reason: "lease expired" };
	}
	const sameTenant = scopeAllowsTenant(lease, tenant);
	const sharedTenantRead = scopeAllowsSharedTenantRead(lease, tenant, requirement);
	if (!sameTenant && !sharedTenantRead) {
		return { allowed: false, requirement, reason: "lease tenant mismatch" };
	}
	const capabilityAllowed = requirement.anyOf.some(capability => hasCapability(lease, capability))
		|| (sharedTenantRead && hasCapability(lease, LEASE_CAPABILITIES.crossTenantSharedRead));
	if (!capabilityAllowed) {
		return { allowed: false, requirement, reason: "lease capability denied" };
	}
	if (!sharedTenantRead && !scopeAllowsResource(lease, requirement)) {
		return { allowed: false, requirement, reason: "lease scope denied" };
	}

	return { allowed: true, requirement };
}
