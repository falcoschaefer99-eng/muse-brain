import { generateId, getTimestamp } from "../helpers";

export const RETRIEVAL_HINT_TYPES = [
	"preference_hint",
	"assistant_response_hint",
	"temporal_hint",
	"entity_hint",
	"quoted_phrase_hint",
	"relational_context_hint",
	"contradiction_hint",
	"territory_salience_hint",
	"state_snapshot_hint"
] as const;

export type RetrievalHintType = typeof RETRIEVAL_HINT_TYPES[number];

export type RetrievalHintSource = "derived" | "manual" | "imported";

export interface RetrievalHintArtifact {
	id: string;
	observation_id: string;
	hint_type: RetrievalHintType;
	hint_text: string;
	confidence: number; // 0.0 - 1.0
	weight: number; // 0.0 - 1.0
	source: RetrievalHintSource;
	created_at: string;
	updated_at: string;
	metadata?: Record<string, unknown>;
}

export interface RetrievalHintStorageStrategy {
	version: "v1";
	canonical_observations_unchanged: true;
	postgres: {
		table: "retrieval_hints";
		primary_key: "id";
		foreign_key: "observation_id";
		indexes: string[];
	};
	sqlite: {
		kv_key: "retrieval_hints";
		indexes_in_memory: string[];
	};
	rules: string[];
}

export const RETRIEVAL_HINT_STORAGE_STRATEGY: RetrievalHintStorageStrategy = {
	version: "v1",
	canonical_observations_unchanged: true,
	postgres: {
		table: "retrieval_hints",
		primary_key: "id",
		foreign_key: "observation_id",
		indexes: [
			"(tenant_id, hint_type)",
			"(tenant_id, observation_id)",
			"GIN(hint_text_tsv)",
			"(tenant_id, confidence DESC)"
		]
	},
	sqlite: {
		kv_key: "retrieval_hints",
		indexes_in_memory: [
			"by_observation_id",
			"by_hint_type",
			"by_hint_token"
		]
	},
	rules: [
		"Derived hints are assistive retrieval surfaces only.",
		"Canonical observations remain source of truth.",
		"Hint generation must be deterministic and auditable by source fields.",
		"Hint payloads are bounded and sanitized before storage."
	]
};

const HINT_TYPE_SET = new Set<string>(RETRIEVAL_HINT_TYPES);

export function normalizeRetrievalHintType(value: unknown): RetrievalHintType | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return HINT_TYPE_SET.has(normalized) ? normalized as RetrievalHintType : undefined;
}

