// ============ ENTITY TOOL (v2) ============
// mind_entity — manage entities (people, projects, agents, concepts)
// and their relations to each other and to observations.

import type { ToolContext } from "./context";

export const TOOL_DEFS = [
	{
		name: "mind_entity",
		description: "Manage entities (people, projects, agents, concepts). Entities are first-class named concepts that observations can be linked to.",
		inputSchema: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["create", "get", "list", "update", "relate", "link", "backfill"],
					description: "create: new entity. get: entity by name or id. list: filtered list. update: modify entity. relate: create relation between entities. link: link observation to entity. backfill: migrate entity_tags on existing observations to proper entities."
				},
				name: { type: "string", description: "[create/get/update] Entity name" },
				entity_type: {
					type: "string",
					enum: ["person", "project", "agent", "concept", "place", "organization"],
					description: "[create] Entity type"
				},
				tags: { type: "array", items: { type: "string" }, description: "[create/update] Tags" },
				salience: {
					type: "string",
					enum: ["foundational", "active", "background", "archive"],
					description: "[create/update] Salience level. Default: active"
				},
				primary_context: { type: "string", description: "[create/update] Brief description" },
				entity_id: { type: "string", description: "[get/update/relate/link] Entity ID" },
				include_observations: { type: "boolean", default: false, description: "[get] Include linked observations" },
				include_relations: { type: "boolean", default: false, description: "[get] Include relations" },
				type_filter: { type: "string", description: "[list] Filter by entity_type" },
				salience_filter: { type: "string", description: "[list] Filter by salience" },
				tag_filter: { type: "array", items: { type: "string" }, description: "[list] Filter by tags (any match)" },
				from_entity_id: { type: "string", description: "[relate] Source entity ID" },
				to_entity_id: { type: "string", description: "[relate] Target entity ID" },
				relation_type: { type: "string", description: "[relate] Relation type (e.g., 'created_by', 'part_of')" },
				strength: { type: "number", description: "[relate] Relation strength 0.0-1.0" },
				relation_context: { type: "string", description: "[relate] Why this relation exists" },
				observation_id: { type: "string", description: "[link] Observation ID to link" },
				limit: { type: "number", default: 20, description: "[get/list] Max results" }
			},
			required: ["action"]
		}
	}
];

