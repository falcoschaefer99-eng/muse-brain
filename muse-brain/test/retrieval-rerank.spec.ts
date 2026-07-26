import { describe, expect, it } from "vitest";
import { extractQuerySignals } from "../src/retrieval/query-signals";
import { applyRetrievalRerank } from "../src/retrieval/rerank";
import type { HybridSearchResult } from "../src/storage/interface";

function makeResult(id: string, score: number, overrides?: Partial<HybridSearchResult>): HybridSearchResult {
	return {
		observation: {
			id,
			content: overrides?.observation?.content ?? "memory body",
			territory: overrides?.observation?.territory ?? "craft",
			created: "2026-04-10T00:00:00.000Z",
			texture: {
				salience: "active",
				vividness: "vivid",
				charge: [],
				grip: "present",
				charge_phase: "fresh"
			},
			access_count: 0
		},
		territory: overrides?.territory ?? "craft",
		score,
		match_sources: overrides?.match_sources ?? ["keyword"],
		score_breakdown: overrides?.score_breakdown
	};
}

describe("retrieval rerank", () => {
	it("returns early when rerank mode is off", async () => {
		const results: HybridSearchResult[] = [
			makeResult("obs_off", 0.66)
		];

		const reranked = await applyRetrievalRerank({
			query: "leave order untouched",
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals("leave order untouched"),
			results,
			options: { mode: "off" }
		});

		expect(reranked.mode).toBe("off");
		expect(reranked.applied).toBe(false);
		expect(reranked.traces).toEqual([]);
		expect(reranked.results).toBe(results);
	});

	it("returns early with mode off when result set is empty", async () => {
		const reranked = await applyRetrievalRerank({
			query: "nothing to rerank",
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals("nothing to rerank"),
			results: [],
			options: { mode: "heuristic" }
		});

		expect(reranked.mode).toBe("off");
		expect(reranked.applied).toBe(false);
		expect(reranked.results).toEqual([]);
		expect(reranked.traces).toEqual([]);
	});

	it("promotes quoted-phrase aligned candidates in heuristic mode", async () => {
		const querySignals = extractQuerySignals('find "memory palace" references');
		const results: HybridSearchResult[] = [
			makeResult("obs_a", 0.8, {
				match_sources: ["keyword"],
				score_breakdown: {
					profile: "benchmark",
					layer_a: {
						base_relevance: 0.8,
						vector_component: 0,
						keyword_component: 0.8,
						hint_component: 0,
						entity_component: 0,
						signal_boost: 0,
						adjusted_relevance: 0.8
					},
					layer_b: {
						base_multiplier: 1,
						grip_multiplier: 1,
						charge_phase_multiplier: 1,
						novelty_multiplier: 1,
						circadian_multiplier: 1,
						weighted_multiplier: 1
					},
					dynamic_weights: {
						baseline: { relevance: 1.2, cognition: 0.5 },
						modifiers: [],
						total_delta: { relevance: 0, cognition: 0 },
						applied: { relevance: 1.2, cognition: 0.5 }
					},
					signals: {
						quoted_phrases: ["memory palace"],
						proper_names: [],
						temporal_query: false,
						assistant_reference_query: false,
						emotional_state_query: false,
						contradiction_query: false,
						relational_query: false,
						relational_intensity: 0,
						territory_cues: [],
						quoted_phrase_matches: [],
						proper_name_matches: [],
						temporal_matched: false,
						temporal_reasons: [],
						assistant_reference_matched: false
					}
				}
			}),
			makeResult("obs_b", 0.79, {
				match_sources: ["keyword", "quoted_phrase"],
				score_breakdown: {
					profile: "benchmark",
					layer_a: {
						base_relevance: 0.79,
						vector_component: 0,
						keyword_component: 0.79,
						hint_component: 0,
						entity_component: 0,
						signal_boost: 0,
						adjusted_relevance: 0.79
					},
					layer_b: {
						base_multiplier: 1,
						grip_multiplier: 1,
						charge_phase_multiplier: 1,
						novelty_multiplier: 1,
						circadian_multiplier: 1,
						weighted_multiplier: 1
					},
					dynamic_weights: {
						baseline: { relevance: 1.2, cognition: 0.5 },
						modifiers: [],
						total_delta: { relevance: 0, cognition: 0 },
						applied: { relevance: 1.2, cognition: 0.5 }
					},
					signals: {
						quoted_phrases: ["memory palace"],
						proper_names: [],
						temporal_query: false,
						assistant_reference_query: false,
						emotional_state_query: false,
						contradiction_query: false,
						relational_query: false,
						relational_intensity: 0,
						territory_cues: [],
						quoted_phrase_matches: ["memory palace"],
						proper_name_matches: [],
						temporal_matched: false,
						temporal_reasons: [],
						assistant_reference_matched: false
					}
				}
			})
		];

		const reranked = await applyRetrievalRerank({
			query: 'find "memory palace" references',
			retrieval_profile: "benchmark",
			query_signals: querySignals,
			results,
			options: { mode: "heuristic", top_n: 10 }
		});

		expect(reranked.results[0].observation.id).toBe("obs_b");
		expect(reranked.traces.some(trace => trace.id === "obs_b" && trace.base_rank > trace.final_rank)).toBe(true);
	});

	it("falls back from model mode to heuristic when model hook is missing", async () => {
		const results: HybridSearchResult[] = [
			makeResult("obs_fallback_a", 0.8),
			makeResult("obs_fallback_b", 0.79, { match_sources: ["keyword", "quoted_phrase"] })
		];

		const reranked = await applyRetrievalRerank({
			query: 'find "memory palace" references',
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals('find "memory palace" references'),
			results,
			options: { mode: "model" }
		});

		expect(reranked.mode).toBe("heuristic");
		expect(reranked.results[0].observation.id).toBe("obs_fallback_b");
		expect(reranked.traces.some(trace => trace.reasons.includes("model_hook_missing_fallback"))).toBe(true);
	});

	it("swallows model hook failures and does not throw", async () => {
		const results: HybridSearchResult[] = [
			makeResult("obs_hook_throw", 0.61, { match_sources: ["keyword"] }),
			makeResult("obs_hook_throw_2", 0.6, { match_sources: ["keyword", "quoted_phrase"] })
		];

		const reranked = await applyRetrievalRerank({
			query: 'model hook throw path with "memory palace"',
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals('model hook throw path with "memory palace"'),
			results,
			options: {
				mode: "model",
				model_hook: async () => {
					throw new Error("model unavailable");
				}
			}
		});
		expect(reranked.mode).toBe("model");
		expect(reranked.applied).toBe(true);
		expect(reranked.traces.some(trace => trace.reasons.includes("model_hook_error_fallback"))).toBe(true);
	});

	it("supports model-assisted deltas when a hook is provided", async () => {
		const results: HybridSearchResult[] = [
			makeResult("obs_model_a", 0.7),
			makeResult("obs_model_b", 0.69)
		];

		const reranked = await applyRetrievalRerank({
			query: "model rerank",
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals("model rerank"),
			results,
			options: {
				mode: "model",
				model_hook: async () => [{ id: "obs_model_b", delta: 0.2, reason: "semantic-fit" }]
			}
		});

		expect(reranked.mode).toBe("model");
		expect(reranked.results[0].observation.id).toBe("obs_model_b");
		expect(reranked.traces.find(trace => trace.id === "obs_model_b")?.model_delta).toBeGreaterThan(0);
	});

	it("uses model absolute score decisions when score is provided", async () => {
		const results: HybridSearchResult[] = [
			makeResult("obs_abs_a", 0.82),
			makeResult("obs_abs_b", 0.81)
		];

		const reranked = await applyRetrievalRerank({
			query: "absolute score decision",
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals("absolute score decision"),
			results,
			options: {
				mode: "model",
				model_hook: async () => [{ id: "obs_abs_b", score: 1.05, reason: "absolute-score" }]
			}
		});

		const trace = reranked.traces.find(item => item.id === "obs_abs_b");
		expect(reranked.results[0].observation.id).toBe("obs_abs_b");
		expect(trace?.model_delta).toBeCloseTo(0.24, 5);
		expect(trace?.reasons).toContain("model:absolute-score");
	});

	it("populates score_breakdown.rerank on reranked results", async () => {
		const results: HybridSearchResult[] = [
			makeResult("obs_breakdown_a", 0.8, {
				match_sources: ["keyword"],
				score_breakdown: {
					profile: "benchmark",
					layer_a: {
						base_relevance: 0.8,
						vector_component: 0,
						keyword_component: 0.8,
						hint_component: 0,
						entity_component: 0,
						signal_boost: 0,
						adjusted_relevance: 0.8
					},
					layer_b: {
						base_multiplier: 1,
						grip_multiplier: 1,
						charge_phase_multiplier: 1,
						novelty_multiplier: 1,
						circadian_multiplier: 1,
						weighted_multiplier: 1
					},
					dynamic_weights: {
						baseline: { relevance: 1.2, cognition: 0.5 },
						modifiers: [],
						total_delta: { relevance: 0, cognition: 0 },
						applied: { relevance: 1.2, cognition: 0.5 }
					},
					signals: {
						quoted_phrases: ["memory palace"],
						proper_names: [],
						temporal_query: false,
						assistant_reference_query: false,
						emotional_state_query: false,
						contradiction_query: false,
						relational_query: false,
						relational_intensity: 0,
						territory_cues: [],
						quoted_phrase_matches: [],
						proper_name_matches: [],
						temporal_matched: false,
						temporal_reasons: [],
						assistant_reference_matched: false
					}
				}
			}),
			makeResult("obs_breakdown_b", 0.79, {
				match_sources: ["keyword", "quoted_phrase"],
				score_breakdown: {
					profile: "benchmark",
					layer_a: {
						base_relevance: 0.79,
						vector_component: 0,
						keyword_component: 0.79,
						hint_component: 0,
						entity_component: 0,
						signal_boost: 0,
						adjusted_relevance: 0.79
					},
					layer_b: {
						base_multiplier: 1,
						grip_multiplier: 1,
						charge_phase_multiplier: 1,
						novelty_multiplier: 1,
						circadian_multiplier: 1,
						weighted_multiplier: 1
					},
					dynamic_weights: {
						baseline: { relevance: 1.2, cognition: 0.5 },
						modifiers: [],
						total_delta: { relevance: 0, cognition: 0 },
						applied: { relevance: 1.2, cognition: 0.5 }
					},
					signals: {
						quoted_phrases: ["memory palace"],
						proper_names: [],
						temporal_query: false,
						assistant_reference_query: false,
						emotional_state_query: false,
						contradiction_query: false,
						relational_query: false,
						relational_intensity: 0,
						territory_cues: [],
						quoted_phrase_matches: ["memory palace"],
						proper_name_matches: [],
						temporal_matched: false,
						temporal_reasons: [],
						assistant_reference_matched: false
					}
				}
			})
		];

		const reranked = await applyRetrievalRerank({
			query: 'find "memory palace" references',
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals('find "memory palace" references'),
			results,
			options: { mode: "heuristic", top_n: 10 }
		});

		const rerankedEntry = reranked.results.find(row => row.observation.id === "obs_breakdown_b");
		expect(rerankedEntry?.score_breakdown?.rerank?.mode).toBe("heuristic");
		expect(rerankedEntry?.score_breakdown?.rerank?.applied).toBe(true);
		expect(rerankedEntry?.score_breakdown?.rerank?.reasons).toContain("quoted_phrase_alignment");
		expect(rerankedEntry?.score_breakdown?.rerank?.final_score).toBeCloseTo(rerankedEntry?.score ?? 0, 10);
	});

	it("applies territory mismatch penalty in heuristic mode", async () => {
		const reranked = await applyRetrievalRerank({
			query: "what happened in us territory",
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals("what happened in us territory"),
			results: [makeResult("obs_territory_miss", 0.7, { territory: "craft", match_sources: ["keyword"] })],
			options: { mode: "heuristic" }
		});

		expect(reranked.results[0].score).toBeCloseTo(0.67, 10);
		expect(reranked.traces[0].heuristic_delta).toBeCloseTo(-0.03, 10);
		expect(reranked.traces[0].reasons).toContain("territory_focus_miss");
	});

	it("does not mutate input result objects when reranking", async () => {
		const source: HybridSearchResult[] = [
			makeResult("obs_immutable_a", 0.8, { match_sources: ["keyword"] }),
			makeResult("obs_immutable_b", 0.79, { match_sources: ["keyword", "quoted_phrase"] })
		];
		const originalTopScore = source[0].score;

		const reranked = await applyRetrievalRerank({
			query: 'find "memory palace" references',
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals('find "memory palace" references'),
			results: source,
			options: { mode: "heuristic", top_n: 10 }
		});

		expect(reranked.results[0].observation.id).toBe("obs_immutable_b");
		expect(source[0].score).toBe(originalTopScore);
		expect(source[0]).not.toBe(reranked.results.find(row => row.observation.id === source[0].observation.id));
	});

	it("clamps model delta decisions to +/-0.35 boundaries", async () => {
		const results: HybridSearchResult[] = [
			makeResult("obs_clamp_a", 0.7),
			makeResult("obs_clamp_b", 0.69)
		];

		const reranked = await applyRetrievalRerank({
			query: "model clamp boundary",
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals("model clamp boundary"),
			results,
			options: {
				mode: "model",
				model_hook: async () => [
					{ id: "obs_clamp_a", delta: -0.9, reason: "strong-demotion" },
					{ id: "obs_clamp_b", delta: 0.9, reason: "strong-promotion" }
				]
			}
		});

		const traceA = reranked.traces.find(trace => trace.id === "obs_clamp_a");
		const traceB = reranked.traces.find(trace => trace.id === "obs_clamp_b");
		expect(traceA?.model_delta).toBeCloseTo(-0.35, 10);
		expect(traceB?.model_delta).toBeCloseTo(0.35, 10);
		expect(reranked.results[0].observation.id).toBe("obs_clamp_b");
	});

	it("emits rerank diagnostics even when score_breakdown is initially absent", async () => {
		const reranked = await applyRetrievalRerank({
			query: "memory palace",
			retrieval_profile: "benchmark",
			query_signals: extractQuerySignals('find "memory palace" references'),
			results: [
				makeResult("obs_diag_a", 0.7, { match_sources: ["keyword"] }),
				makeResult("obs_diag_b", 0.69, { match_sources: ["keyword", "quoted_phrase"] })
			],
			options: { mode: "heuristic" }
		});

		const winner = reranked.results.find(row => row.observation.id === "obs_diag_b");
		expect(winner?.rerank_trace).toBeDefined();
		expect(winner?.score_breakdown?.rerank?.applied).toBe(true);
		expect(winner?.score_breakdown?.rerank?.reasons).toContain("quoted_phrase_alignment");
	});
});
