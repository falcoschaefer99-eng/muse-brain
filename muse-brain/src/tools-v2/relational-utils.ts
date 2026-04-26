// ============ RELATIONAL WRITE UTILITIES (v2) ============
// Shared by mind_relate and mind_observe's optional relation payload.

import type { IBrainStorage } from "../storage/interface";
import type { RelationalState } from "../types";
import { RELATIONSHIP_LEVELS } from "../constants";
import { generateId, getTimestamp, toStringArray } from "../helpers";

const RELATION_DIRECTIONS = ["toward", "from", "mutual"] as const;
type RelationDirection = typeof RELATION_DIRECTIONS[number];

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

function normalizeRelationalWrite(input: RelationalWriteInput): NormalizedRelationalWrite | { error: string } {
	if (typeof input.entity !== "string" || typeof input.feeling !== "string") {
		return { error: "entity and feeling are required for relational write" };
	}

	const entity = input.entity.trim();
	const feeling = input.feeling.trim();
	const entityLower = entity.toLowerCase();

	if (!entityLower) return { error: "Missing required parameter: entity" };
	if (!feeling) return { error: "Missing required parameter: feeling" };
	if (entityLower.length > 100) return { error: "Entity name too long (max 100 characters)" };
	if (/[<>\0]/.test(entity)) return { error: "Entity name contains invalid characters" };

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

	const context = typeof input.context === "string" && input.context.trim()
		? input.context.trim()
		: undefined;

	return {
		entity,
		entityLower,
		feeling,
		intensity,
		charges: toStringArray(input.charges),
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

export async function writeRelationalFeeling(
	storage: IBrainStorage,
	input: RelationalWriteInput
): Promise<Record<string, unknown>> {
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

		if (normalized.setLevel) {
			const consent = await storage.readConsent();
			const oldLevel = consent.relationship_level;
			consent.relationship_level = normalized.setLevel;
			await storage.writeConsent(consent);
			relationshipLevel = { updated: true, from: oldLevel, to: normalized.setLevel };
		}

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

	if (normalized.setLevel) {
		const consent = await storage.readConsent();
		const oldLevel = consent.relationship_level;
		consent.relationship_level = normalized.setLevel;
		await storage.writeConsent(consent);
		relationshipLevel = { updated: true, from: oldLevel, to: normalized.setLevel };
	}

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
