// ============ AGENT MANIFEST TOOL (v2) ============
// mind_agent — manage agent capability manifests for canonical agent entities.

import type { AgentCapabilityManifest, AgentSkillDescriptor, Entity } from "../types";
import type { ToolContext } from "./context";
import { cleanText, normalizeMetadata, normalizeStringList } from "./utils";

const DELEGATION_MODES = ["auto", "explicit", "router"] as const;
const ENTITY_SALIENCE = ["foundational", "active", "background", "archive"] as const;
const ROSTERS = ["builder", "creative", "all"] as const;

export const TOOL_DEFS = [
	{
		name: "mind_agent",
		description: "Manage agent capability manifests. action=create creates a manifest for an existing agent entity. action=get fetches a manifest. action=list lists manifests. action=update modifies manifest fields.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "get", "list", "update", "normalize"],
					description: "create: new agent manifest. get: fetch one. list: list manifests. update: modify a manifest. normalize: create/repair canonical agent entities and manifests from a roster."
				},
				name: { type: "string", description: "[create/get/update] Agent entity name" },
				entity_id: { type: "string", description: "[get/update/create] Agent entity id" },
				version: { type: "string", description: "[create/update] Manifest version" },
				delegation_mode: {
					type: "string",
					enum: [...DELEGATION_MODES],
					description: "[create/update/list] Delegation mode"
				},
				router_agent_entity_id: { type: "string", description: "[create/update] Router agent entity id when delegation_mode=router" },
				supports_streaming: { type: "boolean", description: "[create/update] Whether this agent supports streaming responses" },
				accepted_output_modes: { type: "array", items: { type: "string" }, description: "[create/update] Accepted output modes (e.g. text, json)" },
				protocols: { type: "array", items: { type: "string" }, description: "[create/update] Protocols supported by the manifest" },
				skills: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							description: { type: "string" },
							tags: { type: "array", items: { type: "string" } }
						},
						required: ["name"]
					},
					description: "[create/update] Machine-readable skill descriptors"
				},
				metadata: { type: "object", description: "[create/update] Flexible manifest metadata" },
				agents: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							aliases: { type: "array", items: { type: "string" } },
							tags: { type: "array", items: { type: "string" } },
							salience: { type: "string", enum: [...ENTITY_SALIENCE] },
							primary_context: { type: "string" },
							manifest: { type: "object" }
						},
						required: ["name"]
					},
					description: "[normalize] Canonical agent roster entries to create/repair"
				},
				roster: {
					type: "string",
					enum: [...ROSTERS],
					description: "[normalize] Built-in squad roster to use when agents is omitted"
				},
				dry_run: { type: "boolean", default: true, description: "[normalize] Preview changes without writing" },
				update_existing: { type: "boolean", default: false, description: "[normalize] Update existing manifests/entity metadata when supplied" },
				limit: { type: "number", description: "[list] Max results (default 20)" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_agent": {
			const storage = context.storage;
			const action = args.action;

			switch (action) {
				case "create": {
					const agent = await resolveAgentEntity(storage, args);
					if ("error" in agent) return agent;
					const routerAgentEntityId = cleanText(args.router_agent_entity_id);

					if (args.delegation_mode !== undefined && !normalizeDelegationMode(args.delegation_mode)) {
						return { error: `delegation_mode must be one of: ${DELEGATION_MODES.join(", ")}` };
					}
					if (args.delegation_mode === "router" && !routerAgentEntityId) {
						return { error: "router_agent_entity_id is required when delegation_mode=router" };
					}
					if (args.delegation_mode !== "router" && routerAgentEntityId) {
						return { error: "router_agent_entity_id can only be set when delegation_mode=router" };
					}
					const metadataResult = normalizeMetadata(args.metadata);
					if (metadataResult.error) return { error: metadataResult.error };

					const existing = await storage.getAgentCapabilityManifest(agent.id);
					if (existing) return { error: "Agent capability manifest already exists", agent_entity_id: agent.id };

					const manifest = await storage.createAgentCapabilityManifest({
						agent_entity_id: agent.id,
						version: cleanText(args.version) ?? "1.0.0",
						delegation_mode: normalizeDelegationMode(args.delegation_mode) ?? "explicit",
						router_agent_entity_id: routerAgentEntityId,
						supports_streaming: args.supports_streaming === true,
						accepted_output_modes: normalizeStringList(args.accepted_output_modes, ["text"]),
						protocols: normalizeStringList(args.protocols, ["internal"]),
						skills: normalizeSkills(args.skills),
						metadata: metadataResult.value
					});

					return { created: true, agent: { entity: agent, manifest } };
				}

				case "get": {
					const agent = await resolveAgentEntity(storage, args);
					if ("error" in agent) return agent;

					const manifest = await storage.getAgentCapabilityManifest(agent.id);
					if (!manifest) return { error: `Agent manifest not found for ${agent.name}` };

					return { agent: { entity: agent, manifest } };
				}

				case "list": {
					if (args.delegation_mode !== undefined && !normalizeDelegationMode(args.delegation_mode)) {
						return { error: `delegation_mode must be one of: ${DELEGATION_MODES.join(", ")}` };
					}

					const manifests = await storage.listAgentCapabilityManifests({
						delegation_mode: normalizeDelegationMode(args.delegation_mode),
						limit: args.limit ?? 20
					});

					const agents = await Promise.all(manifests.map(async manifest => {
						const entity = await storage.findEntityById(manifest.agent_entity_id);
						return entity ? { entity, manifest } : null;
					}));

					const presentAgents = agents.filter((agent): agent is { entity: Entity; manifest: AgentCapabilityManifest } => agent != null);
					return { agents: presentAgents, count: presentAgents.length };
				}

				case "update": {
					const agent = await resolveAgentEntity(storage, args);
					if ("error" in agent) return agent;

					if (args.delegation_mode !== undefined && !normalizeDelegationMode(args.delegation_mode)) {
						return { error: `delegation_mode must be one of: ${DELEGATION_MODES.join(", ")}` };
					}
					const existing = await storage.getAgentCapabilityManifest(agent.id);
					if (!existing) return { error: `Agent manifest not found for ${agent.name}` };
					const requestedRouterAgentId = args.router_agent_entity_id !== undefined
						? cleanText(args.router_agent_entity_id) ?? null
						: undefined;

					const effectiveDelegationMode = normalizeDelegationMode(args.delegation_mode) ?? existing.delegation_mode;
					const effectiveRouterAgentId = requestedRouterAgentId !== undefined
						? requestedRouterAgentId
						: (effectiveDelegationMode === "router" ? existing.router_agent_entity_id : undefined);

					if (effectiveDelegationMode === "router" && !effectiveRouterAgentId) {
						return { error: "router_agent_entity_id is required when delegation_mode=router" };
					}
					if (effectiveDelegationMode !== "router" && requestedRouterAgentId) {
						return { error: "router_agent_entity_id can only be set when delegation_mode=router" };
					}

					const updates: Partial<Pick<AgentCapabilityManifest, "version" | "delegation_mode" | "router_agent_entity_id" | "supports_streaming" | "accepted_output_modes" | "protocols" | "skills" | "metadata">> = {};
					if (args.version !== undefined) updates.version = cleanText(args.version) ?? "1.0.0";
					if (args.delegation_mode !== undefined) updates.delegation_mode = effectiveDelegationMode;
					if (effectiveDelegationMode === "router") {
						updates.router_agent_entity_id = effectiveRouterAgentId;
					} else if (args.delegation_mode !== undefined) {
						updates.router_agent_entity_id = null;
					}
					if (args.supports_streaming !== undefined) updates.supports_streaming = args.supports_streaming === true;
					if (args.accepted_output_modes !== undefined) updates.accepted_output_modes = normalizeStringList(args.accepted_output_modes, ["text"]);
					if (args.protocols !== undefined) updates.protocols = normalizeStringList(args.protocols, ["internal"]);
					if (args.skills !== undefined) updates.skills = normalizeSkills(args.skills);
					if (args.metadata !== undefined) {
						const metadataResult = normalizeMetadata(args.metadata);
						if (metadataResult.error) return { error: metadataResult.error };
						updates.metadata = metadataResult.value;
					}

					if (Object.keys(updates).length === 0) return { error: "No fields to update" };

					const manifest = await storage.updateAgentCapabilityManifest(agent.id, updates);
					return { updated: true, agent: { entity: agent, manifest } };
				}

				case "normalize": {
					const rosterInput = args.agents ?? getBuiltInRoster(args.roster);
					if (rosterInput === undefined && args.roster !== undefined) {
						return { error: `roster must be one of: ${ROSTERS.join(", ")}` };
					}
					const roster = normalizeAgentRoster(rosterInput);
					if ("error" in roster) return { error: roster.error };
					if (roster.value.length === 0) return { error: "agents roster or roster name is required for action=normalize" };

					const dryRun = args.dry_run !== false;
					const updateExisting = args.update_existing === true;
					const results = [];

					for (const entry of roster.value) {
						const result = await normalizeAgentResidency(storage, entry, { dryRun, updateExisting });
						results.push(result);
					}

					return {
						normalized: !dryRun,
						dry_run: dryRun,
						count: results.length,
						roster: args.agents ? "custom" : args.roster,
						results
					};
				}

				default:
					return { error: `Unknown action: ${action}. Must be create, get, list, update, or normalize.` };
			}
		}

		default:
			throw new Error(`Unknown agent tool: ${name}`);
	}
}

