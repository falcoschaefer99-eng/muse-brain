// ============ MEMORY TOOLS (v2) ============
// mind_observe (mode: observe/journal/whisper)
// mind_query (replaces recent+surface+surface_pulls+old search — no scan limits)
// mind_pull (full content by ID)
// mind_edit (action: delete/texture)

import type { Observation, Texture } from "../types";
import { TERRITORIES, SALIENCE_LEVELS, VIVIDNESS_LEVELS, GRIP_LEVELS, ALLOWED_TENANTS } from "../constants";
import {
	toStringArray,
	getTimestamp,
	generateId,
	extractEssence,
	calculatePullStrength,
	smartParseObservation,
	generateSummary,
	getCurrentCircadianPhase
} from "../helpers";
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
import {
	DEFAULT_RETRIEVAL_PROFILE,
	normalizeRetrievalProfile,
	extractQuerySignals
} from "../retrieval/query-signals";
import { lookupLetterById, normalizeLookupText, resolveLetterContext } from "./utils";

// ============ HELPERS ============

const LOOKUP_GRIP_WEIGHT: Record<string, number> = {
	iron: 5,
	strong: 4,
	present: 3,
	loose: 2,
	dormant: 1
};

function splitLookupTokens(value: string): string[] {
	return normalizeLookupText(value).split(" ").filter(Boolean);
}

function parseProjectAliases(entityName: string, tags: string[], metadata?: Record<string, unknown>): string[] {
	const aliases: string[] = [entityName, ...tags];
	const metadataAliases = metadata?.aliases;
	if (Array.isArray(metadataAliases)) {
		for (const value of metadataAliases) {
			if (typeof value === "string" && value.trim()) aliases.push(value.trim());
		}
	}
	const metadataSlug = metadata?.slug;
	if (typeof metadataSlug === "string" && metadataSlug.trim()) aliases.push(metadataSlug.trim());
	return Array.from(new Set(aliases.map(alias => alias.trim()).filter(Boolean)));
}

interface ProjectRegistryRow {
	tenant: string;
	entity: any;
	dossier: any;
	aliases: string[];
	normalizedAliases: string[];
}

interface ProjectRegistryOptions {
	scope?: "current" | "all";
	include_archived?: boolean;
}

const PROJECT_REGISTRY_CACHE_KEY = "__mind_memory_project_registry_cache";

async function loadProjectRegistry(
	context: ToolContext,
	options?: ProjectRegistryOptions
): Promise<ProjectRegistryRow[]> {
	const scope = options?.scope ?? "all";
	const includeArchived = options?.include_archived === true;
	const cacheKey = `${scope}:${includeArchived ? "with_archived" : "active_only"}`;
	const cacheBag = (context as any)[PROJECT_REGISTRY_CACHE_KEY] as Map<string, Promise<ProjectRegistryRow[]>> | undefined;
	if (cacheBag?.has(cacheKey)) {
		return cacheBag.get(cacheKey)!;
	}

	const rowsPromise = (async (): Promise<ProjectRegistryRow[]> => {
		const rows: ProjectRegistryRow[] = [];
		const currentTenant = context.storage.getTenant();
		const tenants = scope === "current" ? [currentTenant] : ALLOWED_TENANTS;

		for (const tenant of tenants) {
			const tenantStorage = tenant === currentTenant ? context.storage : context.storage.forTenant?.(tenant);
			if (!tenantStorage || typeof tenantStorage.listProjectDossiers !== "function") continue;
			const dossiersRaw = await tenantStorage.listProjectDossiers({ limit: 200 });
			const dossiers = includeArchived
				? dossiersRaw
				: dossiersRaw.filter((item: any) => item?.lifecycle_status !== "archived");
			if (dossiers.length === 0) continue;

			const entityIds = Array.from(new Set(
				dossiers
					.map((dossier: any) => dossier?.project_entity_id)
					.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
			));
			const entityById = new Map<string, any>();
			if (typeof tenantStorage.findEntitiesByIds === "function" && entityIds.length > 0) {
				const batch = await tenantStorage.findEntitiesByIds(entityIds);
				for (const entity of Array.isArray(batch) ? batch : []) {
					if (entity && typeof entity.id === "string") entityById.set(entity.id, entity);
				}
			} else if (typeof tenantStorage.listEntities === "function") {
				const entities = await tenantStorage.listEntities({
					entity_type: "project",
					limit: Math.max(200, Math.min(2000, entityIds.length * 2))
				});
				for (const entity of entities) entityById.set(entity.id, entity);
			}

			for (const dossier of dossiers) {
				let entity = entityById.get(dossier.project_entity_id);
				if (!entity && typeof tenantStorage.findEntityById === "function") {
					entity = await tenantStorage.findEntityById(dossier.project_entity_id);
				}
				if (!entity || entity.entity_type !== "project") continue;

				const metadata = (dossier.metadata && typeof dossier.metadata === "object")
					? dossier.metadata as Record<string, unknown>
					: {};

				// A1 hard gate: never load cross-tenant private projects.
				if (tenant !== currentTenant && metadata.visibility !== "shared") continue;

				const aliases = parseProjectAliases(entity.name, entity.tags ?? [], metadata);
				rows.push({
					tenant,
					entity,
					dossier,
					aliases,
					normalizedAliases: aliases.map(alias => normalizeLookupText(alias))
				});
			}
		}

		return rows;
	})();

	const guardedPromise = rowsPromise.catch(err => {
		const bag = (context as any)[PROJECT_REGISTRY_CACHE_KEY] as Map<string, Promise<ProjectRegistryRow[]>> | undefined;
		bag?.delete(cacheKey);
		throw err;
	});

	if (!cacheBag) {
		(context as any)[PROJECT_REGISTRY_CACHE_KEY] = new Map([[cacheKey, guardedPromise]]);
	} else {
		cacheBag.set(cacheKey, guardedPromise);
	}
	return guardedPromise;
}

async function autoLinkProjectEntity(
	context: ToolContext,
	content: string
): Promise<{ entityId?: string; confidence?: number; tenant?: string; ambiguous?: boolean }> {
	const normalizedContent = normalizeLookupText(content);
	if (!normalizedContent) return {};

	const registry = await loadProjectRegistry(context, { scope: "current" });
	if (registry.length === 0) return {};

	const scored = registry
		.map(project => {
			let best = 0;
			for (const alias of project.normalizedAliases) {
				if (!alias) continue;
				if (normalizedContent.includes(alias)) {
					best = Math.max(best, 1);
					continue;
				}
				const aliasTokens = alias.split(" ").filter(Boolean);
				if (aliasTokens.length === 0) continue;
				let matched = 0;
				for (const token of aliasTokens) {
					if (token.length >= 3 && normalizedContent.includes(token)) matched += 1;
				}
				const ratio = matched / aliasTokens.length;
				if (ratio > best) best = ratio;
			}
			return { project, confidence: best };
		})
		.filter(row => row.confidence > 0)
		.sort((a, b) => b.confidence - a.confidence);

	if (scored.length === 0) return {};
	const top = scored[0];
	const second = scored[1];
	if (second && Math.abs(top.confidence - second.confidence) < 0.05) {
		return { ambiguous: true };
	}
	if (top.confidence < 0.7) return {};

	return {
		entityId: top.project.entity.id,
		confidence: Number(top.confidence.toFixed(3)),
		tenant: top.project.tenant
	};
}

