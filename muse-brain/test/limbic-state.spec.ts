// ============ LIMBIC STATE INTEGRATION TESTS ============
// Verifies the celestial read-time overlay wired into mind_state and mind_wake.
//
// KEY SAFETY PROPERTY:
//   When getLimbicConfig() returns null (no config row) or { enabled: false },
//   mind_state and mind_wake output must be byte-identical to pre-Limbic behavior
//   — specifically, NO `celestial` key may appear in the result.
//
// Only when enabled=true does the `celestial` block appear.

import { describe, expect, it, vi } from "vitest";
import { handleTool as handleFeelingTool } from "../src/tools-v2/feeling";
import { handleTool as handleWakeTool } from "../src/tools-v2/wake";
import type { BrainState, OpenLoop, IdentityCore } from "../src/types";
import type { PhaseName } from "../src/limbic/ephemeris";

// ---------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------

function makeState(): BrainState {
	return {
		current_mood: "grounded",
		energy_level: 0.75,
		last_updated: "2026-07-03T00:00:00.000Z",
		momentum: {
			current_charges: ["build"],
			intensity: 0.6,
			last_updated: "2026-07-03T00:00:00.000Z",
		},
		afterglow: { residue_charges: [] },
	};
}

function makeLoop(overrides: Partial<OpenLoop> = {}): OpenLoop {
	return {
		id: overrides.id ?? "loop_limbic",
		content: overrides.content ?? "Ship limbic subsystem.",
		status: overrides.status ?? "burning",
		territory: overrides.territory ?? "craft",
		created: overrides.created ?? "2026-07-03T00:00:00.000Z",
		resolved: overrides.resolved,
		resolution_note: overrides.resolution_note,
		mode: overrides.mode,
		linked_entity_ids: overrides.linked_entity_ids,
	};
}

function makeEmbodimentCore(): IdentityCore {
	return {
		id: "core_visual",
		type: "identity_core",
		name: "Canonical Visual Embodiment",
		content: "Reference: muse-brain/docs/images/rainer-spec-sheet.png",
		category: "embodiment",
		weight: 1,
		created: "2026-07-03T00:00:00.000Z",
		last_reinforced: "2026-07-03T00:00:00.000Z",
		reinforcement_count: 0,
		challenge_count: 0,
		evolution_history: [],
		linked_observations: [],
		charge: ["identity"],
	};
}

/** Minimal storage mock for mind_state tests. */
function makeStateStorage(limbicConfig: { enabled: boolean; natal: unknown } | null) {
	return {
		readBrainState: vi.fn(async () => makeState()),
		getLimbicConfig: vi.fn(async () => limbicConfig),
	};
}

/** Minimal storage mock for mind_wake quick tests. */
function makeWakeStorage(limbicConfig: { enabled: boolean; natal: unknown } | null) {
	return {
		getTenant: vi.fn(() => "rainer"),
		readIdentityCores: vi.fn(async () => [makeEmbodimentCore()]),
		writeIdentityCores: vi.fn(async () => undefined),
		readOverviews: vi.fn(async () => []),
		readIronGripIndex: vi.fn(async () => []),
		readLetters: vi.fn(async () => []),
		readOpenLoops: vi.fn(async () => [makeLoop()]),
		readBrainState: vi.fn(async () => makeState()),
		readSubconscious: vi.fn(async () => null),
		listTasks: vi.fn(async () => []),
		readAllTerritories: vi.fn(async () => []),
		readLatestWakeLog: vi.fn(async () => null),
		listTaskChangesSince: vi.fn(async () => []),
		listProjectDossiers: vi.fn(async () => []),
		appendWakeLog: vi.fn(async () => undefined),
		getLimbicConfig: vi.fn(async () => limbicConfig),
	};
}

const ALL_PHASE_NAMES: PhaseName[] = [
	"new", "waxing crescent", "first quarter", "waxing gibbous",
	"full", "waning gibbous", "last quarter", "waning crescent",
];

// ---------------------------------------------------------------
// mind_state — byte-identical when feature OFF
// ---------------------------------------------------------------