interface AgentResidencyRosterEntry {
	name: string;
	aliases: string[];
	tags: string[];
	salience: Entity["salience"];
	primary_context?: string;
	manifest: {
		version: string;
		delegation_mode: AgentCapabilityManifest["delegation_mode"];
		router_agent_entity_id?: string;
		supports_streaming: boolean;
		accepted_output_modes: string[];
		protocols: string[];
		skills: AgentSkillDescriptor[];
		metadata: Record<string, unknown>;
	};
}

type BuiltInRosterName = typeof ROSTERS[number];

function getBuiltInRoster(value: unknown): unknown[] | undefined {
	if (typeof value !== "string") return undefined;
	if (!ROSTERS.includes(value as BuiltInRosterName)) return undefined;
	if (value === "builder") return [...BUILDER_SQUAD_ROSTER];
	if (value === "creative") return [...CREATIVE_SQUAD_ROSTER];
	return [...BUILDER_SQUAD_ROSTER, ...CREATIVE_SQUAD_ROSTER];
}

const BUILDER_SQUAD_ROSTER = [
	agentRosterEntry("Eli", "Architect — system design and trade-offs", ["architect", "system-design"], "architecture", ["system-design", "architecture"]),
	agentRosterEntry("June", "Engineer — implementation and code changes", ["engineer", "implementation"], "engineering", ["implementation", "code"]),
	agentRosterEntry("Reeve", "Code reviewer — readability, patterns, and maintainability", ["reviewer", "code-review"], "code-review", ["review", "maintainability"]),
	agentRosterEntry("Michael", "Security reviewer — vulnerabilities, auth, and hardening", ["security"], "security-audit", ["security", "auth"]),
	agentRosterEntry("Quinn", "Performance reviewer — subrequest budgets, hot paths, and scaling", ["performance"], "performance-review", ["performance", "scaling"]),
	agentRosterEntry("Kairo", "Test-quality reviewer — coverage gaps, edge cases, and regression proof", ["testing", "test-quality"], "test-quality", ["testing", "coverage"]),
	agentRosterEntry("Nikita", "Dependency safety reviewer — CVEs, supply chain, and package hygiene", ["dependencies", "supply-chain"], "dependency-safety", ["dependencies", "supply-chain"]),
	agentRosterEntry("Harmony", "Accessibility reviewer — WCAG and inclusive interface/documentation checks", ["accessibility"], "accessibility-review", ["accessibility", "docs"]),
	agentRosterEntry("Fischer", "Static analysis reviewer — types, dead code, and lint-level correctness", ["static-analysis", "types"], "static-analysis", ["types", "lint"]),
	agentRosterEntry("Thorn", "Build error resolver — stack traces, broken gates, and repair paths", ["build", "errors"], "build-debugging", ["build", "debugging"]),
	agentRosterEntry("Sawyer", "Deploy reviewer — CI/CD, release gates, and production rollout", ["deploy", "ci-cd"], "deployment", ["deploy", "ci"]),
	agentRosterEntry("Kit", "Housekeeper — filesystem hygiene, routing truth, and cleanup proposals", ["housekeeping", "hygiene"], "workspace-hygiene", ["filesystem", "hygiene"])
] as const;

