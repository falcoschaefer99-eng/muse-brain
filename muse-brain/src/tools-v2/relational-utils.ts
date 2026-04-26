// ============ RELATIONAL WRITE UTILITIES (v2) ============
// Shared by mind_relate and mind_observe's optional relation payload.

import type { IBrainStorage } from "../storage/interface";
import type { RelationalState } from "../types";
import { RELATIONSHIP_LEVELS } from "../constants";
import { generateId, getTimestamp, toStringArray } from "../helpers";

const RELATION_DIRECTIONS = ["toward", "from", "mutual"] as const;
type RelationDirection = typeof RELATION_DIRECTIONS[number];
const MAX_ENTITY_LENGTH = 100;
const MAX_FEELING_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 2_000;
const MAX_CHARGES = 20;
const MAX_CHARGE_LENGTH = 100;

export interface RelationalWriteInput {
	entity?: unknown;
	feeling?: unknown;
	intensity?: unknown;
	charges?: unknown;
	direction?: unknown;
	context?: unknown;
	set_level?: unknown;
}

interface NormalizedRelationalWrite {
	entity: string;
	entityLower: string;
	feeling: string;
	intensity: number;
	charges: string[];
	direction: RelationDirection;
	context?: string;
	setLevel?: "stranger" | "familiar" | "close" | "bonded";
}

export type RelationalWriteResult =
	| { error: string }
	| {
		created: true;
		id: string;
		entity: string;
		direction: RelationDirection;
		feeling: string;
		intensity: number;
		charges: string[];
		relationship_level?: Record<string, unknown>;
		note: string;
	}
	| {
		updated: true;
		entity: string;
		direction: RelationDirection;
		feeling: string;
		intensity: number;
		charges: string[];
		history_depth: number;
		relationship_level?: Record<string, unknown>;
		note: string;
	};

function trimConsentLog<T extends { log: unknown[] }>(consent: T): void {
	if (consent.log.length > 100) consent.log = consent.log.slice(-100);
}

function normalizeCharges(value: unknown): string[] | { error: string } {
	const raw = toStringArray(value)
		.filter((item): item is string => typeof item === "string")
		.map(item => item.trim())
		.filter(Boolean);

	if (raw.length > MAX_CHARGES) return { error: `charges may include at most ${MAX_CHARGES} entries` };

	for (const charge of raw) {
		if (charge.length > MAX_CHARGE_LENGTH) return { error: `charge entries must be ${MAX_CHARGE_LENGTH} characters or fewer` };
		if (/[\x00-\x1f]/.test(charge)) return { error: "charge entries contain invalid characters" };
	}

	return raw;
}

function normalizeRelationalWrite(input: RelationalWriteInput): NormalizedRelationalWrite | { error: string } {
	if (typeof input.entity !== "string" || typeof input.feeling !== "string") {
		return { error: "entity and feeling are required for relational write" };
	}

	const entity = input.entity.trim();
	const feeling = input.feeling.trim();
	const entityLower = entity.toLowerCase();

	if (!entityLower) return { error: "Missing required parameter: entity" };
	if (!feeling) return { error: "Missing required parameter: feeling" };
	if (entityLower.length > MAX_ENTITY_LENGTH) return { error: `Entity name too long (max ${MAX_ENTITY_LENGTH} characters)` };
	if (feeling.length > MAX_FEELING_LENGTH) return { error: `feeling too long (max ${MAX_FEELING_LENGTH} characters)` };
	if (/[\x00-\x1f<>]/.test(entity)) return { error: "Entity name contains invalid characters" };
	if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(feeling)) return { error: "feeling contains invalid characters" };

	let intensity = 0.7;
	if (input.intensity !== undefined) {
		if (typeof input.intensity !== "number" || !Number.isFinite(input.intensity) || input.intensity < 0 || input.intensity > 1) {
			return { error: "intensity must be a number between 0 and 1" };
		}
		intensity = input.intensity;
	}

	const direction = input.direction === undefined ? "toward" : input.direction;
	if (typeof direction !== "string" || !RELATION_DIRECTIONS.includes(direction as RelationDirection)) {
		return { error: `Invalid direction. Must be one of: ${RELATION_DIRECTIONS.join(", ")}` };
	}

	let setLevel: NormalizedRelationalWrite["setLevel"];
	if (input.set_level !== undefined) {
		if (typeof input.set_level !== "string" || !(RELATIONSHIP_LEVELS as readonly string[]).includes(input.set_level)) {
			return { error: `Invalid relationship level. Valid: ${[...RELATIONSHIP_LEVELS].join(", ")}` };
		}
		setLevel = input.set_level as NormalizedRelationalWrite["setLevel"];
	}

	let context: string | undefined;
	if (input.context !== undefined) {
		if (typeof input.context !== "string") return { error: "context must be a string when provided" };
		context = input.context.trim() || undefined;
		if (context && context.length > MAX_CONTEXT_LENGTH) return { error: `context too long (max ${MAX_CONTEXT_LENGTH} characters)` };
		if (context && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(context)) return { error: "context contains invalid characters" };
	}

	const charges = normalizeCharges(input.charges);
	if ("error" in charges) return charges;

	return {
		entity,
		entityLower,
		feeling,
		intensity,
		charges,
		direction: direction as RelationDirection,
		context,
		setLevel
	};
}

