import { describe, expect, it } from "vitest";

import {
	computeRetrievalHintMatch,
	deriveQueryHintTerms,
	RETRIEVAL_HINT_STORAGE_STRATEGY,
	STATE_SNAPSHOT_HINT_LANE,
	buildInitialRetrievalHints,
	createRetrievalHint,
	deriveAssistantResponseHints,
	deriveEntityHints,
	derivePreferenceHints,
	deriveQuotedPhraseHints,
	deriveRelationalContextHints,
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

	it("derives preference hints from preference tags and language cues", () => {
		const hints = derivePreferenceHints({
			id: "obs_pref",
			content: "I prefer deep work blocks and I love dark mode.",
			tags: ["preference: quiet mornings", "topic:workflow"]
		});
		const texts = hints.map(h => h.hint_text);

		expect(texts).toContain("quiet mornings");
		expect(texts.some(text => text.includes("deep work"))).toBe(true);
		expect(texts.some(text => text.includes("dark mode"))).toBe(true);
		expect(hints.every(h => h.hint_type === "preference_hint")).toBe(true);
	});

	it("derives assistant response hints only for assistant-authored observations", () => {
		const assistantHints = deriveAssistantResponseHints({
			id: "obs_asst",
			content: "Assistant: benchmark lane needs honest receipts and miss analysis.",
			summary: "recommend benchmark receipts",
			type: "assistant_response",
			tags: ["assistant"]
		});
		expect(assistantHints.length).toBeGreaterThan(0);
		expect(assistantHints.every(h => h.hint_type === "assistant_response_hint")).toBe(true);

		const userHints = deriveAssistantResponseHints({
			id: "obs_user",
			content: "I wrote this note myself about benchmarks.",
			type: "journal"
		});
		expect(userHints).toHaveLength(0);
	});

	it("derives relational context hints from territory and relational cues", () => {
		const hints = deriveRelationalContextHints({
			id: "obs_rel",
			content: "We had a conflict and then moved toward repair after the apology.",
			context: "relationship rupture and repair",
			territory: "us"
		});
		const texts = hints.map(h => h.hint_text);

		expect(texts).toContain("relationship");
		expect(texts).toContain("conflict");
		expect(texts).toContain("repair");
		expect(hints.every(h => h.hint_type === "relational_context_hint")).toBe(true);
	});

	it("builds initial hint pack with deduping", () => {
		const hints = buildInitialRetrievalHints({
			id: "obs_all",
			content: 'Assistant: Alice said "Never fake receipts." I prefer clear deltas.',
			created: "2026-04-09T12:34:56.000Z",
			entity_id: "entity_partner_1",
			type: "assistant_response",
			territory: "us"
		});

		const keyCount = new Set(hints.map(h => `${h.hint_type}::${h.hint_text.toLowerCase()}`)).size;
		expect(hints.length).toBe(keyCount);
		expect(hints.some(h => h.hint_type === "quoted_phrase_hint")).toBe(true);
		expect(hints.some(h => h.hint_type === "temporal_hint")).toBe(true);
		expect(hints.some(h => h.hint_type === "entity_hint")).toBe(true);
		expect(hints.some(h => h.hint_type === "preference_hint")).toBe(true);
		expect(hints.some(h => h.hint_type === "assistant_response_hint")).toBe(true);
		expect(hints.some(h => h.hint_type === "relational_context_hint")).toBe(true);
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

	it("keeps query-term fallback conservative when explicit signals already exist", () => {
		const terms = deriveQueryHintTerms({
			query: "What did Caroline do in April 2026?",
			proper_names: ["Caroline"],
			temporal: {
				years: [2026],
				months: [4]
			}
		});

		expect(terms).toContain("caroline");
		expect(terms).toContain("2026");
		expect(terms).toContain("april");
		expect(terms).not.toContain("what");
		expect(terms).not.toContain("did");
	});

	it("uses filtered raw query tokens only as a fallback", () => {
		const terms = deriveQueryHintTerms({
			query: "what happened about abstract memory retrieval here"
		});

		expect(terms).toContain("abstract");
		expect(terms).toContain("memory");
		expect(terms).toContain("retrieval");
		expect(terms).not.toContain("what");
		expect(terms).not.toContain("about");
		expect(terms).not.toContain("here");
	});

	it("weights quoted phrase hint matches higher than generic entity hints", () => {
		const terms = ["caroline"];
		const entity = computeRetrievalHintMatch([
			createRetrievalHint({
				observation_id: "obs_entity",
				hint_type: "entity_hint",
				hint_text: "caroline",
				confidence: 0.9,
				weight: 0.8
			})
		], terms);
		const quoted = computeRetrievalHintMatch([
			createRetrievalHint({
				observation_id: "obs_quote",
				hint_type: "quoted_phrase_hint",
				hint_text: "caroline",
				confidence: 0.9,
				weight: 0.8
			})
		], terms);

		expect(quoted.score).toBeGreaterThan(entity.score);
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

	it("defines state snapshot hint lane as reserved-only in sprint 3", () => {
		expect(STATE_SNAPSHOT_HINT_LANE.status).toBe("reserved");
		expect(STATE_SNAPSHOT_HINT_LANE.implemented).toBe(false);
		expect(STATE_SNAPSHOT_HINT_LANE.rules.length).toBeGreaterThan(0);
	});
});
