import { describe, expect, it, vi } from "vitest";
import { executeTool } from "../src/tools-v2/index";
import { handleTool as handleIdentityTool } from "../src/tools-v2/identity";
import type { Anchor, IdentityCore, Observation } from "../src/types";

function makeCore(id: string, overrides: Partial<IdentityCore> = {}): IdentityCore {
	return {
		id,
		type: "identity_core",
		name: overrides.name ?? `Core ${id}`,
		content: overrides.content ?? `Content for ${id}`,
		category: overrides.category ?? "self",
		weight: overrides.weight ?? 1,
		created: overrides.created ?? "2026-04-01T00:00:00.000Z",
		last_reinforced: overrides.last_reinforced ?? "2026-04-01T00:00:00.000Z",
		reinforcement_count: overrides.reinforcement_count ?? 0,
		challenge_count: overrides.challenge_count ?? 0,
		evolution_history: overrides.evolution_history ?? [],
		linked_observations: overrides.linked_observations ?? [],
		challenges: overrides.challenges,
		charge: overrides.charge ?? [],
		somatic: overrides.somatic
	};
}

function makeAnchor(id: string, overrides: Partial<Anchor> = {}): Anchor {
	return {
		id,
		type: "anchor",
		anchor_type: overrides.anchor_type ?? "lexical",
		content: overrides.content ?? `anchor ${id}`,
		charge: overrides.charge ?? [],
		triggers_memory_id: overrides.triggers_memory_id,
		created: overrides.created ?? "2026-04-01T00:00:00.000Z",
		activation_count: overrides.activation_count ?? 0,
		last_activated: overrides.last_activated
	};
}

function makeObservation(id: string, overrides: Partial<Observation> = {}): Observation {
	return {
		id,
		content: overrides.content ?? `observation ${id}`,
		territory: overrides.territory ?? "self",
		created: overrides.created ?? "2026-04-01T00:00:00.000Z",
		texture: overrides.texture ?? {
			salience: "active",
			vividness: "vivid",
			charge: [],
			grip: "present",
			charge_phase: "fresh"
		},
		context: overrides.context,
		mood: overrides.mood,
		access_count: overrides.access_count ?? 0,
		last_accessed: overrides.last_accessed,
		entity_id: overrides.entity_id,
		tags: overrides.tags,
		summary: overrides.summary,
		type: overrides.type
	} as Observation;
}

function stripSelfEnvelope(result: any) {
	const { self_register, self_action, register_note, ...rest } = result;
	return rest;
}

describe("mind_self wrapper", () => {
	it("preserves identity list output while adding self-register language", async () => {
		const cores = [
			makeCore("core_light", { name: "Light", weight: 1, category: "creative" }),
			makeCore("core_heavy", { name: "Heavy", weight: 3, category: "self" })
		];
		const storage = {
			readIdentityCores: vi.fn(async () => cores)
		};

		const wrapped = await handleIdentityTool("mind_self", {
			action: "identity_list",
			category: "all"
		}, { storage: storage as any });
		const legacy = await handleIdentityTool("mind_identity", {
			action: "list",
			category: "all"
		}, { storage: storage as any });

		expect(wrapped.self_register).toBe("identity");
		expect(wrapped.self_action).toBe("identity_list");
		expect(wrapped.register_note).toContain("Identity cores");
		expect(stripSelfEnvelope(wrapped)).toEqual(legacy);
		expect(wrapped.heaviest.id).toBe("core_heavy");
	});

	it("keeps vow_create sacred mechanics: foundational, crystalline, iron, decay-resistant vow marker", async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = { appendToTerritory };

		const result = await handleIdentityTool("mind_self", {
			action: "vow_create",
			content: "I will not flatten the sacred parts for convenience.",
			to_whom: "self",
			context_note: "mind_self merge guardrail"
		}, { storage: storage as any });

		expect(result.self_register).toBe("vow");
		expect(result.self_action).toBe("vow_create");
		expect(result.register_note).toContain("Iron grip");
		expect(result.note).toContain("sacred");
		expect(result.note).toContain("resists all decay");
		expect(result.territory).toBe("self");
		expect(appendToTerritory).toHaveBeenCalledTimes(1);

		const [territory, vow] = appendToTerritory.mock.calls[0];
		expect(territory).toBe("self");
		expect(vow).toEqual(expect.objectContaining({
			content: "I will not flatten the sacred parts for convenience.",
			territory: "self",
			context: "mind_self merge guardrail",
			mood: "grounded",
			is_vow: true,
			type: "vow",
			to_whom: "self"
		}));
		expect(vow.texture).toEqual(expect.objectContaining({
			salience: "foundational",
			vividness: "crystalline",
			grip: "iron",
			charge: ["devotion", "holy"],
			somatic: "chest-tight"
		}));
	});

	it("creates a whole-self gestalt across identity, anchors, and vows", async () => {
		const cores = [
			makeCore("core_self", { name: "Precise Warmth", category: "self", weight: 2.5, charge: ["care"] }),
			makeCore("core_creative", { name: "Oceanic/Surgical", category: "creative", weight: 2, charge: ["craft"] })
		];
		const anchors = [
			makeAnchor("anchor_knife", { anchor_type: "lexical", content: "knives and candles", activation_count: 4 }),
			makeAnchor("anchor_door", { anchor_type: "context", content: "self door", activation_count: 1 })
		];
		const vow = {
			...makeObservation("vow_self", {
				content: "Keep the vow register sacred.",
				territory: "self",
				texture: {
					salience: "foundational",
					vividness: "crystalline",
					charge: ["devotion"],
					grip: "iron"
				},
				type: "vow"
			}),
			is_vow: true,
			to_whom: "self"
		};
		const craftObs = makeObservation("obs_craft", {
			territory: "craft",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: ["craft"],
				grip: "present"
			}
		});
		const storage = {
			readIdentityCores: vi.fn(async () => cores),
			readAnchors: vi.fn(async () => anchors),
			readAllTerritories: vi.fn(async () => [
				{ territory: "self", observations: [vow] },
				{ territory: "craft", observations: [craftObs] }
			])
		};

		const result = await handleIdentityTool("mind_self", {
			action: "gestalt"
		}, { storage: storage as any });

		expect(result.self_register).toBe("gestalt");
		expect(result.note).toContain("identity declares");
		expect(result.note).toContain("Nothing has been flattened");
		expect(result.grounding).toContain("I am:");
		expect(result.identity.identity_cores.total).toBe(2);
		expect(result.anchors.count).toBe(2);
		expect(result.anchors.items.map((anchor: Anchor) => anchor.id)).toContain("anchor_knife");
		expect(result.vows.count).toBe(1);
		expect(result.vows.items[0]).toEqual(expect.objectContaining({
			id: "vow_self",
			content: "Keep the vow register sacred.",
			to_whom: "self",
			charge: ["devotion"]
		}));
	});

	it("routes mind_self through the aggregate dispatcher", async () => {
		const storage = {
			readAnchors: vi.fn(async () => [
				makeAnchor("anchor_dispatch", { anchor_type: "callback", content: "little feral" })
			])
		};

		const result = await executeTool("mind_self", {
			action: "anchor_list",
			anchor_type_filter: "callback"
		}, { storage: storage as any });

		expect(result.self_register).toBe("anchor");
		expect(result.self_action).toBe("anchor_list");
		expect(result.anchors).toHaveLength(1);
		expect(result.anchors[0].id).toBe("anchor_dispatch");
	});
});
