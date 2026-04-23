import { describe, expect, it, vi } from "vitest";
import { handleTool as handleCommsTool } from "../src/tools-v2/comms";

// ============ HELPERS ============

function makeLetter(id: string, content: string, timestamp: string, read = false) {
	return {
		id,
		from_context: "rook",
		to_context: "chat",
		content,
		timestamp,
		read,
		letter_type: "handoff" as const
	};
}

// ============ TEST 6: Letter edge cases ============

describe("mind_letter action=search edge cases", () => {
	it("returns error when query is whitespace-only", async () => {
		const storage = {
			readLetters: vi.fn(async () => [])
		};

		const result = await handleCommsTool("mind_letter", {
			action: "search",
			context: "chat",
			query: "   "
		}, { storage: storage as any });

		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/query/i);
	});

	it("returns error when query is empty string", async () => {
		const storage = {
			readLetters: vi.fn(async () => [])
		};

		const result = await handleCommsTool("mind_letter", {
			action: "search",
			context: "chat",
			query: ""
		}, { storage: storage as any });

		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/query/i);
	});

	it("returns error when query is omitted entirely", async () => {
		const storage = {
			readLetters: vi.fn(async () => [])
		};

		const result = await handleCommsTool("mind_letter", {
			action: "search",
			context: "chat"
		}, { storage: storage as any });

		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/query/i);
	});
});

describe("mind_letter action=get edge cases", () => {
	it("returns not-found error when letter ID does not exist", async () => {
		const storage = {
			readLetters: vi.fn(async () => [
				makeLetter("letter_exists", "Some content", "2026-04-14T10:00:00.000Z")
			])
		};

		const result = await handleCommsTool("mind_letter", {
			action: "get",
			context: "chat",
			id: "letter_ghost"
		}, { storage: storage as any });

		expect(result.found).toBeUndefined();
		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/not found/i);
	});
});

describe("mind_letter action=list cursor behavior", () => {
	it("returns has_more:false when cursor points to last item", async () => {
		const letters = [
			makeLetter("letter_3", "third content", "2026-04-14T12:00:00.000Z"),
			makeLetter("letter_2", "second content", "2026-04-14T11:00:00.000Z"),
			makeLetter("letter_1", "first content", "2026-04-14T10:00:00.000Z")
		];

		const storage = {
			readLetters: vi.fn(async () => letters)
		};

		// cursor at letter_2 means we start after letter_2 — only letter_1 remains
		const result = await handleCommsTool("mind_letter", {
			action: "list",
			context: "chat",
			cursor: "letter_2",
			limit: 10
		}, { storage: storage as any });

		expect(result.has_more).toBe(false);
		expect(result.count).toBe(1);
		expect(result.letters[0].id).toBe("letter_1");
		expect(result.next_cursor).toBeNull();
	});

	it("returns has_more:false when cursor points to last item in the list", async () => {
		const letters = [
			makeLetter("letter_a", "first letter", "2026-04-14T10:00:00.000Z")
		];

		const storage = {
			readLetters: vi.fn(async () => letters)
		};

		// cursor at the only letter — nothing remains after it
		const result = await handleCommsTool("mind_letter", {
			action: "list",
			context: "chat",
			cursor: "letter_a",
			limit: 10
		}, { storage: storage as any });

		expect(result.has_more).toBe(false);
		expect(result.count).toBe(0);
		expect(result.next_cursor).toBeNull();
	});

	it("skips cursor entirely when cursor ID is not found (stale cursor behavior)", async () => {
		// When cursor doesn't match any letter, cursorIndex is -1 and slice is skipped.
		// The implementation returns ALL letters (no slice applied on invalid cursor).
		const letters = [
			makeLetter("letter_3", "third", "2026-04-14T12:00:00.000Z"),
			makeLetter("letter_2", "second", "2026-04-14T11:00:00.000Z"),
			makeLetter("letter_1", "first", "2026-04-14T10:00:00.000Z")
		];

		const storage = {
			readLetters: vi.fn(async () => letters)
		};

		const result = await handleCommsTool("mind_letter", {
			action: "list",
			context: "chat",
			cursor: "letter_stale_does_not_exist",
			limit: 10
		}, { storage: storage as any });

		// Stale cursor is silently skipped — all letters returned
		expect(result.count).toBe(3);
		expect(result.has_more).toBe(false);
	});
});

