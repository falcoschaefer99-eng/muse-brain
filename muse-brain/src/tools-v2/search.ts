// ============ SEARCH TOOL (v2) ============
// mind_search — hybrid search (vector + full-text) with Neural Surfacing v1 modulation.
// Backward-compatible tool interface: same input params, enriched output.

import { TERRITORIES } from "../constants";
import { extractEssence, getCurrentCircadianPhase } from "../helpers";
import type { ToolContext } from "./context";
import { createEmbeddingProvider } from "../embedding/index";
import {
	parseConfidenceThreshold,
	parseOptionalPositiveInt,
	applyConfidenceScoring,
	filterAndCapByConfidence,
	fireAndForgetSideEffects,
	CONFIDENCE_DEFAULTS
} from "./confidence-utils";

export const TOOL_DEFS = [
	{
		name: "mind_search",
		description: "Search memories by content, charges, and somatic markers. Uses hybrid vector + keyword search with Neural Surfacing modulation (grip, novelty, circadian bias). Use for finding specific memories by topic, person, feeling, or event.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Keywords or natural language to search for" },
				territory: { type: "string", enum: [...Object.keys(TERRITORIES), "all"], default: "all", description: "Filter to one territory or 'all'" },
				limit: { type: "number", default: 10, description: "Max results" },
				grip_filter: { type: "string", enum: ["iron", "strong", "present", "loose", "dormant"], description: "Optional: only return observations at this grip level or stronger" },
				entity: { type: "string", description: "Filter by entity name or ID" },
				confidence_threshold: { type: "number", description: "Optional confidence gate (0.0-1.0) before returning context rows" },
				shadow_mode: { type: "boolean", default: false, description: "If true, report threshold effects without dropping rows" },
				recency_boost_days: { type: "number", description: "Recency boost window in days (default 3)" },
				recency_boost: { type: "number", description: "Confidence boost for recent rows (0.0-0.5, default 0.15)" },
				max_context_items: { type: "number", description: "Hard cap for returned context rows after filtering (default uses limit, max 20)" }
			},
			required: ["query"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_search": {
			const query: string = args.query || "";
			if (!query.trim()) {
				return { query, scope: args.territory || "all", results: [], total_matches: 0, hint: "Query too short — use longer keywords" };
			}

			const limit = Math.min(args.limit || 10, 50);
			const confidenceThreshold = parseConfidenceThreshold(args.confidence_threshold);
			if (args.confidence_threshold !== undefined && confidenceThreshold === undefined) {
				return { error: "confidence_threshold must be a number between 0 and 1" };
			}
			if (args.shadow_mode !== undefined && typeof args.shadow_mode !== "boolean") {
				return { error: "shadow_mode must be a boolean" };
			}
			const shadowMode = args.shadow_mode === true;
			const parsedRecencyBoostDays = parseOptionalPositiveInt(args.recency_boost_days, 1, 30);
			if (args.recency_boost_days !== undefined && parsedRecencyBoostDays === undefined) {
				return { error: "recency_boost_days must be an integer between 1 and 30" };
			}
			const recencyBoostDays = parsedRecencyBoostDays ?? CONFIDENCE_DEFAULTS.recency_boost_days;
			if (args.recency_boost !== undefined && (typeof args.recency_boost !== "number" || !Number.isFinite(args.recency_boost) || args.recency_boost < 0 || args.recency_boost > 0.5)) {
				return { error: "recency_boost must be a number between 0 and 0.5" };
			}
			const recencyBoost = args.recency_boost ?? CONFIDENCE_DEFAULTS.recency_boost;
			const parsedMaxContextItems = parseOptionalPositiveInt(args.max_context_items, 1, 20);
			if (args.max_context_items !== undefined && parsedMaxContextItems === undefined) {
				return { error: "max_context_items must be an integer between 1 and 20" };
			}
			const maxContextItems = Math.min(parsedMaxContextItems ?? Math.min(limit, 20), limit);
			const territory = (!args.territory || args.territory === "all") ? undefined : args.territory;

			// Optional grip filter — translate to array for hybridSearch
			const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
			let gripFilter: string[] | undefined;
			if (args.grip_filter) {
				const minLevel = gripOrder[args.grip_filter] ?? 4;
				gripFilter = Object.keys(gripOrder).filter(g => gripOrder[g] <= minLevel);
			}

			// Generate query embedding if AI binding is available.
			let embedding: number[] | undefined;
			if (context.ai) {
				try {
					const provider = createEmbeddingProvider(context.ai);
					embedding = await provider.embedText(query);
				} catch (err) {
					// Embedding failure is non-fatal — fall back to keyword-only.
					console.error("mind_search embed failed:", err instanceof Error ? err.message : "unknown error");
				}
			}

			// Get circadian phase for territory bias modulation.
			const circadianInfo = getCurrentCircadianPhase();

			// Resolve entity param to an entity_id if provided.
			let entityId: string | undefined;
			if (args.entity) {
				const byId = await context.storage.findEntityById(args.entity);
				if (byId) {
					entityId = byId.id;
				} else {
					const byName = await context.storage.findEntityByName(args.entity);
					if (byName) entityId = byName.id;
				}
			}

			const hybridResults = await context.storage.hybridSearch({
				query,
				embedding,
				territory,
				grip: gripFilter,
				limit,
				circadian_phase: circadianInfo.phase,
				entity_id: entityId
			});

			const confidenceScored = applyConfidenceScoring(hybridResults, recencyBoostDays, recencyBoost);
			const { filtered: finalResults, belowThresholdCount, preCapCount } = filterAndCapByConfidence(
				confidenceScored, confidenceThreshold, shadowMode, maxContextItems
			);

			if (finalResults.length > 0) {
				fireAndForgetSideEffects(context, finalResults.map(r => r.observation.id), "hybridSearch");
			}

			const mappedResults = finalResults.map(r => ({
				id: r.observation.id,
				territory: r.territory,
				essence: extractEssence(r.observation),
				charge: r.observation.texture?.charge || [],
				grip: r.observation.texture?.grip,
				match_in: r.match_sources,
				score: Math.round(r.score * 100) / 100,
				confidence: Math.round(r.confidence * 100) / 100,
				recency_boost_applied: Math.round(r.recency_boost_applied * 100) / 100,
				score_breakdown: r.score_breakdown
			}));

			return {
				query,
				scope: args.territory || "all territories",
				confidence: {
					threshold: confidenceThreshold ?? null,
					shadow_mode: shadowMode,
					recency_boost_days: recencyBoostDays,
					recency_boost: recencyBoost,
					below_threshold: belowThresholdCount,
					pre_cap_count: preCapCount,
					max_context_items: maxContextItems
				},
				results: mappedResults,
				total_matches: mappedResults.length,
				hint: "Use mind_pull(id) for full content"
			};
		}

		default:
			throw new Error(`Unknown search tool: ${name}`);
	}
}