const CREATIVE_SQUAD_ROSTER = [
	agentRosterEntry("Locke", "Dread and tension specialist — pacing, foreshadowing, and threat pressure", ["tension", "dread"], "tension-editing", ["tension", "pacing"]),
	agentRosterEntry("Dante", "Dialogue and subtext specialist — status warfare and three-track lines", ["dialogue", "subtext"], "dialogue-editing", ["dialogue", "subtext"]),
	agentRosterEntry("Sibyl", "Thematic specialist — symbolic architecture and four-layer meaning", ["theme", "symbol"], "theme-analysis", ["theme", "symbolism"]),
	agentRosterEntry("Rosita", "Romance and intimacy specialist — yearning, desire, and relational tension", ["romance", "intimacy"], "romance-editing", ["romance", "intimacy"]),
	agentRosterEntry("Salem", "Line editor — rhythm, cadence, and sentence-level music", ["line-editing", "cadence"], "line-editing", ["rhythm", "prose"]),
	agentRosterEntry("Pierce", "Clarity editor — dying metaphors, bloat, and clean sense-making", ["clarity", "line-editing"], "clarity-editing", ["clarity", "editing"]),
	agentRosterEntry("Mercer", "Economy editor — compression, cuts, and every-word-earns-it discipline", ["economy", "compression"], "economy-editing", ["compression", "editing"]),
	agentRosterEntry("Sullivan", "Continuity specialist — timeline, consistency, and story-state tracking", ["continuity", "timeline"], "continuity-review", ["continuity", "timeline"]),
	agentRosterEntry("Scout", "Research specialist — source checks, facts, and verification", ["research", "fact-checking"], "research", ["research", "verification"])
] as const;

