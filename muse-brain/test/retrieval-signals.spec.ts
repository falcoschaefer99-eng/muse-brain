import { describe, expect, it } from "vitest";
import {
	extractQuerySignals,
	computeQuerySignalBoosts,
	getRetrievalProfileConfig,
	normalizeRetrievalProfile
} from "../src/retrieval/query-signals";

describe("retrieval query signals", () => {
	it("extracts quoted phrases, proper names, temporal cues, and assistant references", () => {
		const signals = extractQuerySignals('What did you say about "memory palace" to Falco in March 2026?');

		expect(signals.quoted_phrases).toContain("memory palace");
		expect(signals.proper_names).toContain("Falco");
		expect(signals.temporal.has_temporal_cue).toBe(true);
		expect(signals.temporal.months).toContain(3);
		expect(signals.temporal.years).toContain(2026);
		expect(signals.assistant_reference.detected).toBe(true);
	});

	it("computes heuristic boosts for matching observations", () => {
		const signals = extractQuerySignals('What did you say about "memory palace" to Falco in March 2026?');
		const profile = getRetrievalProfileConfig("balanced");

		const boost = computeQuerySignalBoosts(signals, {
			content: "Assistant: We discussed memory palace methods with Falco yesterday.",
			context: "assistant response",
			type: "assistant_response",
			created: "2026-03-12T10:00:00.000Z",
			tags: ["assistant", "response"]
		}, profile.query_signal_boosts, Date.parse("2026-03-14T00:00:00.000Z"));

		expect(boost.total_boost).toBeGreaterThan(0);
		expect(boost.quoted_phrase_matches).toContain("memory palace");
		expect(boost.proper_name_matches).toContain("Falco");
		expect(boost.temporal_matched).toBe(true);
		expect(boost.assistant_reference_matched).toBe(true);
	});

	it("normalizes retrieval profile values", () => {
		expect(normalizeRetrievalProfile("NATIVE")).toBe("native");
		expect(normalizeRetrievalProfile("benchmark")).toBe("benchmark");
		expect(normalizeRetrievalProfile("weird-profile")).toBeUndefined();
	});
});