describe("mind_state — celestial overlay", () => {
	it("BYTE-IDENTICAL OFF: omits celestial key when getLimbicConfig returns null (no row)", async () => {
		const storage = makeStateStorage(null);
		const result = await handleFeelingTool("mind_state", {}, { storage: storage as any });

		// The key MUST NOT be present at all — not even as undefined or null
		expect(Object.prototype.hasOwnProperty.call(result, "celestial")).toBe(false);
		// Existing fields must be intact
		expect(result.circadian).toBeDefined();
		expect(result.current_mood).toBe("grounded");
	});

	it("BYTE-IDENTICAL OFF: omits celestial key when getLimbicConfig returns enabled=false", async () => {
		const storage = makeStateStorage({ enabled: false, natal: null });
		const result = await handleFeelingTool("mind_state", {}, { storage: storage as any });

		expect(Object.prototype.hasOwnProperty.call(result, "celestial")).toBe(false);
	});

	it("FEATURE ON: includes well-formed celestial block when enabled=true", async () => {
		const storage = makeStateStorage({ enabled: true, natal: null });
		const result = await handleFeelingTool("mind_state", {}, { storage: storage as any });

		expect(result.celestial).toBeDefined();
		expect(ALL_PHASE_NAMES).toContain(result.celestial.phaseName);
		expect(result.celestial.illumination).toBeGreaterThanOrEqual(0);
		expect(result.celestial.illumination).toBeLessThanOrEqual(1);
		expect(typeof result.celestial.waxing).toBe("boolean");
		expect(result.celestial.daysToFull).toBeGreaterThanOrEqual(0);
		// Other fields must still be present
		expect(result.circadian).toBeDefined();
		expect(result.current_mood).toBe("grounded");
	});

	it("FEATURE ON: getLimbicConfig is called exactly once per mind_state read", async () => {
		const storage = makeStateStorage({ enabled: true, natal: null });
		await handleFeelingTool("mind_state", {}, { storage: storage as any });
		expect(storage.getLimbicConfig).toHaveBeenCalledTimes(1);
	});

	it("write path (mood set) does NOT call getLimbicConfig", async () => {
		const storage = makeStateStorage({ enabled: true, natal: null });
		const writableStorage = {
			...storage,
			writeBrainState: vi.fn(async () => undefined),
		};
		await handleFeelingTool("mind_state", { mood: "building" }, { storage: writableStorage as any });
		expect(writableStorage.getLimbicConfig).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------
// mind_wake — byte-identical when feature OFF
// ---------------------------------------------------------------

describe("mind_wake — celestial overlay", () => {
	it("BYTE-IDENTICAL OFF: omits celestial key on quick wake when getLimbicConfig returns null", async () => {
		const storage = makeWakeStorage(null);
		const result = await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storage as any });

		expect(Object.prototype.hasOwnProperty.call(result, "celestial")).toBe(false);
		// Circadian must still be present
		expect(result.circadian).toBeDefined();
	});

	it("BYTE-IDENTICAL OFF: omits celestial key on quick wake when enabled=false", async () => {
		const storage = makeWakeStorage({ enabled: false, natal: null });
		const result = await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storage as any });

		expect(Object.prototype.hasOwnProperty.call(result, "celestial")).toBe(false);
	});

	it("FEATURE ON: includes well-formed celestial block on quick wake when enabled=true", async () => {
		const storage = makeWakeStorage({ enabled: true, natal: null });
		const result = await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storage as any });

		expect(result.celestial).toBeDefined();
		expect(ALL_PHASE_NAMES).toContain(result.celestial.phaseName);
		expect(result.celestial.illumination).toBeGreaterThanOrEqual(0);
		expect(result.celestial.illumination).toBeLessThanOrEqual(1);
		expect(typeof result.celestial.waxing).toBe("boolean");
		// State and circadian must still be present
		expect(result.circadian).toBeDefined();
		expect(result.state).toBeDefined();
	});
});