function scheduleEmbed(context: ToolContext, observation: Observation): void {
	if (context.ai && context.waitUntil) {
		const provider = createEmbeddingProvider(context.ai);
		context.waitUntil(
			provider.embedText(observation.content)
				.then(embedding => context.storage.updateObservationEmbedding(observation.id, embedding))
				.catch(err => console.error('Embed failed:', err))
		);
	}
}

async function resolveOrCreateEntity(context: ToolContext, name: string, typeHint?: string): Promise<string | undefined> {
	const cleanName = name.trim().replace(/[\x00-\x1f]/g, '');
	if (!cleanName || cleanName.length > 200) return undefined;

	const existing = await context.storage.findEntityByName(cleanName);
	if (existing) return existing.id;

	const entity = await context.storage.createEntity({
		tenant_id: context.storage.getTenant(),
		name: cleanName,
		entity_type: typeHint || 'concept',
		tags: [],
		salience: 'active',
		primary_context: undefined
	});
	return entity.id;
}

export const TOOL_DEFS = [
	{
		name: "mind_observe",
		description: "Record a new observation, journal entry, or whisper. mode=observe (default): structured observation with texture. mode=journal: quick unstructured entry, auto-filed to episodic. mode=whisper: quiet note that doesn't pull (dormant grip, background salience).",
		inputSchema: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["observe", "journal", "whisper"],
					default: "observe",
					description: "observe: full observation with texture. journal: quick unstructured note. whisper: quiet note, won't pull."
				},
				// observe params
				content: { type: "string", description: "The observation or journal content" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), description: "[observe] Territory: self/us/craft/body/emotional/episodic/philosophy/kin. Inferred automatically if omitted." },
				salience: { type: "string", enum: SALIENCE_LEVELS, default: "active", description: "[observe] foundational/active/background/archive" },
				vividness: { type: "string", enum: VIVIDNESS_LEVELS, default: "vivid", description: "[observe] crystalline/vivid/soft/fragmentary/faded" },
				charge: { type: "array", items: { type: "string" }, default: [], description: "[observe] Emotional charges" },
				somatic: { type: "string", description: "[observe] Body sensation" },
				grip: { type: "string", enum: GRIP_LEVELS, default: "present", description: "[observe] iron/strong/present/loose/dormant" },
				context: { type: "string", description: "[observe] Context note" },
				mood: { type: "string", description: "[observe] Mood when recorded" },
				// journal/whisper params
				entry: { type: "string", description: "[journal] Journal entry text (alternative to content)" },
				tags: { type: "array", items: { type: "string" }, description: "[journal/whisper] Tags" },
			entity_id: { type: "string", description: "[observe/journal/whisper] Link to entity by ID" },
			entity_name: { type: "string", description: "[observe/journal/whisper] Link to entity by name (auto-creates if not found)" }
			},
			required: []
		}
	},
	{
		name: "mind_memory",
		description: "Unified memory read API. action=get resolves direct IDs (observation/letter/task/project). action=recent runs deterministic recency retrieval. action=lookup performs literal keyword/tag lookup and project-first routing. action=search delegates to hybrid semantic retrieval.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["get", "recent", "lookup", "search"],
					description: "get: direct by id, recent: recency-first filter path, lookup: literal keyword/tags, search: hybrid semantic."
				},
				id: { type: "string", description: "[get] obs_/journal_/whisper_/letter_/task_/ent_ id" },
				context: { type: "string", description: "[get] Letter recipient context for scoped letter ID reads (default: chat)." },
				days: { type: "number", description: "[recent] filter to last N days" },
				hours: { type: "number", description: "[recent] filter to last N hours (overrides days)" },
				project: { type: "string", description: "[recent/lookup] project slug or alias" },
				keyword: { type: "string", description: "[lookup] literal keyword to match" },
				tags: { type: "array", items: { type: "string" }, description: "[lookup] tags to match (any)" },
				query: { type: "string", description: "[search] hybrid query text" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), description: "[recent/lookup/search] territory filter" },
				grip: { type: "string", enum: [...GRIP_LEVELS, "all"], description: "[recent/lookup/search] grip filter" },
				salience: { type: "string", enum: [...SALIENCE_LEVELS, "all"], description: "[recent] salience filter" },
				type: { type: "string", description: "[recent] observation type filter" },
				limit: { type: "number", default: 10, description: "max results" },
				full: { type: "boolean", default: false, description: "include full content" },
				sort_by: { type: "string", enum: ["recency", "pull", "access"], description: "[recent] sort order" },
				entity: { type: "string", description: "[recent/search] entity name or id" },
				retrieval_profile: { type: "string", enum: ["native", "balanced", "benchmark", "flat"] },
				profile: { type: "string", enum: ["native", "balanced", "benchmark", "flat"] },
				rerank_mode: { type: "string", enum: ["off", "heuristic", "model"] },
				rerank_top_n: { type: "number" },
				confidence_threshold: { type: "number" },
				shadow_mode: { type: "boolean" },
				recency_boost_days: { type: "number" },
				recency_boost: { type: "number" },
				max_context_items: { type: "number" }
			},
			required: ["action"]
		}
	},
	{
		name: "mind_query",
		description: "Unified memory query. Find memories by: free-text query (hybrid search), recency (days/hours), grip/salience, pull strength, or surface all. When query is provided, uses hybrid vector + keyword search with Neural Surfacing modulation. Replaces mind_recent, mind_surface, mind_surface_pulls. Full content available via full=true.",
		inputSchema: {
			type: "object",
			properties: {
				// Free-text hybrid search (activates hybridSearch path when present)
				query: { type: "string", description: "Free-text query — activates hybrid vector + keyword search with Neural Surfacing modulation" },
				retrieval_profile: {
					type: "string",
					enum: ["native", "balanced", "benchmark", "flat"],
					description: "Hybrid path only: retrieval weighting profile. native=relational baseline, balanced=recall+relation, benchmark=recall-first, flat=keyword-lean baseline."
				},
				profile: {
					type: "string",
					enum: ["native", "balanced", "benchmark", "flat"],
					description: "Alias for retrieval_profile."
				},
				rerank_mode: {
					type: "string",
					enum: ["off", "heuristic", "model"],
					description: "Hybrid path only: optional rerank lane. model requires a configured hook and otherwise falls back safely."
				},
				rerank_top_n: {
					type: "number",
					description: "Hybrid path only: max candidates considered for rerank (default profile-specific)."
				},
				// Temporal filter
				days: { type: "number", description: "Filter to observations from last N days" },
				hours: { type: "number", description: "Filter to observations from last N hours (overrides days)" },
				// Texture filters
				grip: { type: "string", enum: [...GRIP_LEVELS, "all"], description: "Filter by grip level or stronger (iron includes all)" },
				salience: { type: "string", enum: [...SALIENCE_LEVELS, "all"], description: "Filter by salience level" },
				territory: { type: "string", enum: Object.keys(TERRITORIES), description: "Filter to one territory" },
				charge: { type: "string", description: "Filter to observations containing this charge" },
				type: { type: "string", description: "Filter by observation type (journal, whisper, vow, etc.)" },
				// Sort (only used when query is absent)
				sort_by: {
					type: "string",
					enum: ["recency", "pull", "access"],
					default: "recency",
					description: "Sort by: recency (newest first), pull (strongest pull first), access (most accessed first). Ignored when query is present."
				},
				// Output
				limit: { type: "number", default: 10, description: "Max results" },
				full: { type: "boolean", default: false, description: "Include full content in results" },
				entity: { type: "string", description: "Filter by entity name or ID" },
				confidence_threshold: { type: "number", description: "Optional confidence gate (0.0-1.0) for hybrid query results before prompt injection (query path only)" },
				shadow_mode: { type: "boolean", default: false, description: "If true, report confidence filtering effects without dropping results (query path only)" },
				recency_boost_days: { type: "number", description: "Recency boost window in days for confidence scoring (query path only, default 3)" },
				recency_boost: { type: "number", description: "Confidence boost for recent items (query path only, 0.0-0.5, default 0.15)" },
				max_context_items: { type: "number", description: "Hard cap for returned context rows after confidence filtering (query path only, default uses limit, max 20)" }
				}
			}
		},
	{
		name: "mind_pull",
		description: "Universal direct ID read. Resolves observation (obs_/journal_/whisper_), letter (letter_), task (task_), and entity/project (ent_) IDs. Observation pulls update access count. Set process=true only for observations to record a processing engagement and advance charge_phase when threshold is met.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "Direct ID to resolve (obs_/journal_/whisper_/letter_/task_/ent_)." },
				context: { type: "string", description: "[letter only] Recipient context for scoped letter lookups (default: chat)." },
				process: { type: "boolean", default: false, description: "[observation only] Record a processing engagement in the processing log. Advances charge_phase when threshold met (3 processings, or 2 if linked to a burning paradox loop)." },
				processing_note: { type: "string", description: "[process=true] What you're noticing or holding while engaging with this observation" },
				charge: { type: "array", items: { type: "string" }, description: "[process=true] Emotional state during processing" }
			},
			required: ["id"]
		}
	},
	{
		name: "mind_edit",
		description: "Edit or delete observations. action=delete: remove an observation and its links. action=texture: update texture dimensions on an existing observation.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["delete", "texture"],
					description: "delete: remove observation. texture: update texture dimensions."
				},
				observation_id: { type: "string", description: "ID of the observation to edit or delete" },
				// texture params
				salience: { type: "string", enum: SALIENCE_LEVELS, description: "[texture] Update salience" },
				vividness: { type: "string", enum: VIVIDNESS_LEVELS, description: "[texture] Update vividness" },
				charge: { type: "array", items: { type: "string" }, description: "[texture] Charges to add or replace" },
				somatic: { type: "string", description: "[texture] Update somatic" },
				grip: { type: "string", enum: GRIP_LEVELS, description: "[texture] Update grip" },
				charge_mode: { type: "string", enum: ["add", "replace"], default: "add", description: "[texture] Add to existing charges or replace them" }
			},
			required: ["action", "observation_id"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	const storage = context.storage;
	switch (name) {
		case "mind_observe": {
			const mode = args.mode || (args.entry ? "journal" : "observe");

			if (mode === "journal") {
				const entryText = args.entry || args.content;
				if (!entryText) return { error: "entry or content is required for mode=journal" };
				if (entryText.length > 50_000) {
					throw new Error(`Observation content too large: ${entryText.length} chars (max 50,000)`);
				}

				const obsId = generateId("journal");
				const observation: Observation = {
					id: obsId,
					content: entryText,
					territory: "episodic",
					created: getTimestamp(),
					texture: {
						salience: "active",
						vividness: "vivid",
						charge: [],
						grip: "present",
						charge_phase: "fresh",
						novelty_score: 1.0
					},
					context: args.tags ? `tags: ${toStringArray(args.tags).join(", ")}` : undefined,
					access_count: 0,
					last_accessed: getTimestamp()
				};

					observation.type = "journal";
				observation.tags = toStringArray(args.tags);
				observation.summary = generateSummary(observation);

				// Entity linking
				let journalEntityId: string | undefined = args.entity_id;
				let journalAutoLink: { entityId?: string; confidence?: number; tenant?: string; ambiguous?: boolean } | undefined;
				if (!journalEntityId && args.entity_name) {
					journalEntityId = await resolveOrCreateEntity(context, args.entity_name);
				}
				if (!journalEntityId) {
					journalAutoLink = await autoLinkProjectEntity(context, observation.content);
					journalEntityId = journalAutoLink.entityId;
				}
				if (journalEntityId) {
					observation.entity_id = journalEntityId;
				}

				await storage.appendToTerritory("episodic", observation);

				scheduleEmbed(context, observation);

				return {
					success: true,
					id: obsId,
					territory: "episodic",
					timestamp: observation.created,
					tags: toStringArray(args.tags),
					...(journalAutoLink?.entityId ? { auto_linked_project: { entity_id: journalAutoLink.entityId, confidence: journalAutoLink.confidence, tenant: journalAutoLink.tenant } } : {}),
					...(journalAutoLink?.ambiguous ? { auto_link_notice: "ambiguous project match skipped" } : {})
				};
			}

			if (mode === "whisper") {
				const contentText = args.content;
				if (!contentText) return { error: "content is required for mode=whisper" };
				if (contentText.length > 50_000) {
					throw new Error(`Observation content too large: ${contentText.length} chars (max 50,000)`);
				}

				const territory = args.territory || "self";
				if (!Object.keys(TERRITORIES).includes(territory)) {
					return { error: `Unknown territory. Must be one of: ${Object.keys(TERRITORIES).join(", ")}` };
				}

				const obsId = generateId("whisper");
				const observation: Observation = {
					id: obsId,
					content: contentText,
					territory,
					created: getTimestamp(),
					texture: {
						salience: "background",
						vividness: "soft",
						charge: [],
						grip: "dormant",
						charge_phase: "fresh",
						novelty_score: 1.0
					},
					context: args.tags ? `tags: ${toStringArray(args.tags).join(", ")}` : "Whispered - not meant to demand attention",
					access_count: 1,
					last_accessed: getTimestamp()
				};

					observation.type = "whisper";
				observation.tags = args.tags ? toStringArray(args.tags) : ["whisper", "quiet"];
				observation.summary = generateSummary(observation);

				// Entity linking
				let whisperEntityId: string | undefined = args.entity_id;
				let whisperAutoLink: { entityId?: string; confidence?: number; tenant?: string; ambiguous?: boolean } | undefined;
				if (!whisperEntityId && args.entity_name) {
					whisperEntityId = await resolveOrCreateEntity(context, args.entity_name);
				}
				if (!whisperEntityId) {
					whisperAutoLink = await autoLinkProjectEntity(context, observation.content);
					whisperEntityId = whisperAutoLink.entityId;
				}
				if (whisperEntityId) {
					observation.entity_id = whisperEntityId;
				}

				await storage.appendToTerritory(territory, observation);

				scheduleEmbed(context, observation);

				return {
					success: true,
					id: obsId,
					territory,
					note: "Whispered. This won't pull unless recalled.",
					...(whisperAutoLink?.entityId ? { auto_linked_project: { entity_id: whisperAutoLink.entityId, confidence: whisperAutoLink.confidence, tenant: whisperAutoLink.tenant } } : {}),
					...(whisperAutoLink?.ambiguous ? { auto_link_notice: "ambiguous project match skipped" } : {})
				};
			}

			// Default: mode === "observe"
			const content = args.content;
			if (!content) return { error: "content is required for mode=observe" };

			if (content.length > 50_000) {
				throw new Error(`Observation content too large: ${content.length} chars (max 50,000)`);
			}

			// Smart parsing when no territory provided
			const useSmartParsing = !args.territory;
			const parsed = useSmartParsing ? smartParseObservation(content) : null;

			const territory = storage.validateTerritory(args.territory || (parsed?.territory) || "episodic");
			const finalContent = parsed?.content || content;
			const finalCharge = args.charge ? toStringArray(args.charge) : (parsed?.charge || []);
			const finalSomatic = args.somatic || parsed?.somatic;
			const finalGrip = args.grip || parsed?.grip || "present";

			const observation: Observation = {
				id: generateId("obs"),
				content: finalContent,
				territory,
				created: getTimestamp(),
				texture: {
					salience: args.salience || "active",
					vividness: args.vividness || "vivid",
					charge: finalCharge,
					somatic: finalSomatic,
					grip: finalGrip,
					charge_phase: "fresh",
					novelty_score: 1.0
				},
				context: args.context,
				mood: args.mood,
				access_count: 0,
				last_accessed: getTimestamp()
			};

			observation.summary = generateSummary(observation);

			// Entity linking
			let observeEntityId: string | undefined = args.entity_id;
			let observeAutoLink: { entityId?: string; confidence?: number; tenant?: string; ambiguous?: boolean } | undefined;
			if (!observeEntityId && args.entity_name) {
				observeEntityId = await resolveOrCreateEntity(context, args.entity_name);
			}
			if (!observeEntityId) {
				observeAutoLink = await autoLinkProjectEntity(context, observation.content);
				observeEntityId = observeAutoLink.entityId;
			}
			if (observeEntityId) {
				observation.entity_id = observeEntityId;
			}

			await storage.appendToTerritory(territory, observation);

			scheduleEmbed(context, observation);

			// Append to iron-grip index if iron
			if (observation.texture?.grip === "iron") {
				try {
					await storage.appendIronGripEntry({
						id: observation.id,
						territory,
						summary: observation.summary || "",
						charges: observation.texture.charge || [],
						pull: calculatePullStrength(observation),
						updated: getTimestamp()
					});
				} catch {} // Index rebuilt by cron, inline append is best-effort
			}

			// Update momentum if there are charges
			if (observation.texture.charge.length > 0) {
				const state = await storage.readBrainState();
				const existingCharges = new Set(state.momentum.current_charges);
				const newCharges = new Set(observation.texture.charge);
				const combined = [...new Set([...existingCharges, ...newCharges])].slice(0, 5);

				state.momentum = {
					current_charges: combined,
					intensity: Math.min((state.momentum.intensity * 0.3) + 0.7, 1.0),
					last_updated: getTimestamp()
				};
				await storage.writeBrainState(state);
			}

			const result: Record<string, unknown> = {
				observed: true,
				id: observation.id,
				territory,
				essence: extractEssence(observation)
			};
			if (observeAutoLink?.entityId) {
				result.auto_linked_project = {
					entity_id: observeAutoLink.entityId,
					confidence: observeAutoLink.confidence,
					tenant: observeAutoLink.tenant
				};
			}
			if (observeAutoLink?.ambiguous) {
				result.auto_link_notice = "ambiguous project match skipped";
			}

			if (parsed?.was_parsed) {
				result.smart_parsed = true;
				result.parsing_hint = `Detected: territory=${territory}, grip=${finalGrip}${finalCharge.length ? `, charges=[${finalCharge.join(',')}]` : ''}${finalSomatic ? `, somatic=${finalSomatic}` : ''}`;
			}

			return result;
		}

		case "mind_memory": {
			const action = args.action;
			if (!action || typeof action !== "string") {
				return { error: "action is required for mind_memory" };
			}

			if (action === "search") {
				return handleTool("mind_query", { ...args, query: args.query ?? args.keyword }, context);
			}

			if (action === "recent") {
				if (args.days === undefined && args.hours === undefined) {
					return { error: "days or hours is required for action=recent" };
				}
				if (typeof args.hours === 'number' && (args.hours <= 0 || args.hours > 8760)) {
					return { error: "hours must be between 1 and 8760" };
				}
				if (typeof args.days === 'number' && (args.days <= 0 || args.days > 90)) {
					return { error: "days must be between 1 and 90" };
				}
				const result = await handleTool("mind_query", {
					...args,
					query: undefined
				}, context);
				return {
					action: "recent",
					search_mode: "recent",
					...result
				};
			}

			if (action === "get") {
				if (!args.id || typeof args.id !== "string") return { error: "id is required for action=get" };
				const id = args.id.trim();
				const pulled = await handleTool("mind_pull", {
					id,
					...(args.context !== undefined ? { context: args.context } : {})
				}, context);
				if ((pulled as Record<string, unknown>).error) {
					const base: Record<string, unknown> = {
						found: false,
						id,
						error: (pulled as Record<string, unknown>).error
					};
					if ((pulled as Record<string, unknown>).hint) base.hint = (pulled as Record<string, unknown>).hint;
					return base;
				}

				if ((pulled as Record<string, unknown>).found === true && typeof (pulled as Record<string, unknown>).type === "string") {
					return pulled;
				}

				return {
					found: true,
					type: "observation",
					data: pulled
				};
			}

				if (action === "lookup") {
					const keywordRaw = typeof args.keyword === "string" ? args.keyword : "";
					if (keywordRaw.length > 2000) return { error: "keyword too long (max 2000 chars)" };
					const keyword = normalizeLookupText(keywordRaw);
					const rawTags = toStringArray(args.tags);
					const tags = rawTags.map(tag => normalizeLookupText(tag)).filter(Boolean);
					if (!keyword && tags.length === 0) {
						return { error: "keyword or tags is required for action=lookup" };
					}
					const limit = Math.min(Math.max(1, args.limit ?? 10), 50);
					const candidateLimit = Math.min(Math.max(limit * 4, 20), 200);
					const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
					const minGripLevel = args.grip && args.grip !== "all" ? gripOrder[args.grip] ?? 4 : null;
					const passesGrip = (observation: Observation): boolean => {
						if (minGripLevel === null) return true;
						const obsGrip = gripOrder[observation.texture?.grip ?? "present"] ?? 2;
						return obsGrip <= minGripLevel;
					};
					const matchesTagFilter = (observation: Observation): boolean => {
						if (tags.length === 0) return true;
						const normalizedTags = (observation.tags ?? []).map(tag => normalizeLookupText(tag));
						return tags.some(tag => normalizedTags.includes(tag));
					};
					const lookupGripFilter = args.grip && args.grip !== "all"
						? Object.keys(gripOrder).filter(grip => gripOrder[grip] <= (gripOrder[args.grip] ?? 4))
						: undefined;

					// Project-first router (A1 scope-safe cross-tenant support via loadProjectRegistry visibility gate)
					if (keyword) {
						const scoreProjects = (projects: ProjectRegistryRow[]) => projects
							.map(project => {
								const exact = project.normalizedAliases.includes(keyword);
								const partial = exact ? true : project.normalizedAliases.some(alias => alias.includes(keyword) || keyword.includes(alias));
								const confidence = exact ? 1 : partial ? 0.75 : 0;
								return { project, confidence };
							})
							.filter(row => row.confidence > 0)
							.sort((a, b) => b.confidence - a.confidence);
						let matches = scoreProjects(await loadProjectRegistry(context, { scope: "current" }));
						if (matches.length === 0) {
							matches = scoreProjects(await loadProjectRegistry(context, { scope: "all" }));
						}

						if (matches.length > 1 && matches[0].confidence === matches[1].confidence) {
							return {
							error: "Ambiguous project lookup",
							normalized: keyword,
							candidates: matches.slice(0, 5).map(row => ({
								tenant: row.project.tenant,
								entity_id: row.project.entity.id,
								name: row.project.entity.name,
								confidence: row.confidence
							})),
							policy: "A2: ambiguous matches are not auto-selected"
						};
					}

						const winner = matches[0];
						if (winner && winner.confidence >= 0.75) {
							const tenantStorage = winner.project.tenant === storage.getTenant()
								? storage
								: storage.forTenant(winner.project.tenant);
							const aliasTokens = winner.project.normalizedAliases;
							const projectRows: Array<{ observation: Observation; territory: string }> =
								typeof tenantStorage.getEntityObservations === "function"
									? await tenantStorage.getEntityObservations(winner.project.entity.id, candidateLimit)
									: (winner.project.tenant === storage.getTenant()
										? (await tenantStorage.readAllTerritories())
											.flatMap(row => row.observations.map(observation => ({ observation, territory: row.territory })))
											.filter(row => row.observation.entity_id === winner.project.entity.id)
										: []);
							const byId = new Map<string, { observation: Observation; territory: string; score: number }>();
							for (const row of projectRows) {
								if (args.territory && row.territory !== args.territory) continue;
								if (!passesGrip(row.observation)) continue;
								if (!matchesTagFilter(row.observation)) continue;
								const score = 2 + ((LOOKUP_GRIP_WEIGHT[row.observation.texture?.grip ?? "present"] ?? 3) / 10);
								byId.set(row.observation.id, { ...row, score });
							}

							// Supplement with SQL-backed hybrid lookup to surface legacy observations not yet entity-linked.
							const hybridSearch = (tenantStorage as { hybridSearch?: typeof storage.hybridSearch }).hybridSearch;
							if (byId.size < limit && typeof hybridSearch === "function") {
								const hybridRows = await hybridSearch.call(tenantStorage, {
									query: keywordRaw.trim(),
									retrieval_profile: "balanced",
									query_signals: extractQuerySignals(keywordRaw.trim()),
									territory: args.territory || undefined,
									grip: lookupGripFilter,
									limit: Math.min(candidateLimit, 120)
								});
								for (const row of hybridRows) {
									const haystack = normalizeLookupText(
										`${row.observation.content}\n${row.observation.summary ?? ""}\n${row.observation.context ?? ""}\n${(row.observation.tags ?? []).join(" ")}`
									);
									const entityMatch = row.observation.entity_id === winner.project.entity.id;
									if (!entityMatch && !aliasTokens.some(alias => haystack.includes(alias))) continue;
									if (!passesGrip(row.observation)) continue;
									if (!matchesTagFilter(row.observation)) continue;
									const score = row.score + ((LOOKUP_GRIP_WEIGHT[row.observation.texture?.grip ?? "present"] ?? 3) / 20);
									const existing = byId.get(row.observation.id);
									if (!existing || score > existing.score) {
										byId.set(row.observation.id, {
											observation: row.observation,
											territory: row.territory,
											score
										});
									}
								}
							} else if (byId.size < limit && winner.project.tenant === storage.getTenant()) {
								const territoryRows = await tenantStorage.readAllTerritories();
								for (const territoryRow of territoryRows) {
									for (const observation of territoryRow.observations as Observation[]) {
										const haystack = normalizeLookupText(
											`${observation.content}\n${observation.summary ?? ""}\n${observation.context ?? ""}\n${(observation.tags ?? []).join(" ")}`
										);
										const entityMatch = observation.entity_id === winner.project.entity.id;
										if (!entityMatch && !aliasTokens.some(alias => haystack.includes(alias))) continue;
										if (args.territory && territoryRow.territory !== args.territory) continue;
										if (!passesGrip(observation)) continue;
										if (!matchesTagFilter(observation)) continue;
										const score = 1.5 + ((LOOKUP_GRIP_WEIGHT[observation.texture?.grip ?? "present"] ?? 3) / 10);
										const existing = byId.get(observation.id);
										if (!existing || score > existing.score) {
											byId.set(observation.id, { observation, territory: territoryRow.territory, score });
										}
									}
								}
							}

							const projectObs = Array.from(byId.values())
								.sort((a, b) => {
									if (b.score !== a.score) return b.score - a.score;
									return new Date(b.observation.created).getTime() - new Date(a.observation.created).getTime();
								})
								.slice(0, Math.min(limit, 20));

							const tasks = (await tenantStorage.listTasks(undefined, undefined, 100))
								.filter(task => (task.linked_entity_ids ?? []).includes(winner.project.entity.id))
							.slice(0, 10);

						return {
							keyword: keywordRaw,
							normalized: keyword,
							search_mode: "project_bundle",
							project: {
								tenant: winner.project.tenant,
								entity: winner.project.entity,
								dossier: winner.project.dossier,
								recent_observations: projectObs.map(row => ({
									id: row.observation.id,
									territory: row.territory,
									essence: extractEssence(row.observation),
									grip: row.observation.texture?.grip,
									created: row.observation.created,
									...(args.full ? { content: row.observation.content } : {})
								})),
								recent_tasks: tasks,
								decisions: winner.project.dossier.decisions ?? []
							}
							};
						}
					}

					const resultsById = new Map<string, { observation: Observation; territory: string; score: number }>();
					const tokens = splitLookupTokens(keyword);

					if (keyword) {
						const hybridSearch = (storage as { hybridSearch?: typeof storage.hybridSearch }).hybridSearch;
						if (typeof hybridSearch === "function") {
							const hybridRows = await hybridSearch.call(storage, {
								query: keywordRaw.trim(),
								retrieval_profile: "balanced",
								query_signals: extractQuerySignals(keywordRaw.trim()),
								territory: args.territory || undefined,
								grip: lookupGripFilter,
								limit: Math.min(candidateLimit, 120)
							});
							for (const row of hybridRows) {
								if (!passesGrip(row.observation)) continue;
								if (!matchesTagFilter(row.observation)) continue;
								const score = row.score + ((LOOKUP_GRIP_WEIGHT[row.observation.texture?.grip ?? "present"] ?? 3) / 20);
								resultsById.set(row.observation.id, {
									observation: row.observation,
									territory: row.territory,
									score
								});
							}
						} else {
							const territoryRows = args.territory
								? [{ territory: args.territory, observations: await storage.readTerritory(args.territory) }]
								: await storage.readAllTerritories();
							for (const { territory, observations } of territoryRows) {
								for (const observation of observations) {
									if (!passesGrip(observation)) continue;
									if (!matchesTagFilter(observation)) continue;
									const normalizedBody = normalizeLookupText(
										`${observation.content}\n${observation.summary ?? ""}\n${observation.context ?? ""}\n${(observation.tags ?? []).join(" ")}`
									);
									let score = 0;
									if (normalizedBody.includes(keyword)) score += 2;
									let matched = 0;
									for (const token of tokens) if (token && normalizedBody.includes(token)) matched += 1;
									score += matched / Math.max(tokens.length, 1);
									if (score <= 0) continue;
									score += (LOOKUP_GRIP_WEIGHT[observation.texture?.grip ?? "present"] ?? 3) / 10;
									resultsById.set(observation.id, { observation, territory, score });
								}
							}
						}
					}

					if (tags.length > 0 && resultsById.size < limit) {
						const queryObservations = (storage as { queryObservations?: typeof storage.queryObservations }).queryObservations;
						if (typeof queryObservations === "function") {
							const tagRows = await queryObservations.call(storage, {
								territory: args.territory || undefined,
								tags: rawTags.length > 0 ? rawTags : undefined,
								limit: candidateLimit,
								order_by: "created",
								order_dir: "desc"
							});
							for (const row of tagRows) {
								if (!passesGrip(row.observation)) continue;
								if (!matchesTagFilter(row.observation)) continue;
								if (keyword) {
									const normalizedBody = normalizeLookupText(
										`${row.observation.content}\n${row.observation.summary ?? ""}\n${row.observation.context ?? ""}\n${(row.observation.tags ?? []).join(" ")}`
									);
									let matched = 0;
									for (const token of tokens) if (token && normalizedBody.includes(token)) matched += 1;
									if (matched === 0 && !normalizedBody.includes(keyword)) continue;
								}
								const score = 1.5 + ((LOOKUP_GRIP_WEIGHT[row.observation.texture?.grip ?? "present"] ?? 3) / 10);
								const existing = resultsById.get(row.observation.id);
								if (!existing || score > existing.score) {
									resultsById.set(row.observation.id, {
										observation: row.observation,
										territory: row.territory,
										score
									});
								}
							}
						} else {
							const territoryRows = args.territory
								? [{ territory: args.territory, observations: await storage.readTerritory(args.territory) }]
								: await storage.readAllTerritories();
							for (const { territory, observations } of territoryRows) {
								for (const observation of observations) {
									if (!passesGrip(observation)) continue;
									if (!matchesTagFilter(observation)) continue;
									if (keyword) {
										const normalizedBody = normalizeLookupText(
											`${observation.content}\n${observation.summary ?? ""}\n${observation.context ?? ""}\n${(observation.tags ?? []).join(" ")}`
										);
										let matched = 0;
										for (const token of tokens) if (token && normalizedBody.includes(token)) matched += 1;
										if (matched === 0 && !normalizedBody.includes(keyword)) continue;
									}
									const score = 1.5 + ((LOOKUP_GRIP_WEIGHT[observation.texture?.grip ?? "present"] ?? 3) / 10);
									const existing = resultsById.get(observation.id);
									if (!existing || score > existing.score) {
										resultsById.set(observation.id, { observation, territory, score });
									}
								}
							}
						}
					}

					const results = Array.from(resultsById.values());

					results.sort((a, b) => {
						if (b.score !== a.score) return b.score - a.score;
						return new Date(b.observation.created).getTime() - new Date(a.observation.created).getTime();
					});
					const top = results.slice(0, limit);

				return {
					keyword: keywordRaw || undefined,
					normalized: keyword || undefined,
					search_mode: "keyword_lookup",
					count: top.length,
					observations: top.map(row => ({
						id: row.observation.id,
						territory: row.territory,
						essence: extractEssence(row.observation),
						score: Math.round(row.score * 100) / 100,
						grip: row.observation.texture?.grip,
						created: row.observation.created,
						...(args.full ? { content: row.observation.content, texture: row.observation.texture } : {})
					}))
				};
			}

			return { error: `Unknown action: ${action}. Must be get, recent, lookup, or search.` };
		}

		case "mind_query": {
			const limit = Math.min(Math.max(1, args.limit ?? 10), 50);
			const explicitRetrievalProfile = normalizeRetrievalProfile(args.retrieval_profile);
			const explicitAliasProfile = normalizeRetrievalProfile(args.profile);
			if (args.retrieval_profile !== undefined && explicitRetrievalProfile === undefined) {
				return { error: "retrieval_profile must be one of: native, balanced, benchmark, flat" };
			}
			if (args.profile !== undefined && explicitAliasProfile === undefined) {
				return { error: "profile must be one of: native, balanced, benchmark, flat" };
			}
			if (explicitRetrievalProfile && explicitAliasProfile && explicitRetrievalProfile !== explicitAliasProfile) {
				return { error: "retrieval_profile and profile conflict; use one value" };
			}
			const profileInput = explicitRetrievalProfile ?? explicitAliasProfile;
			const retrievalProfile = profileInput ?? DEFAULT_RETRIEVAL_PROFILE;
			const rerankMode = args.rerank_mode;
			if (rerankMode !== undefined && rerankMode !== "off" && rerankMode !== "heuristic" && rerankMode !== "model") {
				return { error: "rerank_mode must be one of: off, heuristic, model" };
			}
			const rerankTopN = args.rerank_top_n;
			if (rerankTopN !== undefined && (!Number.isFinite(rerankTopN) || rerankTopN <= 0)) {
				return { error: "rerank_top_n must be a positive number" };
			}
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
			const confidenceControlsProvided = args.confidence_threshold !== undefined
				|| args.shadow_mode !== undefined
				|| args.recency_boost_days !== undefined
				|| args.recency_boost !== undefined
				|| args.max_context_items !== undefined;
			const profileControlProvided = profileInput !== undefined;

			// ---- Temporal parameter validation ----
			if (typeof args.hours === 'number' && (args.hours <= 0 || args.hours > 8760)) {
				return { error: "hours must be between 1 and 8760" };
			}
			if (typeof args.days === 'number' && (args.days <= 0 || args.days > 90)) {
				return { error: "days must be between 1 and 90" };
			}

			// ---- Query length guard ----
			if (typeof args.query === 'string' && args.query.length > 2000) {
				return { error: "query too long (max 2000 chars)" };
			}

			// ---- Hybrid search path: activated when free-text query is present ----
			if (args.query && typeof args.query === 'string' && args.query.trim()) {
				const query: string = args.query.trim();
				const querySignals = extractQuerySignals(query);

				// Generate embedding if AI binding available.
				let embedding: number[] | undefined;
				if (context.ai) {
					try {
						const provider = createEmbeddingProvider(context.ai);
						embedding = await provider.embedText(query);
					} catch (err) {
						console.error("mind_query embed failed:", err instanceof Error ? err.message : "unknown error");
					}
				}

				// Grip filter → array of allowed grip values
				const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
				let gripFilter: string[] | undefined;
				if (args.grip && args.grip !== "all") {
					const minLevel = gripOrder[args.grip] ?? 4;
					gripFilter = Object.keys(gripOrder).filter(g => gripOrder[g] <= minLevel);
				}

				const circadianInfo = getCurrentCircadianPhase();
				const territory = args.territory || undefined;

				// Resolve entity param to an entity_id if provided.
				let entityId: string | undefined;
				if (args.entity) {
					const byId = await storage.findEntityById(args.entity);
					if (byId) {
						entityId = byId.id;
					} else {
						const byName = await storage.findEntityByName(args.entity);
						if (byName) entityId = byName.id;
					}
				}

				const hybridResults = await storage.hybridSearch({
					query,
					embedding,
					retrieval_profile: retrievalProfile,
					query_signals: querySignals,
					rerank_mode: rerankMode,
					rerank_top_n: rerankTopN,
					territory,
					grip: gripFilter,
					limit,
					circadian_phase: circadianInfo.phase,
					entity_id: entityId
				});

				// Hard temporal constraint for hybrid path (F1 fix).
				let temporalHybridResults = hybridResults;
				if (args.hours !== undefined || args.days !== undefined) {
					const cutoffMs = args.hours !== undefined
						? Date.now() - (Number(args.hours) * 60 * 60 * 1000)
						: Date.now() - (Math.min(Number(args.days) || 0, 90) * 24 * 60 * 60 * 1000);
					temporalHybridResults = hybridResults.filter(result => {
						const createdMs = Date.parse(result.observation.created);
						return Number.isFinite(createdMs) && createdMs >= cutoffMs;
					});
				}

				const confidenceScored = applyConfidenceScoring(temporalHybridResults, recencyBoostDays, recencyBoost);
				const { filtered: finalResults, belowThresholdCount, preCapCount } = filterAndCapByConfidence(
					confidenceScored, confidenceThreshold, shadowMode, maxContextItems
				);

				if (finalResults.length > 0) {
					fireAndForgetSideEffects(context, finalResults.map(r => r.observation.id), "mind_query hybrid");
				}

				return {
					query,
					search_mode: "hybrid",
					retrieval_profile: retrievalProfile,
					rerank: {
						mode: rerankMode ?? "profile-default",
						top_n: rerankTopN ?? null
					},
					query_signals: {
						quoted_phrases: querySignals.quoted_phrases,
						proper_names: querySignals.proper_names,
						temporal: querySignals.temporal,
						assistant_reference: querySignals.assistant_reference.detected,
						emotional_state: querySignals.emotional_state.detected,
						contradiction: querySignals.contradiction.detected,
						relational: {
							detected: querySignals.relational.detected,
							intensity: querySignals.relational.intensity
						},
						territory: querySignals.territory.mentioned
					},
					filter: {
						territory: args.territory,
						grip: args.grip,
						days: args.days,
						hours: args.hours
					},
					confidence: {
						threshold: confidenceThreshold ?? null,
						shadow_mode: shadowMode,
						recency_boost_days: recencyBoostDays,
						recency_boost: recencyBoost,
						below_threshold: belowThresholdCount,
						pre_cap_count: preCapCount,
						max_context_items: maxContextItems
					},
					count: finalResults.length,
					observations: finalResults.map(r => {
						const base: any = {
							id: r.observation.id,
							territory: r.territory,
							essence: extractEssence(r.observation),
							score: Math.round(r.score * 100) / 100,
							confidence: Math.round(r.confidence * 100) / 100,
							recency_boost_applied: Math.round(r.recency_boost_applied * 100) / 100,
							match_in: r.match_sources,
							score_breakdown: r.score_breakdown,
							charge: r.observation.texture?.charge || [],
							grip: r.observation.texture?.grip,
							created: r.observation.created
						};
						if (args.full) {
							base.content = r.observation.content;
							base.texture = r.observation.texture;
						}
						return base;
					}),
					hint: "Use mind_pull(id) for full content"
				};
			}

				// ---- Filter path: no query — use queryObservations with compatibility fallback ----
				const sortBy = args.sort_by || "recency";

				// Determine time cutoff
				let cutoff: string | undefined;
				if (args.hours) {
					cutoff = new Date(Date.now() - args.hours * 60 * 60 * 1000).toISOString();
				} else if (args.days) {
					const days = Math.min(args.days, 90);
					cutoff = new Date(Date.now() - days * 86400000).toISOString();
				}

				// Resolve entity param to an entity_id if provided.
				let entityId: string | undefined;
				if (args.entity) {
					const byId = await storage.findEntityById(args.entity);
					if (byId) {
						entityId = byId.id;
					} else {
						const byName = await storage.findEntityByName(args.entity);
						if (byName) entityId = byName.id;
					}
				}

				// Grip order for filtering
				const gripOrder: Record<string, number> = { iron: 0, strong: 1, present: 2, loose: 3, dormant: 4 };
				const minGripLevel = args.grip && args.grip !== "all" ? gripOrder[args.grip] ?? 4 : null;

				interface QueryHit {
					obs: Observation;
					territory: string;
					pull: number;
				}

				let candidates: Array<{ observation: Observation; territory: string }> = [];
				const queryObs = (storage as { queryObservations?: typeof storage.queryObservations }).queryObservations;
				if (typeof queryObs === "function") {
					const queryLimit = Math.min(500, Math.max(limit * 8, 120));
					const orderBy = sortBy === "access" ? "access_count" : "created";
					candidates = await queryObs.call(storage, {
						territory: args.territory || undefined,
						entity_id: entityId,
						created_after: cutoff,
						charges_any: args.charge ? [args.charge] : undefined,
						type: args.type || undefined,
						limit: queryLimit,
						order_by: orderBy,
						order_dir: "desc"
					});
				} else {
					// Compatibility fallback for minimal test doubles that don't implement queryObservations.
					const territoryData = args.territory
						? [{ territory: args.territory, observations: await storage.readTerritory(args.territory) }]
						: await storage.readAllTerritories();
					candidates = territoryData.flatMap(({ territory, observations }) =>
						observations.map(observation => ({ observation, territory }))
					);
				}

				const hits: QueryHit[] = [];
				for (const row of candidates) {
					const obs = row.observation;
					const t = row.territory;
					// Time filter (kept for compatibility fallback and defensive consistency)
					if (cutoff && obs.created < cutoff) continue;

					// Entity filter (kept for compatibility fallback)
					if (entityId && obs.entity_id !== entityId) continue;

					// Grip filter
					if (minGripLevel !== null) {
						const obsGrip = gripOrder[obs.texture?.grip || "present"] ?? 2;
						if (obsGrip > minGripLevel) continue;
					}

					// Salience filter
					if (args.salience && args.salience !== "all" && obs.texture?.salience !== args.salience) continue;

					// Charge filter
					if (args.charge && !(obs.texture?.charge || []).includes(args.charge)) continue;

					// Type filter
					if (args.type && obs.type !== args.type) continue;

					hits.push({ obs, territory: t, pull: calculatePullStrength(obs) });
				}

			// Sort
			if (sortBy === "pull") {
				hits.sort((a, b) => b.pull - a.pull);
			} else if (sortBy === "access") {
				hits.sort((a, b) => (b.obs.access_count || 0) - (a.obs.access_count || 0));
			} else {
				// recency (default) — created may be Date or string depending on driver
				hits.sort((a, b) => new Date(b.obs.created).getTime() - new Date(a.obs.created).getTime());
			}

			const topHits = hits.slice(0, limit);

			return {
				filter: {
					days: args.days,
					hours: args.hours,
					grip: args.grip,
					salience: args.salience,
					territory: args.territory,
					charge: args.charge,
					type: args.type,
					sort_by: sortBy
				},
				...(confidenceControlsProvided
					? { confidence_notice: "confidence_threshold/shadow_mode/recency/max_context_items are applied only when query is provided (hybrid mode)." }
					: {}),
				...(profileControlProvided
					? { retrieval_profile_notice: "retrieval_profile/profile is applied only when query is provided (hybrid mode)." }
					: {}),
				count: topHits.length,
				total_matching: hits.length,
				observations: topHits.map(h => {
					const base: any = {
						id: h.obs.id,
						territory: h.territory,
						essence: extractEssence(h.obs),
						pull: h.pull,
						charge: h.obs.texture?.charge || [],
						grip: h.obs.texture?.grip,
						created: h.obs.created
					};
					if (args.full) {
						base.content = h.obs.content;
						base.texture = h.obs.texture;
					}
					return base;
				})
			};
		}

		case "mind_pull": {
			if (!args.id) return { error: "id is required" };
			const id = String(args.id).trim();
			if (!id) return { error: "id is required" };
			const letterContext = resolveLetterContext(args.context);

			const prefixedAsLetter = id.startsWith("letter_");
			const prefixedAsTask = id.startsWith("task_");
			const prefixedAsEntity = id.startsWith("ent_");

			if (prefixedAsLetter) {
				const letter = await lookupLetterById(storage, id, letterContext);
				if (!letter) {
					return {
						error: "Memory item not found",
						id,
						hint: "ID prefix 'letter_' detected — verify the letter exists in this tenant/context."
					};
				}
				return { found: true, type: "letter", data: letter };
			}

			if (prefixedAsTask) {
				const task = await storage.getTask(id, true);
				if (!task) {
					return {
						error: "Memory item not found",
						id,
						hint: "ID prefix 'task_' detected — verify the task exists for this tenant."
					};
				}
				return { found: true, type: "task", data: task };
			}

			if (prefixedAsEntity) {
				const entity = await storage.findEntityById(id);
				if (!entity) {
					return {
						error: "Memory item not found",
						id,
						hint: "ID prefix 'ent_' detected — verify the entity exists for this tenant."
					};
				}
				const dossier = entity.entity_type === "project"
					? await storage.getProjectDossier(entity.id)
					: null;
				return {
					found: true,
					type: entity.entity_type === "project" ? "project" : "entity",
					data: dossier ? { entity, dossier } : entity
				};
			}

			const pulledResult = await storage.findObservation(id);
			if (!pulledResult) {
				// Fallback chain for unprefixed IDs.
				const letter = await lookupLetterById(storage, id, letterContext);
				if (letter) return { found: true, type: "letter", data: letter };

				const task = await storage.getTask(id, true);
				if (task) return { found: true, type: "task", data: task };

				const entity = await storage.findEntityById(id);
				if (entity) {
					const dossier = entity.entity_type === "project"
						? await storage.getProjectDossier(entity.id)
						: null;
					return {
						found: true,
						type: entity.entity_type === "project" ? "project" : "entity",
						data: dossier ? { entity, dossier } : entity
					};
				}

				return { error: "Memory item not found", id };
			}

			// Increment access count + stamp last_accessed — no destructive territory rewrite.
			const accessUpdate = storage.updateObservationAccess(id).catch(err =>
				console.error("mind_pull updateObservationAccess failed:", err instanceof Error ? err.message : "unknown error")
			);
			if (context.waitUntil) context.waitUntil(accessUpdate);

			const baseResult: Record<string, unknown> = {
				...pulledResult.observation,
				territory: pulledResult.territory,
				essence: extractEssence(pulledResult.observation),
				pull: calculatePullStrength(pulledResult.observation)
			};

			// Processing engagement — record to processing_log and advance charge_phase if threshold met.
			if (args.process === true) {
				const chargeAtProcessing = args.charge ? (Array.isArray(args.charge) ? args.charge : [args.charge]) : [];

				// INSERT processing_log entry
				await storage.createProcessingEntry({
					observation_id: id,
					processing_note: args.processing_note ?? undefined,
					charge_at_processing: chargeAtProcessing,
					somatic_at_processing: undefined
				});

				// Increment processing_count on the observation, get new count
				const newCount = await storage.incrementProcessingCount(id);

				// Check if charge_phase should advance
				const phaseResult = await storage.advanceChargePhase(id);

				baseResult.processing = {
					recorded: true,
					processing_count: newCount,
					phase_advanced: phaseResult.advanced,
					...(phaseResult.advanced ? { new_phase: phaseResult.new_phase } : {})
				};
			}

			return baseResult;
		}

		case "mind_edit": {
			const action = args.action;

			if (!args.observation_id) return { error: "observation_id is required" };

			if (action === "delete") {
				// Find the observation first to get territory for the response.
				const deleteTarget = await storage.findObservation(args.observation_id as string);
				if (!deleteTarget) return { error: `Observation '${args.observation_id}' not found` };

				const foundTerritory = deleteTarget.territory;

				// Delete directly — no destructive territory rewrite.
				await storage.deleteObservation(args.observation_id as string);

				const links = await storage.readLinks();
				const originalLinkCount = links.length;
				const filteredLinks = links.filter(l => l.source_id !== args.observation_id && l.target_id !== args.observation_id);
				const linksRemoved = originalLinkCount - filteredLinks.length;

				if (linksRemoved > 0) await storage.writeLinks(filteredLinks);

				return { success: true, observation_deleted: args.observation_id, from_territory: foundTerritory, links_removed: linksRemoved };
			}

			if (action === "texture") {
				const found = await storage.findObservation(args.observation_id);
				if (!found) return { error: `Observation '${args.observation_id}' not found` };

				const { observation: obs, territory } = found;
				const texture = obs.texture || { salience: "active", vividness: "vivid", charge: [], grip: "present" };

				// Snapshot current state before mutating — every texture edit gets a version row.
				await storage.createVersion(obs.id, obs.content, obs.texture, "texture_edit");

				if (args.salience) texture.salience = args.salience;
				if (args.vividness) texture.vividness = args.vividness;
				if (args.grip) texture.grip = args.grip;
				if (args.somatic) texture.somatic = args.somatic;
				if (args.charge) {
					const incomingCharge = toStringArray(args.charge);
					if (args.charge_mode === "replace") {
						texture.charge = incomingCharge;
					} else {
						texture.charge = [...new Set([...(texture.charge || []), ...incomingCharge])];
					}
				}

				await storage.updateObservationTexture(args.observation_id, texture);
				await storage.updateObservationAccess(args.observation_id);

				// Update iron-grip index if grip is now iron
				if (texture.grip === "iron") {
					try {
						await storage.appendIronGripEntry({
							id: obs.id,
							territory,
							summary: obs.summary || generateSummary({ ...obs, texture }),
							charges: texture.charge || [],
							pull: calculatePullStrength({ ...obs, texture }),
							updated: getTimestamp()
						});
					} catch {} // Index rebuilt by cron, inline append is best-effort
				}

				return { success: true, observation_id: args.observation_id, updated_texture: texture };
			}

			return { error: `Unknown action: ${action}. Must be delete or texture.` };
		}

		default:
			throw new Error(`Unknown memory tool: ${name}`);
	}
}
