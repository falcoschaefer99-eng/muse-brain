// ============ RETRIEVAL PROFILES + QUERY SIGNALS (Sprint 1) ============
// Layer A (relevance) helpers:
// - retrieval profile baselines
// - query signal extraction
// - first heuristic boost set

export type RetrievalProfile = "native" | "balanced" | "benchmark";

export interface QueryTemporalSignals {
	has_temporal_cue: boolean;
	iso_dates: string[];
	years: number[];
	months: number[]; // 1-12
	relative_cues: string[];
}

export interface QueryAssistantReference {
	detected: boolean;
	cues: string[];
}

export interface QuerySignals {
	quoted_phrases: string[];
	proper_names: string[];
	temporal: QueryTemporalSignals;
	assistant_reference: QueryAssistantReference;
}

export interface QuerySignalBoostConfig {
	quoted_phrase: number;
	proper_name: number;
	temporal: number;
	assistant_reference: number;
	max_total: number;
}

export interface RetrievalProfileConfig {
	name: RetrievalProfile;
	candidate_pool: {
		vector: number;
		keyword: number;
		entity: number;
	};
	relevance_mix: {
		vector: number;
		keyword: number;
	};
	layer_weights: {
		relevance: number;
		cognition: number;
	};
	hint_component_scale: number;
	entity_only_base: number;
	entity_match_boost: number;
	query_signal_boosts: QuerySignalBoostConfig;
}

export const DEFAULT_RETRIEVAL_PROFILE: RetrievalProfile = "native";

export const RETRIEVAL_PROFILE_CONFIGS: Record<RetrievalProfile, RetrievalProfileConfig> = {
	native: {
		name: "native",
		candidate_pool: { vector: 50, keyword: 30, entity: 20 },
		relevance_mix: { vector: 0.7, keyword: 0.3 },
		layer_weights: { relevance: 1.0, cognition: 1.0 },
		hint_component_scale: 0.06,
		entity_only_base: 0.5,
		entity_match_boost: 0.08,
		query_signal_boosts: {
			quoted_phrase: 0.16,
			proper_name: 0.1,
			temporal: 0.1,
			assistant_reference: 0.09,
			max_total: 0.42
		}
	},
	balanced: {
		name: "balanced",
		candidate_pool: { vector: 80, keyword: 50, entity: 30 },
		relevance_mix: { vector: 0.65, keyword: 0.35 },
		layer_weights: { relevance: 1.1, cognition: 0.8 },
		hint_component_scale: 0.08,
		entity_only_base: 0.52,
		entity_match_boost: 0.1,
		query_signal_boosts: {
			quoted_phrase: 0.18,
			proper_name: 0.12,
			temporal: 0.12,
			assistant_reference: 0.1,
			max_total: 0.5
		}
	},
	benchmark: {
		name: "benchmark",
		candidate_pool: { vector: 120, keyword: 80, entity: 40 },
		relevance_mix: { vector: 0.55, keyword: 0.45 },
		layer_weights: { relevance: 1.2, cognition: 0.5 },
		hint_component_scale: 0.1,
		entity_only_base: 0.55,
		entity_match_boost: 0.12,
		query_signal_boosts: {
			quoted_phrase: 0.2,
			proper_name: 0.14,
			temporal: 0.14,
			assistant_reference: 0.12,
			max_total: 0.6
		}
	}
};

export function normalizeRetrievalProfile(value: unknown): RetrievalProfile | undefined {
	if (typeof value !== "string") return undefined;
	const clean = value.trim().toLowerCase();
	if (clean === "native" || clean === "balanced" || clean === "benchmark") return clean;
	return undefined;
}

export function getRetrievalProfileConfig(profile: RetrievalProfile): RetrievalProfileConfig {
	return RETRIEVAL_PROFILE_CONFIGS[profile];
}

const MONTHS: Record<string, number> = {
	january: 1, jan: 1,
	february: 2, feb: 2,
	march: 3, mar: 3,
	april: 4, apr: 4,
	may: 5,
	june: 6, jun: 6,
	july: 7, jul: 7,
	august: 8, aug: 8,
	september: 9, sep: 9, sept: 9,
	october: 10, oct: 10,
	november: 11, nov: 11,
	december: 12, dec: 12
};

