// ============ SEARCH TOOL (v2) ============
// mind_search — vector search via storage.searchSimilar, keyword fallback scanning FULL content

import type { Observation } from "../types";
import { TERRITORIES } from "../constants";
import { extractEssence, getCurrentCircadianPhase } from "../helpers";
import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_search",
		description: "Search memories by content, charges, and somatic markers. Searches full content with no scan limits. Use for finding specific memories by topic, person, feeling, or event.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Keywords to search for — multiple words matched individually across full content" },
				territory: { type: "string", enum: [...Object.keys(TERRITORIES), "all"], default: "all", description: "Filter to one territory or 'all'" },
				limit: { type: "number", default: 10, description: "Max results" },
				grip_filter: { type: "string", enum: ["iron", "strong", "present", "loose", "dormant"], description: "Optional: only return observations at this grip level or stronger" }
			},
			required: ["query"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_search": {
			const searchAll = !args.territory || args.territory === "all";
			const limit = Math.min(args.limit || 10, 50);

			// Split query into words (skip short filler words)
			const queryWords = args.query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
			if (queryWords.length === 0) {
				return { query: args.query, scope: args.territory || "all", results: [], total_matches: 0, hint: "Query too short — use longer keywords" };
			}

			// Optional grip filter
			const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
			const minGripLevel = args.grip_filter ? gripOrder[args.grip_filter] ?? 4 : 4;

			interface SearchHit { id: string; territory: string; obs: Observation; score: number; match_in: string[] }
			const results: SearchHit[] = [];

			const gripBoost: Record<string, number> = { iron: 1.3, strong: 1.15, present: 1.0, loose: 0.9, dormant: 0.7 };

			// Determine which territories to search — FULL scan, no limits
			const territoriesToSearch: string[] = searchAll ? Object.keys(TERRITORIES) : [args.territory];

			for (const t of territoriesToSearch) {
				const observations = await storage.readTerritory(t);

				for (const obs of observations) {
					// Apply grip filter if requested
					if (args.grip_filter) {
						const obsGrip = gripOrder[obs.texture?.grip || "present"] ?? 2;
						if (obsGrip > minGripLevel) continue;
					}

					let score = 0;
					const match_in: string[] = [];

					// Check FULL content — case-insensitive, no truncation
					const contentLower = obs.content.toLowerCase();
					for (const word of queryWords) {
						if (contentLower.indexOf(word) !== -1) {
							score += 2;
							if (!match_in.includes("content")) match_in.push("content");
							break;
						}
					}

					// Check charges — already lowercase short strings
					const charges = obs.texture?.charge;
					if (charges && charges.length > 0) {
						for (const charge of charges) {
							for (const word of queryWords) {
								if (charge.indexOf(word) !== -1) {
									score += 1.5;
									if (!match_in.includes("charge")) match_in.push("charge");
									break;
								}
							}
							if (match_in.includes("charge")) break;
						}
					}

					// Check somatic
					const somatic = obs.texture?.somatic;
					if (somatic) {
						const somaticLower = somatic.toLowerCase();
						for (const word of queryWords) {
							if (somaticLower.indexOf(word) !== -1) {
								score += 1;
								if (!match_in.includes("somatic")) match_in.push("somatic");
								break;
							}
						}
					}

					// Check summary if present
					if (obs.summary && score === 0) {
						const summaryLower = obs.summary.toLowerCase();
						for (const word of queryWords) {
							if (summaryLower.indexOf(word) !== -1) {
								score += 1;
								if (!match_in.includes("summary")) match_in.push("summary");
								break;
							}
						}
					}

					// Check tags if present
					if (obs.tags && obs.tags.length > 0 && score === 0) {
						const tagsText = obs.tags.join(" ").toLowerCase();
						for (const word of queryWords) {
							if (tagsText.indexOf(word) !== -1) {
								score += 0.5;
								if (!match_in.includes("tags")) match_in.push("tags");
								break;
							}
						}
					}

					if (score > 0) {
						score *= gripBoost[obs.texture?.grip || "present"] || 1.0;
						results.push({ id: obs.id, territory: t, obs, score, match_in });
					}
				}
			}

			results.sort((a, b) => b.score - a.score);
			const finalResults = results.slice(0, limit).map(r => ({
				id: r.id,
				territory: r.territory,
				essence: extractEssence(r.obs),
				charge: r.obs.texture?.charge || [],
				grip: r.obs.texture?.grip,
				match_in: r.match_in,
				score: Math.round(r.score * 100) / 100
			}));

			return {
				query: args.query,
				scope: args.territory || "all territories",
				results: finalResults,
				total_matches: results.length,
				hint: "Use mind_pull(id) for full content"
			};
		}

		default:
			throw new Error(`Unknown search tool: ${name}`);
	}
}
