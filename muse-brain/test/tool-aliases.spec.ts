import { describe, it, expect, vi } from "vitest";
import { executeTool } from "../src/tools-v2/index";

describe("tool alias dispatch", () => {
	it("routes mind_memory through the aggregate dispatcher", async () => {
		const observation = {
			id: "obs_dispatch",
			content: "dispatcher read consolidation payload",
			territory: "craft",
			created: "2026-04-27T00:00:00.000Z",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "present",
				charge_phase: "fresh"
			},
			access_count: 0
		};
		const storage = {
			findObservation: vi.fn(async (id: string) =>
				id === "obs_dispatch" ? { observation, territory: "craft" } : null
			),
			updateObservationAccess: vi.fn(async () => undefined),
			getTask: vi.fn(async () => null),
			findEntityById: vi.fn(async () => null),
			readLetters: vi.fn(async () => [])
		};

		const result = await executeTool("mind_memory", {
			action: "get",
			id: "obs_dispatch"
		}, { storage: storage as any });

		expect(result.found).toBe(true);
		expect(result.type).toBe("observation");
		expect(result.data.id).toBe("obs_dispatch");
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