const PROPER_NAME_BLOCKLIST = new Set([
	"The", "A", "An", "And", "Or", "But",
	"What", "When", "Where", "Why", "How", "Who",
	"I", "You", "We", "They", "He", "She", "It",
	"Today", "Tomorrow", "Yesterday", "Last", "Next", "This"
]);

const RELATIVE_TEMPORAL_CUES = [
	"today",
	"yesterday",
	"tomorrow",
	"last week",
	"this week",
	"next week",
	"last month",
	"this month",
	"next month",
	"last year",
	"this year",
	"next year",
	"recent",
	"recently",
	"latest",
	"earlier"
];

function unique<T>(items: T[]): T[] {
	const out: T[] = [];
	const seen = new Set<T>();
	for (const item of items) {
		if (seen.has(item)) continue;
		seen.add(item);
		out.push(item);
	}
	return out;
}

function lowerIncludes(haystack: string, needle: string): boolean {
	return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function extractQuerySignals(query: string): QuerySignals {
	const raw = String(query ?? "");
	const lowered = raw.toLowerCase();

	const quoted_phrases = unique(
		Array.from(raw.matchAll(/"([^"\n]{2,160})"/g))
			.map(m => m[1].trim())
			.filter(Boolean)
	);

	const proper_names = unique(
		Array.from(raw.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g))
			.map(m => m[0].trim())
			.filter(name => !PROPER_NAME_BLOCKLIST.has(name))
			.filter(name => !MONTHS[name.toLowerCase()])
	);

	const iso_dates = unique(
		Array.from(lowered.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)).map(m => m[0])
	);
	const years = unique(
		Array.from(lowered.matchAll(/\b(?:19|20)\d{2}\b/g))
			.map(m => Number(m[0]))
			.filter(n => Number.isFinite(n))
	);
	const months = unique(
		Object.entries(MONTHS)
			.filter(([token]) => new RegExp(`\\b${token}\\b`, "i").test(raw))
			.map(([, month]) => month)
	);
	const relative_cues = RELATIVE_TEMPORAL_CUES.filter(cue => lowered.includes(cue));
	const has_temporal_cue = iso_dates.length > 0 || years.length > 0 || months.length > 0 || relative_cues.length > 0;

	const assistantCues: string[] = [];
	if (/\bwhat did you\b/i.test(raw)) assistantCues.push("what_did_you");
	if (/\b(?:you|assistant|ai|rainer|rook)\s+(?:said|told|wrote|replied|mentioned|recommended|answered)\b/i.test(raw)) {
		assistantCues.push("assistant_verb_reference");
	}
	if (/\byour\s+(?:response|answer|message|advice)\b/i.test(raw)) assistantCues.push("your_response_reference");
	if (/\bassistant\b/i.test(raw)) assistantCues.push("assistant_term");

	return {
		quoted_phrases,
		proper_names,
		temporal: {
			has_temporal_cue,
			iso_dates,
			years,
			months,
			relative_cues
		},
		assistant_reference: {
			detected: assistantCues.length > 0,
			cues: unique(assistantCues)
		}
	};
}

export interface SignalScorableObservation {
	content?: string;
	summary?: string;
	context?: string;
	created?: string;
	type?: string;
	tags?: string[];
}

export interface QuerySignalMatch {
	components: {
		quoted_phrase: number;
		proper_name: number;
		temporal: number;
		assistant_reference: number;
	};
	total_boost: number;
	quoted_phrase_matches: string[];
	proper_name_matches: string[];
	temporal_matched: boolean;
	temporal_reasons: string[];
	assistant_reference_matched: boolean;
}