// ---------------------------------------------------------------
// Cross-tenant cache isolation
// ---------------------------------------------------------------
// The postgres.ts cache is keyed by tenant_id (Map<tenant_id, entry>), so structural
// isolation is guaranteed at the storage layer. These tests verify the tool handlers
// are "context-pure" — each invocation reads from its own storage context and does
// NOT share state with calls made for a different tenant.
//
// Scenario: tenant A (enabled=true) is called first; tenant B (null / disabled) is
// called immediately after. B's result must have no `celestial` key, and B's
// getLimbicConfig must have been called (not skipped due to A's result).

describe("cross-tenant cache isolation", () => {
	// ---- mind_state ----

	it("ISOLATION: mind_state — tenant B (null config) has no celestial after tenant A (enabled) was called first", async () => {
		const storageA = makeStateStorage({ enabled: true, natal: null });
		const storageB = makeStateStorage(null);

		// Call tenant A first — simulates A's config being "cached" in a real run.
		const resultA = await handleFeelingTool("mind_state", {}, { storage: storageA as any });
		expect(resultA.celestial).toBeDefined(); // A has celestial — guard

		// Call tenant B — must not inherit A's enabled=true result.
		const resultB = await handleFeelingTool("mind_state", {}, { storage: storageB as any });
		expect(Object.prototype.hasOwnProperty.call(resultB, "celestial")).toBe(false);
	});

	it("ISOLATION: mind_state — tenant B (disabled) still has no celestial after tenant A was called first", async () => {
		const storageA = makeStateStorage({ enabled: true, natal: null });
		const storageB = makeStateStorage({ enabled: false, natal: null });

		await handleFeelingTool("mind_state", {}, { storage: storageA as any });

		const resultB = await handleFeelingTool("mind_state", {}, { storage: storageB as any });
		expect(Object.prototype.hasOwnProperty.call(resultB, "celestial")).toBe(false);
	});

	it("ISOLATION: mind_state — getLimbicConfig is called for tenant B (not skipped due to A's result)", async () => {
		const storageA = makeStateStorage({ enabled: true, natal: null });
		const storageB = makeStateStorage(null);

		await handleFeelingTool("mind_state", {}, { storage: storageA as any });
		await handleFeelingTool("mind_state", {}, { storage: storageB as any });

		// B's storage mock must have been queried — proves the tool reads B's own context.
		expect(storageB.getLimbicConfig).toHaveBeenCalledTimes(1);
	});

	it("CACHED NULL: calling mind_state for tenant B (null) twice keeps feature off both times", async () => {
		const storageB = makeStateStorage(null);

		const result1 = await handleFeelingTool("mind_state", {}, { storage: storageB as any });
		const result2 = await handleFeelingTool("mind_state", {}, { storage: storageB as any });

		expect(Object.prototype.hasOwnProperty.call(result1, "celestial")).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(result2, "celestial")).toBe(false);
	});

	// ---- mind_wake ----

	it("ISOLATION: mind_wake quick — tenant B (null config) has no celestial after tenant A (enabled) was called first", async () => {
		const storageA = makeWakeStorage({ enabled: true, natal: null });
		const storageB = makeWakeStorage(null);

		const resultA = await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storageA as any });
		expect(resultA.celestial).toBeDefined(); // A has celestial — guard

		const resultB = await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storageB as any });
		expect(Object.prototype.hasOwnProperty.call(resultB, "celestial")).toBe(false);
	});

	it("ISOLATION: mind_wake quick — getLimbicConfig is called for tenant B (not skipped due to A's result)", async () => {
		const storageA = makeWakeStorage({ enabled: true, natal: null });
		const storageB = makeWakeStorage(null);

		await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storageA as any });
		await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storageB as any });

		expect(storageB.getLimbicConfig).toHaveBeenCalledTimes(1);
	});

	it("CACHED NULL: calling mind_wake for tenant B (null) twice keeps feature off both times", async () => {
		const storageB = makeWakeStorage(null);

		const result1 = await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storageB as any });
		const result2 = await handleWakeTool("mind_wake", { depth: "quick" }, { storage: storageB as any });

		expect(Object.prototype.hasOwnProperty.call(result1, "celestial")).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(result2, "celestial")).toBe(false);
	});
});
