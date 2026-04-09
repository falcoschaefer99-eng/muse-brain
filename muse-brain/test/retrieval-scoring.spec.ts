import { describe, expect, it } from "vitest";
import type { Observation } from "../src/types";
import { extractQuerySignals } from "../src/retrieval/query-signals";
import { scoreHybridCandidate } from "../src/retrieval/scoring";

function makeObservation(overrides: Partial<Observation> = {}): Observation {
	return {
		id: overrides.id ?? "obs_score",
		content: overrides.content ?? "Assistant: memory palace notes for Falco",
		territory: overrides.territory ?? "craft",
		created: overrides.created ?? "2026-04-09T06:30:00.000Z",
		texture: overrides.texture ?? {
			salience: "active",
			vividness: "vivid",
			charge: [],
			grip: "present",
			charge_phase: "fresh"
		},
		access_count: overrides.access_count ?? 0,
		context: overrides.context,
		mood: overrides.mood,
		last_accessed: overrides.last_accessed,
		links: overrides.links,
		summary: overrides.summary,
		type: overrides.type,
		tags: overrides.tags,
		entity_id: overrides.entity_id
	};
}

describe("retrieval scoring", () => {
	it("keeps keyword-only candidates alive when keyword normalization collapses to zero", () => {
		const observation = makeObservation({
			content: "plain keyword match",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "present",
				charge_phase: "processing"
			}
		});

		const scored = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: extractQuerySignals("plain keyword"),
			keyword_rank: 0,
			max_keyword_rank: 0,
			min_similarity: 0.3
		});

		expect(scored).not.toBeNull();
		expect(scored?.match_sources).toContain("keyword");
		expect(scored?.score_breakdown.layer_a.keyword_component).toBe(0.35);
	});

	it("separates Layer A relevance from Layer B cognition in the breakdown", () => {
		const observation = makeObservation({
			type: "assistant_response",
			tags: ["assistant"],
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: ["clarity"],
				grip: "iron",
				charge_phase: "fresh",
				novelty_score: 0.9
			}
		});

		const scored = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "balanced",
			query_signals: extractQuerySignals('What did you say about "memory palace" to Falco in April 2026?'),
			vector_similarity: 0.7,
			keyword_rank: 0.8,
			max_keyword_rank: 1,
			entity_matched: true,
			circadian_bias_matched: true,
			min_similarity: 0.01
		});

		expect(scored).not.toBeNull();
		expect(scored?.score_breakdown.layer_a.adjusted_relevance).toBeGreaterThan(
			scored?.score_breakdown.layer_a.base_relevance ?? 0
		);
		expect(scored?.score_breakdown.layer_b.base_multiplier).toBeGreaterThan(1);
		expect(scored?.score_breakdown.signals.quoted_phrase_matches).toContain("memory palace");
		expect(scored?.score_breakdown.signals.assistant_reference_matched).toBe(true);
	});

	it("reduces cognitive amplification in benchmark profile versus native", () => {
		const observation = makeObservation({
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "iron",
				charge_phase: "fresh",
				novelty_score: 0.9
			}
		});
		const signals = extractQuerySignals('What did you say about "memory palace"?');

		const native = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: signals,
			vector_similarity: 0.6,
			max_keyword_rank: 0,
			circadian_bias_matched: true,
			min_similarity: 0.01
		});
		const benchmark = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "benchmark",
			query_signals: signals,
			vector_similarity: 0.6,
			max_keyword_rank: 0,
			circadian_bias_matched: true,
			min_similarity: 0.01
		});

		expect(native).not.toBeNull();
		expect(benchmark).not.toBeNull();
		expect(native?.score_breakdown.layer_b.weighted_multiplier).toBeGreaterThan(
			benchmark?.score_breakdown.layer_b.weighted_multiplier ?? 0
		);
	});

	it("applies profile-specific hint component scaling", () => {
		const observation = makeObservation({
			content: "quiet note with no direct keyword overlap",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "present",
				charge_phase: "processing"
			}
		});
		const signals = extractQuerySignals("april memory");

		const native = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "native",
			query_signals: signals,
			hint_score: 1,
			max_keyword_rank: 0,
			min_similarity: 0.01
		});
		const benchmark = scoreHybridCandidate({
			observation,
			territory: "craft",
			retrieval_profile: "benchmark",
			query_signals: signals,
			hint_score: 1,
			max_keyword_rank: 0,
			min_similarity: 0.01
		});

		expect(native).not.toBeNull();
		expect(benchmark).not.toBeNull();
		expect((benchmark?.score_breakdown.layer_a.hint_component ?? 0)).toBeGreaterThan(
			native?.score_breakdown.layer_a.hint_component ?? 0
		);
	});
});