export async function handleTool(name: string, args: any, context: ToolContext): Promise<any> {
	switch (name) {
		case "mind_entity": {
			const action = args.action;
			const storage = context.storage;

			switch (action) {
				case "create": {
					if (!args.name?.trim()) return { error: "Entity name is required" };
					if (!args.entity_type) return { error: "entity_type is required" };

					const cleanName = args.name.trim().replace(/[\x00-\x1f]/g, '');
					if (!cleanName) return { error: "Entity name is required" };
					if (cleanName.length > 200) return { error: "Entity name too long (max 200 chars)" };

					const existing = await storage.findEntityByName(cleanName);
					if (existing) return { error: "Entity already exists", existing_id: existing.id };

					const entity = await storage.createEntity({
						tenant_id: storage.getTenant(),
						name: cleanName,
						entity_type: args.entity_type,
						tags: args.tags || [],
						salience: args.salience || 'active',
						primary_context: args.primary_context
					});

					return { created: true, entity };
				}

				case "get": {
					let entity = null;
					if (args.entity_id) {
						entity = await storage.findEntityById(args.entity_id);
					} else if (args.name) {
						entity = await storage.findEntityByName(args.name);
					} else {
						return { error: "Provide entity_id or name" };
					}

					if (!entity) return { error: "Entity not found" };

					const result: any = { entity };

					if (args.include_observations) {
						result.observations = await storage.getEntityObservations(entity.id, args.limit || 20);
					}

					if (args.include_relations) {
						result.relations = await storage.getEntityRelations(entity.id);
					}

					return result;
				}

				case "list": {
					const entities = await storage.listEntities({
						entity_type: args.type_filter,
						salience: args.salience_filter,
						tags: args.tag_filter,
						limit: args.limit
					});
					return { entities, count: entities.length };
				}

				case "update": {
					const VALID_ENTITY_TYPES = ["person", "project", "agent", "concept", "place", "organization"];

					let entity = null;
					if (args.entity_id) {
						entity = await storage.findEntityById(args.entity_id);
					} else if (args.name) {
						entity = await storage.findEntityByName(args.name);
					}
					if (!entity) return { error: "Entity not found" };

					const updates: Partial<Pick<typeof entity, 'name' | 'entity_type' | 'tags' | 'salience' | 'primary_context'>> = {};
					if (args.name !== undefined) {
						const cleanUpdateName = args.name.trim().replace(/[\x00-\x1f]/g, '');
						if (!cleanUpdateName) return { error: "Entity name is required" };
						if (cleanUpdateName.length > 200) return { error: "Entity name too long (max 200 chars)" };
						updates.name = cleanUpdateName;
					}
					if (args.entity_type !== undefined) {
						if (!VALID_ENTITY_TYPES.includes(args.entity_type)) {
							return { error: `Invalid entity_type. Must be one of: ${VALID_ENTITY_TYPES.join(", ")}` };
						}
						updates.entity_type = args.entity_type;
					}
					if (args.tags !== undefined) updates.tags = args.tags;
					if (args.salience !== undefined) updates.salience = args.salience;
					if (args.primary_context !== undefined) updates.primary_context = args.primary_context;

					if (Object.keys(updates).length === 0) return { error: "No fields to update" };

					const updated = await storage.updateEntity(entity.id, updates);
					return { updated: true, entity: updated };
				}

				case "relate": {
					if (!args.from_entity_id || !args.to_entity_id) return { error: "from_entity_id and to_entity_id required" };
					if (!args.relation_type) return { error: "relation_type required" };
					if (args.relation_type.length > 100) return { error: "relation_type too long (max 100 chars)" };

					// Verify both entities belong to current tenant
					const [fromEntity, toEntity] = await Promise.all([
						storage.findEntityById(args.from_entity_id),
						storage.findEntityById(args.to_entity_id)
					]);
					if (!fromEntity) return { error: "from_entity not found" };
					if (!toEntity) return { error: "to_entity not found" };

					const strength = Math.max(0, Math.min(1, args.strength ?? 1.0));

					const relation = await storage.createRelation({
						tenant_id: storage.getTenant(),
						from_entity_id: args.from_entity_id,
						to_entity_id: args.to_entity_id,
						relation_type: args.relation_type,
						strength,
						context: args.relation_context
					});
					return { related: true, relation };
				}

				case "link": {
					if (!args.observation_id) return { error: "observation_id required" };
					if (!args.entity_id) return { error: "entity_id required" };

					const [obs, ent] = await Promise.all([
						storage.findObservation(args.observation_id),
						storage.findEntityById(args.entity_id)
					]);
					if (!obs) return { error: "Observation not found" };
					if (!ent) return { error: "Entity not found" };

					await storage.linkObservationToEntity(args.observation_id, args.entity_id);
					return { linked: true, observation_id: args.observation_id, entity_id: args.entity_id };
				}

				case "backfill": {
					// One-shot admin operation: migrate observations with entity_tags
					// to proper entities, then link observations to those entities.

					const rows = await storage.queryEntityTagsForBackfill();

					if (rows.length === 0) {
						return { backfilled: 0, entities_created: 0, entities_existing: 0 };
					}

					// Step 1: collect all distinct tags across qualifying observations
					const allTags = new Set<string>();
					for (const row of rows) {
						for (const tag of row.entity_tags) {
							if (tag) allTags.add(tag);
						}
					}

					if (allTags.size > 200) {
						return { error: "Too many distinct entity_tags (max 200 per backfill run)" };
					}

					// Step 2: resolve each tag to an entity (find or create)
					const tagToEntityId = new Map<string, string>();
					let entities_created = 0;
					let entities_existing = 0;

					for (const tag of allTags) {
						const existing = await storage.findEntityByName(tag);
						if (existing) {
							tagToEntityId.set(tag, existing.id);
							entities_existing++;
						} else {
							const created = await storage.createEntity({
								tenant_id: storage.getTenant(),
								name: tag,
								entity_type: 'concept',
								tags: [],
								salience: 'active'
							});
							tagToEntityId.set(tag, created.id);
							entities_created++;
						}
					}

					// Step 3: link each observation to its first entity_tag
					let backfilled = 0;
					for (const row of rows) {
						const firstTag = row.entity_tags[0];
						if (!firstTag) continue;
						const entityId = tagToEntityId.get(firstTag);
						if (!entityId) continue;
						await storage.linkObservationToEntity(row.id, entityId);
						backfilled++;
					}

					const has_more = rows.length === 500;
					return { backfilled, entities_created, entities_existing, has_more };
				}

				default:
					return { error: `Unknown action: ${action}` };
			}
		}

		default:
			throw new Error(`Unknown entity tool: ${name}`);
	}
}