describe("mind_letter optimized storage lanes", () => {
	it("uses getLetterById lane when available for get action", async () => {
		const getLetterById = vi.fn(async (id: string, recipientContext: string) =>
			id === "letter_get_lane" && recipientContext === "chat"
				? makeLetter("letter_get_lane", "from fast lane", "2026-04-14T12:00:00.000Z", false)
				: null
		);
		const markLettersRead = vi.fn(async () => undefined);
		const storage = {
			getLetterById,
			markLettersRead,
			readLetters: vi.fn(async () => [])
		};

		const result = await handleCommsTool("mind_letter", {
			action: "get",
			context: "chat",
			id: "letter_get_lane"
		}, { storage: storage as any });

		expect(getLetterById).toHaveBeenCalledWith("letter_get_lane", "chat");
		expect(storage.readLetters).not.toHaveBeenCalled();
		expect(markLettersRead).toHaveBeenCalledWith(["letter_get_lane"]);
		expect(result.found).toBe(true);
	});

	it("uses listLettersPaged lane when available for list action", async () => {
		const listLettersPaged = vi.fn(async () => ({
			letters: [makeLetter("letter_fast", "fast lane", "2026-04-14T12:00:00.000Z")],
			has_more: false,
			next_cursor: null
		}));
		const storage = {
			listLettersPaged,
			readLetters: vi.fn(async () => [])
		};

		const result = await handleCommsTool("mind_letter", {
			action: "list",
			context: "chat",
			limit: 10
		}, { storage: storage as any });

		expect(listLettersPaged).toHaveBeenCalledTimes(1);
		expect(storage.readLetters).not.toHaveBeenCalled();
		expect(result.count).toBe(1);
		expect(result.letters[0].id).toBe("letter_fast");
	});

	it("uses listLettersPaged + markLettersRead lanes for read action", async () => {
		const listLettersPaged = vi.fn(async () => ({
			letters: [makeLetter("letter_read_lane", "read lane", "2026-04-14T12:00:00.000Z", false)],
			has_more: false,
			next_cursor: null
		}));
		const markLettersRead = vi.fn(async () => undefined);
		const storage = {
			listLettersPaged,
			markLettersRead,
			readLetters: vi.fn(async () => [])
		};

		const result = await handleCommsTool("mind_letter", {
			action: "read",
			context: "chat",
			limit: 10
		}, { storage: storage as any });

		expect(listLettersPaged).toHaveBeenCalledTimes(1);
		expect(markLettersRead).toHaveBeenCalledWith(["letter_read_lane"]);
		expect(storage.readLetters).not.toHaveBeenCalled();
		expect(result.count).toBe(1);
	});

	it("uses countLettersFromSince lane for cross-tenant write rate limit", async () => {
		const recipientStorage = {
			countLettersFromSince: vi.fn(async () => 200),
			appendLetter: vi.fn(async () => undefined),
			readLetters: vi.fn(async () => [])
		};
		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => recipientStorage as any),
			appendLetter: vi.fn(async () => undefined)
		};

		const result = await handleCommsTool("mind_letter", {
			action: "write",
			to: "companion",
			to_context: "chat",
			content: "Rate-limit check"
		}, { storage: storage as any });

		expect(recipientStorage.countLettersFromSince).toHaveBeenCalledTimes(1);
		expect(recipientStorage.readLetters).not.toHaveBeenCalled();
		expect(recipientStorage.appendLetter).not.toHaveBeenCalled();
		expect(result.error).toMatch(/daily cross-tenant letter limit/i);
	});

	it("sends cross-tenant letter when countLettersFromSince is below limit", async () => {
		const recipientStorage = {
			countLettersFromSince: vi.fn(async () => 199),
			appendLetter: vi.fn(async () => undefined),
			readLetters: vi.fn(async () => [])
		};
		const storage = {
			getTenant: () => "rainer",
			forTenant: vi.fn(() => recipientStorage as any),
			appendLetter: vi.fn(async () => undefined)
		};

		const result = await handleCommsTool("mind_letter", {
			action: "write",
			to: "companion",
			to_context: "chat",
			content: "Allowed send"
		}, { storage: storage as any });

		expect(recipientStorage.countLettersFromSince).toHaveBeenCalledTimes(1);
		expect(recipientStorage.appendLetter).toHaveBeenCalledTimes(1);
		expect(result.sent).toBe(true);
		expect(result.to_brain).toBe("companion");
	});

	it("accepts stale cursor on optimized listLettersPaged path", async () => {
		const listLettersPaged = vi.fn(async () => ({
			letters: [
				makeLetter("letter_cursor_a", "A", "2026-04-14T12:00:00.000Z"),
				makeLetter("letter_cursor_b", "B", "2026-04-14T11:00:00.000Z")
			],
			has_more: false,
			next_cursor: null
		}));
		const storage = {
			listLettersPaged,
			readLetters: vi.fn(async () => [])
		};

		const result = await handleCommsTool("mind_letter", {
			action: "list",
			context: "chat",
			cursor: "stale_cursor_token",
			limit: 10
		}, { storage: storage as any });

		expect(listLettersPaged).toHaveBeenCalledWith({
			context: "chat",
			limit: 10,
			cursor: "stale_cursor_token",
			unread_only: false,
			from: undefined,
			query: undefined
		});
		expect(result.count).toBe(2);
		expect(result.letters[0].id).toBe("letter_cursor_a");
	});
});