export function validateRelationalWrite(input: RelationalWriteInput): { valid: true } | { valid: false; error: string } {
	const normalized = normalizeRelationalWrite(input);
	if ("error" in normalized) return { valid: false, error: normalized.error };
	return { valid: true };
}

async function updateRelationshipLevel(
	storage: IBrainStorage,
	setLevel: "stranger" | "familiar" | "close" | "bonded",
	context?: string
): Promise<Record<string, unknown>> {
	const consent = await storage.readConsent();
	const oldLevel = consent.relationship_level;
	consent.relationship_level = setLevel;
	consent.log.push({
		timestamp: getTimestamp(),
		domain: "relationship_level",
		action: "granted",
		level: setLevel,
		context: context || `${oldLevel} → ${setLevel}`
	});
	trimConsentLog(consent);
	await storage.writeConsent(consent);
	return { updated: true, from: oldLevel, to: setLevel };
}

export async function writeRelationalFeeling(
	storage: IBrainStorage,
	input: RelationalWriteInput
): Promise<RelationalWriteResult> {
	const normalized = normalizeRelationalWrite(input);
	if ("error" in normalized) return { error: normalized.error };

	const states = await storage.readRelationalState();
	const now = getTimestamp();
	const existing = states.find(s => s.entity.toLowerCase() === normalized.entityLower && s.direction === normalized.direction);
	let relationshipLevel: Record<string, unknown> | undefined;

	if (existing) {
		existing.history.push({ feeling: existing.feeling, intensity: existing.intensity, charges: existing.charges, timestamp: existing.updated });
		if (existing.history.length > 10) existing.history = existing.history.slice(-10);

		existing.feeling = normalized.feeling;
		existing.intensity = normalized.intensity;
		existing.charges = normalized.charges.length > 0 ? normalized.charges : existing.charges;
		existing.context = normalized.context || existing.context;
		existing.updated = now;

		await storage.writeRelationalState(states);

		if (normalized.setLevel) relationshipLevel = await updateRelationshipLevel(storage, normalized.setLevel, normalized.context);

		return {
			updated: true,
			entity: existing.entity,
			direction: existing.direction,
			feeling: existing.feeling,
			intensity: existing.intensity,
			charges: existing.charges,
			history_depth: existing.history.length,
			...(relationshipLevel ? { relationship_level: relationshipLevel } : {}),
			note: `Relational state toward ${existing.entity} updated.`
		};
	}

	const newState: RelationalState = {
		id: generateId("rel"),
		entity: normalized.entity,
		direction: normalized.direction,
		feeling: normalized.feeling,
		intensity: normalized.intensity,
		charges: normalized.charges,
		context: normalized.context,
		created: now,
		updated: now,
		history: []
	};

	states.push(newState);
	await storage.writeRelationalState(states);

	if (normalized.setLevel) relationshipLevel = await updateRelationshipLevel(storage, normalized.setLevel, normalized.context);

	return {
		created: true,
		id: newState.id,
		entity: newState.entity,
		direction: newState.direction,
		feeling: newState.feeling,
		intensity: newState.intensity,
		charges: newState.charges,
		...(relationshipLevel ? { relationship_level: relationshipLevel } : {}),
		note: `First relational state recorded for ${newState.entity}.`
	};
}
