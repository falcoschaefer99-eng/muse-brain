import type { Observation } from "../types";
import type { QuerySignals, RetrievalProfile } from "./query-signals";
import type { HybridScoreBreakdown } from "./scoring";
import { clamp, unique } from "./utils";

export type RetrievalRerankMode = "off" | "heuristic" | "model";

export interface RetrievalRerankModelCandidate {
	id: string;
	territory: string;
	score: number;
	match_sources: string[];
	content: string;
	summary?: string;
	created?: string;
	score_breakdown?: HybridScoreBreakdown;
}

export interface RetrievalRerankModelInput {
	query: string;
	retrieval_profile: RetrievalProfile;
	query_signals: QuerySignals;
	candidates: RetrievalRerankModelCandidate[];
}

export interface RetrievalRerankModelDecision {
	id: string;
	/**
	 * Optional absolute score replacement (pre-clamp). If present, delta is
	 * ignored and derived from this absolute score.
	 */
	score?: number;
	/** Optional additive delta to apply to the candidate score. */
	delta?: number;
	reason?: string;
}

export type RetrievalRerankModelHook = (
	input: RetrievalRerankModelInput
) => Promise<RetrievalRerankModelDecision[]>;

export interface RetrievalRerankOptions {
	mode?: RetrievalRerankMode;
	top_n?: number;
	model_hook?: RetrievalRerankModelHook;
}

export interface RetrievalRerankTrace {
	id: string;
	base_rank: number;
	final_rank: number;
	base_score: number;
	final_score: number;
	delta_score: number;
	heuristic_delta: number;
	model_delta: number;
	reasons: string[];
}

export interface RetrievalRerankableResult {
	observation: Observation;
	territory: string;
	score: number;
	match_sources: string[];
	vector_similarity?: number;
	keyword_rank?: number;
	score_breakdown?: HybridScoreBreakdown;
	rerank_trace?: RetrievalRerankTrace;
}

export interface RetrievalRerankOutcome<T extends RetrievalRerankableResult> {
	results: T[];
	mode: RetrievalRerankMode;
	applied: boolean;
	traces: RetrievalRerankTrace[];
}

function defaultModeForProfile(profile: RetrievalProfile): RetrievalRerankMode {
	// Keep rerank opt-in by profile: benchmark lane enables heuristic by default.
	return profile === "benchmark" ? "heuristic" : "off";
}

function computeHeuristicDelta(
	result: RetrievalRerankableResult,
	querySignals: QuerySignals
): { delta: number; reasons: string[] } {
	const reasons: string[] = [];
	let delta = 0;
	const signalBreakdown = result.score_breakdown?.signals;

	const hasQuotedMatch = (signalBreakdown?.quoted_phrase_matches?.length ?? 0) > 0
		|| result.match_sources.includes("quoted_phrase");
	if (querySignals.quoted_phrases.length > 0 && hasQuotedMatch) {
		delta += 0.09;
		reasons.push("quoted_phrase_alignment");
	}

	const hasProperNameMatch = (signalBreakdown?.proper_name_matches?.length ?? 0) > 0
		|| result.match_sources.includes("proper_name")
		|| result.match_sources.includes("entity_hint");
	if (querySignals.proper_names.length > 0 && hasProperNameMatch) {
		delta += 0.07;
		reasons.push("proper_name_alignment");
	}

	if (querySignals.temporal.has_temporal_cue && (signalBreakdown?.temporal_matched || result.match_sources.includes("temporal_hint"))) {
		delta += 0.06;
		reasons.push("temporal_alignment");
	}

	if (querySignals.assistant_reference.detected && (signalBreakdown?.assistant_reference_matched || result.match_sources.includes("assistant_response_hint"))) {
		delta += 0.055;
		reasons.push("assistant_reference_alignment");
	}

	if (querySignals.territory.mentioned.length > 0) {
		if (querySignals.territory.mentioned.includes(result.territory)) {
			delta += 0.06;
			reasons.push("territory_focus_match");
		} else {
			delta -= 0.03;
			reasons.push("territory_focus_miss");
		}
	}

	if (querySignals.relational.detected) {
		const relationalLane = result.territory === "us"
			|| result.match_sources.includes("relational_context_hint");
		if (relationalLane) {
			const intensityScale = 0.6 + (querySignals.relational.intensity * 0.4);
			delta += 0.05 * intensityScale;
			reasons.push("relational_context_alignment");
		}
	}

	if (querySignals.emotional_state.detected) {
		const emotionalLane = result.territory === "emotional"
			|| result.territory === "self"
			|| result.territory === "us";
		if (emotionalLane) {
			delta += 0.03;
			reasons.push("emotional_context_alignment");
		}
	}

	if (querySignals.contradiction.detected && result.match_sources.includes("relational_context_hint")) {
		delta += 0.03;
		reasons.push("contradiction_context_alignment");
	}

	const multiSourceHits = ["vector", "keyword", "hint", "entity"].filter(source => result.match_sources.includes(source)).length;
	if (multiSourceHits >= 2) {
		delta += 0.015;
		reasons.push("multi_source_consensus");
	}

	return {
		delta: clamp(delta, -0.2, 0.28),
		reasons
	};
}