export function sanitizeHintText(raw: unknown, maxLength = 240): string {
	const text = String(raw ?? "")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return "";
	return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export interface CreateRetrievalHintInput {
	observation_id: string;
	hint_type: RetrievalHintType;
	hint_text: string;
	confidence?: number;
	weight?: number;
	source?: RetrievalHintSource;
	metadata?: Record<string, unknown>;
	now?: string;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

export function createRetrievalHint(input: CreateRetrievalHintInput): RetrievalHintArtifact {
	const now = input.now ?? getTimestamp();
	return {
		id: generateId("hint"),
		observation_id: input.observation_id,
		hint_type: input.hint_type,
		hint_text: sanitizeHintText(input.hint_text),
		confidence: clamp01(input.confidence ?? 0.75),
		weight: clamp01(input.weight ?? 0.5),
		source: input.source ?? "derived",
		created_at: now,
		updated_at: now,
		metadata: input.metadata
	};
}

export interface HintExtractionObservation {
	id: string;
	content: string;
	summary?: string;
	context?: string;
	mood?: string;
	territory?: string;
	type?: string;
	created?: string;
	entity_id?: string;
	tags?: string[];
}

function unique(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (!value || seen.has(value)) continue;
		seen.add(value);
		out.push(value);
	}
	return out;
}

const ENTITY_TERM_BLOCKLIST = new Set([
	"user",
	"assistant",
	"session",
	"question",
	"answer",
	"date",
	"today",
	"yesterday",
	"tomorrow",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday"
]);

const PREFERENCE_STOPWORDS = new Set([
	"this", "that", "with", "from", "into", "about", "really", "very", "just", "kind", "sort"
]);

const ASSISTANT_HINT_STOPWORDS = new Set([
	"the", "and", "that", "with", "from", "this", "what", "when", "where", "which", "who", "why", "how",
	"your", "you", "have", "has", "had", "been", "were", "would", "should", "could", "about", "into", "there", "here",
	"assistant", "rainer", "rook"
]);

function compactHintTokens(raw: string, minLength: number, stopwords: Set<string>): string[] {
	return unique(
		String(raw ?? "")
			.toLowerCase()
			.split(/[^a-z0-9_\-]+/)
			.map(token => token.trim())
			.filter(token => token.length >= minLength)
			.filter(token => !stopwords.has(token))
	);
}

export function deriveQuotedPhraseHints(observation: HintExtractionObservation): RetrievalHintArtifact[] {
	const quotes = unique(
		Array.from(observation.content.matchAll(/"([^"\n]{2,160})"/g))
			.map(match => sanitizeHintText(match[1], 160))
			.filter(Boolean)
	);

	return quotes.map(phrase =>
		createRetrievalHint({
			observation_id: observation.id,
			hint_type: "quoted_phrase_hint",
			hint_text: phrase,
			confidence: 0.92,
			weight: 0.7,
			metadata: { extraction: "quoted_phrase" }
		})
	);
}

export function deriveTemporalHints(observation: HintExtractionObservation): RetrievalHintArtifact[] {
	const created = observation.created ? new Date(observation.created) : undefined;
	if (!created || Number.isNaN(created.getTime())) return [];

	const year = String(created.getUTCFullYear());
	const month = created.toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toLowerCase();
	const day = created.toISOString().slice(0, 10);
	const temporalTokens = unique([year, month, day]);

	return temporalTokens.map(token =>
		createRetrievalHint({
			observation_id: observation.id,
			hint_type: "temporal_hint",
			hint_text: token,
			confidence: 0.95,
			weight: token === day ? 0.75 : 0.62,
			metadata: { extraction: "created_timestamp" }
		})
	);
}

export function deriveEntityHints(observation: HintExtractionObservation): RetrievalHintArtifact[] {
	const hints: RetrievalHintArtifact[] = [];

	if (observation.entity_id) {
		hints.push(createRetrievalHint({
			observation_id: observation.id,
			hint_type: "entity_hint",
			hint_text: observation.entity_id,
			confidence: 0.97,
			weight: 0.85,
			metadata: { extraction: "entity_id" }
		}));
	}

	const capitalizedTerms = unique(
		Array.from(observation.content.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g))
			.map(match => sanitizeHintText(match[0], 120))
			.filter(term => term.length >= 4)
			.filter(term => !ENTITY_TERM_BLOCKLIST.has(term.toLowerCase()))
			.filter(Boolean)
	).slice(0, 6);

	for (const term of capitalizedTerms) {
		hints.push(createRetrievalHint({
			observation_id: observation.id,
			hint_type: "entity_hint",
			hint_text: term,
			confidence: 0.66,
			weight: 0.42,
			metadata: { extraction: "capitalized_term" }
		}));
	}

	return hints;
}

