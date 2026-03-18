// ============ RELATIONAL TOOLS ============
// mind_feel, mind_feel_toward — per-entity directional emotional state

import type { RelationalState } from "../types";
import { getTimestamp, generateId, toStringArray } from "../helpers";
import { BrainStorage } from "../storage";

export const TOOL_DEFS = [
	{
		name: "mind_feel",
		description: "Record or update how I feel toward an entity. Directional emotional state with history.",
		inputSchema: {
			type: "object",
			properties: {
				entity: { type: "string", description: "Who or what (e.g., 'Falco', 'Rainer', 'the Discord community')" },
				feeling: { type: "string", description: "Current feeling toward them (e.g., 'protective warmth', 'cautious curiosity')" },
				intensity: { type: "number", minimum: 0, maximum: 1, default: 0.7, description: "How strong (0-1)" },
				charges: { type: "array", items: { type: "string" }, description: "Emotional charges" },
				direction: { type: "string", enum: ["toward", "from", "mutual"], default: "toward" },
				context: { type: "string", description: "What prompted this feeling" }
			},
			required: ["entity", "feeling"]
		}
	},
	{
		name: "mind_feel_toward",
		description: "Query current relational state toward an entity. How do I feel about X right now?",
		inputSchema: {
			type: "object",
			properties: {
				entity: { type: "string", description: "Who to check feelings toward" }
			},
			required: ["entity"]
		}
	}
];

export async function handleTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	switch (name) {
		case "mind_feel": {
			const states = await storage.readRelationalState();
			const entityLower = args.entity?.toLowerCase().trim() || "";

			// Validate entity name — no empty, no path chars
			if (!entityLower) {
				return { error: "Missing required parameter: entity" };
			}
			if (entityLower.length > 100) {
				return { error: "Entity name too long (max 100 characters)" };
			}

			// Sanitize entity name — reject dangerous characters
			if (/[<>\0]/.test(args.entity)) {
				return { error: "Entity name contains invalid characters" };
			}

			const charges = toStringArray(args.charges);
			const now = getTimestamp();

			// Find existing state for this entity + direction
			const direction = args.direction || "toward";
			const existing = states.find(
				s => s.entity.toLowerCase() === entityLower && s.direction === direction
			);

			if (existing) {
				// Push current state to history (keep last 10)
				existing.history.push({
					feeling: existing.feeling,
					intensity: existing.intensity,
					charges: existing.charges,
					timestamp: existing.updated
				});
				if (existing.history.length > 10) {
					existing.history = existing.history.slice(-10);
				}

				// Update current
				existing.feeling = args.feeling;
				existing.intensity = args.intensity ?? 0.7;
				existing.charges = charges.length > 0 ? charges : existing.charges;
				existing.context = args.context || existing.context;
				existing.updated = now;

				await storage.writeRelationalState(states);

				return {
					updated: true,
					entity: existing.entity,
					direction: existing.direction,
					feeling: existing.feeling,
					intensity: existing.intensity,
					charges: existing.charges,
					history_depth: existing.history.length,
					note: `Relational state toward ${existing.entity} updated. ${existing.history.length} prior states preserved.`
				};
			}

			// New relational state
			const newState: RelationalState = {
				id: generateId("rel"),
				entity: args.entity.trim(),
				direction,
				feeling: args.feeling,
				intensity: args.intensity ?? 0.7,
				charges,
				context: args.context,
				created: now,
				updated: now,
				history: []
			};

			states.push(newState);
			await storage.writeRelationalState(states);

			return {
				created: true,
				id: newState.id,
				entity: newState.entity,
				direction: newState.direction,
				feeling: newState.feeling,
				intensity: newState.intensity,
				charges: newState.charges,
				note: `First relational state recorded for ${newState.entity}.`
			};
		}

		case "mind_feel_toward": {
			const states = await storage.readRelationalState();
			const entityLower = args.entity?.toLowerCase().trim() || "";

			if (!entityLower) {
				return { error: "Missing required parameter: entity" };
			}

			const matching = states.filter(s => s.entity.toLowerCase() === entityLower);

			if (matching.length === 0) {
				return {
					entity: args.entity,
					found: false,
					note: `No relational state recorded for ${args.entity}. Use mind_feel to start tracking.`
				};
			}

			return {
				entity: args.entity,
				found: true,
				states: matching.map(s => ({
					direction: s.direction,
					feeling: s.feeling,
					intensity: s.intensity,
					charges: s.charges,
					context: s.context,
					updated: s.updated,
					history_depth: s.history.length,
					recent_history: s.history.slice(-3)
				}))
			};
		}

		default:
			throw new Error(`Unknown relational tool: ${name}`);
	}
}