function synthesizeScoreBreakdown(
	profile: RetrievalProfile,
	querySignals: QuerySignals,
	baseScore: number
): HybridScoreBreakdown {
	return {
		profile,
		layer_a: {
			base_relevance: baseScore,
			vector_component: 0,
			keyword_component: 0,
			hint_component: 0,
			entity_component: 0,
			signal_boost: 0,
			adjusted_relevance: baseScore
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
			baseline: { relevance: 1, cognition: 0 },
			modifiers: [],
			total_delta: { relevance: 0, cognition: 0 },
			applied: { relevance: 1, cognition: 0 }
		},
		signals: {
			quoted_phrases: [...querySignals.quoted_phrases],
			proper_names: [...querySignals.proper_names],
			temporal_query: querySignals.temporal.has_temporal_cue,
			assistant_reference_query: querySignals.assistant_reference.detected,
			emotional_state_query: querySignals.emotional_state.detected,
			contradiction_query: querySignals.contradiction.detected,
			relational_query: querySignals.relational.detected,
			relational_intensity: querySignals.relational.intensity,
			territory_cues: [...querySignals.territory.mentioned],
			quoted_phrase_matches: [],
			proper_name_matches: [],
			temporal_matched: false,
			temporal_reasons: [],
			assistant_reference_matched: false
		}
	};
}

