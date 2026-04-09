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

export function buildInitialRetrievalHints(observation: HintExtractionObservation): RetrievalHintArtifact[] {
	const hints = [
		...deriveQuotedPhraseHints(observation),
		...deriveTemporalHints(observation),
		...deriveEntityHints(observation)
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

	const rawTokens = String(input.query ?? "")
		.toLowerCase()
		.split(/[^a-z0-9_\-]+/)
		.map(token => token.trim())
		.filter(token => token.length >= 3);
	for (const token of rawTokens) out.add(token);

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

	for (const hint of hints) {
		const hintText = hint.hint_text.toLowerCase().trim();
		if (hintText.length < 4) continue;
		for (const term of queryTerms) {
			if (!term) continue;
			if (hintText === term || hintText.includes(term)) {
				matchedTerms.add(term);
				matchedTypes.add(hint.hint_type);
				weightedScore += (hint.weight * 0.7) + (hint.confidence * 0.3);
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
