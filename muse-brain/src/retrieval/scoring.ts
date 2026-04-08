// ============ RETRIEVAL SCORING (Sprint 1 gate hardening) ============
// Pure scoring helpers shared by postgres/sqlite hybridSearch implementations.

import type { Observation } from "../types";
import {
	computeQuerySignalBoosts,
	getRetrievalProfileConfig,
	type QuerySignals,
	type RetrievalProfile
} from "./query-signals";

const KEYWORD_MATCH_FLOOR = 0.35;

const GRIP_MULTIPLIER: Record<string, number> = {
	iron: 1.3,
	strong: 1.15,
	present: 1.0,
	loose: 0.9,
	dormant: 0.7
};

const CHARGE_PHASE_MULTIPLIER: Record<string, number> = {
	fresh: 1.3,
	active: 1.15,
	processing: 1.0,
	metabolized: 0.85
};

export interface HybridScoreBreakdown {
	profile: RetrievalProfile;
	layer_a: {
		base_relevance: number;
		vector_component: number;
		keyword_component: number;
		entity_component: number;
		signal_boost: number;
		adjusted_relevance: number;
	};
	layer_b: {
		base_multiplier: number;
		grip_multiplier: number;
		charge_phase_multiplier: number;
		novelty_multiplier: number;
		circadian_multiplier: number;
		weighted_multiplier: number;
	};
	signals: {
		quoted_phrases: string[];
		proper_names: string[];
		temporal_query: boolean;
		assistant_reference_query: boolean;
		quoted_phrase_matches: string[];
		proper_name_matches: string[];
		temporal_matched: boolean;
		temporal_reasons: string[];
		assistant_reference_matched: boolean;
	};
}

export interface HybridCandidateScoreInput {
	observation: Observation;
	territory: string;
	retrieval_profile: RetrievalProfile;
	query_signals: QuerySignals;
	max_keyword_rank: number;
	vector_similarity?: number;
	keyword_rank?: number;
	entity_matched?: boolean;
	novelty_score?: number;
	circadian_bias_matched?: boolean;
	min_similarity?: number;
}

export interface HybridCandidateScoreResult {
	score: number;
	match_sources: string[];
	score_breakdown: HybridScoreBreakdown;
}

function normalizeKeywordComponent(keywordRank: number | undefined, maxKeywordRank: number): number {
	if (keywordRank === undefined) return 0;
	if (maxKeywordRank <= 0) return KEYWORD_MATCH_FLOOR;
	return Math.max(0, keywordRank) / maxKeywordRank;
}

export function scoreHybridCandidate(input: HybridCandidateScoreInput): HybridCandidateScoreResult | null {
	const {
		observation,
		territory,
		retrieval_profile,
		query_signals,
		max_keyword_rank,
		vector_similarity,
		keyword_rank,
		entity_matched = false,
		novelty_score,
		circadian_bias_matched = false,
		min_similarity = 0.3
	} = input;

	const profileConfig = getRetrievalProfileConfig(retrieval_profile);
	const texture = observation.texture || {};
	const grip = texture.grip ?? "present";
	const chargePhase = texture.charge_phase ?? "processing";
	const noveltyScore = novelty_score ?? texture.novelty_score ?? 0.5;
	const matchSources: string[] = [];

	let baseRelevance = 0;
	let vectorComponent = 0;
	let keywordComponent = 0;
	let entityComponent = 0;

	if (vector_similarity !== undefined && keyword_rank !== undefined) {
		vectorComponent = vector_similarity * profileConfig.relevance_mix.vector;
		keywordComponent = normalizeKeywordComponent(keyword_rank, max_keyword_rank) * profileConfig.relevance_mix.keyword;
		baseRelevance = vectorComponent + keywordComponent;
		matchSources.push("vector", "keyword");
	} else if (vector_similarity !== undefined) {
		vectorComponent = vector_similarity;
		baseRelevance = vectorComponent;
		matchSources.push("vector");
	} else if (keyword_rank !== undefined) {
		keywordComponent = normalizeKeywordComponent(keyword_rank, max_keyword_rank);
		baseRelevance = keywordComponent;
		matchSources.push("keyword");
	} else if (entity_matched) {
		baseRelevance = profileConfig.entity_only_base;
	}

	if (entity_matched) {
		entityComponent += profileConfig.entity_match_boost;
		matchSources.push("entity");
	}

	const signalMatch = computeQuerySignalBoosts(
		query_signals,
		{
			content: observation.content,
			summary: observation.summary,
			context: observation.context,
			created: observation.created,
			type: observation.type,
			tags: observation.tags
		},
		profileConfig.query_signal_boosts
	);

	if (signalMatch.quoted_phrase_matches.length > 0) matchSources.push("quoted_phrase");
	if (signalMatch.proper_name_matches.length > 0) matchSources.push("proper_name");
	if (signalMatch.temporal_matched) matchSources.push("temporal");
	if (signalMatch.assistant_reference_matched) matchSources.push("assistant_reference");

	const adjustedRelevance = Math.max(
		0,
		(baseRelevance + entityComponent + signalMatch.total_boost) * profileConfig.layer_weights.relevance
	);
	if (adjustedRelevance <= 0) return null;

	const gripMultiplier = GRIP_MULTIPLIER[grip] ?? 1.0;
	const chargePhaseMultiplier = CHARGE_PHASE_MULTIPLIER[chargePhase] ?? 1.0;
	const noveltyMultiplier = noveltyScore > 0.7 && chargePhase !== "metabolized"
		? 1 + (noveltyScore - 0.5) * 0.5
		: 1.0;
	const circadianMultiplier = circadian_bias_matched ? 1.15 : 1.0;
	const baseMultiplier = gripMultiplier * chargePhaseMultiplier * noveltyMultiplier * circadianMultiplier;
	const weightedMultiplier = 1 + ((baseMultiplier - 1) * profileConfig.layer_weights.cognition);
	const score = adjustedRelevance * weightedMultiplier;

	if (score < min_similarity) return null;

	return {
		score,
		match_sources: Array.from(new Set(matchSources)),
		score_breakdown: {
			profile: retrieval_profile,
			layer_a: {
				base_relevance: baseRelevance,
				vector_component: vectorComponent,
				keyword_component: keywordComponent,
				entity_component: entityComponent,
				signal_boost: signalMatch.total_boost,
				adjusted_relevance: adjustedRelevance
			},
			layer_b: {
				base_multiplier: baseMultiplier,
				grip_multiplier: gripMultiplier,
				charge_phase_multiplier: chargePhaseMultiplier,
				novelty_multiplier: noveltyMultiplier,
				circadian_multiplier: circadianMultiplier,
				weighted_multiplier: weightedMultiplier
			},
			signals: {
				quoted_phrases: query_signals.quoted_phrases,
				proper_names: query_signals.proper_names,
				temporal_query: query_signals.temporal.has_temporal_cue,
				assistant_reference_query: query_signals.assistant_reference.detected,
				quoted_phrase_matches: signalMatch.quoted_phrase_matches,
				proper_name_matches: signalMatch.proper_name_matches,
				temporal_matched: signalMatch.temporal_matched,
				temporal_reasons: signalMatch.temporal_reasons,
				assistant_reference_matched: signalMatch.assistant_reference_matched
			}
		}
	};
}
