import { describe, expect, it } from "vitest";

import {
	computeRetrievalHintMatch,
	deriveQueryHintTerms,
	RETRIEVAL_HINT_STORAGE_STRATEGY,
	buildInitialRetrievalHints,
	createRetrievalHint,
	deriveEntityHints,
	deriveQuotedPhraseHints,
	deriveTemporalHints,
	normalizeRetrievalHintType,
	sanitizeHintText
} from "../src/retrieval/hints";

describe("retrieval hint schema", () => {
	it("normalizes valid hint types and rejects invalid values", () => {
		expect(normalizeRetrievalHintType("temporal_hint")).toBe("temporal_hint");
		expect(normalizeRetrievalHintType("  ENTITY_HINT ")).toBe("entity_hint");
		expect(normalizeRetrievalHintType("made_up_hint")).toBeUndefined();
	});

	it("sanitizes hint text and enforces max length", () => {
		expect(sanitizeHintText("  hello   world  ")).toBe("hello world");
		expect(sanitizeHintText("a".repeat(300), 10)).toBe("aaaaaaaaaa");
		expect(sanitizeHintText("   ")).toBe("");
	});

	it("creates bounded hint artifacts with deterministic timestamps", () => {
		const hint = createRetrievalHint({
			observation_id: "obs_1",
			hint_type: "entity_hint",
			hint_text: "  Alice   Jones  ",
			confidence: 5,
			weight: -2,
			now: "2026-04-09T00:00:00.000Z"
		});

		expect(hint.hint_text).toBe("Alice Jones");
		expect(hint.confidence).toBe(1);
		expect(hint.weight).toBe(0);
		expect(hint.created_at).toBe("2026-04-09T00:00:00.000Z");
		expect(hint.updated_at).toBe("2026-04-09T00:00:00.000Z");
		expect(hint.id.startsWith("hint_")).toBe(true);
	});
});

describe("retrieval hint derivation", () => {
	it("derives quoted phrase hints", () => {
		const hints = deriveQuotedPhraseHints({
			id: "obs_q",
			content: 'I said "build receipts, not vibes" and "build receipts, not vibes".'
		});

		expect(hints).toHaveLength(1);
		expect(hints[0].hint_type).toBe("quoted_phrase_hint");
		expect(hints[0].hint_text).toBe("build receipts, not vibes");
	});

	it("derives temporal hints from created timestamp", () => {
		const hints = deriveTemporalHints({
			id: "obs_t",
			content: "temporal",
			created: "2026-04-09T12:34:56.000Z"
		});
		const texts = hints.map(h => h.hint_text);

		expect(texts).toContain("2026");
		expect(texts).toContain("april");
		expect(texts).toContain("2026-04-09");
	});

	it("derives entity hints from entity_id + capitalized terms", () => {
		const hints = deriveEntityHints({
			id: "obs_e",
			content: "Discussed this with Alice Johnson and Rainer. Assistant said hello in Session 1.",
			entity_id: "entity_partner_1"
		});

		expect(hints.some(h => h.hint_text === "entity_partner_1")).toBe(true);
		expect(hints.some(h => h.hint_text === "Alice Johnson")).toBe(true);
		expect(hints.some(h => h.hint_text.toLowerCase() === "assistant")).toBe(false);
		expect(hints.some(h => h.hint_text.toLowerCase() === "session")).toBe(false);
	});

	it("builds initial hint pack with deduping", () => {
		const hints = buildInitialRetrievalHints({
			id: "obs_all",
			content: 'Alice said "Never fake receipts."',
			created: "2026-04-09T12:34:56.000Z",
			entity_id: "entity_partner_1"
		});

		const keyCount = new Set(hints.map(h => `${h.hint_type}::${h.hint_text.toLowerCase()}`)).size;
		expect(hints.length).toBe(keyCount);
		expect(hints.some(h => h.hint_type === "quoted_phrase_hint")).toBe(true);
		expect(hints.some(h => h.hint_type === "temporal_hint")).toBe(true);
		expect(hints.some(h => h.hint_type === "entity_hint")).toBe(true);
	});

	it("derives query hint terms and matches hint artifacts", () => {
		const terms = deriveQueryHintTerms({
			query: 'What happened in April 2026 with "memory palace"?',
			quoted_phrases: ["memory palace"],
			proper_names: ["Alice Johnson"],
			temporal: {
				years: [2026],
				months: [4]
			}
		});
		expect(terms).toContain("memory palace");
		expect(terms).toContain("alice johnson");
		expect(terms).toContain("2026");
		expect(terms).toContain("april");

		const hints = [
			createRetrievalHint({
				observation_id: "obs_1",
				hint_type: "temporal_hint",
				hint_text: "april",
				confidence: 0.9,
				weight: 0.8
			}),
			createRetrievalHint({
				observation_id: "obs_1",
				hint_type: "quoted_phrase_hint",
				hint_text: "memory palace",
				confidence: 0.9,
				weight: 0.8
			})
		];

		const matched = computeRetrievalHintMatch(hints, terms);
		expect(matched.score).toBeGreaterThan(0);
		expect(matched.matched_hint_types).toContain("temporal_hint");
		expect(matched.matched_hint_types).toContain("quoted_phrase_hint");
	});

	it("ignores short or substring-noise hints during matching", () => {
		const terms = deriveQueryHintTerms({
			query: "about sabrina and abstract memory"
		});
		const noisyHints = [
			createRetrievalHint({
				observation_id: "obs_n",
				hint_type: "entity_hint",
				hint_text: "ab",
				confidence: 1,
				weight: 1
			})
		];
		const matched = computeRetrievalHintMatch(noisyHints, terms);
		expect(matched.score).toBe(0);
		expect(matched.matched_terms).toHaveLength(0);
	});
});

describe("retrieval hint storage strategy", () => {
	it("declares sidecar-only, canonical-safe strategy", () => {
		expect(RETRIEVAL_HINT_STORAGE_STRATEGY.version).toBe("v1");
		expect(RETRIEVAL_HINT_STORAGE_STRATEGY.canonical_observations_unchanged).toBe(true);
		expect(RETRIEVAL_HINT_STORAGE_STRATEGY.postgres.table).toBe("retrieval_hints");
		expect(RETRIEVAL_HINT_STORAGE_STRATEGY.sqlite.kv_key).toBe("retrieval_hints");
	});
});
