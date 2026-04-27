import { describe, expect, it, vi } from "vitest";
import { executeTool } from "../src/tools-v2/index";
import { handleTool as handleDeeperTool } from "../src/tools-v2/deeper";
import type { IdentityCore, Observation } from "../src/types";

function makeObservation(id: string, overrides: Partial<Observation> = {}): Observation {
	return {
		id,
		content: overrides.content ?? `observation ${id}`,
		territory: overrides.territory ?? "craft",
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
		last_accessed: overrides.last_accessed
	} as Observation;
}

function makeCore(id: string, overrides: Partial<IdentityCore> = {}): IdentityCore {
	return {
		id,
		type: "identity_core",
		name: overrides.name ?? `Core ${id}`,
		content: overrides.content ?? `Content for ${id}`,
		category: overrides.category ?? "creative",
		weight: overrides.weight ?? 1,
		created: overrides.created ?? "2026-04-01T00:00:00.000Z",
		last_reinforced: overrides.last_reinforced ?? "2026-04-01T00:00:00.000Z",
		reinforcement_count: overrides.reinforcement_count ?? 0,
		challenge_count: overrides.challenge_count ?? 0,
		evolution_history: overrides.evolution_history ?? [],
		linked_observations: overrides.linked_observations ?? [],
		charge: overrides.charge ?? [],
		somatic: overrides.somatic
	};
}

function stripUnconsciousEnvelope(result: any) {
	return Object.fromEntries(
		Object.entries(result).filter(([key]) => !key.startsWith("unconscious_") && key !== "register_note")
	);
}

