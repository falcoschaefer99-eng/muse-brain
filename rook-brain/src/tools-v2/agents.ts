// ============ AGENT MANIFEST TOOL (v2) ============
// mind_agent — manage agent capability manifests for canonical agent entities.

import type { AgentCapabilityManifest, AgentSkillDescriptor, Entity } from "../types";
import type { ToolContext } from "./context";
import { cleanText, normalizeMetadata, normalizeStringList } from "./utils";

const DELEGATION_MODES = ["auto", "explicit", "router"] as const;

export const TOOL_DEFS = [
	{
		name: "mind_agent",
		description: "Manage agent capability manifests. action=create creates a manifest for an existing agent entity. action=get fetches a manifest. action=list lists manifests. action=update modifies manifest fields.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "get", "list", "update"],
					description: "create: new agent manifest. get: fetch one. list: list manifests. update: modify a manifest."
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

				default:
					return { error: `Unknown action: ${action}. Must be create, get, list, or update.` };
			}
		}

		default:
			throw new Error(`Unknown agent tool: ${name}`);
	}
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
