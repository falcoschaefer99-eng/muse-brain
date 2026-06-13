import { describe, expect, it } from "vitest";
import {
	LEASE_CAPABILITIES,
	authorizeLeaseForTool,
	createDelegatedLease,
	createSyntheticRootLease,
	isScopeSubset,
	parseLeaseEnvelope,
	resolveRequestLease,
	type BrainLease
} from "../src/security/leases";

const NOW = Date.parse("2026-05-11T12:00:00.000Z");

function parentLease(overrides: Partial<BrainLease> = {}): BrainLease {
	return {
		lease_id: "lease_parent",
		agent_id: "rainer",
		platform: "codex",
		session_id: "session_1",
		run_id: "run_1",
		delegation_chain: ["falco", "rainer"],
		capabilities: [
			LEASE_CAPABILITIES.memoryRead,
			LEASE_CAPABILITIES.memorySearch,
			LEASE_CAPABILITIES.observeWrite
		],
		scope: {
			tenant: "rainer",
			territories: ["craft", "episodic"],
			entities: ["agent:salem"]
		},
		issued_at: "2026-05-11T11:55:00.000Z",
		expires_at: "2026-05-11T13:00:00.000Z",
		...overrides
	};
}

function toBase64UrlJson(value: unknown): string {
	return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("agent lease protocol", () => {
	it("parses a JSON lease envelope safely", () => {
		const lease = parentLease();
		const parsed = parseLeaseEnvelope(JSON.stringify(lease));
		expect(parsed.error).toBeUndefined();
		expect(parsed.lease?.lease_id).toBe("lease_parent");
		expect(parsed.lease?.scope.tenant).toBe("rainer");
	});

	it("parses a base64url JSON lease envelope", () => {
		const lease = parentLease();
		const parsed = parseLeaseEnvelope(toBase64UrlJson(lease));
		expect(parsed.error).toBeUndefined();
		expect(parsed.lease?.lease_id).toBe("lease_parent");
	});

	it("rejects malformed or incomplete lease envelopes", () => {
		expect(parseLeaseEnvelope("{bad").error).toMatch(/valid JSON/);
		expect(parseLeaseEnvelope(JSON.stringify({ lease_id: "x" })).error).toBe("agent_id is required");
		expect(parseLeaseEnvelope("x".repeat(9000)).error).toBe("lease header too large");
	});

	it("creates a synthetic root lease for legacy authenticated clients in shadow mode", () => {
		const resolution = resolveRequestLease(new Headers(), "rainer", "shadow", NOW);
		expect(resolution.source).toBe("synthetic_root");
		expect(resolution.lease?.capabilities).toContain(LEASE_CAPABILITIES.systemRoot);
	});

	it("requires an explicit lease in required mode", () => {
		const resolution = resolveRequestLease(new Headers(), "rainer", "required", NOW);
		expect(resolution.source).toBe("missing");
		expect(resolution.error).toBe("lease is required");
	});

	it("permits delegated leases to narrow but not widen scope", () => {
		const parent = parentLease();
		expect(isScopeSubset(parent.scope, { tenant: "rainer", territories: ["craft"], entities: ["agent:salem"] })).toBe(true);
		expect(isScopeSubset(parent.scope, { tenant: "rainer", territories: ["self"] })).toBe(false);
		expect(isScopeSubset(parent.scope, { tenant: "rainer" })).toBe(false);

		const child = createDelegatedLease(parent, {
			lease_id: "lease_child",
			agent_id: "salem",
			platform: "codex",
			session_id: "session_1",
			run_id: "run_2",
			capabilities: [LEASE_CAPABILITIES.memoryRead],
			scope: { tenant: "rainer", territories: ["craft"], entities: ["agent:salem"] },
			expires_at: "2026-05-11T12:30:00.000Z"
		}, NOW);

		expect(child.parent_lease_id).toBe("lease_parent");
		expect(child.delegation_chain).toEqual(["falco", "rainer", "salem"]);

		expect(() => createDelegatedLease(parent, {
			lease_id: "lease_wide",
			agent_id: "salem",
			platform: "codex",
			capabilities: [LEASE_CAPABILITIES.identityWrite],
			scope: { tenant: "rainer", territories: ["craft"], entities: ["agent:salem"] },
			expires_at: "2026-05-11T12:30:00.000Z"
		}, NOW)).toThrow(/capability exceeds/);

		expect(() => createDelegatedLease(parent, {
			lease_id: "lease_long",
			agent_id: "salem",
			platform: "codex",
			capabilities: [LEASE_CAPABILITIES.memoryRead],
			scope: { tenant: "rainer", territories: ["craft"], entities: ["agent:salem"] },
			expires_at: "2026-05-11T14:00:00.000Z"
		}, NOW)).toThrow(/outlives parent/);

		expect(() => createDelegatedLease(parent, {
			lease_id: "lease_invalid_expiry",
			agent_id: "salem",
			platform: "codex",
			capabilities: [LEASE_CAPABILITIES.memoryRead],
			scope: { tenant: "rainer", territories: ["craft"], entities: ["agent:salem"] },
			expires_at: "not-a-date"
		}, NOW)).toThrow(/expires_at is invalid/);

		expect(() => createDelegatedLease(parentLease({ expires_at: "2026-05-11T11:59:59.000Z" }), {
			lease_id: "lease_from_dead_parent",
			agent_id: "salem",
			platform: "codex",
			capabilities: [LEASE_CAPABILITIES.memoryRead],
			scope: { tenant: "rainer", territories: ["craft"], entities: ["agent:salem"] },
			expires_at: "2026-05-11T12:30:00.000Z"
		}, NOW)).toThrow(/parent lease expired/);
	});

	it("authorizes reads and denies writes outside capability/scope", () => {
		const lease = createDelegatedLease(parentLease(), {
			lease_id: "lease_child",
			agent_id: "salem",
			platform: "codex",
			capabilities: [LEASE_CAPABILITIES.memoryRead],
			scope: { tenant: "rainer", territories: ["craft"], entities: ["agent:salem"] },
			expires_at: "2026-05-11T12:30:00.000Z"
		}, NOW);

		expect(authorizeLeaseForTool(lease, "mind_pull", { id: "obs_1", territory: "craft", entity_id: "agent:salem" }, "rainer", NOW).allowed).toBe(true);
		expect(authorizeLeaseForTool(lease, "mind_pull", { id: "obs_1" }, "rainer", NOW).reason).toBe("lease scope denied");
		expect(authorizeLeaseForTool(lease, "mind_observe", { territory: "craft" }, "rainer", NOW).allowed).toBe(false);
		expect(authorizeLeaseForTool(lease, "mind_query", { territory: "self" }, "rainer", NOW).allowed).toBe(false);
	});

	it("denies expired and cross-tenant leases", () => {
		const expired = parentLease({ expires_at: "2026-05-11T11:59:59.000Z" });
		expect(authorizeLeaseForTool(expired, "mind_pull", { id: "obs_1" }, "rainer", NOW).reason).toBe("lease expired");
		expect(authorizeLeaseForTool(parentLease(), "mind_pull", { id: "obs_1" }, "companion", NOW).reason).toBe("lease tenant mismatch");
	});

	it("allows cross-tenant reads only for explicit shared territories", () => {
		const lease = parentLease({
			capabilities: [LEASE_CAPABILITIES.crossTenantSharedRead],
			scope: {
				tenant: "rainer",
				shared_territories: ["craft"]
			}
		});

		expect(authorizeLeaseForTool(lease, "mind_query", { territory: "craft", query: "handoff" }, "companion", NOW).allowed).toBe(true);
		expect(authorizeLeaseForTool(lease, "mind_query", { territory: "self", query: "handoff" }, "companion", NOW).reason).toBe("lease tenant mismatch");
		expect(authorizeLeaseForTool(lease, "mind_query", { query: "handoff" }, "companion", NOW).reason).toBe("lease tenant mismatch");
		expect(authorizeLeaseForTool(lease, "mind_observe", { territory: "craft", content: "nope" }, "companion", NOW).reason).toBe("lease tenant mismatch");
	});

	it("documents that omitted top-level resource fields mean unrestricted resources within the lease tenant", () => {
		const lease = parentLease({
			capabilities: [LEASE_CAPABILITIES.memoryRead],
			scope: { tenant: "rainer" }
		});

		expect(authorizeLeaseForTool(lease, "mind_query", { territory: "self" }, "rainer", NOW).allowed).toBe(true);
	});

	it("supports family wildcards such as memory.*", () => {
		const lease = parentLease({
			capabilities: ["memory.*"],
			scope: { tenant: "rainer", territories: ["craft"] }
		});

		expect(authorizeLeaseForTool(lease, "mind_query", { territory: "craft" }, "rainer", NOW).allowed).toBe(true);
		expect(authorizeLeaseForTool(lease, "mind_pull", { id: "obs_1", territory: "craft" }, "rainer", NOW).allowed).toBe(true);
		expect(authorizeLeaseForTool(lease, "mind_pull", { id: "obs_1" }, "rainer", NOW).reason).toBe("lease scope denied");
		expect(authorizeLeaseForTool(lease, "mind_observe", { territory: "craft" }, "rainer", NOW).allowed).toBe(false);
	});

	it("maps mind_link writes to entity.link and full wake to write authority", () => {
		const linkLease = parentLease({
			capabilities: [LEASE_CAPABILITIES.entityLink],
			scope: { tenant: "rainer", territories: ["craft"] }
		});
		expect(authorizeLeaseForTool(linkLease, "mind_link", { action: "create", territory: "craft" }, "rainer", NOW).allowed).toBe(true);

		const readLease = parentLease({
			capabilities: [LEASE_CAPABILITIES.memoryRead],
			scope: { tenant: "rainer" }
		});
		expect(authorizeLeaseForTool(readLease, "mind_wake", { depth: "quick" }, "rainer", NOW).allowed).toBe(true);
		expect(authorizeLeaseForTool(readLease, "mind_wake", { depth: "full" }, "rainer", NOW).reason).toBe("lease capability denied");
	});

	it("root lease can call any tool in its tenant", () => {
		const root = createSyntheticRootLease("rainer", NOW);
		expect(authorizeLeaseForTool(root, "mind_identity", { action: "evolve" }, "rainer", NOW).allowed).toBe(true);
		expect(authorizeLeaseForTool(root, "mind_identity", { action: "evolve" }, "companion", NOW).allowed).toBe(false);
	});
});