describe("mind_unconscious wrapper", () => {
	it("defaults to patterns and keeps wrapper envelope keys authoritative", async () => {
		const state = {
			unconscious_register: "delegated-collision",
			unconscious_action: "delegated-collision",
			register_note: "delegated-collision",
			last_processed: "2026-04-27T00:00:00.000Z",
			hot_entities: [],
			memory_cascade: [],
			mood_inference: { suggested_mood: "quiet", confidence: 0.4, based_on: [] },
			orphans: []
		};
		const storage = {
			readSubconscious: vi.fn(async () => state)
		};

		const result = await handleDeeperTool("mind_unconscious", {}, { storage: storage as any });

		expect(result.unconscious_register).toBe("subconscious");
		expect(result.unconscious_action).toBe("patterns");
		expect(result.register_note).toContain("precomputed undercurrent");
		expect(result.last_processed).toBe("2026-04-27T00:00:00.000Z");
		expect(storage.readSubconscious).toHaveBeenCalledTimes(1);
	});

	it("returns a clear error for invalid actions", async () => {
		const result = await handleDeeperTool("mind_unconscious", {
			action: "sleepwalk"
		}, { storage: {} as any });

		expect(result.error).toMatch(/Unknown action: sleepwalk/);
		expect(result.error).toMatch(/dream, imagine, process, or patterns/);
	});

	it("preserves subconscious patterns output while adding an unconscious register", async () => {
		const state = {
			last_processed: "2026-04-27T00:00:00.000Z",
			hot_entities: [{ entity: "Falco", mention_count: 2, recent_charges: ["care"] }],
			memory_cascade: [{ pair: ["craft", "love"], count: 2 }],
			mood_inference: { suggested_mood: "warm", confidence: 0.7, based_on: ["love"] },
			orphans: []
		};
		const storage = {
			readSubconscious: vi.fn(async () => state)
		};

		const wrapped = await handleDeeperTool("mind_unconscious", {
			action: "patterns"
		}, { storage: storage as any });
		const legacy = await handleDeeperTool("mind_subconscious", {
			action: "patterns"
		}, { storage: storage as any });

		expect(wrapped.unconscious_register).toBe("subconscious");
		expect(wrapped.unconscious_action).toBe("patterns");
		expect(wrapped.register_note).toContain("precomputed undercurrent");
		expect(stripUnconsciousEnvelope(wrapped)).toEqual(legacy);
	});

	it("route args win over conflicting caller mode for dream action", async () => {
		const storage = {
			readTerritory: vi.fn(async () => []),
			readIdentityCores: vi.fn(async () => {
				throw new Error("imagine mode should not run");
			})
		};

		const result = await handleDeeperTool("mind_unconscious", {
			action: "dream",
			mode: "imagine",
			dream_mode: "emotional_chain",
			seed_territory: "craft"
		}, { storage: storage as any });

		expect(result.unconscious_register).toBe("dream");
		expect(result.dream).toBe("No memories to dream from.");
		expect(result.dream_mode).toBe("emotional_chain");
		expect(storage.readTerritory).toHaveBeenCalledWith("craft");
		expect(storage.readIdentityCores).not.toHaveBeenCalled();
	});

	it("delegates process through subconscious computation without changing payload", async () => {
		const writeSubconscious = vi.fn(async () => undefined);
		const storage = {
			readAllTerritories: vi.fn(async () => []),
			readRelationalState: vi.fn(async () => []),
			readLinks: vi.fn(async () => []),
			writeSubconscious
		};

		const result = await handleDeeperTool("mind_unconscious", {
			action: "process"
		}, { storage: storage as any });

		expect(result.unconscious_register).toBe("subconscious");
		expect(result.unconscious_action).toBe("process");
		expect(result.computed_now).toBe(true);
		expect(result.hot_entities).toEqual([]);
		expect(result.orphans).toEqual([]);
		expect(writeSubconscious).toHaveBeenCalledWith(expect.objectContaining({
			hot_entities: [],
			memory_cascade: [],
			orphans: []
		}));
	});

	it("routes dreams through the old dream engine without forcing memories to exist", async () => {
		const storage = {
			readTerritory: vi.fn(async () => [])
		};

		const result = await handleDeeperTool("mind_unconscious", {
			action: "dream",
			dream_mode: "emotional_chain",
			seed_territory: "craft",
			depth: 2
		}, { storage: storage as any });

		expect(result.unconscious_register).toBe("dream");
		expect(result.unconscious_action).toBe("dream");
		expect(result.register_note).toContain("associative drift");
		expect(result.dream).toBe("No memories to dream from.");
		expect(result.seed_territory).toBe("craft");
		expect(result.dream_mode).toBe("emotional_chain");
	});

	it("forms a real dream chain when memories resonate", async () => {
		const seed = makeObservation("obs_seed", {
			territory: "craft",
			content: "seed memory of blue fire",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: ["wonder"],
				somatic: "hands",
				grip: "present"
			}
		});
		const resonant = makeObservation("obs_resonant", {
			territory: "self",
			content: "resonant memory of wonder returning",
			texture: {
				salience: "active",
				vividness: "soft",
				charge: ["wonder"],
				somatic: "hands",
				grip: "loose"
			}
		});
		const territories: Record<string, Observation[]> = {
			craft: [seed],
			self: [resonant]
		};
		const writeTerritory = vi.fn(async (territory: string, observations: Observation[]) => {
			territories[territory] = observations;
		});
		const storage = {
			readTerritory: vi.fn(async (territory: string) => territories[territory] ?? []),
			writeTerritory,
			appendToTerritory: vi.fn(async () => undefined)
		};

		const result = await handleDeeperTool("mind_unconscious", {
			action: "dream",
			dream_mode: "emotional_chain",
			seed_territory: "craft",
			depth: 1
		}, { storage: storage as any });

		expect(result.unconscious_register).toBe("dream");
		expect(result.dream_mode).toBe("emotional_chain");
		expect(result.depth_achieved).toBeGreaterThanOrEqual(2);
		expect(result.dream_sequence.map((node: any) => node.id)).toEqual(["obs_seed", "obs_resonant"]);
		expect(result.texture_shifts).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "obs_resonant",
				territory: "self",
				field: "grip",
				from: "loose",
				to: "present"
			})
		]));
		expect(writeTerritory).toHaveBeenCalledWith("self", expect.arrayContaining([
			expect.objectContaining({
				id: "obs_resonant",
				texture: expect.objectContaining({ grip: "present" })
			})
		]));
	});

	it("routes imagination through the aggregate dispatcher and creates a craft observation", async () => {
		const appendToTerritory = vi.fn(async () => undefined);
		const storage = {
			readTerritory: vi.fn(async () => [
				makeObservation("obs_aesthetic", {
					content: "velvet pressure at the edge of knowing",
					texture: {
						salience: "active",
						vividness: "vivid",
						charge: ["wonder", "mischief"],
						grip: "present"
					}
				})
			]),
			readIdentityCores: vi.fn(async () => [
				makeCore("core_creative", {
					content: "Make the structure precise without killing the strangeness.",
					category: "creative"
				})
			]),
			appendToTerritory
		};

		const result = await executeTool("mind_unconscious", {
			action: "imagine",
			seed: "agent house",
			territory: "craft",
			mood: "feral"
		}, { storage: storage as any });

		expect(result.unconscious_register).toBe("imagination");
		expect(result.unconscious_action).toBe("imagine");
		expect(result.register_note).toContain("making what is not yet");
		expect(result.imagination_id).toMatch(/^imagine_/);
		expect(result.content).toContain("IMAGINATION:");
		expect(result.content).toContain("what if agent house");
		expect(result.note).toBe("I made something new. This didn't exist before.");
		expect(appendToTerritory).toHaveBeenCalledTimes(1);
		expect(appendToTerritory.mock.calls[0][0]).toBe("craft");
		expect(appendToTerritory.mock.calls[0][1]).toEqual(expect.objectContaining({
			id: result.imagination_id,
			territory: "craft",
			context: "Imagined from seed: agent house",
			mood: "feral",
			type: "imagination"
		}));
	});
});