export async function applyRetrievalRerank<T extends RetrievalRerankableResult>(args: {
	query: string;
	retrieval_profile: RetrievalProfile;
	query_signals: QuerySignals;
	results: T[];
	options?: RetrievalRerankOptions;
}): Promise<RetrievalRerankOutcome<T>> {
	const modeRequested = args.options?.mode ?? defaultModeForProfile(args.retrieval_profile);
	if (modeRequested === "off" || args.results.length === 0) {
		return {
			results: args.results,
			mode: "off",
			applied: false,
			traces: []
		};
	}

	const effectiveMode: RetrievalRerankMode = modeRequested === "model" && !args.options?.model_hook
		? "heuristic"
		: modeRequested;
	const topN = clamp(
		args.options?.top_n ?? Math.min(Math.max(20, args.results.length), 120),
		5,
		200
	);

	const seeded = args.results
		.map((result, index) => ({
			result,
			base_rank: index + 1,
			base_score: result.score
		}))
		.sort((a, b) => b.base_score - a.base_score);
	const head = seeded.slice(0, topN);
	const tail = seeded.slice(topN);
	const headById = new Map<string, { result: T; base_rank: number; base_score: number }>(
		head.map(row => [row.result.observation.id, row])
	);

	const heuristicById = new Map<string, { delta: number; reasons: string[] }>();
	for (const row of head) {
		heuristicById.set(row.result.observation.id, computeHeuristicDelta(row.result, args.query_signals));
	}

	const modelById = new Map<string, { delta: number; reason?: string }>();
	let modelHookFailed = false;
	if (effectiveMode === "model" && args.options?.model_hook) {
		try {
			const decisions = await args.options.model_hook({
				query: args.query,
				retrieval_profile: args.retrieval_profile,
				query_signals: args.query_signals,
				candidates: head.map(row => ({
					id: row.result.observation.id,
					territory: row.result.territory,
					score: row.base_score,
					match_sources: row.result.match_sources,
					content: row.result.observation.content,
					summary: row.result.observation.summary,
					created: row.result.observation.created,
					score_breakdown: row.result.score_breakdown
				}))
			});

			for (const decision of decisions) {
				const target = headById.get(decision.id);
				if (!target) continue;
				const deltaFromAbsolute = Number.isFinite(decision.score)
					? Number(decision.score) - target.base_score
					: undefined;
				const deltaRaw = deltaFromAbsolute ?? (Number.isFinite(decision.delta) ? Number(decision.delta) : 0);
				modelById.set(decision.id, {
					delta: clamp(deltaRaw, -0.35, 0.35),
					reason: decision.reason
				});
			}
		} catch {
			// Optional lane — failures should not break retrieval path.
			modelHookFailed = true;
		}
	}

	// Keep deterministic composition order for analysis while preserving topN gate:
	// rerank-adjusted head first, untouched tail appended.
	// NOTE: tail items are intentionally not reranked (no heuristic/model delta);
	// they keep original scores by design so top_n remains a hard budget.
	const enriched = [...head, ...tail].map(row => {
		const id = row.result.observation.id;
		const heuristic = heuristicById.get(id);
		const model = modelById.get(id);
		const heuristicDelta = heuristic?.delta ?? 0;
		const modelDelta = model?.delta ?? 0;
		const finalScore = row.base_score + heuristicDelta + modelDelta;
		const reasons = unique([
			...(heuristic?.reasons ?? []),
			...(model?.reason ? [`model:${model.reason}`] : []),
			...(modeRequested === "model" && effectiveMode !== "model" ? ["model_hook_missing_fallback"] : []),
			...(modeRequested === "model" && effectiveMode === "model" && modelHookFailed ? ["model_hook_error_fallback"] : [])
		]);
		return {
			...row,
			heuristic_delta: heuristicDelta,
			model_delta: modelDelta,
			final_score: finalScore,
			reasons
		};
	});

	enriched.sort((a, b) => b.final_score - a.final_score);
	const finalRankById = new Map<string, number>();
	for (let i = 0; i < enriched.length; i++) {
		finalRankById.set(enriched[i].result.observation.id, i + 1);
	}

	const traces: RetrievalRerankTrace[] = [];
	for (const row of enriched) {
		const finalRank = finalRankById.get(row.result.observation.id) ?? row.base_rank;
		const delta = row.final_score - row.base_score;
		if (Math.abs(delta) < 1e-6) continue;
		traces.push({
			id: row.result.observation.id,
			base_rank: row.base_rank,
			final_rank: finalRank,
			base_score: row.base_score,
			final_score: row.final_score,
			delta_score: delta,
			heuristic_delta: row.heuristic_delta,
			model_delta: row.model_delta,
			reasons: row.reasons
		});
	}

	const finalResults = enriched.map(row => {
		const finalRank = finalRankById.get(row.result.observation.id);
		const rerankApplied = Math.abs(row.final_score - row.base_score) > 1e-6;
		const rerankMeta = {
			mode: effectiveMode,
			applied: rerankApplied,
			base_rank: row.base_rank,
			final_rank: finalRank,
			base_score: row.base_score,
			final_score: row.final_score,
			delta_score: row.final_score - row.base_score,
			heuristic_delta: row.heuristic_delta !== 0 ? row.heuristic_delta : undefined,
			model_delta: row.model_delta !== 0 ? row.model_delta : undefined,
			reasons: row.reasons
		};
		const baseBreakdown = row.result.score_breakdown
			?? (rerankApplied
				? synthesizeScoreBreakdown(args.retrieval_profile, args.query_signals, row.base_score)
				: undefined);
		const rerankBreakdown = baseBreakdown
			? { ...baseBreakdown, rerank: rerankMeta }
			: undefined;
		const rerankTrace = rerankApplied || row.reasons.length > 0
			? {
				id: row.result.observation.id,
				base_rank: row.base_rank,
				final_rank: finalRank ?? row.base_rank,
				base_score: row.base_score,
				final_score: row.final_score,
				delta_score: row.final_score - row.base_score,
				heuristic_delta: row.heuristic_delta,
				model_delta: row.model_delta,
				reasons: row.reasons
			}
			: undefined;

		const nextResult = {
			...row.result,
			score: row.final_score,
			score_breakdown: rerankBreakdown,
			rerank_trace: rerankTrace
		} as T;
		return nextResult;
	});

	return {
		results: finalResults,
		mode: effectiveMode,
		applied: traces.length > 0,
		traces
	};
}