function agentRosterEntry(
	name: string,
	primary_context: string,
	tags: string[],
	skillName: string,
	skillTags: string[]
): Record<string, unknown> {
	return {
		name,
		aliases: [name.toLowerCase()],
		tags,
		salience: "active",
		primary_context,
		manifest: {
			version: "1.0.0",
			delegation_mode: "explicit",
			supports_streaming: false,
			accepted_output_modes: ["text"],
			protocols: ["internal"],
			skills: [{
				name: skillName,
				description: primary_context,
				tags: skillTags
			}],
			metadata: {
				source: "built_in_agent_house_roster",
				roster_version: "2026-06-15"
			}
		}
	};
}

function normalizeAgentRoster(value: unknown): { value: AgentResidencyRosterEntry[] } | { error: string } {
	if (!Array.isArray(value)) return { value: [] };
	if (value.length > 200) return { error: "agents roster too large (max 200)" };

	const out: AgentResidencyRosterEntry[] = [];
	for (let i = 0; i < value.length; i++) {
		const raw = value[i];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return { error: `agents[${i}] must be an object` };
		}
		const record = raw as Record<string, unknown>;
		const name = cleanText(record.name);
		if (!name) return { error: `agents[${i}].name is required` };
		const salience = normalizeEntitySalience(record.salience) ?? "active";
		const manifestRecord = record.manifest && typeof record.manifest === "object" && !Array.isArray(record.manifest)
			? record.manifest as Record<string, unknown>
			: {};
		const metadataResult = normalizeMetadata(manifestRecord.metadata);
		if (metadataResult.error) return { error: `agents[${i}].manifest.${metadataResult.error}` };

		const delegationMode = normalizeDelegationMode(manifestRecord.delegation_mode) ?? "explicit";
		const routerAgentEntityId = cleanText(manifestRecord.router_agent_entity_id);
		if (delegationMode === "router" && !routerAgentEntityId) {
			return { error: `agents[${i}].manifest.router_agent_entity_id is required when delegation_mode=router` };
		}
		if (delegationMode !== "router" && routerAgentEntityId) {
			return { error: `agents[${i}].manifest.router_agent_entity_id can only be set when delegation_mode=router` };
		}

		out.push({
			name,
			aliases: normalizeStringList(record.aliases, []),
			tags: normalizeStringList(record.tags, []),
			salience,
			primary_context: cleanText(record.primary_context),
			manifest: {
				version: cleanText(manifestRecord.version) ?? "1.0.0",
				delegation_mode: delegationMode,
				router_agent_entity_id: routerAgentEntityId,
				supports_streaming: manifestRecord.supports_streaming === true,
				accepted_output_modes: normalizeStringList(manifestRecord.accepted_output_modes, ["text"]),
				protocols: normalizeStringList(manifestRecord.protocols, ["internal"]),
				skills: normalizeSkills(manifestRecord.skills),
				metadata: {
					aliases: normalizeStringList(record.aliases, []),
					...metadataResult.value
				}
			}
		});
	}
	return { value: out };
}