export function derivePreferenceHints(observation: HintExtractionObservation): RetrievalHintArtifact[] {
	const hints: RetrievalHintArtifact[] = [];
	const candidates: string[] = [];
	const content = String(observation.content ?? "");
	const tags = Array.isArray(observation.tags) ? observation.tags : [];

	for (const tag of tags) {
		const normalized = String(tag ?? "").trim();
		const prefTag = normalized.match(/^(?:pref|preference|likes?|dislikes?|favorite)[:=]\s*(.+)$/i);
		if (prefTag?.[1]) candidates.push(prefTag[1]);
	}

	const preferencePatterns = [
		/\b(?:i|we)\s+(?:really\s+)?(?:like|love|prefer|enjoy|need|want)\s+([^.;\n]{3,120})/gi,
		/\b(?:i|we)\s+(?:do\s+not|don't|never)\s+(?:like|want|enjoy)\s+([^.;\n]{3,120})/gi,
		/\bmy\s+favorite\s+([^.;\n]{2,80})/gi
	];
	for (const pattern of preferencePatterns) {
		for (const match of content.matchAll(pattern)) {
			if (match[1]) candidates.push(match[1]);
		}
	}

	const normalizedCandidates = unique(
		candidates
			.map(raw => sanitizeHintText(raw, 120).toLowerCase())
			.map(raw => raw.replace(/^(?:to|for|about)\s+/, "").trim())
			.filter(Boolean)
			.filter(value => !PREFERENCE_STOPWORDS.has(value))
	).slice(0, 8);

	for (const text of normalizedCandidates) {
		hints.push(createRetrievalHint({
			observation_id: observation.id,
			hint_type: "preference_hint",
			hint_text: text,
			confidence: 0.82,
			weight: 0.62,
			metadata: { extraction: "preference_pattern" }
		}));
	}

	return hints;
}

function isAssistantAuthored(observation: HintExtractionObservation): boolean {
	const type = String(observation.type ?? "").toLowerCase();
	const context = String(observation.context ?? "").toLowerCase();
	const tags = (observation.tags ?? []).map(tag => String(tag).toLowerCase());
	const content = String(observation.content ?? "").trim().toLowerCase();

	if (/(assistant|reply|response)/.test(type)) return true;
	if (/(assistant|rainer|rook)/.test(context)) return true;
	if (tags.some(tag => /(assistant|ai|response|reply|rainer|rook)/.test(tag))) return true;
	if (/^(assistant|rainer|rook)\s*:/.test(content)) return true;
	return false;
}

export function deriveAssistantResponseHints(observation: HintExtractionObservation): RetrievalHintArtifact[] {
	if (!isAssistantAuthored(observation)) return [];

	const source = `${observation.content ?? ""}\n${observation.summary ?? ""}`;
	const keywordTokens = compactHintTokens(source, 5, ASSISTANT_HINT_STOPWORDS).slice(0, 10);
	const hints = keywordTokens.map(token =>
		createRetrievalHint({
			observation_id: observation.id,
			hint_type: "assistant_response_hint",
			hint_text: token,
			confidence: 0.74,
			weight: 0.58,
			metadata: { extraction: "assistant_keyword" }
		})
	);

	return hints;
}

const RELATIONAL_SIGNAL_CUES: Record<string, string[]> = {
	conflict: ["conflict", "argument", "fight", "rupture", "tension", "clash"],
	repair: ["repair", "reconcile", "apology", "forgive", "resolution", "made up"],
	grief: ["grief", "loss", "mourning", "sadness", "heartbroken", "hurt"],
	intimacy: ["intimacy", "vulnerable", "closeness", "yearning", "desire"],
	devotion: ["devotion", "care", "support", "commitment", "vow", "love"],
	trust: ["trust", "safety", "secure", "rely", "reliable"]
};

export function deriveRelationalContextHints(observation: HintExtractionObservation): RetrievalHintArtifact[] {
	const hints: RetrievalHintArtifact[] = [];
	const haystack = `${observation.content ?? ""}\n${observation.context ?? ""}\n${(observation.tags ?? []).join(" ")}`.toLowerCase();
	const territory = String(observation.territory ?? "").toLowerCase();

	const territoryHints = new Map<string, string>([
		["us", "relationship"],
		["kin", "family"],
		["emotional", "emotional-state"]
	]);
	const territoryHint = territoryHints.get(territory);
	if (territoryHint) {
		hints.push(createRetrievalHint({
			observation_id: observation.id,
			hint_type: "relational_context_hint",
			hint_text: territoryHint,
			confidence: 0.83,
			weight: 0.64,
			metadata: { extraction: "territory_context" }
		}));
	}

	for (const [signal, cues] of Object.entries(RELATIONAL_SIGNAL_CUES)) {
		if (cues.some(cue => haystack.includes(cue))) {
			hints.push(createRetrievalHint({
				observation_id: observation.id,
				hint_type: "relational_context_hint",
				hint_text: signal,
				confidence: 0.76,
				weight: 0.6,
				metadata: { extraction: "relational_cue" }
			}));
		}
	}

	return hints;
}

export const STATE_SNAPSHOT_HINT_LANE = {
	status: "reserved",
	implemented: false,
	rules: [
		"State snapshot hints are defined as a future lane only.",
		"No state-derived hints are generated in Sprint 3.",
		"Any future implementation must be opt-in and auditable."
	]
} as const;

export function buildInitialRetrievalHints(observation: HintExtractionObservation): RetrievalHintArtifact[] {
	const hints = [
		...deriveQuotedPhraseHints(observation),
		...deriveTemporalHints(observation),
		...deriveEntityHints(observation),
		...derivePreferenceHints(observation),
		...deriveAssistantResponseHints(observation),
		...deriveRelationalContextHints(observation)
	];

	const seen = new Set<string>();
	const deduped: RetrievalHintArtifact[] = [];
	for (const hint of hints) {
		const key = `${hint.hint_type}::${hint.hint_text.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(hint);
	}
	return deduped;
}

export interface QueryHintSignalsInput {
	query: string;
	quoted_phrases?: string[];
	proper_names?: string[];
	temporal?: {
		iso_dates?: string[];
		years?: number[];
		months?: number[];
	};
}

const QUERY_HINT_STOPWORDS = new Set([
	"the", "and", "for", "with", "from", "that", "this", "what", "when", "where", "which", "who", "whom", "why", "how",
	"did", "does", "do", "was", "were", "is", "are", "am", "be", "been", "being", "can", "could", "should", "would",
	"have", "has", "had", "my", "your", "their", "our", "his", "her", "its", "about", "into", "onto", "over", "under",
	"before", "after", "during", "between", "again", "also", "then", "than", "there", "here"
]);

export function deriveQueryHintTerms(input: QueryHintSignalsInput): string[] {
	const out = new Set<string>();
	const quoted = Array.isArray(input.quoted_phrases) ? input.quoted_phrases : [];
	const names = Array.isArray(input.proper_names) ? input.proper_names : [];
	const isoDates = Array.isArray(input.temporal?.iso_dates) ? input.temporal!.iso_dates! : [];
	const years = Array.isArray(input.temporal?.years) ? input.temporal!.years! : [];

	for (const phrase of quoted) {
		const clean = sanitizeHintText(phrase, 160).toLowerCase();
		if (clean) out.add(clean);
	}

	for (const name of names) {
		const clean = sanitizeHintText(name, 120).toLowerCase();
		if (clean) out.add(clean);
	}

	for (const value of isoDates) {
		const clean = sanitizeHintText(value, 20).toLowerCase();
		if (clean) out.add(clean);
	}

	for (const value of years) {
		if (Number.isFinite(value)) out.add(String(value));
	}

	const monthMap: Record<number, string> = {
		1: "january", 2: "february", 3: "march", 4: "april", 5: "may", 6: "june",
		7: "july", 8: "august", 9: "september", 10: "october", 11: "november", 12: "december"
	};
	const months = Array.isArray(input.temporal?.months) ? input.temporal!.months! : [];
	for (const month of months) {
		const token = monthMap[month];
		if (token) out.add(token);
	}

	// Fallback tokens are intentionally conservative to reduce broad/noisy hint matching.
	if (out.size === 0) {
		const rawTokens = String(input.query ?? "")
			.toLowerCase()
			.split(/[^a-z0-9_\-]+/)
			.map(token => token.trim())
			.filter(token => token.length >= 4)
			.filter(token => !QUERY_HINT_STOPWORDS.has(token))
			.slice(0, 12);
		for (const token of rawTokens) out.add(token);
	}

	return Array.from(out);
}

export interface RetrievalHintMatchResult {
	score: number;
	matched_terms: string[];
	matched_hint_types: RetrievalHintType[];
}

export function computeRetrievalHintMatch(
	hints: RetrievalHintArtifact[],
	queryTerms: string[]
): RetrievalHintMatchResult {
	if (!hints.length || !queryTerms.length) {
		return { score: 0, matched_terms: [], matched_hint_types: [] };
	}

	const matchedTerms = new Set<string>();
	const matchedTypes = new Set<RetrievalHintType>();
	let weightedScore = 0;
	const typeWeight: Record<RetrievalHintType, number> = {
		preference_hint: 0.75,
		assistant_response_hint: 0.75,
		temporal_hint: 0.9,
		entity_hint: 0.55,
		quoted_phrase_hint: 1.0,
		relational_context_hint: 0.7,
		contradiction_hint: 0.7,
		territory_salience_hint: 0.65,
		state_snapshot_hint: 0.65
	};

	for (const hint of hints) {
		const hintText = hint.hint_text.toLowerCase().trim();
		if (hintText.length < 4) continue;
		for (const term of queryTerms) {
			if (!term || term.length < 4) continue;
			if (hintText === term || hintText.includes(term)) {
				matchedTerms.add(term);
				matchedTypes.add(hint.hint_type);
				const base = (hint.weight * 0.7) + (hint.confidence * 0.3);
				weightedScore += base * (typeWeight[hint.hint_type] ?? 0.7);
				break;
			}
		}
	}

	if (matchedTerms.size === 0) {
		return { score: 0, matched_terms: [], matched_hint_types: [] };
	}

	// Normalize by term count and clamp to [0, 1].
	const normalized = Math.min(weightedScore / Math.max(queryTerms.length, 1), 1);
	return {
		score: normalized,
		matched_terms: Array.from(matchedTerms),
		matched_hint_types: Array.from(matchedTypes)
	};
}