function isAssistantAuthoredObservation(observation: SignalScorableObservation): boolean {
	const type = String(observation.type ?? "").toLowerCase();
	const context = String(observation.context ?? "").toLowerCase();
	const content = String(observation.content ?? "").toLowerCase();
	const tags = (observation.tags ?? []).map(tag => tag.toLowerCase());

	if (/(assistant|reply|response)/.test(type)) return true;
	if (/(assistant|rainer|rook)/.test(context)) return true;
	if (tags.some(tag => /(assistant|ai|response|reply|rainer|rook)/.test(tag))) return true;
	if (/^(assistant|rainer|rook)\s*:/.test(content.trim())) return true;
	return false;
}

function matchTemporalSignals(temporal: QueryTemporalSignals, createdIso: string | undefined, nowMs: number): { matched: boolean; reasons: string[] } {
	if (!createdIso) return { matched: false, reasons: [] };
	const createdMs = Date.parse(createdIso);
	if (!Number.isFinite(createdMs)) return { matched: false, reasons: [] };

	const created = new Date(createdMs);
	const createdDate = created.toISOString().slice(0, 10);
	const reasons: string[] = [];

	if (temporal.iso_dates.includes(createdDate)) reasons.push("iso_date");
	if (temporal.years.includes(created.getUTCFullYear())) reasons.push("year");
	if (temporal.months.includes(created.getUTCMonth() + 1)) reasons.push("month");

	if (temporal.relative_cues.length > 0) {
		const ageDays = (nowMs - createdMs) / (24 * 60 * 60 * 1000);
		for (const cue of temporal.relative_cues) {
			if ((cue === "today" && ageDays <= 1.2)
				|| (cue === "yesterday" && ageDays > 0.8 && ageDays <= 2.2)
				|| (cue === "recent" && ageDays <= 14)
				|| (cue === "recently" && ageDays <= 21)
				|| (cue === "latest" && ageDays <= 10)
				|| (cue === "this week" && ageDays <= 7)
				|| (cue === "last week" && ageDays <= 14)
				|| (cue === "this month" && ageDays <= 31)
				|| (cue === "last month" && ageDays <= 62)
				|| (cue === "this year" && ageDays <= 366)
				|| (cue === "last year" && ageDays <= 730)) {
				reasons.push(`relative:${cue}`);
			}
		}
	}

	return { matched: reasons.length > 0, reasons: unique(reasons) };
}

export function computeQuerySignalBoosts(
	signals: QuerySignals,
	observation: SignalScorableObservation,
	config: QuerySignalBoostConfig,
	nowMs = Date.now()
): QuerySignalMatch {
	const haystack = `${observation.content ?? ""}\n${observation.summary ?? ""}\n${observation.context ?? ""}`.toLowerCase();

	const quoted_phrase_matches = signals.quoted_phrases.filter(phrase => lowerIncludes(haystack, phrase));
	const proper_name_matches = signals.proper_names.filter(name => {
		if (lowerIncludes(haystack, name)) return true;
		const parts = name.split(/\s+/).map(p => p.trim()).filter(Boolean);
		return parts.length > 1 && parts.every(part => lowerIncludes(haystack, part));
	});
	const temporalMatch = matchTemporalSignals(signals.temporal, observation.created, nowMs);
	const assistant_reference_matched = signals.assistant_reference.detected && isAssistantAuthoredObservation(observation);

	let components = {
		quoted_phrase: Math.min(config.quoted_phrase * quoted_phrase_matches.length, config.quoted_phrase * 2.5),
		proper_name: Math.min(config.proper_name * proper_name_matches.length, config.proper_name * 2.5),
		temporal: temporalMatch.matched ? config.temporal : 0,
		assistant_reference: assistant_reference_matched ? config.assistant_reference : 0
	};

	let total = components.quoted_phrase + components.proper_name + components.temporal + components.assistant_reference;
	if (total > config.max_total && total > 0) {
		const scale = config.max_total / total;
		components = {
			quoted_phrase: components.quoted_phrase * scale,
			proper_name: components.proper_name * scale,
			temporal: components.temporal * scale,
			assistant_reference: components.assistant_reference * scale
		};
		total = config.max_total;
	}

	return {
		components,
		total_boost: total,
		quoted_phrase_matches,
		proper_name_matches,
		temporal_matched: temporalMatch.matched,
		temporal_reasons: temporalMatch.reasons,
		assistant_reference_matched
	};
}
