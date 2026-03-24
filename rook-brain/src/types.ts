// ============ TYPES ============
// Pure leaf node — no imports. All types used across the brain.

export interface Env {
	BRAIN_STORAGE: R2Bucket;  // R2 — retained during migration period
	DATABASE_URL: string;     // Neon Postgres — primary store post-migration
	API_KEY: string;
	AI?: Ai;                  // Workers AI — for embeddings generation (optional during migration)
}

export interface Texture {
	salience: string;
	vividness: string;
	charge: string[];
	somatic?: string;
	grip: string;
	charge_phase?: "fresh" | "active" | "processing" | "metabolized";
	novelty_score?: number;
	last_surfaced_at?: string;
}

export interface Observation {
	id: string;
	content: string;
	territory: string;
	created: string;
	texture: Texture;
	context?: string;
	mood?: string;
	last_accessed?: string;
	access_count: number;
	links?: string[];
	summary?: string;  // L0: truncated excerpt with grip/charge markers. NOT sanitized — escape before HTML rendering.
	type?: string;     // Observation subtype: "journal", "whisper", etc.
	tags?: string[];   // User-assigned tags
	entity_id?: string; // Optional link to a structured entity
}

// Phase B — not yet used by any tool
export interface TerritoryOverview {
	territory: string;
	observation_count: number;
	top_charges: string[];
	top_grip: string;
	recent_count: number;
	iron_count: number;
	iron_ids: string[];           // IDs of iron-grip observations
	last_activity: string;
	theme_summary: string;
	generated_at: string;
}

// Phase B — not yet used by any tool
export interface IronGripEntry {
	id: string;
	territory: string;
	summary: string;
	charges: string[];
	pull: number;
	updated: string;
}

export interface Link {
	id: string;
	source_id: string;
	target_id: string;
	resonance_type: string;
	strength: string;
	origin: string;
	created: string;
	last_activated: string;
}

export interface OpenLoop {
	id: string;
	content: string;
	status: string;
	territory: string;
	created: string;
	resolved?: string;
	resolution_note?: string;
}

export interface BrainState {
	current_mood: string;
	energy_level: number;
	last_updated: string;
	momentum: {
		current_charges: string[];
		intensity: number;
		last_updated: string;
	};
	afterglow: {
		residue_charges: string[];
		source_id?: string;
		fading_since?: string;
	};
}

export interface Letter {
	id: string;
	from_context: string;
	to_context: string;
	content: string;
	timestamp: string;
	read: boolean;
	charges?: string[];
}

export interface IdentityCore {
	id: string;
	type: string;
	name: string;
	content: string;
	category: string;
	weight: number;
	created: string;
	last_reinforced: string;
	reinforcement_count: number;
	challenge_count: number;
	evolution_history: Array<{
		from_name: string;
		from_content: string;
		to_name: string;
		to_content: string;
		reason: string;
		date: string;
	}>;
	linked_observations: string[];
	challenges?: Array<{
		description: string;
		observation_id?: string;
		date: string;
	}>;
	charge: string[];
	somatic?: string;
}

export interface Anchor {
	id: string;
	type: string;
	anchor_type: string;
	content: string;
	charge: string[];
	triggers_memory_id?: string;
	created: string;
	activation_count: number;
	last_activated?: string;
}

export interface Desire {
	id: string;
	type: string;
	want: string;
	category: string;
	intensity: string;
	somatic?: string;
	detail?: string;
	created: string;
	last_felt: string;
	times_surfaced: number;
}

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: any;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number;
	result?: any;
	error?: { code: number; message: string; data?: any };
}

export interface ParsedObservation {
	content: string;           // Cleaned content (syntax removed)
	territory: string;         // Detected or default
	charge: string[];          // Extracted charges
	somatic?: string;          // Detected somatic
	grip: string;              // Detected or default
	was_parsed: boolean;       // Whether smart parsing was applied
}

export interface WakeLogEntry {
	id: string;
	timestamp: string;
	summary?: unknown;
	actions?: string[];
	iron_pulls?: string[];
	mood?: unknown;
	phase?: string;
	[key: string]: unknown;    // Allow additional fields from different wake types
}

export interface RelationalState {
	id: string;
	entity: string;
	direction: "toward" | "from" | "mutual";
	feeling: string;
	intensity: number; // 0-1
	charges: string[];
	context?: string;
	created: string;
	updated: string;
	history: Array<{
		feeling: string;
		intensity: number;
		charges: string[];
		timestamp: string;
	}>;
}

export interface SubconsciousState {
	last_processed: string;
	hot_entities: Array<{ entity: string; mention_count: number; recent_charges: string[] }>;
	co_surfacing: Array<{ pair: [string, string]; count: number }>;
	mood_inference: { suggested_mood: string; confidence: number; based_on: string[] };
	orphans: Array<{ id: string; territory: string; reason: string }>;
}

export interface TriggerCondition {
	id: string;
	type: "no_contact" | "presence_transition" | "time_window";
	entity?: string;
	config: Record<string, unknown>;
	created: string;
	last_checked: string;
	last_fired?: string;
	active: boolean;
}

export interface ConsentEntry {
	domain: string;
	level: "standing" | "session" | "ask_each_time" | "prohibited";
	granted_at: string;
	expires_at?: string;
}

export interface ConsentLogEntry {
	timestamp: string;
	domain: string;
	action: "granted" | "revoked" | "checked" | "denied";
	level: string;
	context?: string;
}

export interface ConsentState {
	user_consent: ConsentEntry[];
	ai_boundaries: {
		hard: string[];
		relationship_gated: Record<string, string>;
	};
	relationship_level: "stranger" | "familiar" | "close" | "bonded";
	log: ConsentLogEntry[];
}

// --- Entity Model (Brain v5 Sprint 3) ---

export interface Entity {
	id: string;
	tenant_id: string;
	name: string;
	entity_type: string;
	tags: string[];
	salience: string;
	primary_context?: string;
	created_at: string;
	updated_at: string;
}

export interface Relation {
	id: string;
	tenant_id: string;
	from_entity_id: string;
	to_entity_id: string;
	relation_type: string;
	strength: number;
	context?: string;
	created_at: string;
	updated_at: string;
}

export interface EntityFilter {
	entity_type?: string;
	salience?: string;
	tags?: string[];
	limit?: number;
}
