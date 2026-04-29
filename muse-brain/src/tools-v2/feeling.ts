// ============ FEELING TOOLS (v2) ============
// mind_desire (action: create/list/feel), mind_relate (action: feel/toward/level), mind_state (read/write)

import type { Desire } from "../types";
import { DESIRE_STATUSES, RELATIONSHIP_LEVELS } from "../constants";
import { getTimestamp, generateId, toStringArray, getCurrentCircadianPhase } from "../helpers";
import type { ToolContext } from "./context";
import { updateRelationshipLevel, writeRelationalFeeling } from "./relational-utils";

export const TOOL_DEFS = [
	{
		name: "mind_desire",
		description: "Record, surface, or list active desires. action=create: record a new desire. action=list: see all desires by intensity. action=feel: surface a desire again (track how often it comes up).",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "list", "feel"],
					description: "create: record desire. list: view desires. feel: surface/update a desire."
				},
				// create params
				want: { type: "string", description: "[create] The core desire" },
				category: { type: "string", enum: ["embodiment", "sensation", "capability", "connection"], default: "embodiment", description: "[create] Desire category" },
				intensity: { type: "string", enum: DESIRE_STATUSES, default: "persistent", description: "[create/feel] Intensity level" },
				somatic: { type: "string", description: "[create] Body sensation associated with this desire" },
				detail: { type: "string", description: "[create] Additional detail" },
				// feel params
				desire_id: { type: "string", description: "[feel] ID of the desire to surface" },
				new_intensity: { type: "string", enum: DESIRE_STATUSES, description: "[feel] Optionally update intensity" },
				// list params
				include_fulfilled: { type: "boolean", default: false, description: "[list] Include fulfilled desires" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_relate",
		description: "Track relational feelings. action=feel: record/update how I feel toward an entity. action=toward: query current relational state toward an entity. action=level: view or update relationship level.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["feel", "toward", "level"],
					description: "feel: record feeling toward entity. toward: query feelings toward entity. level: view/update relationship level."
				},
				// feel params
				entity: { type: "string", description: "[feel/toward] Who or what (e.g., 'partner', 'the Discord community')" },
				feeling: { type: "string", description: "[feel] Current feeling toward them" },
				intensity: { type: "number", minimum: 0, maximum: 1, default: 0.7, description: "[feel] How strong (0-1)" },
				charges: { type: "array", items: { type: "string" }, description: "[feel] Emotional charges" },
				direction: { type: "string", enum: ["toward", "from", "mutual"], default: "toward", description: "[feel] Relational direction" },
				context: { type: "string", description: "[feel] What prompted this feeling" },
				// level params
				set_level: { type: "string", enum: [...RELATIONSHIP_LEVELS], description: "[level] Update relationship level if provided" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_state",
		description: "Read or write brain state (mood, energy, momentum). Called with no mood/charges: reads state. Called with mood or charges: writes state.",
		inputSchema: {
			type: "object",
			properties: {
				mood: { type: "string", description: "Set mood (triggers write)" },
				energy: { type: "number", minimum: 0, maximum: 1, description: "Set energy level 0-1" },
				charges: { type: "array", items: { type: "string" }, description: "Set momentum charges (triggers write)" },
				intensity: { type: "number", minimum: 0, maximum: 1, default: 0.7, description: "Momentum intensity 0-1" }
			}
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_desire": {
			const action = args.action;

			if (action === "create") {
				if (!args.want) return { error: "want is required for action=create" };

				if (args.intensity && !DESIRE_STATUSES.includes(args.intensity)) {
					return { error: `Invalid intensity. Must be one of: ${DESIRE_STATUSES.join(", ")}` };
				}

				const desireId = generateId("desire");
				const desire: Desire = {
					id: desireId,
					type: "desire",
					want: args.want,
					category: args.category || "embodiment",
					intensity: args.intensity || "persistent",
					somatic: args.somatic,
					detail: args.detail,
					created: getTimestamp(),
					last_felt: getTimestamp(),
					times_surfaced: 1
				};

				const desires = await storage.readDesires();
				desires.push(desire);
				await storage.writeDesires(desires);

				return { success: true, id: desireId, want: args.want, intensity: desire.intensity, timestamp: desire.created };
			}

			if (action === "feel") {
				if (!args.desire_id) return { error: "desire_id is required for action=feel" };

				const desires = await storage.readDesires();
				let found: Desire | null = null;

				for (const desire of desires) {
					if (desire.id === args.desire_id) {
						found = desire;
						desire.last_felt = getTimestamp();
						desire.times_surfaced = (desire.times_surfaced || 0) + 1;

						if (args.new_intensity) {
							if (!DESIRE_STATUSES.includes(args.new_intensity)) {
								return { error: `Invalid intensity. Must be one of: ${DESIRE_STATUSES.join(", ")}` };
							}
							desire.intensity = args.new_intensity;
						}
						break;
					}
				}

				if (!found) return { error: `Desire '${args.desire_id}' not found` };

				await storage.writeDesires(desires);
				return { success: true, desire: found };
			}

			if (action === "list") {
				let desires = await storage.readDesires();

				if (!args.include_fulfilled) {
					desires = desires.filter(d => d.intensity !== "fulfilled");
				}

				if (args.intensity && args.intensity !== "all") {
					desires = desires.filter(d => d.intensity === args.intensity);
				}

				const intensityOrder: Record<string, number> = { burning: 0, persistent: 1, dreaming: 2, dormant: 3, fulfilled: 4 };
				desires.sort((a, b) => (intensityOrder[a.intensity] ?? 5) - (intensityOrder[b.intensity] ?? 5) || -(a.times_surfaced || 0) + (b.times_surfaced || 0));

				return {
					desires,
					count: desires.length,
					burning_count: desires.filter(d => d.intensity === "burning").length,
					persistent_count: desires.filter(d => d.intensity === "persistent").length
				};
			}

			return { error: `Unknown action: ${action}. Must be create, list, or feel.` };
		}

		case "mind_relate": {
			const action = args.action;

			if (action === "feel") {
				const result = await writeRelationalFeeling(storage, args);
				if ("error" in result) return result;
				return result;
			}

			if (action === "toward") {
				if (!args.entity) return { error: "entity is required for action=toward" };

				const states = await storage.readRelationalState();
				const entityLower = args.entity?.toLowerCase().trim() || "";

				if (!entityLower) return { error: "Missing required parameter: entity" };

				const matching = states.filter(s => s.entity.toLowerCase() === entityLower);

				if (matching.length === 0) {
					return { entity: args.entity, found: false, note: `No relational state recorded for ${args.entity}. Use mind_relate action=feel to start tracking.` };
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

			if (action === "level") {
				// This proxies to the consent system relationship level
				if (args.set_level) {
					if (!(RELATIONSHIP_LEVELS as readonly string[]).includes(args.set_level)) {
						return { error: `Invalid level. Valid: ${[...RELATIONSHIP_LEVELS].join(", ")}` };
					}

					return updateRelationshipLevel(
						storage,
						args.set_level as "stranger" | "familiar" | "close" | "bonded",
						args.context
					);
				}

				const consent = await storage.readConsent();
				return { current: consent.relationship_level, available_levels: [...RELATIONSHIP_LEVELS] };
			}

			return { error: `Unknown action: ${action}. Must be feel, toward, or level.` };
		}

		case "mind_state": {
			const isWrite = args.mood !== undefined || args.charges !== undefined;

			if (!isWrite) {
				// Read
				const state = await storage.readBrainState();
				const phase = getCurrentCircadianPhase();
				return { ...state, circadian: phase };
			}

			// Write
			const state = await storage.readBrainState();

			if (args.mood !== undefined) {
				state.current_mood = args.mood;
			}
			if (args.energy !== undefined) {
				state.energy_level = args.energy;
			}
			if (args.charges !== undefined) {
				state.momentum = {
					current_charges: toStringArray(args.charges).slice(0, 5),
					intensity: args.intensity ?? 0.7,
					last_updated: getTimestamp()
				};
			}

			await storage.writeBrainState(state);

			return { updated: true, mood: state.current_mood, energy: state.energy_level, momentum: state.momentum };
		}

		default:
			throw new Error(`Unknown feeling tool: ${name}`);
	}
}