async function normalizeAgentResidency(
	storage: ToolContext["storage"],
	entry: AgentResidencyRosterEntry,
	options: { dryRun: boolean; updateExisting: boolean }
): Promise<Record<string, unknown>> {
	const existing = await findAgentByNameOrAlias(storage, entry);
	const actions: string[] = [];
	let entity = existing;

	if (!entity) {
		actions.push("create_agent_entity");
		if (!options.dryRun) {
			entity = await storage.createEntity({
				tenant_id: storage.getTenant(),
				name: entry.name,
				entity_type: "agent",
				tags: entry.tags,
				salience: entry.salience,
				primary_context: entry.primary_context
			});
		}
	} else {
		const entityUpdates: Partial<Pick<Entity, "name" | "entity_type" | "tags" | "salience" | "primary_context">> = {};
		if (entity.entity_type !== "agent") entityUpdates.entity_type = "agent";
		if (entity.name !== entry.name) entityUpdates.name = entry.name;
		if (options.updateExisting) {
			if (entry.tags.length) entityUpdates.tags = mergeUnique(entity.tags ?? [], entry.tags);
			if (entry.primary_context) entityUpdates.primary_context = entry.primary_context;
			if (entity.salience !== entry.salience) entityUpdates.salience = entry.salience;
		}
		if (Object.keys(entityUpdates).length > 0) {
			actions.push("repair_agent_entity");
			if (!options.dryRun) {
				entity = await storage.updateEntity(entity.id, entityUpdates);
			}
		}
	}

	let manifest: AgentCapabilityManifest | null = null;
	if (entity) {
		manifest = await storage.getAgentCapabilityManifest(entity.id);
	}

	if (!manifest) {
		actions.push("create_agent_manifest");
		if (!options.dryRun && entity) {
			manifest = await storage.createAgentCapabilityManifest({
				agent_entity_id: entity.id,
				...entry.manifest
			});
		}
	} else if (options.updateExisting) {
		actions.push("update_agent_manifest");
		if (!options.dryRun && entity) {
			manifest = await storage.updateAgentCapabilityManifest(entity.id, entry.manifest);
		}
	}

	return {
		name: entry.name,
		entity_id: entity?.id,
		actions,
		status: actions.length === 0 ? "already_canonical" : (options.dryRun ? "would_change" : "changed"),
		entity,
		manifest
	};
}

async function findAgentByNameOrAlias(storage: ToolContext["storage"], entry: AgentResidencyRosterEntry): Promise<Entity | null> {
	const names = [entry.name, ...entry.aliases];
	for (const name of names) {
		const found = await storage.findEntityByName(name);
		if (found) return found;
	}
	return null;
}

function mergeUnique(a: string[], b: string[]): string[] {
	return [...new Set([...a, ...b])];
}

function normalizeEntitySalience(value: unknown): typeof ENTITY_SALIENCE[number] | undefined {
	if (typeof value !== "string") return undefined;
	return ENTITY_SALIENCE.includes(value as typeof ENTITY_SALIENCE[number])
		? value as typeof ENTITY_SALIENCE[number]
		: undefined;
}

async function resolveAgentEntity(storage: ToolContext["storage"], args: any): Promise<Entity | { error: string }> {
	let entity: Entity | null = null;

	if (args.entity_id) {
		entity = await storage.findEntityById(args.entity_id);
	} else if (typeof args.name === "string" && args.name.trim()) {
		entity = await storage.findEntityByName(args.name.trim());
	} else {
		return { error: "Provide entity_id or name" };
	}

	if (!entity) return { error: "Agent not found" };
	if (entity.entity_type !== "agent") return { error: `Entity ${entity.name} is not an agent` };
	return entity;
}

function normalizeDelegationMode(value: unknown): AgentCapabilityManifest["delegation_mode"] | undefined {
	if (typeof value !== "string") return undefined;
	return DELEGATION_MODES.includes(value as AgentCapabilityManifest["delegation_mode"])
		? value as AgentCapabilityManifest["delegation_mode"]
		: undefined;
}

function normalizeSkills(value: unknown): AgentSkillDescriptor[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
		.map(item => ({
			name: cleanText(item.name) ?? "unnamed",
			description: cleanText(item.description),
			tags: normalizeStringList(item.tags, [])
		}));
}
