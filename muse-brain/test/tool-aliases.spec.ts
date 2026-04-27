import { describe, it, expect, vi } from "vitest";
import { executeTool } from "../src/tools-v2/index";

function observation(id: string, overrides: Record<string, any> = {}) {
	return {
		id,
		content: overrides.content ?? `content for ${id}`,
		territory: overrides.territory ?? "craft",
		created: overrides.created ?? "2026-04-27T00:00:00.000Z",
		texture: overrides.texture ?? {
			salience: "active",
			vividness: "vivid",
			charge: [],
			grip: "present",
			charge_phase: "fresh"
		},
		access_count: overrides.access_count ?? 0,
		...overrides
	};
}

describe("tool alias dispatch", () => {
	it("routes mind_memory get through the aggregate dispatcher with processing parity", async () => {
		const obs = observation("obs_dispatch", {
			content: "dispatcher read consolidation payload"
		});
		const storage = {
			findObservation: vi.fn(async (id: string) =>
				id === "obs_dispatch" ? { observation: obs, territory: "craft" } : null
			),
			updateObservationAccess: vi.fn(async () => undefined),
			createProcessingEntry: vi.fn(async () => undefined),
			incrementProcessingCount: vi.fn(async () => 2),
			advanceChargePhase: vi.fn(async () => ({ advanced: false })),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null),
			readLetters: vi.fn(async () => [])
		};

		const result = await executeTool("mind_memory", {
			action: "get",
			id: "obs_dispatch",
			process: true,
			processing_note: "dispatcher parity",
			charge: ["steady"]
		}, { storage: storage as any });

		expect(result.found).toBe(true);
		expect(result.type).toBe("observation");
		expect(result.data.id).toBe("obs_dispatch");
		expect(result.data.processing).toEqual(expect.objectContaining({
			recorded: true,
			processing_count: 2,
			phase_advanced: false
		}));
		expect(storage.createProcessingEntry).toHaveBeenCalledWith(expect.objectContaining({
			observation_id: "obs_dispatch",
			processing_note: "dispatcher parity",
			charge_at_processing: ["steady"]
		}));
	});

	it("routes mind_memory search through the aggregate dispatcher", async () => {
		const obs = observation("obs_search_dispatch", {
			content: "search dispatcher payload",
			created: new Date().toISOString()
		});
		const storage = {
			hybridSearch: vi.fn(async () => [{
				observation: obs,
				territory: "craft",
				score: 0.81,
				match_sources: ["keyword"]
			}]),
			findEntityById: vi.fn(async () => null),
			findEntityByName: vi.fn(async () => null)
		};

		const result = await executeTool("mind_memory", {
			action: "search",
			query: "dispatcher payload",
			limit: 1
		}, { storage: storage as any });

		expect(result.search_mode).toBe("hybrid");
		expect(result.count).toBe(1);
		expect(result.observations[0].id).toBe("obs_search_dispatch");
		expect(storage.hybridSearch).toHaveBeenCalledWith(expect.objectContaining({
			query: "dispatcher payload",
			limit: 1
		}));
	});

	it("routes mind_memory timeline through the aggregate dispatcher", async () => {
		const storage = {
			queryObservations: vi.fn(async () => [
				{ observation: observation("obs_later", { created: "2026-01-02T00:00:00.000Z" }), territory: "craft" },
				{ observation: observation("obs_earlier", { created: "2026-01-01T00:00:00.000Z" }), territory: "craft" }
			])
		};

		const result = await executeTool("mind_memory", {
			action: "timeline",
			territory: "craft",
			limit: 2
		}, { storage: storage as any });

		expect(result.search_mode).toBe("chronological");
		expect(result.observations.map((row: any) => row.id)).toEqual(["obs_earlier", "obs_later"]);
		expect(storage.queryObservations).toHaveBeenCalledWith(expect.objectContaining({
			territory: "craft"
		}));
	});

	it("routes mind_memory territory through the aggregate dispatcher", async () => {
		const obs = observation("obs_territory_dispatch");
		const storage = {
			readTerritory: vi.fn(async (territory: string) => territory === "craft" ? [obs] : [])
		};

		const result = await executeTool("mind_memory", {
			action: "territory",
			territory: "craft"
		}, { storage: storage as any });

		expect(result.territory).toBe("craft");
		expect(result.count).toBe(1);
		expect(result.observations[0].id).toBe("obs_territory_dispatch");
	});

	it("maps mind_write_letter to mind_letter with action=write", async () => {
		const appendLetter = vi.fn(async () => undefined);
		const storage = { appendLetter };

		const result = await executeTool("mind_write_letter", {
			to_context: "chat",
			content: "hello from legacy client"
		}, { storage: storage as any });

		expect(result.sent).toBe(true);
		expect(appendLetter).toHaveBeenCalledTimes(1);
	});

	it("maps mind_read_letters to mind_letter with action=read", async () => {
		const readLetters = vi.fn(async () => [{
			id: "letter_1",
			from_context: "rainer",
			to_context: "chat",
			content: "hi",
			timestamp: "2026-04-08T00:00:00.000Z",
			read: false,
			charges: [],
			letter_type: "personal"
		}]);
		const writeLetters = vi.fn(async () => undefined);
		const storage = { readLetters, writeLetters };

		const result = await executeTool("mind_read_letters", {
			context: "chat"
		}, { storage: storage as any });

		expect(result.count).toBe(1);
		expect(writeLetters).toHaveBeenCalledTimes(1);
	});

	it("maps mind_set_context to mind_context with action=set", async () => {
		const writeConversationContext = vi.fn(async () => undefined);
		const storage = { writeConversationContext };

		const result = await executeTool("mind_set_context", {
			summary: "context from legacy client"
		}, { storage: storage as any });

		expect(result.saved).toBe(true);
		expect(writeConversationContext).toHaveBeenCalledTimes(1);
	});
});
